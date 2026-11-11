import type { MetadataExtractor } from '@ai-sdk/openai-compatible'

import type { LiquidExchangeBlock } from './rules.js'

type Metadata = Awaited<ReturnType<MetadataExtractor['extractMetadata']>>

function readBlock(body: unknown): LiquidExchangeBlock | undefined {
  if (typeof body !== 'object' || body === null || !('exchange' in body)) return undefined
  const block = body.exchange
  if (typeof block !== 'object' || block === null || !('job_id' in block)) return undefined
  return block as LiquidExchangeBlock
}

function toMetadata(block: LiquidExchangeBlock | undefined): Metadata {
  return block ? { liquid: { exchange: block as never } } : undefined
}

/** Copies the `exchange` block of the response into `providerMetadata.liquid`. */
export const exchangeMetadata: MetadataExtractor = {
  extractMetadata: async ({ parsedBody }) => toMetadata(readBlock(parsedBody)),
  createStreamExtractor: () => {
    let block: LiquidExchangeBlock | undefined
    return {
      // The exchange puts the block on the terminal chunk of the stream.
      processChunk(chunk) {
        block = readBlock(chunk) ?? block
      },
      buildMetadata: () => toMetadata(block),
    }
  },
}
