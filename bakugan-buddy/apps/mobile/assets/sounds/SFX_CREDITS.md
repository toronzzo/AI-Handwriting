# Tier-0 reaction sounds — provenance and credits

Every file in this folder is an **original, synthesized sound**: sine partials,
one-pole filtered noise and linear attack/release envelopes written by this
repository's own generator script. No sample, recording, song, library or
model output is used, so there is no third-party audio to credit and nothing
copyrighted or uncredited is bundled. No Earshot package, model or runtime was
installed to make these; Earshot stays out of this PR (see
`docs/MEDIA_TOOLS.md`).

- **Licence:** the six WAV files are part of this repository and ship under the
  repository's own licence, the same as the code beside them.
- **Where they play:** `apps/mobile/src/media/sounds/` only, through the
  existing `expo-audio` dependency, from the app bundle. There is no network
  call, no download and no stream.
- **Tier 0 scope:** these are short, non-verbal reaction cues for the moods in
  `docs/PREYAS_FROM_ANIME.md` (§3 "Reaction bank", §4 "Tier 0 - reactions").
  They never contain speech, and they are never an AI voice.

## The six files

All are 22 050 Hz, mono, 16-bit PCM WAV (smallest that still sounds clean on
a phone speaker), trimmed of leading and trailing silence, loudness-matched to
the same **-20 dBFS RMS**, peak-limited to **-6 dBFS**, and under 0.5 s.

| File | Cue | Mood | Length | Bytes | Peak | RMS | SHA-256 |
|---|---|---|---|---|---|---|---|
| `pop-open.wav` | Pop open | excited | 0.301 s | 13 300 | -8.7 dBFS | -20.0 dBFS | `464d3f2058dc57346e32220b17206ac35dc4460e79e7f08edaa70a17cb3cfeec` |
| `laugh.wav` | Laugh | happy | 0.374 s | 16 520 | -7.5 dBFS | -20.0 dBFS | `f50793eab9584a916c487ffd6166f1104fc8b5d9a7a9c57ff8a773001a9d7cb6` |
| `gasp.wav` | Gasp | curious | 0.286 s | 12 638 | -6.0 dBFS | -20.0 dBFS | `0669728da31d9b42f1681863928504fc6e0898be5ef398372c2c3bb3db9b69d2` |
| `hmm.wav` | Hmm | thinking | 0.427 s | 18 868 | -8.7 dBFS | -20.0 dBFS | `c22c06b73d9194024bb91fbf5a82ebf045abd919ae3eb07c2405191b4b16483c` |
| `whoop.wav` | Whoop | battle | 0.328 s | 14 500 | -9.0 dBFS | -20.0 dBFS | `81a70bf551fe66c9abe5804e210366f48151cd4f1c1cad6432b19684e60c89d4` |
| `droop.wav` | Droop | sad | 0.456 s | 20 144 | -9.0 dBFS | -20.0 dBFS | `52e30f3792fb63f7f2614951344872aa0b726f73252ee3e670a28cf50deca822` |

Total: 6 files, 95 970 bytes (about 94 KB) for the whole bank.

The cue ids, labels and moods are in
`apps/mobile/src/media/sounds/cues.ts`; this table must list exactly those
files, and `src/media/sounds/sounds.test.ts` fails if the two ever drift
apart or a file is added here without a row.

## How each one is made

Each cue is a small, fixed recipe in the generator (a fundamental that glides,
two or three harmonics, a filtered-noise layer where a breath belongs):

| Cue | Recipe |
|---|---|
| pop-open | a 420 → 1250 Hz glide with a very short noise snap |
| laugh | three short 300-400 Hz bursts, rising a little each time |
| gasp | two soft low-passed noise breaths, one above the other |
| hmm | a 160 → 140 Hz hum with a quiet noise bed |
| whoop | a 520 → 900 Hz rise with a thin noise edge |
| droop | a 300 → 165 Hz fall with a soft noise tail |

To regenerate identical files, run the generator with Node 22 (no packages):
it writes the six WAVs at these exact settings, then the normalise step trims,
loudness-matches and peak-limits them. Changing a seed or a recipe changes the
result, so the header numbers above are the record of what shipped.

## Rules for adding to this folder

1. At most 12 files, each at most 64 KB, each listed in this table.
2. Original or credited-licence material only; no samples from a game, show or
   library, and never a cloned voice.
3. Loudness-matched to the same measured RMS and under 0.5 s, so one cue never
   jumps out beside another.
