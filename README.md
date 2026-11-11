# @liquid/ai-sdk-provider

The Liquid Inference provider for the [Vercel AI SDK](https://ai-sdk.dev).
It wraps `@ai-sdk/openai-compatible` and sends each request to the exchange
through Chat Completions.

```typescript
import { generateText } from 'ai'
import { createLiquid } from '@liquid/ai-sdk-provider'

const liquid = createLiquid({ capUsd: 0.05, exchange: { limits: { ttft_ms: 1500 } } })

const result = await generateText({ model: liquid('liquid.auto'), prompt: 'Say hello.' })
console.log(result.providerMetadata?.liquid?.exchange.job_id)
```

## Settings

| Setting        | Default                              | Meaning                                                      |
| -------------- | ------------------------------------ | ------------------------------------------------------------ |
| `apiKey`       | `LIQUID_API_KEY`, read for each call | A key with the `spend` scope.                                |
| `baseURL`      | `LIQUID_BASE_URL`, then the router   | The base URL. It ends in `/v1`.                              |
| `capUsd`       | `1`                                  | Sent as `x-liquid-cap-usd`. `null` sends no header.          |
| `exchange`     | none                                 | Purchasing rules for each request. A call can change fields. |
| `includeUsage` | `true`                               | Report token counts for a stream.                            |

A call sets rules with `providerOptions: { liquid: { exchange: { ... } } }`.
The fields are in the Purchasing rules guide.

## Metadata

`providerMetadata.liquid.exchange` holds the `exchange` block of the response:
the job id, the provider, the status and the charge. The charge of a stream
is final only when the status is `settled`.

## Release

Each PR that changes behavior adds a changeset:

```bash
npm run changeset
```

A merge to `main` makes the release workflow open or update a "Version packages" PR.
It bumps the version and writes `CHANGELOG.md`. Merging that PR publishes the package to npm,
with provenance, and tags the release on GitHub. The workflow needs the `NPM_TOKEN` secret.

To publish by hand, run `npm run version`, then `npm run release`.
