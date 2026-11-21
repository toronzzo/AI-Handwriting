# Alive layer

Preyas in his room. The phone decides every frame. A mind may suggest a goal and a mood, and the skill list can ignore it.

`tick` on `AliveController` is synchronous. It does not fetch, speak, or save. Perception, the skill picker, the follow ring, explore, pose offsets, and bark cooldowns all finish before the function returns. The same frame object comes back every time.

Mood names are the canonical set in `@bakugan-buddy/mood`. The ball performs five of them (`neutral`, `happy`, `excited`, `sad`, `angry`). `thinking` and `listening` use the neutral set with a tilt. `surprised` and `battle` use the excited set. Battle does not change form; the big creature is a different scene.

## Skills

`data/skills.ts` is the priority list. Higher `priority` wins. `idle-roll` always wants the frame, so the picker always returns a skill.

| Skill | Wants the frame when |
| --- | --- |
| `sleep` | Sleep was requested, or advice says sleep while he is settled and the partner is still. Movement or a call cancels it. |
| `follow` | He has noticed the partner, and they are moving, calling, past the leash, or still out of the comfort ring before he has settled. |
| `explore` | The partner is still and he has settled, or he is alone. He scans, then walks to a point in `data/room.ts`. |
| `idle-roll` | Always. |

## Advisor

```ts
interface MindAdvisor {
  advise(input: AdvisorInput): Promise<AdvisorSuggestion | null>;
}

type AdvisorSuggestion = { goal: SkillId; mood: Mood; because: string };
```

Call `advise` every few seconds, off the frame. Pass `controller.advisorSnapshot()`. Feed a non-null result to `controller.offerAdvice(suggestion, nowMs)`. The hint expires on its own (`ADVICE_HOLD_MS`).

`createBrainAdvisor(baseUrl)` posts to the Mac brain (`/v1/chat/completions`), parses one JSON object `{ line, goal, mood, moodDelta }`, and returns null on timeout, a rate limit, or junk. The room then keeps the bark pools. `createStudioAdvisor` is the older `[mood] goal` line for Home Studio.

The picker still runs `skillWants`. A suggestion whose skill does not want the frame changes nothing about what he does, other than a mood tint when no stronger performance (notice, hurry, sleep, a button) is in play.

## Memory

Noticed things wait out `NOTICE_MS` before they count. Looking away early resets the timer. Last-known player position updates only while the player is visible.

`exportSnapshot()` / `loadSnapshot(json)` is a versioned JSON log: `{ version, events: [{ t, name, detail }], facts }`. The app writes that string to device storage. The tick never awaits the write.

## Barks

`data/barks.ts` holds 12 lines for each situation. `pickBark` returns a line only when the situation is non-null, the situation cooldown has passed, and the line was not used recently. If every line is spent, he stays quiet. The app shows the line in a bubble and may hand it to Home Studio TTS. There is no baked voice in this package.

## Body

Play the GLB clip from `frame.clip` (`idle`, `happy`, `closed`), then add `bob`, `hop`, `roll`, `flap`, `headTilt`, and `look`. Those offsets are clamped in `POSE_LIMITS`. Bob and hop are never negative. `flap` is a few degrees on top of a clip that was already checked for intersections, and it is zero on the closed clip.

## Router foundation

`router.ts` is the flag-gated decision layer for a later chat integration. It
is not wired into chat yet: the existing `chooseRoute` path stays in charge.
Everything below defaults off.

| Flag | Meaning |
| --- | --- |
| `PREYAS_ROUTER=1` or `EXPO_PUBLIC_PREYAS_ROUTER=1` | Turns the router on. |
| `PREYAS_ROUTER_MODE=prefer-local` | Local only; never leaves the Mac. |
| `PREYAS_ROUTER_MODE=fallback-on-local-unavailable` | Local first, then one dedicated fallback only with cloud opt-in. |
| `PREYAS_ROUTER_MODE=manual` | Exactly the provider named by `PREYAS_ROUTER_PROVIDER`. |
| `PREYAS_ROUTER_ALLOW_CLOUD=1` | Explicit opt-in for any cloud route. |

Each flag also has an `EXPO_PUBLIC_` variant for the app build
(`EXPO_PUBLIC_PREYAS_ROUTER_MODE`, and so on).

The default providers are the local health probe (`GET /v1/health` on the
brain proxy) plus two typed, disabled placeholders. Missing, invalid, demo,
offline and timed-out providers are treated as unavailable, and free-cloud
slots are never chosen automatically.
## Free-cloud fallback (opt-in, one provider)

`freeCloud.ts` turns the dedicated fallback slot into one explicit provider.
`router.ts` itself still names no provider. Everything stays off by default:
an empty environment returns the same local adapter and two placeholders.

| Flag | Meaning |
| --- | --- |
| `PREYAS_FREE_CLOUD=1` | Select the free-cloud provider. Needs the router on, a cloud mode and the cloud opt-in. |
| `GROQ_API_KEY` | The provider key, from the environment or the drive's `secrets/.env`. Never committed. |
| `GROQ_MODEL` | Model id; default `llama-3.1-8b-instant`. |
| `GROQ_BASE_URL` | Base URL; https only (loopback http for tests). |
| `PREYAS_FREE_CLOUD_TIMEOUT_MS` | Chat deadline, 1000-120000 ms, default 90000. |
| `PREYAS_FREE_CLOUD_PROBE_TIMEOUT_MS` | Health deadline, 50-10000 ms, default 2500. |

The activated provider fills the **fallback** slot; the free-cloud slot stays a
placeholder, so it can only be reached in fallback or manual mode after the
cloud opt-in. A missing or malformed key, or any invalid setting, leaves the
provider disabled and the route unavailable. The Brain view reads its status
from the existing live-status node data and shows a provider as reachable only
when the health check passed.

Setup, limits and the full routing table: `docs/PREYAS_FREE_CLOUD.md`.

