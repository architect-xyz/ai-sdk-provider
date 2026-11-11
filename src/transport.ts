import { APICallError } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'

import type { ExchangeRules } from './rules.js'

/** What a model needs to call the exchange. */
export interface Transport {
  baseURL: string
  /** The headers of each request: the cap, `explain` and the headers of the settings. */
  headers: Record<string, string>
  /** Adds the key when a request starts. */
  fetch: FetchFunction
  /** The default purchasing rules. */
  exchange: ExchangeRules | undefined
}

type Plain = Record<string, unknown>

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Merges two objects. A field of `over` replaces the same field of `base`; plain objects merge. */
export function merge(base: Plain, over: Plain): Plain {
  const out: Plain = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const current = out[key]
    out[key] = isPlain(current) && isPlain(value) ? merge(current, value) : value
  }
  return out
}

export function mergeRules(
  defaults: ExchangeRules | undefined,
  call: ExchangeRules | undefined
): ExchangeRules | undefined {
  if (!defaults) return call
  return merge(defaults as Plain, (call ?? {}) as Plain) as ExchangeRules
}

export async function failure(response: Response, url: string, body: unknown) {
  const bodyText = await response.text()
  let data: unknown
  try {
    data = JSON.parse(bodyText)
  } catch {
    data = undefined
  }
  return new APICallError({
    message: `Liquid request failed with status ${response.status}`,
    url,
    requestBodyValues: body,
    statusCode: response.status,
    responseBody: bodyText,
    data,
    isRetryable: response.status === 429 || response.status >= 500,
  })
}

/** Sends a JSON request and throws an `APICallError` for a status that is not 2xx. */
export async function postJson(
  transport: Transport,
  path: string,
  body: Plain,
  options: { headers?: Record<string, string | undefined>; abortSignal?: AbortSignal }
): Promise<Response> {
  const url = `${transport.baseURL}${path}`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const source of [transport.headers, options.headers ?? {}]) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) headers[key.toLowerCase()] = value
    }
  }
  const response = await transport.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.abortSignal,
  })
  if (!response.ok) throw await failure(response, url, body)
  return response
}

export function responseHeaders(response: Response): Record<string, string> {
  const out: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}
