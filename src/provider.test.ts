import { generateText, streamText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLiquid } from './provider.js'

const block = {
  job_id: 'job_1',
  status: 'pending',
  charge: { cap_usd: 0.5, cap_nanos: 500000000, estimated_usd: 0.01 },
}

function completion(extra: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    ...extra,
  }
}

function recorder(respond: () => Response) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    })
    return respond()
  })
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch }
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllEnvs())

describe('createLiquid', () => {
  it('sends the key, the default cap and the base URL', async () => {
    const { calls, fetch } = recorder(() => json(completion()))
    const provider = createLiquid({ apiKey: 'sk-test', baseURL: 'https://x.test/v1/', fetch })
    await generateText({ model: provider('gpt-oss-120b'), prompt: 'hi' })
    const [call] = calls
    expect(call?.url).toBe('https://x.test/v1/chat/completions')
    expect(call?.headers.get('authorization')).toBe('Bearer sk-test')
    expect(call?.headers.get('x-liquid-cap-usd')).toBe('1')
    expect(call?.body.model).toBe('gpt-oss-120b')
  })

  it('reads the key from the environment when the request starts', async () => {
    const { calls, fetch } = recorder(() => json(completion()))
    const provider = createLiquid({ fetch })
    vi.stubEnv('LIQUID_API_KEY', 'sk-env')
    await generateText({ model: provider('m'), prompt: 'hi' })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer sk-env')
  })

  it('fails with a clear error when no key is set', async () => {
    vi.stubEnv('LIQUID_API_KEY', undefined)
    const { fetch } = recorder(() => json(completion()))
    const provider = createLiquid({ fetch })
    await expect(generateText({ model: provider('m'), prompt: 'hi' })).rejects.toThrow(
      /LIQUID_API_KEY/
    )
  })

  it('sends no cap header when capUsd is null', async () => {
    const { calls, fetch } = recorder(() => json(completion()))
    const provider = createLiquid({ apiKey: 'k', capUsd: null, fetch })
    await generateText({ model: provider('m'), prompt: 'hi' })
    expect(calls[0]?.headers.has('x-liquid-cap-usd')).toBe(false)
  })

  it('merges the default rules with the rules of one call', async () => {
    const { calls, fetch } = recorder(() => json(completion()))
    const provider = createLiquid({
      apiKey: 'k',
      fetch,
      exchange: { limits: { ttft_ms: 1500 }, privacy: { retention: 'none' } },
    })
    await generateText({
      model: provider('m'),
      prompt: 'hi',
      providerOptions: { liquid: { exchange: { limits: { ttft_ms: 500 }, cap_usd: 0.05 } } },
    })
    expect(calls[0]?.body.exchange).toEqual({
      limits: { ttft_ms: 500 },
      privacy: { retention: 'none' },
      cap_usd: 0.05,
    })
  })

  it('sends the rules of a call when there are no default rules', async () => {
    const { calls, fetch } = recorder(() => json(completion()))
    const provider = createLiquid({ apiKey: 'k', fetch })
    await generateText({
      model: provider('m'),
      prompt: 'hi',
      providerOptions: { liquid: { exchange: { cap_usd: 0.05 } } },
    })
    expect(calls[0]?.body.exchange).toEqual({ cap_usd: 0.05 })
  })

  it('returns the exchange block in the provider metadata', async () => {
    const { fetch } = recorder(() => json(completion({ exchange: block })))
    const provider = createLiquid({ apiKey: 'k', fetch })
    const result = await generateText({ model: provider('m'), prompt: 'hi' })
    expect(result.providerMetadata?.liquid).toEqual({ exchange: block })
  })

  it('leaves the metadata out when the response has no block', async () => {
    const { fetch } = recorder(() => json(completion()))
    const provider = createLiquid({ apiKey: 'k', fetch })
    const result = await generateText({ model: provider('m'), prompt: 'hi' })
    expect(result.providerMetadata?.liquid?.exchange).toBeUndefined()
  })

  it('returns the block of the last chunk of a stream', async () => {
    const chunk = (delta: object, extra: object = {}) =>
      `data: ${JSON.stringify({ id: 'c', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`
    const sse =
      chunk({ role: 'assistant', content: 'hi' }) +
      `data: ${JSON.stringify({
        id: 'c',
        created: 1,
        model: 'm',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        exchange: { ...block, status: 'settled' },
      })}\n\n` +
      'data: [DONE]\n\n'
    const { calls, fetch } = recorder(
      () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
    )
    const provider = createLiquid({ apiKey: 'k', fetch })
    const result = streamText({ model: provider('m'), prompt: 'hi' })
    expect(await result.text).toBe('hi')
    expect((await result.providerMetadata)?.liquid).toEqual({
      exchange: { ...block, status: 'settled' },
    })
    expect(calls[0]?.body.stream_options).toEqual({ include_usage: true })
  })
})
