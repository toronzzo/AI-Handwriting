/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CUE_FILES, TIER0_CUES } from "./cues.ts";

/**
 * The bundled WAVs, the credits file and the cue map must agree.
 *
 * This is also the machine check behind the narrow review rule in
 * brain-server/coach-seed/review-and-merge-pr.md: a .wav is allowed in
 * assets/sounds/ only when it is listed in SFX_CREDITS.md with its measured
 * numbers and its checksum, and the folder stays small.
 */

const ROOT = process.cwd();
const DIR = join(ROOT, "assets/sounds");
const CREDITS = join(DIR, "SFX_CREDITS.md");

/** Media plan A.6: at most 12 files, at most 64 KB each, under 0.5 s. */
const MAX_FILES = 12;
const MAX_BYTES = 64 * 1024;
const MAX_SECONDS = 0.5;
const SAMPLE_RATE = 22_050;

type Wav = { seconds: number; peakDb: number; rmsDb: number; channels: number; bits: number; sampleRate: number };

/** Read the 44-byte canon header of a PCM WAV and measure it. */
function readWav(file: string): Wav {
  const buf = readFileSync(join(DIR, file));
  assert.equal(buf.toString("ascii", 0, 4), "RIFF", `${file}: RIFF`);
  assert.equal(buf.toString("ascii", 8, 12), "WAVE", `${file}: WAVE`);
  assert.equal(buf.toString("ascii", 12, 16), "fmt ", `${file}: fmt chunk`);
  assert.equal(buf.toString("ascii", 36, 40), "data", `${file}: data chunk`);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  assert.equal(buf.readUInt16LE(20), 1, `${file}: PCM`);
  const dataBytes = buf.readUInt32LE(40);
  assert.equal(44 + dataBytes, buf.length, `${file}: header length matches the file`);
  const samples = dataBytes / 2;
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = buf.readInt16LE(44 + i * 2) / 32768;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  // RMS is an amplitude, so its level is 20*log10, not 10*log10(the power).
  const rms = Math.sqrt(sum / samples);
  return {
    seconds: samples / sampleRate,
    peakDb: 20 * Math.log10(peak),
    rmsDb: 20 * Math.log10(rms),
    channels,
    bits,
    sampleRate,
  };
}

/** The rows of the file table in SFX_CREDITS.md, keyed by file name. */
function creditRows(): Map<string, { line: string; cells: string[] }> {
  const rows = new Map<string, { line: string; cells: string[] }>();
  for (const line of readFileSync(CREDITS, "utf8").split("\n")) {
    const match = line.match(/^\|\s*`([^`]+\.wav)`\s*\|/);
    if (!match) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    rows.set(match[1], { line, cells });
  }
  return rows;
}

const wavFiles = readdirSync(DIR).filter((name) => name.toLowerCase().endsWith(".wav")).sort();

test("the folder holds exactly the bank the cue map names", () => {
  assert.deepEqual(wavFiles, [...CUE_FILES].map((file) => `${file}.wav`).sort());
  assert.deepEqual(CUE_FILES.map((file) => `${file}.wav`).sort(), wavFiles);
});

test("the bank stays small enough to review", () => {
  assert.ok(wavFiles.length <= MAX_FILES, `${wavFiles.length} files`);
  for (const file of wavFiles) {
    const bytes = readFileSync(join(DIR, file)).length;
    assert.ok(bytes <= MAX_BYTES, `${file} is ${bytes} bytes`);
  }
});

test("every cue is a short, quiet, 22 kHz mono WAV", () => {
  for (const file of wavFiles) {
    const wav = readWav(file);
    assert.equal(wav.channels, 1, `${file}: mono`);
    assert.equal(wav.bits, 16, `${file}: 16-bit`);
    assert.equal(wav.sampleRate, SAMPLE_RATE, `${file}: sample rate`);
    assert.ok(wav.seconds <= MAX_SECONDS, `${file} is ${wav.seconds}s`);
    assert.ok(wav.seconds > 0.05, `${file} is not empty`);
    // Peak headroom and a restrained level, so the phone is not startled.
    assert.ok(wav.peakDb <= -6, `${file} peaks at ${wav.peakDb.toFixed(1)} dBFS`);
    assert.ok(wav.rmsDb <= -15, `${file} RMS is ${wav.rmsDb.toFixed(1)} dBFS`);
  }
});

test("the cues are loudness-matched to each other", () => {
  const levels = wavFiles.map((file) => readWav(file).rmsDb);
  assert.ok(Math.max(...levels) - Math.min(...levels) < 1.5, `spread ${levels.join(", ")}`);
  // A cross-check that the level maths is amplitude, not power: -20 dBFS RMS
  // is a tenth of full scale on every cue.
  for (const level of levels) {
    assert.ok(Math.abs(level - -20) < 1.5, `peak of the bank should sit at -20 dBFS RMS, got ${level}`);
  }
});

test("SFX_CREDITS.md lists every asset with its length, level and checksum", () => {
  assert.ok(existsSync(CREDITS), "SFX_CREDITS.md must exist beside the WAVs");
  const rows = creditRows();
  for (const file of wavFiles) {
    const row = rows.get(file);
    assert.ok(row, `${file} has no row in SFX_CREDITS.md`);
    const wav = readWav(file);
    const checksum = createHash("sha256").update(readFileSync(join(DIR, file))).digest("hex");
    assert.ok(row.line.includes(checksum), `${file}: checksum row is stale, run the generator`);
    assert.ok(row.line.includes(`${wav.seconds.toFixed(3)} s`), `${file}: length row is stale`);
    assert.ok(row.line.includes(`${wav.peakDb.toFixed(1)} dBFS`), `${file}: peak row is stale`);
    assert.ok(row.line.includes(`${wav.rmsDb.toFixed(1)} dBFS`), `${file}: RMS row is stale`);
    // The size column is written in thousands ("20 144"), so compare with the
    // whitespace removed rather than depending on a particular thin space.
    const bytes = String(readFileSync(join(DIR, file)).length);
    assert.ok(
      row.line.replace(/\s/g, "").includes(bytes),
      `${file}: size row is stale`,
    );
  }
});

test("the credits file names each cue and says where it came from", () => {
  const text = readFileSync(CREDITS, "utf8");
  for (const cue of TIER0_CUES) {
    assert.ok(text.includes(cue.id), `${cue.id} missing from the credits`);
  }
  assert.match(text, /original, synthesized/i, "the provenance is stated");
  assert.match(text, /no network|no download|offline/i, "nothing is fetched at runtime");
  assert.ok(creditRows().size === wavFiles.length, "no orphan rows");
});
