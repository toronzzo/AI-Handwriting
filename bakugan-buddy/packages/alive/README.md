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

`MockMindAdvisor` is the offline default. `createStudioAdvisor(baseUrl)` posts one `[mood] goal` request to Home Studio `POST /v1/chat` and returns null if the sidecar is down or the line is not a goal. `chainAdvisors(studio, mock)` prefers the studio.

The picker still runs `skillWants`. A suggestion whose skill does not want the frame changes nothing about what he does, other than a mood tint when no stronger performance (notice, hurry, sleep, a button) is in play.

## Memory

Noticed things wait out `NOTICE_MS` before they count. Looking away early resets the timer. Last-known player position updates only while the player is visible.

`exportSnapshot()` / `loadSnapshot(json)` is a versioned JSON log: `{ version, events: [{ t, name, detail }], facts }`. The app writes that string to device storage. The tick never awaits the write.

## Barks

`data/barks.ts` holds 12 lines for each situation. `pickBark` returns a line only when the situation is non-null, the situation cooldown has passed, and the line was not used recently. If every line is spent, he stays quiet. The app shows the line in a bubble and may hand it to Home Studio TTS. There is no baked voice in this package.

## Body

Play the GLB clip from `frame.clip` (`idle`, `happy`, `closed`), then add `bob`, `hop`, `roll`, `flap`, `headTilt`, and `look`. Those offsets are clamped in `POSE_LIMITS`. Bob and hop are never negative. `flap` is a few degrees on top of a clip that was already checked for intersections, and it is zero on the closed clip.
