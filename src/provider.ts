import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import { loadApiKey, withoutTrailingSlash, type FetchFunction } from '@ai-sdk/provider-utils'

import { exchangeMetadata } from './metadata.js'
import type { ExchangeRules } from './rules.js'

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
  headers?: Record<string, string>
  fetch?: FetchFunction
  /** Report token counts for a stream. Defaults to true. */
  includeUsage?: boolean
}

export type LiquidProvider = OpenAICompatibleProvider<string, string, string, string>

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

  return createOpenAICompatible({
    name: 'liquid',
    baseURL,
    headers: {
      ...(capUsd === null ? {} : { 'x-liquid-cap-usd': String(capUsd) }),
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
}

/** The provider with the default settings. It reads `LIQUID_API_KEY` when a request starts. */
export const liquid: LiquidProvider = createLiquid()
