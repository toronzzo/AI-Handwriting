/**
 * B6 computer control: the ask-first session. A state machine with an
 * injected clock:
 *   idle -> proposed -> (approved -> running -> idle) | rejected | stopped | expired
 *
 * Rules this file enforces:
 * - ONE pending proposal at a time; the user approves each action with Да/Нет.
 * - Every proposal passes checkDenied (the hard deny list) and then the B3
 *   guard reviewAction; a block stops it, an "ask" is the normal path.
 * - Approval is single-use, bound to a hash of the exact action, valid 60 s.
 * - The deny list is checked AGAIN against a fresh frontmost() right before
 *   executing.
 * - At most maxActions per session; at least 1 s between executed actions;
 *   the session ends after idleSeconds without a decision.
 * - stop() kills any pending proposal at once and always works, even when
 *   the feature is disabled.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkDenied } from "./computerDeny.mjs";
import { appendComputerLog, purgeOldShots, shotFilePath } from "./computerLog.mjs";
import { buildEscalationPrompt, parseProposal } from "./computerPropose.mjs";
import { createApprovals } from "./guard.mjs";
import { estimatePaidCostUsd } from "../../../packages/alive/src/confirm.ts";
import { appendPaidSpend, setInFlightCost } from "../coach/spendGate.mjs";
import { paidCostUsd } from "./brainUsage.mjs";

export const DECISION_TTL_MS = 60_000;
export const MIN_ACTION_GAP_MS = 1_000;
export const DEFAULT_MAX_ACTIONS = 20;
export const DEFAULT_IDLE_SECONDS = 120;
export const ESCALATION_MAX_TOKENS = 2048;

/** <dataDir>/settings/computer.json; missing or invalid = off. Read-only. */
export function readComputerSettings(dataDir) {
  const defaults = {
    enabled: false,
    maxActions: DEFAULT_MAX_ACTIONS,
    idleSeconds: DEFAULT_IDLE_SECONDS,
    source: "default",
  };
  if (!dataDir) return defaults;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "settings", "computer.json"), "utf8"));
    const maxActions = Number(parsed?.maxActions);
    const idleSeconds = Number(parsed?.idleSeconds);
    return {
      enabled: parsed?.enabled === true,
      maxActions: Number.isFinite(maxActions) && maxActions >= 1 && maxActions <= 200
        ? Math.floor(maxActions)
        : DEFAULT_MAX_ACTIONS,
      idleSeconds: Number.isFinite(idleSeconds) && idleSeconds >= 10 && idleSeconds <= 3600
        ? Math.floor(idleSeconds)
        : DEFAULT_IDLE_SECONDS,
      source: "file",
    };
  } catch {
    return defaults;
  }
}

/**
 * The ONLY writer of settings/computer.json. Called exclusively from the
 * POST /v1/computer/settings route; no model, tool or coach code path may
 * call it (a test scans the sources for call sites).
 */
export function writeComputerSettings(dataDir, settings) {
  if (!dataDir) return false;
  const current = readComputerSettings(dataDir);
  const maxActions = Number(settings.maxActions);
  const idleSeconds = Number(settings.idleSeconds);
  const body = {
    enabled: settings.enabled === true,
    maxActions:
      Number.isFinite(maxActions) && maxActions >= 1 && maxActions <= 200
        ? Math.floor(maxActions)
        : current.maxActions,
    idleSeconds:
      Number.isFinite(idleSeconds) && idleSeconds >= 10 && idleSeconds <= 3600
        ? Math.floor(idleSeconds)
        : current.idleSeconds,
  };
  try {
    fs.mkdirSync(path.join(dataDir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "settings", "computer.json"), JSON.stringify(body, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * createComputerSession(deps) -> session. deps:
 *   dataDir           BAKUGAN_DATA_DIR ("" when the drive is missing)
 *   adapter           the adapter interface (fake in tests, Mac in production)
 *   proposer          propose({goal, snapshot, lastActions}) -> proposal
 *   escalateProposer  async ({prompt}) -> raw reply text (paid gateway)
 *   review            guard reviewAction
 *   gate              allowPaid from spendGate
 *   now               injected clock, () -> epoch ms
 */
export function createComputerSession(deps = {}) {
  const {
    dataDir = "",
    adapter,
    proposer,
    escalateProposer,
    review,
    gate,
    now = () => Date.now(),
  } = deps;

  const approvals = createApprovals({ now });

  let goal = "";
  let sessionId = "";
  let phase = "idle"; // idle | proposed | running | stopped | ended
  let pending = null; // { proposalId, action, approvalToken, expiresAt, warn, snapshot, shotUrl }
  let lastSnapshot = null;
  let lastActions = [];
  let stepIndex = 0;
  let executedCount = 0;
  let lastExecutedAt = 0;
  let lastActivityAt = 0;

  const settings = () => readComputerSettings(dataDir);
  const enabled = () => settings().enabled;
  const spend = () =>
    typeof gate === "function"
      ? gate(dataDir, 0, new Date(now()))
      : { allowed: true, spentTodayUsd: 0, capUsd: 0 };

  function randomId() {
    return crypto.randomBytes(9).toString("hex");
  }

  function log(entry) {
    appendComputerLog(dataDir, { sessionId, n: stepIndex, ...entry }, new Date(now()));
  }

  /** The guard action behind a proposal; the approval hash binds to this. */
  function guardAction(proposal) {
    const base = { origin: "user", source: "computer", userRequest: goal };
    if (proposal.action === "click") {
      return { kind: "computer_click", args: { target: proposal.target, label: proposal.targetLabel }, ...base };
    }
    if (proposal.action === "type") {
      return { kind: "computer_keys", args: { text: proposal.text }, ...base };
    }
    if (proposal.action === "key") {
      return { kind: "computer_keys", args: { combo: proposal.combo }, ...base };
    }
    return null;
  }

  function shortDescribe(proposal) {
    if (proposal.action === "click") return `clicked "${proposal.targetLabel || proposal.target}"`;
    if (proposal.action === "type") return `typed "${String(proposal.text || "").slice(0, 40)}"`;
    if (proposal.action === "key") return `pressed ${proposal.combo}`;
    return String(proposal.action);
  }

  /** Expiry of the 60 s decision window; logs and clears the pending. */
  function expireIfNeeded() {
    if (!pending) return false;
    if (now() > pending.expiresAt) {
      log({ action: pending.action, verdict: "proposed", decision: "expired" });
      pending = null;
      phase = "idle";
      return true;
    }
    return false;
  }

  /** The session ends after idleSeconds without a decision. */
  function idleExpired() {
    const s = settings();
    if (!sessionId || (phase !== "proposed" && phase !== "idle" && phase !== "running")) return false;
    if (lastActivityAt > 0 && now() - lastActivityAt > s.idleSeconds * 1000) {
      if (pending) log({ action: pending.action, verdict: "proposed", decision: "expired" });
      pending = null;
      phase = "ended";
      return true;
    }
    return false;
  }

  function publicProposal() {
    if (!pending) return null;
    return {
      proposalId: pending.proposalId,
      action: pending.action.action,
      target: pending.action.target ?? null,
      targetLabel: pending.action.targetLabel ?? null,
      text: pending.action.text ?? null,
      combo: pending.action.combo ?? null,
      why: pending.action.why,
      warn: pending.warn || null,
      shotUrl: pending.shotUrl,
      expiresAt: pending.expiresAt,
      step: stepIndex,
      maxActions: settings().maxActions,
    };
  }

  /**
   * Shared pipeline for a concrete action proposal (click/type/key):
   * deny list (fresh observation) -> element check -> B3 review -> pending
   * approval with a single-use token, plus the human screenshot.
   */
  async function acceptProposal(proposal, front) {
    const s = settings();
    const deny = checkDenied(proposal, { app: front?.app, title: front?.title, url: front?.url });
    if (deny.denied) {
      log({ action: proposal, verdict: "denied", decision: "", result: deny.rule });
      return { ok: false, error: "denied", rule: deny.rule, why: deny.why, denied: true };
    }
    if (proposal.action === "click") {
      const el = (lastSnapshot?.elements ?? []).find((row) => String(row.id) === proposal.target);
      if (!el) {
        log({ action: proposal, verdict: "denied", decision: "", result: "unknown_element" });
        return {
          ok: false,
          error: "denied",
          rule: "unknown_element",
          why: "the model named an element that is not on the screen anymore",
          denied: true,
        };
      }
    }
    const action = guardAction(proposal);
    let verdict;
    try {
      verdict = await review(action, { dataDir, now: () => new Date(now()), allowPaid: gate || null });
    } catch {
      verdict = { verdict: "ask", rule: "R8", why: "controlling your computer always needs your OK" };
    }
    if (verdict.verdict === "block") {
      log({ action: proposal, verdict: "blocked", decision: "", result: verdict.rule });
      return { ok: false, error: "blocked", rule: verdict.rule, why: verdict.why, denied: true };
    }
    // allow or ask: the user still approves every single action with Да/Нет.
    const proposalId = randomId();
    let shotUrl = null;
    try {
      const shotPath = shotFilePath(dataDir, proposalId);
      const shot = await adapter.screenshot(shotPath);
      if (shot && shot.ok) shotUrl = `/v1/computer/shot/${proposalId}.jpg`;
    } catch {
      shotUrl = null;
    }
    const approvalToken = approvals.grant(action);
    pending = {
      proposalId,
      action: proposal,
      approvalToken,
      expiresAt: now() + DECISION_TTL_MS,
      warn: deny.warn || null,
      snapshot: lastSnapshot,
      shotUrl,
    };
    phase = "proposed";
    stepIndex += 1;
    lastActivityAt = now();
    return {
      ok: true,
      proposalId,
      action: proposal.action,
      target: proposal.target ?? null,
      targetLabel: proposal.targetLabel ?? null,
      text: proposal.text ?? null,
      combo: proposal.combo ?? null,
      why: proposal.why,
      warn: deny.warn || null,
      step: stepIndex,
      maxActions: s.maxActions,
      shotUrl,
      spentTodayUsd: spend().spentTodayUsd,
    };
  }

  async function execute(proposal) {
    const t0 = now();
    try {
      if (proposal.action === "click") {
        const center =
          proposal.center ??
          (() => {
            const el = (lastSnapshot?.elements ?? []).find((row) => String(row.id) === proposal.target);
            return el ? { x: Number(el.x) + Number(el.w) / 2, y: Number(el.y) + Number(el.h) / 2 } : null;
          })();
        if (!center) return { ok: false, error: "the element is not on the screen anymore" };
        const result = await adapter.click(center.x, center.y);
        return { ok: result?.ok !== false, error: result?.error || "", ms: now() - t0 };
      }
      if (proposal.action === "type") {
        const result = await adapter.type(proposal.text);
        return { ok: result?.ok !== false, error: result?.error || "", ms: now() - t0 };
      }
      if (proposal.action === "key") {
        const result = await adapter.keys(proposal.combo);
        return { ok: result?.ok !== false, error: result?.error || "", ms: now() - t0 };
      }
      return { ok: false, error: "nothing to run", ms: now() - t0 };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), ms: now() - t0 };
    }
  }

  function stateView() {
    return {
      enabled: enabled(),
      maxActions: settings().maxActions,
      idleSeconds: settings().idleSeconds,
      phase,
      goal: goal || null,
      sessionId: sessionId || null,
      step: stepIndex,
      executed: executedCount,
      proposal: publicProposal(),
      spentTodayUsd: spend().spentTodayUsd,
      capUsd: spend().capUsd,
    };
  }

  return {
    // Test-only escape hatch so a test can tamper with the pending proposal
    // and prove the approval is bound to the exact action. Never read in routes.
    _pending: () => pending,

    settings,
    state() {
      return stateView();
    },

    async updateSettings(body = {}) {
      if (!dataDir) return { ok: false, error: "drive_missing" };
      if (body.enabled === undefined) return { ok: false, error: "enabled_required" };
      if (body.enabled === true && body.confirmed !== true) {
        return { ok: false, error: "confirm_first" };
      }
      const written = writeComputerSettings(dataDir, {
        enabled: body.enabled === true,
        maxActions: body.maxActions,
        idleSeconds: body.idleSeconds,
      });
      if (!written) return { ok: false, error: "write_failed" };
      if (body.enabled === false) {
        if (pending) log({ action: pending.action, verdict: "proposed", decision: "stopped" });
        pending = null;
        phase = "idle";
      }
      return { ok: true, settings: readComputerSettings(dataDir) };
    },

    async start({ goal: newGoal } = {}) {
      if (!dataDir) return { ok: false, error: "drive_missing" };
      if (!enabled()) return { ok: false, error: "computer_off" };
      const text = String(newGoal || "").trim();
      if (!text) return { ok: false, error: "goal_required" };
      goal = text.slice(0, 500);
      sessionId = randomId();
      phase = "idle";
      pending = null;
      lastSnapshot = null;
      lastActions = [];
      stepIndex = 0;
      executedCount = 0;
      lastExecutedAt = 0;
      lastActivityAt = now();
      purgeOldShots(dataDir, new Date(now()));
      return { ok: true, sessionId, state: stateView() };
    },

    async step() {
      if (!dataDir) return { ok: false, error: "drive_missing" };
      if (!enabled()) return { ok: false, error: "computer_off" };
      if (!sessionId) return { ok: false, error: "no_session" };
      expireIfNeeded();
      if (idleExpired()) return { ok: false, error: "session_ended" };
      if (pending) return { ok: false, error: "proposal_pending", proposal: publicProposal() };
      const s = settings();
      if (executedCount >= s.maxActions) return { ok: false, error: "cap_reached" };
      if (phase === "stopped" || phase === "ended") return { ok: false, error: "session_ended" };
      let front;
      let snapshot;
      try {
        front = await adapter.frontmost();
        snapshot = await adapter.axSnapshot();
      } catch (error) {
        return {
          ok: false,
          error: "observe_failed",
          why: error instanceof Error ? error.message : String(error),
        };
      }
      lastSnapshot = snapshot;
      let proposal;
      try {
        proposal = await proposer.propose({ goal, snapshot, lastActions });
      } catch {
        return { ok: false, error: "propose_failed", why: "the local model did not answer" };
      }
      if (!proposal || proposal.action === "ask" || proposal.action === "done") {
        lastActivityAt = now();
        return {
          ok: true,
          proposal: {
            action: proposal?.action ?? "ask",
            why: proposal?.why ?? "I could not decide",
            reason: proposal?.reason ?? null,
          },
          step: stepIndex,
          maxActions: s.maxActions,
          spentTodayUsd: spend().spentTodayUsd,
        };
      }
      return await acceptProposal(proposal, front);
    },

    async decide({ proposalId, yes } = {}) {
      if (!dataDir) return { ok: false, error: "drive_missing" };
      if (!enabled()) {
        if (pending) log({ action: pending.action, verdict: "proposed", decision: "stopped" });
        pending = null;
        phase = "idle";
        return { ok: false, error: "computer_off" };
      }
      if (!pending) return { ok: false, error: "no_pending" };
      if (String(proposalId || "") !== pending.proposalId) return { ok: false, error: "proposal_mismatch" };
      if (expireIfNeeded()) return { ok: false, error: "expired" };
      if (idleExpired()) return { ok: false, error: "session_ended" };
      if (!yes) {
        log({ action: pending.action, verdict: "proposed", decision: "no" });
        pending = null;
        phase = "idle";
        lastActivityAt = now();
        return { ok: true, decision: "no" };
      }
      if (now() - lastExecutedAt < MIN_ACTION_GAP_MS) {
        return { ok: false, error: "too_soon", retryMs: MIN_ACTION_GAP_MS - (now() - lastExecutedAt) };
      }
      // Single-use approval bound to the EXACT current action.
      const approved = approvals.take(guardAction(pending.action), pending.approvalToken);
      if (!approved) {
        log({ action: pending.action, verdict: "proposed", decision: "yes", result: "approval_invalid" });
        pending = null;
        phase = "idle";
        return { ok: false, error: "approval_invalid" };
      }
      // The deny list runs AGAIN against a fresh observation right before executing.
      let fresh;
      try {
        fresh = await adapter.frontmost();
      } catch {
        fresh = null;
      }
      const recheck = checkDenied(pending.action, { app: fresh?.app, title: fresh?.title, url: fresh?.url });
      if (recheck.denied) {
        log({
          action: pending.action,
          verdict: "denied_at_execution",
          decision: "yes",
          result: recheck.rule,
        });
        pending = null;
        phase = "idle";
        return { ok: false, error: "denied", rule: recheck.rule, why: recheck.why };
      }
      const proposal = pending.action;
      pending = null;
      phase = "running";
      const result = await execute(proposal);
      phase = "idle";
      lastActivityAt = now();
      lastExecutedAt = now();
      log({
        action: proposal,
        verdict: result.ok ? "executed" : "failed",
        decision: "yes",
        result: result.ok ? "ok" : result.error,
        ms: result.ms,
      });
      if (result.ok) {
        executedCount += 1;
        lastActions.push(shortDescribe(proposal));
        if (executedCount >= settings().maxActions) phase = "ended";
      }
      return { ok: result.ok, decision: "yes", result: result.error || "ok" };
    },

    async stop() {
      if (pending) log({ action: pending.action, verdict: "proposed", decision: "stopped" });
      pending = null;
      phase = "stopped";
      lastActivityAt = now();
      return { ok: true, stopped: true };
    },

    async escalatePreview({ proposalId } = {}) {
      if (!dataDir) return { ok: false, error: "drive_missing" };
      if (!enabled()) return { ok: false, error: "computer_off" };
      if (!sessionId) return { ok: false, error: "no_session" };
      if (proposalId && (!pending || pending.proposalId !== String(proposalId))) {
        return { ok: false, error: "proposal_mismatch" };
      }
      if (!lastSnapshot) return { ok: false, error: "no_observation" };
      const prompt = buildEscalationPrompt({ goal, snapshot: lastSnapshot, lastActions });
      const estimateUsd = estimatePaidCostUsd(prompt.length, ESCALATION_MAX_TOKENS);
      const g = spend();
      const gateResult = typeof gate === "function" ? gate(dataDir, estimateUsd, new Date(now())) : { allowed: true, reason: "ok", spentTodayUsd: 0, capUsd: 0 };
      return {
        ok: true,
        preview: prompt,
        estimateUsd,
        spentTodayUsd: gateResult.spentTodayUsd ?? g.spentTodayUsd,
        capUsd: gateResult.capUsd ?? g.capUsd,
        allowed: gateResult.allowed,
        reason: gateResult.reason,
      };
    },

    async escalateConfirm({ yes } = {}) {
      if (!dataDir) return { ok: false, error: "drive_missing" };
      if (!yes) return { ok: true, confirmed: false };
      if (!enabled()) return { ok: false, error: "computer_off" };
      if (!sessionId) return { ok: false, error: "no_session" };
      if (!lastSnapshot) return { ok: false, error: "no_observation" };
      const prompt = buildEscalationPrompt({ goal, snapshot: lastSnapshot, lastActions });
      const estimateUsd = estimatePaidCostUsd(prompt.length, ESCALATION_MAX_TOKENS);
      const gateResult =
        typeof gate === "function"
          ? gate(dataDir, estimateUsd, new Date(now()))
          : { allowed: true, reason: "ok", spentTodayUsd: 0, capUsd: 0 };
      if (!gateResult.allowed) {
        return {
          ok: false,
          allowed: false,
          reason: gateResult.reason,
          spentTodayUsd: gateResult.spentTodayUsd,
          capUsd: gateResult.capUsd,
        };
      }
      let raw = "";
      try {
        // Reserve the worst case for the duration of the call, then settle the
        // shared paid ledger ONCE with what the gateway reported. The Yes/No
        // card and the gate above are unchanged: this only makes the money
        // that was already approved count against the same daily cap as every
        // other paid route.
        setInFlightCost("computer:" + (sessionId || "session"), estimateUsd);
        const answer = await escalateProposer({ prompt });
        const text = typeof answer === "string" ? answer : String((answer && answer.text) || "");
        const usage = answer && typeof answer === "object" ? answer.usage : null;
        const settledUsd = Number(paidCostUsd(usage, now()));
        appendPaidSpend(dataDir, Number.isFinite(settledUsd) && settledUsd > 0 ? settledUsd : estimateUsd, "computer");
        raw = text;
      } catch {
        return { ok: false, error: "escalate_failed", why: "the paid gateway did not answer" };
      } finally {
        setInFlightCost("computer:" + (sessionId || "session"), 0);
      }
      const parsed = parseProposal(raw, lastSnapshot);
      if (!parsed.ok) {
        return {
          ok: true,
          escalated: true,
          proposal: { action: "ask", why: "DeepSeek could not decide", reason: parsed.reason },
          estimateUsd,
          spentTodayUsd: gateResult.spentTodayUsd,
          capUsd: gateResult.capUsd,
        };
      }
      if (parsed.proposal.action === "ask" || parsed.proposal.action === "done") {
        return {
          ok: true,
          escalated: true,
          proposal: parsed.proposal,
          estimateUsd,
          spentTodayUsd: gateResult.spentTodayUsd,
          capUsd: gateResult.capUsd,
        };
      }
      let fresh = null;
      try {
        fresh = await adapter.frontmost();
      } catch {
        fresh = null;
      }
      const accepted = await acceptProposal(parsed.proposal, fresh);
      return {
        ...accepted,
        escalated: true,
        estimateUsd,
        spentTodayUsd: gateResult.spentTodayUsd,
        capUsd: gateResult.capUsd,
      };
    },
  };
}
