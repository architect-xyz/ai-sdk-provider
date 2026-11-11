import type { SharedV4Warning, SpeechModelV4, TranscriptionModelV4 } from '@ai-sdk/provider'
import { convertUint8ArrayToBase64 } from '@ai-sdk/provider-utils'

import { mergeRules, postJson, responseHeaders, type Transport } from './transport.js'
import type { ExchangeRules, LiquidExchangeBlock } from './rules.js'

/** `providerOptions.liquid` of a speech call. */
export interface LiquidSpeechOptions {
  exchange?: ExchangeRules
  /** Asks for a quality tier, for an offer that declared it. */
  quality?: string
}

/** `providerOptions.liquid` of a transcription call. */
export interface LiquidTranscriptionOptions {
  exchange?: ExchangeRules
  /** The words and names that the transcript must spell as given. */
  keyterms?: string[]
  /** Label each segment with its speaker. Only an offer that declared it can win. */
  diarize?: boolean
  prompt?: string
  temperature?: number
  /** An ISO 639-1 hint for the spoken language. */
  language?: string
}

type Options = Record<string, unknown> | undefined

function parseHeaderBlock(value: string | null): LiquidExchangeBlock | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as LiquidExchangeBlock
  } catch {
    return undefined
  }
}

export class LiquidSpeechModel implements SpeechModelV4 {
  readonly specificationVersion = 'v4'
  readonly provider = 'liquid.speech'

  constructor(
    readonly modelId: string,
    private readonly transport: Transport
  ) {}

  async doGenerate(options: Parameters<SpeechModelV4['doGenerate']>[0]) {
    const warnings: SharedV4Warning[] = []
    if (options.language !== undefined) {
      warnings.push({
        type: 'unsupported',
        feature: 'language',
        details: 'The exchange speech route has no language field. Choose a voice instead.',
      })
    }
    const call = options.providerOptions?.liquid as Options as LiquidSpeechOptions | undefined
    const exchange = mergeRules(this.transport.exchange, call?.exchange)
    const body = {
      model: this.modelId,
      input: options.text,
      ...(options.voice !== undefined && { voice: options.voice }),
      ...(options.instructions !== undefined && { instructions: options.instructions }),
      ...(options.speed !== undefined && { speed: options.speed }),
      ...(options.outputFormat !== undefined && { response_format: options.outputFormat }),
      ...(call?.quality !== undefined && { quality: call.quality }),
      ...(exchange && { exchange }),
    }
    const response = await postJson(this.transport, '/audio/speech', body, options)
    const audio = new Uint8Array(await response.arrayBuffer())
    // The body is audio, so the exchange block is in a header.
    const block = parseHeaderBlock(response.headers.get('x-liquid-exchange'))
    return {
      audio,
      warnings,
      request: { body },
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders(response),
      },
      providerMetadata: block ? { liquid: { exchange: block as never } } : undefined,
    }
  }
}

interface TranscriptionBody {
  text: string
  language?: string | null
  duration?: number
  segments?: { text: string; start: number; end: number }[]
  words?: { word: string; start: number; end: number }[]
  usage?: { seconds?: number }
  exchange?: LiquidExchangeBlock
}

export class LiquidTranscriptionModel implements TranscriptionModelV4 {
  readonly specificationVersion = 'v4'
  readonly provider = 'liquid.transcription'

  constructor(
    readonly modelId: string,
    private readonly transport: Transport
  ) {}

  async doGenerate(options: Parameters<TranscriptionModelV4['doGenerate']>[0]) {
    const call = options.providerOptions?.liquid as Options as
      LiquidTranscriptionOptions | undefined
    const exchange = mergeRules(this.transport.exchange, call?.exchange)
    const data =
      typeof options.audio === 'string' ? options.audio : convertUint8ArrayToBase64(options.audio)
    const body = {
      model: this.modelId,
      input_references: [{ type: 'audio', data, media_type: options.mediaType }],
      response_format: 'verbose_json',
      ...(options.timestampGranularities && {
        timestamp_granularities: options.timestampGranularities,
      }),
      ...(call?.language !== undefined && { language: call.language }),
      ...(call?.prompt !== undefined && { prompt: call.prompt }),
      ...(call?.temperature !== undefined && { temperature: call.temperature }),
      ...(call?.diarize !== undefined && { diarize: call.diarize }),
      ...(call?.keyterms !== undefined && { keyterms: call.keyterms }),
      ...(exchange && { exchange }),
    }
    const response = await postJson(this.transport, '/audio/transcriptions', body, options)
    const result = (await response.json()) as TranscriptionBody
    return {
      text: result.text,
      segments: (result.segments ?? []).map((s) => ({
        text: s.text,
        startSecond: s.start,
        endSecond: s.end,
      })),
      words: result.words?.map((w) => ({ text: w.word, startSecond: w.start, endSecond: w.end })),
      language: result.language ?? undefined,
      durationInSeconds: result.duration ?? result.usage?.seconds,
      warnings: [],
      // The audio is not repeated in the recorded request.
      request: { body: JSON.stringify({ ...body, input_references: '[audio]' }) },
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders(response),
        body: result,
      },
      providerMetadata: result.exchange
        ? { liquid: { exchange: result.exchange as never } }
        : undefined,
    }
  }
}
