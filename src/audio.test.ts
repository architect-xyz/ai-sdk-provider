import {
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
} from 'ai'
import { describe, expect, it } from 'vitest'

import { getLiquidError } from './errors.js'
import { createLiquid } from './provider.js'

interface Call {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

function stub(respond: () => Response) {
  const calls: Call[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    })
    return respond()
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const block = {
  job_id: 'job_a',
  status: 'settled',
  charge: { cap_usd: 0.01, cap_nanos: 1e7, estimated_usd: 0.001, total_usd: 0.0008 },
}

describe('speechModel', () => {
  it('posts the text and returns the audio and the block from the header', async () => {
    const { calls, fetch } = stub(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg', 'x-liquid-exchange': JSON.stringify(block) },
        })
    )
    const provider = createLiquid({
      apiKey: 'k',
      baseURL: 'https://x.test/v1',
      fetch,
      exchange: { privacy: { retention: 'none' } },
    })
    const result = await generateSpeech({
      model: provider.speechModel('tts-1'),
      text: 'Hello',
      voice: 'alloy',
      speed: 1.2,
      outputFormat: 'mp3',
      instructions: 'warm',
      providerOptions: { liquid: { exchange: { cap_usd: 0.01 }, quality: 'high' } },
    })
    const [call] = calls
    expect(call?.url).toBe('https://x.test/v1/audio/speech')
    expect(call?.headers.get('authorization')).toBe('Bearer k')
    expect(call?.headers.get('x-liquid-cap-usd')).toBe('1')
    expect(call?.body).toEqual({
      model: 'tts-1',
      input: 'Hello',
      voice: 'alloy',
      instructions: 'warm',
      speed: 1.2,
      response_format: 'mp3',
      quality: 'high',
      exchange: { privacy: { retention: 'none' }, cap_usd: 0.01 },
    })
    expect([...result.audio.uint8Array]).toEqual([1, 2, 3])
    expect(result.providerMetadata.liquid?.exchange).toEqual(block)
  })

  it('warns that language is not supported', async () => {
    const { fetch } = stub(() => new Response(new Uint8Array([1])))
    const provider = createLiquid({ apiKey: 'k', fetch })
    const result = await generateSpeech({
      model: provider.speechModel('tts-1'),
      text: 'Hi',
      language: 'en',
    })
    expect(result.warnings.map((w) => w.type === 'unsupported' && w.feature)).toContain('language')
  })

  it('throws an error that getLiquidError reads', async () => {
    const { fetch } = stub(
      () =>
        new Response(JSON.stringify({ error: { code: 'unsupported_model', message: 'no' } }), {
          status: 400,
        })
    )
    const provider = createLiquid({ apiKey: 'k', fetch })
    const error = await generateSpeech({
      model: provider.speechModel('liquid.auto'),
      text: 'Hi',
      maxRetries: 0,
    }).catch((e: unknown) => e)
    expect(getLiquidError((error as { cause?: unknown }).cause ?? error)?.code).toBe(
      'unsupported_model'
    )
  })
})

describe('transcriptionModel', () => {
  it('sends the audio as an input reference and maps the transcript', async () => {
    const { calls, fetch } = stub(
      () =>
        new Response(
          JSON.stringify({
            task: 'transcribe',
            text: 'hello world',
            language: 'en',
            duration: 2.5,
            segments: [{ id: 0, start: 0, end: 2.5, text: 'hello world' }],
            words: [{ word: 'hello', start: 0, end: 1 }],
            usage: { type: 'duration', seconds: 3 },
            exchange: block,
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    )
    const provider = createLiquid({ apiKey: 'k', baseURL: 'https://x.test/v1', fetch })
    const result = await transcribe({
      model: provider.transcriptionModel('whisper'),
      audio: new Uint8Array([1, 2, 3]),
      providerOptions: { liquid: { diarize: true, keyterms: ['Liquid'], language: 'en' } },
    })
    const [call] = calls
    expect(call?.url).toBe('https://x.test/v1/audio/transcriptions')
    expect(call?.body).toMatchObject({
      model: 'whisper',
      response_format: 'verbose_json',
      diarize: true,
      keyterms: ['Liquid'],
      language: 'en',
    })
    const refs = call?.body.input_references as { type: string; data: string }[]
    expect(refs[0]?.type).toBe('audio')
    expect(refs[0]?.data).toBe('AQID')
    expect(result.text).toBe('hello world')
    expect(result.segments).toEqual([{ text: 'hello world', startSecond: 0, endSecond: 2.5 }])
    expect(result.language).toBe('en')
    expect(result.durationInSeconds).toBe(2.5)
    expect(result.providerMetadata.liquid?.exchange).toEqual(block)
  })
})
