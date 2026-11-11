import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import {
  InvalidArgumentError,
  type SpeechModelV4,
  type TranscriptionModelV4,
} from '@ai-sdk/provider'
import { loadApiKey, withoutTrailingSlash, type FetchFunction } from '@ai-sdk/provider-utils'

import { LiquidSpeechModel, LiquidTranscriptionModel } from './audio.js'
import { exchangeMetadata } from './metadata.js'
import { failure, mergeRules, type Transport } from './transport.js'
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
  /** A speech model. The price is per character, so the cap is the charge. */
  speechModel(modelId: string): SpeechModelV4
  /** A transcription model. The price is per second of audio. */
  transcriptionModel(modelId: string): TranscriptionModelV4
}

type Plain = Record<string, unknown>

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

  const headers = {
    ...(capUsd === null ? {} : { 'x-liquid-cap-usd': String(capUsd) }),
    ...(settings.explain ? { 'x-liquid-explain': 'true' } : {}),
    ...settings.headers,
  }
  const transport: Transport = { baseURL, headers, fetch: authorized, exchange: defaults }

  const base = createOpenAICompatible({
    name: 'liquid',
    baseURL,
    headers,
    fetch: authorized,
    includeUsage: settings.includeUsage ?? true,
    metadataExtractor: exchangeMetadata,
    transformRequestBody: defaults
      ? (body) => ({
          ...body,
          exchange: mergeRules(defaults, isPlain(body.exchange) ? body.exchange : undefined),
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
    if (!response.ok) throw await failure(response, url, {})
    return (await response.json()) as T
  }

  return Object.assign(base, {
    listModels: async (options?: { abortSignal?: AbortSignal }) =>
      (await get<{ data: LiquidModel[] }>('/models', options?.abortSignal)).data,
    speechModel: (modelId: string) => new LiquidSpeechModel(modelId, transport),
    transcriptionModel: (modelId: string) => new LiquidTranscriptionModel(modelId, transport),
    getJob: (jobId: string, options?: { abortSignal?: AbortSignal }) =>
      get<LiquidExchangeBlock>(`/jobs/${encodeURIComponent(jobId)}`, options?.abortSignal),
  })
}

/** The provider with the default settings. It reads `LIQUID_API_KEY` when a request starts. */
export const liquid: LiquidProvider = createLiquid()
