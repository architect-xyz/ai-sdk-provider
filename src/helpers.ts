import type { SharedV4ProviderMetadata, SharedV4ProviderOptions } from '@ai-sdk/provider'

import type { LiquidCallOptions, LiquidExchangeBlock } from './rules.js'

/**
 * Types the `providerOptions` of one call.
 *
 * ```ts
 * generateText({ model, prompt, providerOptions: liquidOptions({ exchange: { cap_usd: 0.05 } }) })
 * ```
 */
export function liquidOptions(options: LiquidCallOptions): SharedV4ProviderOptions {
  return { liquid: options as SharedV4ProviderOptions[string] }
}

/** Reads the `exchange` block from the `providerMetadata` of a result or of a step. */
export function getExchange(source: {
  providerMetadata?: SharedV4ProviderMetadata | undefined
}): LiquidExchangeBlock | undefined {
  const block = source.providerMetadata?.liquid?.exchange
  return typeof block === 'object' && block !== null && 'job_id' in block
    ? (block as unknown as LiquidExchangeBlock)
    : undefined
}

/**
 * What the job cost, in USD, when the exchange has settled it.
 * A job that is still `pending` has no total yet, so this returns `undefined`.
 */
export function getChargeUsd(source: {
  providerMetadata?: SharedV4ProviderMetadata | undefined
}): number | undefined {
  const block = getExchange(source)
  return block?.status === 'pending' ? undefined : block?.charge.total_usd
}
