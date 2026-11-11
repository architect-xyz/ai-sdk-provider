import { APICallError } from '@ai-sdk/provider'

/** The `error` object of a refusal or failure from the exchange. */
export interface LiquidErrorInfo {
  status?: number
  /** For example `cap_too_low`, `model_not_found`, `conflicting_parameters` or `invalid_request`. */
  code?: string
  /** The field of the request that the error names. */
  param?: string
  message: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/**
 * Reads the code and the parameter of an exchange error.
 * Returns `undefined` when the error is not an API error that has an `error` body.
 */
export function getLiquidError(error: unknown): LiquidErrorInfo | undefined {
  if (!APICallError.isInstance(error)) return undefined
  const data = error.data
  const body = typeof data === 'object' && data !== null && 'error' in data ? data.error : undefined
  if (typeof body !== 'object' || body === null) return undefined
  const fields = body as Record<string, unknown>
  return {
    status: error.statusCode,
    code: text(fields.code),
    param: text(fields.param),
    message: text(fields.message) ?? error.message,
  }
}
