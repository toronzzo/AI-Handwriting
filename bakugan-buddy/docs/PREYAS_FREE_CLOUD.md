# Preyas free-cloud fallback (opt-in)

One optional cloud provider can take over when the local model is down. It is
off on every fresh install: with no environment set, chat behaves exactly as
before and nothing leaves the Mac.

## The provider

**Groq (GroqCloud, Free plan).** Verified against Groq's own documentation:

| What | Value |
| --- | --- |
| Chat endpoint | `POST https://api.groq.com/openai/v1/chat/completions` |
| Health endpoint | `GET https://api.groq.com/openai/v1/models` |
| Authentication | `Authorization: Bearer <key>` (an API key from console.groq.com) |
| Wire format | OpenAI-compatible chat completions, the same shape the local brain speaks |
| Default model | `llama-3.1-8b-instant` |
| Free-plan limits (published sample) | 30 requests/min, 1,000 requests/day, 8,000 tokens/min, 200,000 tokens/day, counted per organization. Your account's own Limits page is authoritative. |
| Over the limit | Requests answer `429 Too Many Requests`; they are not billed |
| Data handling | Inputs and outputs are not retained by default for inference; usage metadata always is, and short logs may be kept for reliability or abuse checks (see console.groq.com/docs/your-data). A cloud turn still leaves your Mac. |

Sources: [API reference](https://console.groq.com/docs/api-reference),
[OpenAI compatibility](https://console.groq.com/docs/openai),
[rate limits](https://console.groq.com/docs/rate-limits),
[your data](https://console.groq.com/docs/your-data),
[models](https://console.groq.com/docs/models).

Model names are Groq's, and Groq's models are its own; nothing in this
repository redistributes them. The adapter asks for a model by id and refuses
an answer from anything that is not the expected shape.

## What turns it on

Cloud use needs **all four** of these. Any one missing keeps the old path:

| Flag | Meaning | Default |
| --- | --- | --- |
| `PREYAS_ROUTER=1` | The routing layer is on | off |
| `PREYAS_ROUTER_MODE=fallback` or `manual` | A mode that may leave the Mac | `prefer-local` |
| `PREYAS_ROUTER_ALLOW_CLOUD=1` | Explicit cloud opt-in | off |
| `PREYAS_FREE_CLOUD=1` | Explicit provider selection | off |

Plus the provider's own settings:

| Variable | Meaning | Default |
| --- | --- | --- |
| `GROQ_API_KEY` | The provider key. Required; a missing, blank, `changeme` or non-`gsk_` value disables the provider | unset |
| `GROQ_MODEL` | Model id | `llama-3.1-8b-instant` |
| `GROQ_BASE_URL` | Base URL. Must be https (plain http only on loopback for tests) | `https://api.groq.com/openai/v1` |
| `PREYAS_FREE_CLOUD_TIMEOUT_MS` | Chat budget in ms, 1000-120000 | 90000 |
| `PREYAS_FREE_CLOUD_PROBE_TIMEOUT_MS` | Health-check budget in ms, 50-10000 | 2500 |

Every app-side flag also has an `EXPO_PUBLIC_` twin, as the router flags
already did (`EXPO_PUBLIC_PREYAS_FREE_CLOUD`, and so on).

## Routing rules

| Situation | Result |
| --- | --- |
| Router off | `legacy` — the existing chat path, no provider call |
| Invalid provider configuration | `unavailable` — no request is made |
| `prefer-local`, local healthy | `local`; never falls back to cloud |
| `prefer-local`, local down | `unavailable` |
| `fallback`, local healthy | `local` |
| `fallback`, local down, opt-in complete | the fallback slot, which the free-cloud provider fills |
| `fallback`, local down, no opt-in or no key | `unavailable` |
| `manual`, provider named, opt-in complete | that provider only |
| `manual` naming `free-cloud` | still a placeholder; the provider lives in the fallback slot |
| Provider unhealthy, timed out, rate limited, unauthorised | `unavailable` |

The free-cloud slot itself stays a disabled placeholder: the activated
provider fills the dedicated fallback slot, so it can only be reached through
fallback or manual mode. Nothing ever falls back to the cloud on its own: the
router decides before a message is sent, and a provider failure maps to
unavailable rather than to another attempt.

## Turning it on

1. Create a key at console.groq.com (Free plan, no card needed for the free tier).
2. Put it in the existing secrets file the gateway already reads,
   `$AGENT_DRIVE_ROOT/secrets/.env`, **not** in this repository:

   ```sh
   echo 'GROQ_API_KEY=gsk_...' >> "$AGENT_DRIVE_ROOT/secrets/.env"
   chmod 600 "$AGENT_DRIVE_ROOT/secrets/.env"
   ```

3. Add the four opt-ins next to it (or to `brain.env` on the Mac):

   ```sh
   PREYAS_ROUTER=1
   PREYAS_ROUTER_MODE=fallback
   PREYAS_ROUTER_ALLOW_CLOUD=1
   PREYAS_FREE_CLOUD=1
   ```

4. Restart the brain. Check the Brain view: the free-cloud node reads
   "Configured and reachable" only after the model list answered. Otherwise it
   says why in plain words, and never shows the key or the provider's error body.

To undo it, unset `PREYAS_FREE_CLOUD` (or the key). Chat returns to the local
path on the next start.

## Boundaries

- The key is read from the environment or the existing secrets file. It is
  never logged, never returned in status, and never sent through a redirect.
- Every request has a deadline and a size cap. A caller cancellation rejects
  with `RouterCancelledError`; a provider deadline rejects with a timeout
  reason. The two are never conflated.
- Chat answers are validated before use: a JSON object, at least one choice,
  a non-empty string message. Anything else is refused.
- The cloud route sees only the persona system message, the newest turns that
  fit the local history budget, and the user turn. Notes, the Brain view and
  other state never travel with it.
- The router source names no provider. Only `freeCloud.ts` knows Groq.

## Tests

```sh
npm --prefix bakugan-buddy/packages/alive test
```

`freeCloud.test.ts` covers flag-off, missing and malformed keys, invalid
configuration, the opt-in chain, local-preferred order, fallback and manual
modes, timeouts, caller cancellation, invalid provider responses and the
legacy chat path with every new flag off. `liveBrain.test.ts` covers the Brain
status mapping.
