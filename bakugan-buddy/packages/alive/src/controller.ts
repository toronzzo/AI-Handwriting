import { normalizeMood, type Mood } from "../../mood/src/index.ts";
import { type AdvisorInput, type AdvisorSuggestion, isSkillId } from "./advisor.ts";
import { activeSituation, BarkMemory, pickBark } from "./barks.ts";
import { EXPLORE_POINTS } from "./data/room.ts";
import { SKILL_LIST } from "./data/skills.ts";
import { scoreRing, stepToward, turnToward, hurryFor, type Spot, type StepOut } from "./follow.ts";
import { emptyFacts, EventLog, exportMemoryJson, loadMemoryJson } from "./memory.ts";
import { makeSlot, resetSlot, tickNotice, type NoticeSlot } from "./perception.ts";
import { clipFor, sampleIdle, type PoseSample } from "./pose.ts";
import { pickSkill } from "./skills.ts";
import {
  ADVICE_HOLD_MS,
  IDLE_SPIN,
  MAX_DT,
  NOTICE_MOOD_MS,
  NOTICE_MS,
  POSE_LIMITS,
  ROOM_MAX,
  ROOM_MIN,
  SCAN_MS,
  SETTLED_MS,
  SPOT_COUNT,
  PLAYER_MOVE_SPEED,
} from "./tuning.ts";
import type { AliveFrame, AliveInput, MemoryFacts, SkillContext, SkillId } from "./types.ts";

export type AliveOptions = {
  x?: number;
  z?: number;
  seed?: number;
  noticeMs?: number;
  /** Resting mood loaded from the emotion store. Skills can still override it. */
  mood?: Mood;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * One Preyas. `tick` is the whole brain for a frame: perception, memory,
 * skills, follow ring, explore, pose, bark. It returns the same object
 * every call and does not allocate along that path.
 */
export class AliveController {
  readonly log = new EventLog();
  readonly facts: MemoryFacts = emptyFacts();
  readonly spots: Spot[];
  readonly frame: AliveFrame;

  x: number;
  z: number;
  yaw = 0;

  private readonly rng: () => number;
  private readonly noticeMs: number;
  private readonly playerSlot: NoticeSlot = makeSlot("player", "partner");
  private readonly placeSlot: NoticeSlot = makeSlot("", "");
  private readonly barkState = new BarkMemory();
  private readonly skillCtx: SkillContext = {
    noticedPlayer: false,
    playerVisible: false,
    distance: 0,
    playerMoving: false,
    summon: false,
    sleepRequested: false,
    settled: false,
    explorePoints: EXPLORE_POINTS.length,
    adviceGoal: null,
  };
  private readonly step: StepOut = { x: 0, z: 0, moved: false, hurry: false };
  private readonly pose: PoseSample = { bob: 0, hop: 0, roll: 0, flap: 0, headTilt: 0, eye: 0 };

  private skill: SkillId = "idle-roll";
  private restMood: Mood = "neutral";
  private mood: Mood = "neutral";
  private look = 0;
  private holdSpot = -1;
  private wasHurrying = false;
  private stillForMs = 0;
  private prevPlayerX = Number.NaN;
  private prevPlayerZ = Number.NaN;
  private explorePhase: 0 | 1 | 2 = 0;
  private exploreUntil = 0;
  private exploreTarget = -1;
  private exploreLast = -1;
  private scanBase = 0;
  private adviceGoal: SkillId | null = null;
  private adviceMood: Mood | null = null;
  private adviceUntil = 0;
  private noticedAt = -1_000_000;
  private justNoticed = false;
  private rev = 1;
  private noticeBucket = -1;
  private lastNow = 0;
  private lastMoving = false;
  private lastDist = 0;
  private lastSleep = false;
  private lastSettled = false;

  constructor(options: AliveOptions = {}) {
    this.x = options.x ?? 1.7;
    this.z = options.z ?? 0.5;
    this.noticeMs = options.noticeMs ?? NOTICE_MS;
    if (options.mood) {
      this.restMood = normalizeMood(options.mood);
      this.mood = this.restMood;
    }
    this.rng = mulberry32(options.seed ?? 1);
    this.spots = new Array(SPOT_COUNT);
    for (let i = 0; i < SPOT_COUNT; i++) this.spots[i] = { x: 0, z: 0, score: 0 };
    this.facts.partnerName = "partner";
    this.playerSlot.name = this.facts.partnerName;
    this.frame = {
      rev: this.rev,
      skill: "idle-roll",
      mood: "neutral",
      x: this.x,
      y: 0,
      z: this.z,
      yaw: 0,
      bob: 0,
      hop: 0,
      roll: 0,
      flap: 0,
      headTilt: 0,
      look: 0,
      eye: 0.4,
      hurry: false,
      scanning: false,
      bark: null,
      noticedPlayer: false,
      notice01: 0,
      adviceGoal: null,
      adviceMood: null,
      clip: "idle",
      logCount: 0,
    };
  }

  /** Hint from the mind. Unknown goals are dropped. Does not pick the skill. */
  offerAdvice(suggestion: AdvisorSuggestion | null, nowMs: number): void {
    if (!suggestion || !isSkillId(suggestion.goal)) return;
    const mood = normalizeMood(suggestion.mood);
    const changed = suggestion.goal !== this.adviceGoal || mood !== this.adviceMood;
    this.adviceGoal = suggestion.goal;
    this.adviceMood = mood;
    this.adviceUntil = nowMs + ADVICE_HOLD_MS;
    if (changed) {
      this.log.push(nowMs, "advice", `${suggestion.goal} ${mood}`);
      this.rev += 1;
    }
  }

  advisorSnapshot(): AdvisorInput {
    const events: { t: number; name: string; detail: string }[] = [];
    this.log.visit((event) => {
      events.push({ t: event.t, name: event.name, detail: event.detail });
    });
    const start = events.length > 12 ? events.length - 12 : 0;
    return {
      nowMs: this.lastNow,
      skill: this.skill,
      mood: this.mood,
      noticedPlayer: this.playerSlot.noticed,
      playerMoving: this.lastMoving,
      distance: this.lastDist,
      sleepRequested: this.lastSleep,
      settled: this.lastSettled,
      events: events.slice(start),
    };
  }

  exportSnapshot(): string {
    return exportMemoryJson(this.log, this.facts);
  }

  loadSnapshot(json: string): boolean {
    const ok = loadMemoryJson(json, this.log, this.facts);
    if (!ok) return false;
    this.playerSlot.name = this.facts.partnerName || "partner";
    this.rev += 1;
    return true;
  }

  writeNewest(max: number, into: string[]): void {
    this.log.writeNewest(max, into);
  }

  /** Drop a suggestion. A wake or mood button outranks a held sleep hint. */
  clearAdvice(): void {
    this.adviceGoal = null;
    this.adviceMood = null;
    this.adviceUntil = 0;
  }

  /** Resting mood from the emotion store. Does not write the log. */
  seedMood(mood: Mood): void {
    this.restMood = normalizeMood(mood);
    this.mood = this.restMood;
  }

  tick(input: AliveInput): AliveFrame {
    const dt = input.dt > MAX_DT ? MAX_DT : input.dt > 0 ? input.dt : 0;
    const dtMs = dt * 1000;
    this.lastNow = input.nowMs;

    let playerSpeed = 0;
    if (Number.isNaN(this.prevPlayerX)) {
      this.prevPlayerX = input.playerX;
      this.prevPlayerZ = input.playerZ;
    } else if (dt > 0) {
      const pdx = input.playerX - this.prevPlayerX;
      const pdz = input.playerZ - this.prevPlayerZ;
      playerSpeed = Math.sqrt(pdx * pdx + pdz * pdz) / dt;
      this.prevPlayerX = input.playerX;
      this.prevPlayerZ = input.playerZ;
    }
    const playerMoving = playerSpeed > PLAYER_MOVE_SPEED || input.summon;
    if (playerMoving) this.stillForMs = 0;
    else this.stillForMs += dtMs;
    const settled = this.stillForMs >= SETTLED_MS;

    const notice = tickNotice(
      this.playerSlot,
      input.playerVisible,
      input.playerX,
      input.playerZ,
      dtMs,
      input.nowMs,
      this.noticeMs,
    );
    this.justNoticed = notice === "noticed";
    if (this.justNoticed) {
      this.noticedAt = input.nowMs;
      this.log.push(input.nowMs, "noticed", this.playerSlot.name);
      this.rev += 1;
    }
    if (this.playerSlot.noticed) {
      this.facts.playerX = this.playerSlot.lastX;
      this.facts.playerZ = this.playerSlot.lastZ;
      this.facts.playerAt = this.playerSlot.lastAt;
    }

    if (input.nowMs > this.adviceUntil) {
      this.adviceGoal = null;
      this.adviceMood = null;
    }

    const dx = input.playerX - this.x;
    const dz = input.playerZ - this.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    const ctx = this.skillCtx;
    ctx.noticedPlayer = this.playerSlot.noticed;
    ctx.playerVisible = input.playerVisible;
    ctx.distance = distance;
    ctx.playerMoving = playerMoving;
    ctx.summon = input.summon;
    ctx.sleepRequested = input.sleepRequested;
    ctx.settled = settled;
    ctx.explorePoints = EXPLORE_POINTS.length;
    ctx.adviceGoal = this.adviceGoal;

    const prevSkill = this.skill;
    const skill = pickSkill(SKILL_LIST, ctx);
    let woke = false;
    let fellAsleep = false;
    if (skill !== prevSkill) {
      this.log.push(input.nowMs, "skill", skill);
      if (prevSkill === "sleep") {
        woke = true;
        this.log.push(input.nowMs, "wake", this.facts.partnerName);
      }
      if (skill === "sleep") {
        fellAsleep = true;
        this.log.push(input.nowMs, "sleep", "ball");
      }
      if (skill === "explore") this.beginScan(input.nowMs);
      this.skill = skill;
      this.rev += 1;
    }

    let hurry = false;
    if (skill === "follow") {
      const index = scoreRing(
        input.playerX,
        input.playerZ,
        this.x,
        this.z,
        input.camForwardX,
        input.camForwardZ,
        this.spots,
        this.holdSpot,
      );
      this.holdSpot = index;
      const spot = this.spots[index]!;
      hurry = hurryFor(distance, this.wasHurrying);
      stepToward(this.x, this.z, spot.x, spot.z, dt, hurry, this.step);
      this.x = this.step.x;
      this.z = this.step.z;
      this.wasHurrying = hurry;
      if (this.step.moved) this.yaw = turnToward(this.yaw, spot.x, spot.z, this.x, this.z, dt);
    } else if (skill === "explore") {
      this.wasHurrying = false;
      hurry = false;
      this.tickExplore(input.nowMs, dt);
    } else if (skill === "idle-roll") {
      this.wasHurrying = false;
      if (input.playerVisible) {
        this.yaw = turnToward(this.yaw, input.playerX, input.playerZ, this.x, this.z, dt);
      } else if (this.playerSlot.lastAt > 0) {
        this.yaw = turnToward(this.yaw, this.playerSlot.lastX, this.playerSlot.lastZ, this.x, this.z, dt);
      } else {
        this.yaw += IDLE_SPIN * dt;
      }
    } else {
      this.wasHurrying = false;
    }

    this.x = clamp(this.x, ROOM_MIN, ROOM_MAX);
    this.z = clamp(this.z, ROOM_MIN, ROOM_MAX);
    this.watchPlace(skill, input.nowMs, dtMs);

    const mood = this.chooseMood(input, skill, hurry);
    const moodJustChanged = mood !== this.mood;
    if (moodJustChanged) {
      this.log.push(input.nowMs, "mood", mood);
      this.mood = mood;
      this.rev += 1;
    }

    const clip = clipFor(skill, mood);
    sampleIdle(mood, input.nowMs * 0.001, clip, this.pose);
    if (skill === "sleep") {
      this.pose.hop = 0;
      this.pose.flap = 0;
      this.pose.bob *= 0.45;
      this.pose.roll *= 0.25;
      this.pose.eye = this.pose.eye > 0.14 ? 0.14 : this.pose.eye;
      this.pose.headTilt *= 0.2;
    }

    const scanning = skill === "explore" && this.explorePhase !== 1;
    this.easeLook(input, skill, scanning, dt);

    const situation = activeSituation({
      skill,
      hurry,
      scanning,
      justNoticed: this.justNoticed,
      woke,
      fellAsleep,
      mood,
      moodJustChanged,
    });
    const bark = pickBark(situation, input.nowMs, this.barkState, this.rng);
    if (bark) {
      this.log.push(input.nowMs, "bark", bark);
      this.rev += 1;
    }

    const notice01 = this.playerSlot.noticed ? 1 : Math.min(1, this.playerSlot.seenMs / this.noticeMs);
    const bucket = this.playerSlot.noticed ? 10 : Math.round(notice01 * 10);
    if (bucket !== this.noticeBucket) {
      this.noticeBucket = bucket;
      this.rev += 1;
    }

    this.lastMoving = playerMoving;
    this.lastDist = distance;
    this.lastSleep = input.sleepRequested;
    this.lastSettled = settled;
    this.justNoticed = false;

    const frame = this.frame;
    frame.rev = this.rev;
    frame.skill = skill;
    frame.mood = mood;
    frame.x = this.x;
    frame.y = 0;
    frame.z = this.z;
    frame.yaw = this.yaw;
    frame.bob = this.pose.bob;
    frame.hop = this.pose.hop;
    frame.roll = this.pose.roll;
    frame.flap = this.pose.flap;
    frame.headTilt = this.pose.headTilt;
    frame.look = this.look;
    frame.eye = this.pose.eye;
    frame.hurry = hurry;
    frame.scanning = scanning;
    frame.bark = bark;
    frame.noticedPlayer = this.playerSlot.noticed;
    frame.notice01 = notice01;
    frame.adviceGoal = this.adviceGoal;
    frame.adviceMood = this.adviceMood;
    frame.clip = clip;
    frame.logCount = this.log.length;
    return frame;
  }

  private chooseMood(input: AliveInput, skill: SkillId, hurry: boolean): Mood {
    if (input.moodOverride) return normalizeMood(input.moodOverride);
    if (this.playerSlot.noticed && input.nowMs - this.noticedAt < NOTICE_MOOD_MS) return "surprised";
    if (skill === "sleep") return "neutral";
    if (hurry) return "excited";
    if (this.adviceMood && input.nowMs <= this.adviceUntil) return this.adviceMood;
    if (skill === "explore" && this.explorePhase !== 1) return "thinking";
    if (skill === "follow") return "happy";
    return this.restMood;
  }

  private beginScan(nowMs: number): void {
    this.explorePhase = 0;
    this.exploreUntil = nowMs + SCAN_MS;
    this.exploreTarget = -1;
    this.scanBase = this.yaw;
  }

  private tickExplore(nowMs: number, dt: number): void {
    if (this.explorePhase === 0 || this.explorePhase === 2) {
      const sweep = Math.sin(nowMs * 0.002) * 0.9;
      const faceX = this.x + Math.sin(this.scanBase + sweep);
      const faceZ = this.z + Math.cos(this.scanBase + sweep);
      this.yaw = turnToward(this.yaw, faceX, faceZ, this.x, this.z, dt);
      if (nowMs < this.exploreUntil) return;
      if (this.explorePhase === 0) {
        this.exploreTarget = this.choosePoint();
        this.explorePhase = 1;
        const point = EXPLORE_POINTS[this.exploreTarget]!;
        this.log.push(nowMs, "explore", point.name);
        this.rev += 1;
      } else {
        this.exploreLast = this.exploreTarget;
        this.beginScan(nowMs);
      }
      return;
    }
    const point = EXPLORE_POINTS[this.exploreTarget]!;
    stepToward(this.x, this.z, point.x, point.z, dt, false, this.step);
    this.x = this.step.x;
    this.z = this.step.z;
    if (this.step.moved) {
      this.yaw = turnToward(this.yaw, point.x, point.z, this.x, this.z, dt);
      return;
    }
    const leftX = point.x - this.x;
    const leftZ = point.z - this.z;
    if (leftX * leftX + leftZ * leftZ <= 0.22 * 0.22) {
      this.explorePhase = 2;
      this.exploreUntil = nowMs + SCAN_MS;
      this.scanBase = this.yaw;
    }
  }

  private choosePoint(): number {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < EXPLORE_POINTS.length; i++) {
      if (i === this.exploreLast && EXPLORE_POINTS.length > 1) continue;
      const point = EXPLORE_POINTS[i]!;
      const dx = point.x - this.x;
      const dz = point.z - this.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const score = dist < 0.35 ? 0 : 1 / (1 + Math.abs(dist - 2.4));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private watchPlace(skill: SkillId, nowMs: number, dtMs: number): void {
    if (skill !== "explore" || this.explorePhase !== 2 || this.exploreTarget < 0) {
      if (!this.placeSlot.noticed) this.placeSlot.seenMs = 0;
      return;
    }
    const point = EXPLORE_POINTS[this.exploreTarget]!;
    if (this.placeSlot.id !== point.id) resetSlot(this.placeSlot, point.id, point.name);
    const result = tickNotice(this.placeSlot, true, point.x, point.z, dtMs, nowMs, this.noticeMs);
    if (result === "noticed") {
      this.facts.lastPlace = point.name;
      this.facts.lastPlaceAt = nowMs;
      this.log.push(nowMs, "noticed", point.name);
      this.rev += 1;
    }
  }

  private easeLook(input: AliveInput, skill: SkillId, scanning: boolean, dt: number): void {
    let target = 0;
    if (skill === "idle-roll" && !this.playerSlot.noticed && input.playerVisible) {
      const toX = input.playerX - this.x;
      const toZ = input.playerZ - this.z;
      const face = Math.atan2(toX, toZ);
      const delta = Math.atan2(Math.sin(face - this.yaw), Math.cos(face - this.yaw));
      target = clamp(delta, -POSE_LIMITS.lookMax, POSE_LIMITS.lookMax);
    } else if (scanning) {
      target = Math.sin(input.nowMs * 0.0016) * POSE_LIMITS.lookMax;
    }
    const maxStep = 2.4 * dt;
    this.look += clamp(target - this.look, -maxStep, maxStep);
  }
}
