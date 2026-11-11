import { APICallError } from '@ai-sdk/provider'
import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { getLiquidError } from './errors.js'
import { getChargeUsd, getExchange, liquidOptions } from './helpers.js'
import { createLiquid } from './provider.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function stub(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; headers: Headers }[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) })
    return respond(String(input), init)
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const settled = {
  job_id: 'job_9',
  status: 'settled',
  charge: { cap_usd: 0.5, cap_nanos: 5e8, estimated_usd: 0.01, total_usd: 0.004 },
}

describe('settings', () => {
  it.each([0, -1, Number.NaN, Infinity])('refuses capUsd %s', (capUsd) => {
    expect(() => createLiquid({ apiKey: 'k', capUsd })).toThrow(/capUsd/)
  })

  it('sends x-liquid-explain when explain is set', async () => {
    const { calls, fetch } = stub(() =>
      json({
        id: 'c',
        created: 1,
        model: 'm',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    )
    const provider = createLiquid({ apiKey: 'k', explain: true, fetch })
    await generateText({ model: provider('m'), prompt: 'hi' })
    expect(calls[0]?.headers.get('x-liquid-explain')).toBe('true')
  })
})

describe('listModels and getJob', () => {
  it('lists the models with the key', async () => {
    const { calls, fetch } = stub(() => json({ object: 'list', data: [{ id: 'liquid.auto' }] }))
    const models = await createLiquid({
      apiKey: 'sk',
      baseURL: 'https://x.test/v1',
      fetch,
    }).listModels()
    expect(models).toEqual([{ id: 'liquid.auto' }])
    expect(calls[0]?.url).toBe('https://x.test/v1/models')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer sk')
  })

  it('reads one job and encodes its id', async () => {
    const { calls, fetch } = stub(() => json(settled))
    const job = await createLiquid({ apiKey: 'k', baseURL: 'https://x.test/v1', fetch }).getJob(
      'job/9'
    )
    expect(job.charge.total_usd).toBe(0.004)
    expect(calls[0]?.url).toBe('https://x.test/v1/jobs/job%2F9')
  })

  it('throws an API error that getLiquidError reads', async () => {
    const { fetch } = stub(() => json({ error: { code: 'not_found', message: 'no job' } }, 404))
    const error = await createLiquid({ apiKey: 'k', fetch })
      .getJob('x')
      .catch((e: unknown) => e)
    expect(APICallError.isInstance(error)).toBe(true)
    expect(getLiquidError(error)).toEqual({
      status: 404,
      code: 'not_found',
      param: undefined,
      message: 'no job',
    })
  })
})

describe('getLiquidError', () => {
  it('reads the code and param of a refused request', async () => {
    const { fetch } = stub(() =>
      json({ error: { code: 'invalid_request', param: 'exchange.cap', message: 'bad' } }, 400)
    )
    const provider = createLiquid({ apiKey: 'k', fetch })
    const error = await generateText({ model: provider('m'), prompt: 'hi' }).catch(
      (e: unknown) => e
    )
    expect(getLiquidError(error)).toMatchObject({
      status: 400,
      code: 'invalid_request',
      param: 'exchange.cap',
    })
  })

  it('returns undefined for another error', () => {
    expect(getLiquidError(new Error('x'))).toBeUndefined()
    expect(getLiquidError(undefined)).toBeUndefined()
  })
})

describe('helpers', () => {
  it('types the provider options', () => {
    expect(liquidOptions({ exchange: { cap_usd: 0.05 } })).toEqual({
      liquid: { exchange: { cap_usd: 0.05 } },
    })
  })

  it('reads the block and the settled charge', () => {
    const source = { providerMetadata: { liquid: { exchange: settled as never } } }
    expect(getExchange(source)?.job_id).toBe('job_9')
    expect(getChargeUsd(source)).toBe(0.004)
  })

  it('has no charge for a pending job or a missing block', () => {
    const pending = { ...settled, status: 'pending' }
    expect(getChargeUsd({ providerMetadata: { liquid: { exchange: pending as never } } })).toBe(
      undefined
    )
    expect(getExchange({})).toBeUndefined()
    expect(getChargeUsd({})).toBeUndefined()
  })

  it('works on a generateText result', async () => {
    const { fetch } = stub(() =>
      json({
        id: 'c',
        created: 1,
        model: 'm',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        exchange: settled,
      })
    )
    const provider = createLiquid({ apiKey: 'k', fetch })
    const spy = vi.fn()
    const result = await generateText({ model: provider('m'), prompt: 'hi' })
    spy(getChargeUsd(result))
    expect(spy).toHaveBeenCalledWith(0.004)
  })
})
