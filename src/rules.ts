/**
 * The purchasing rules that the exchange reads from the `exchange` object of
 * a request. The fields are the ones in the Purchasing rules guide. The
 * router refuses an unknown field with `400 invalid_request`.
 */
export interface ExchangeRules {
  /** The most one job can cost, in USD. */
  cap_usd?: number
  /** The most one job can cost, in nano-USD. Send one of `cap_usd` and `cap_nanos`. */
  cap_nanos?: number
  candidates?: {
    models?: { allow?: string[]; exclude?: string[] }
    creators?: { allow?: string[] }
    providers?: { allow?: string[]; exclude?: string[]; prefer?: string[] }
  }
  rank?: {
    strategy?: 'price' | 'fastest' | 'smartest' | 'auto' | { kind: string; [key: string]: unknown }
    cost_tier?: string
    fast?: boolean
    failure_risk_ranking?: boolean
    latency_nanos_per_ms?: number
    workload_profile?: string
    allow_single_supplier?: boolean
  }
  limits?: {
    cap_usd?: number
    cap_nanos?: number
    price?: {
      input_usd_per_mtok?: number
      output_usd_per_mtok?: number
      cache_read_usd_per_mtok?: number
      cache_write_usd_per_mtok?: number
      unit_usd?: number
    }
    ttft_ms?: number
    completion_ms?: number
    min_tps?: number
  }
  privacy?: {
    retention?: string
    regions?: string[]
    requirements?: string[]
  }
  cache?: {
    mode?: string
    expected_hit_rate?: number
    response?: boolean
    response_ttl_seconds?: number
  }
  session?: {
    sticky?: boolean
    pin?: boolean
    margin?: number
  }
}

/** The options of one call: `providerOptions: { liquid: { exchange: { ... } } }`. */
export interface LiquidCallOptions {
  exchange?: ExchangeRules
}

/** The receipt summary that the exchange adds to each response. */
export interface LiquidExchangeBlock {
  job_id: string
  provider_slug?: string
  offer_id?: string | null
  /** `pending` until usage settles, then `settled` or `credited`. */
  status: string
  charge: {
    cap_usd: number
    cap_nanos: number
    estimated_usd: number
    supplier_usd?: number
    fee_usd?: number
    credits_usd?: number
    /** What the buyer pays. It is never more than `cap_usd`. */
    total_usd?: number
    total_nanos?: number
    [key: string]: unknown
  }
  usage?: Record<string, unknown>
  timing?: Record<string, unknown>
  finish_reason?: string
  /** Present for a request that sent `x-liquid-explain: true`, and for `getJob`. */
  routing?: Record<string, unknown>
  [key: string]: unknown
}

/** What the provider returns in `providerMetadata.liquid`. */
export interface LiquidProviderMetadata {
  exchange: LiquidExchangeBlock
}
