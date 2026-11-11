import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import { APICallError, InvalidArgumentError } from '@ai-sdk/provider'
import { loadApiKey, withoutTrailingSlash, type FetchFunction } from '@ai-sdk/provider-utils'

import { exchangeMetadata } from './metadata.js'
import type { ExchangeRules, LiquidExchangeBlock } from './rules.js'

export const DEFAULT_BASE_URL = 'https://router.inference.ai.exchange/v1'

/** The cap of a request when `capUsd` is not set. */
export const DEFAULT_CAP_USD = 1

export interface LiquidProviderSettings {
  /** Defaults to the `LIQUID_API_KEY` environment variable. Read when a request starts. */
  apiKey?: string
  /** Defaults to `LIQUID_BASE_URL`, then to the public router. It ends in `/v1`. */
  baseURL?: string
  /**
   * The most one request can cost, in USD. It is sent as `x-liquid-cap-usd`.
   * Defaults to 1. Use `null` to send no header, and set a cap in `exchange`.
   */
  capUsd?: number | null
  /** Purchasing rules for every request. The rules of one call replace these field by field. */
  exchange?: ExchangeRules
  /** Add the routing detail to the `exchange` block of each response. */
  explain?: boolean
  headers?: Record<string, string>
  fetch?: FetchFunction
  /** Report token counts for a stream. Defaults to true. */
  includeUsage?: boolean
}

/** An entry of `GET /v1/models`. The exchange adds fields, so any other key can be present. */
export interface LiquidModel {
  id: string
  object?: string
  [key: string]: unknown
}

export type LiquidProvider = OpenAICompatibleProvider<string, string, string, string> & {
  /** Lists the models and router models that a request can name, with the presets of the key. */
  listModels(options?: { abortSignal?: AbortSignal }): Promise<LiquidModel[]>
  /**
   * Reads the receipt of one job, with its routing detail.
   * The receipt can lag the answer by a moment, so a call at once can get a 404.
   */
  getJob(jobId: string, options?: { abortSignal?: AbortSignal }): Promise<LiquidExchangeBlock>
}

type Plain = Record<string, unknown>

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function merge(base: Plain, over: Plain): Plain {
  const out: Plain = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const current = out[key]
    out[key] = isPlain(current) && isPlain(value) ? merge(current, value) : value
  }
  return out
}

export function createLiquid(settings: LiquidProviderSettings = {}): LiquidProvider {
  const baseURL =
    withoutTrailingSlash(settings.baseURL ?? process.env.LIQUID_BASE_URL) ?? DEFAULT_BASE_URL
  const capUsd = settings.capUsd === undefined ? DEFAULT_CAP_USD : settings.capUsd
  if (capUsd !== null && !(Number.isFinite(capUsd) && capUsd > 0)) {
    throw new InvalidArgumentError({
      argument: 'capUsd',
      message: 'capUsd must be a positive number of USD, or null.',
    })
  }
  const upstream: FetchFunction = settings.fetch ?? globalThis.fetch

  const authorized: FetchFunction = (input, init) => {
    const apiKey = loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: 'LIQUID_API_KEY',
      description: 'Liquid Inference',
    })
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${apiKey}`)
    return upstream(input, { ...init, headers })
  }

  const defaults = settings.exchange

  const base = createOpenAICompatible({
    name: 'liquid',
    baseURL,
    headers: {
      ...(capUsd === null ? {} : { 'x-liquid-cap-usd': String(capUsd) }),
      ...(settings.explain ? { 'x-liquid-explain': 'true' } : {}),
      ...settings.headers,
    },
    fetch: authorized,
    includeUsage: settings.includeUsage ?? true,
    metadataExtractor: exchangeMetadata,
    transformRequestBody: defaults
      ? (body) => ({
          ...body,
          exchange: merge(defaults as Plain, isPlain(body.exchange) ? body.exchange : {}),
        })
      : undefined,
  })

  async function get<T>(path: string, abortSignal?: AbortSignal): Promise<T> {
    const url = `${baseURL}${path}`
    const response = await authorized(url, {
      method: 'GET',
      headers: settings.headers,
      signal: abortSignal,
    })
    const bodyText = await response.text()
    let data: unknown
    try {
      data = JSON.parse(bodyText)
    } catch {
      data = undefined
    }
    if (!response.ok) {
      throw new APICallError({
        message: `Liquid request failed with status ${response.status}`,
        url,
        requestBodyValues: {},
        statusCode: response.status,
        responseBody: bodyText,
        data,
        isRetryable: response.status === 429 || response.status >= 500,
      })
    }
    return data as T
  }

  return Object.assign(base, {
    listModels: async (options?: { abortSignal?: AbortSignal }) =>
      (await get<{ data: LiquidModel[] }>('/models', options?.abortSignal)).data,
    getJob: (jobId: string, options?: { abortSignal?: AbortSignal }) =>
      get<LiquidExchangeBlock>(`/jobs/${encodeURIComponent(jobId)}`, options?.abortSignal),
  })
}

/** The provider with the default settings. It reads `LIQUID_API_KEY` when a request starts. */
export const liquid: LiquidProvider = createLiquid()
