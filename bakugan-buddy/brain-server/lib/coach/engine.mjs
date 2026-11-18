/**
 * The Coach: turns user text into one coached reply. All "experience" is
 * written down — playbook files, the lessons log, the learned counters —
 * nothing is fine-tuned and the Coach NEVER runs a command or a process.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCoachIntent, isSessionWord } from "../../../packages/alive/src/coach.ts";
import { copySeedIfMissing, loadSkills } from "./skills.mjs";
import { findSkill, searchLessons, MATCH_THRESHOLD, LESSON_THRESHOLD } from "./retrieve.mjs";
import { beginSession, handleSession } from "./session.mjs";
import { renderStep, renderWhy } from "./render.mjs";
import { loadLearned, recordCompletion, isLearned, learnedList } from "./learned.mjs";
import { appendLesson, loadLessons } from "./lessons.mjs";
import { escalateReply, buildGrokBotText, buildPaidPrompt } from "./escalate.mjs";
import { redactSecrets } from "./redact.mjs";
import { estimatePaidCostUsd } from "../../../packages/alive/src/confirm.ts";
import { allowPaid } from "./spendGate.mjs";
import { speakableStep } from "../os/speakable.mjs";
import { saveLastPair } from "../os/gold.mjs";

function writeJsonAtomic(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
  } catch {
    /* best effort */
  }
}

function isYesWord(text) {
  return /^(yes|да|ok|yep|yeah)$/iu.test(String(text ?? "").trim());
}

export function createCoach({ dataDir, skillsDir, seedDir, now = () => Date.now(), judge = async () => "unsure" }) {
  const skillsCache = new Map();
  let session = null; // active skill session (see session.mjs)
  let pendingSkill = null; // low-confidence skill waiting for "yes"
  let lessonCapture = null; // { stage, situation?, cause?, skill }
  let store = {}; // learned counts by skill name
  let lessons = []; // in-memory lessons log
  let lastSpeak = { id: 0, text: "", lang: "en" }; // the latest spoken coach message

  const lessonsFile = dataDir ? path.join(dataDir, "coach", "lessons.jsonl") : null;
  const sessionFile = dataDir ? path.join(dataDir, "coach", "session.json") : null;
  const learnedFile = dataDir ? path.join(dataDir, "coach", "learned.json") : null;

  if (dataDir) {
    if (seedDir) copySeedIfMissing(seedDir, skillsDir || path.join(dataDir, "coach", "skills"));
    store = loadLearned(learnedFile);
    lessons = loadLessons(lessonsFile);
    try {
      const saved = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      if (saved && saved.session && saved.session.mode === "skill") session = saved.session;
      if (saved && saved.pendingSkill) pendingSkill = saved.pendingSkill;
    } catch {
      /* no saved session */
    }
  }

  function persistSession() {
    if (sessionFile) writeJsonAtomic(sessionFile, { session, pendingSkill });
  }

  function entries() {
    return loadSkills(skillsDir, skillsCache);
  }

  function skillByName(name) {
    const entry = entries().find((row) => row.ok && row.skill.name === name);
    return entry ? entry.skill : null;
  }

  function lessonLine(query) {
    const hits = searchLessons(lessons, query, 1);
    if (hits.length && hits[0].score >= LESSON_THRESHOLD) {
      const lesson = hits[0].lesson;
      const fix = lesson.fix ? ` Fix: ${lesson.fix}` : "";
      return `I remember a lesson from ${lesson.date}: ${lesson.situation}${fix}`;
    }
    return null;
  }

  function shortFor(active) {
    return isLearned(store, active.skillName) && !active.userWhy && !active.lastBad;
  }

  function stateView() {
    const base = {
      mode: "off",
      skillName: null,
      step: 0,
      of: 0,
      startedAt: null,
      learnedCount: learnedList(store).length,
      lastSpeak: { ...lastSpeak },
      danger: false,
    };
    if (lessonCapture) return { ...base, mode: "lesson", skillName: lessonCapture.skill || null };
    if (pendingSkill) return { ...base, mode: "pending", skillName: pendingSkill.name };
    if (session && session.mode === "skill") {
      const skill = skillByName(session.skillName);
      return {
        ...base,
        mode: "skill",
        skillName: session.skillName,
        step: session.step,
        of: skill ? skill.steps.length : 0,
        startedAt: session.startedAt,
        danger: Boolean(skill?.steps[session.step - 1]?.danger),
      };
    }
    return base;
  }

  function done(reply, extra = {}) {
    const speak = speakableStep(reply);
    if (reply) {
      lastSpeak = { id: lastSpeak.id + 1, text: speak.text, lang: speak.lang };
    }
    persistSession();
    return { handled: true, reply, state: stateView(), escalate: false, speak, ...extra };
  }

  function beginSkill(skill) {
    session = beginSession(skill, now);
    pendingSkill = null;
    const lesson = lessonLine(skill.name);
    const head = `I will use: ${skill.name}.`;
    const step = renderStep(skill, 1, { short: shortFor(session) });
    return done([head, lesson, step].filter(Boolean).join("\n\n"));
  }

  function doneSaveExample() {
    const result = saveLastPair(dataDir, now);
    if (result.saved) return done(`Saved as example #${result.active}.`);
    return done(`Not saved: ${result.reason}.`);
  }

  function handleStart(topic) {
    if (/^(skills|навыки)$/iu.test(topic)) {
      const names = skills()
        .map((row) => (row.learned ? `${row.name} (learned)` : row.name));
      return done(
        names.length ? `I know these skills: ${names.join(", ")}.` : "No skills loaded yet.",
      );
    }
    const found = findSkill(entries(), topic);
    if (found.confidence === "high" && found.skill) return beginSkill(found.skill);
    if (found.confidence === "low" && found.skill) {
      pendingSkill = found.skill;
      return done(`I will use: ${found.skill.name}. Say yes to start.`);
    }
    const grokBotText = buildGrokBotText({ topic });
    return done(escalateReply({ reason: "no-skill" }), { escalate: true, grokBotText });
  }

  async function turn(rawText) {
    const text = String(rawText ?? "").trim();
    if (!text) {
      return done('Say "coach <topic>" to start, for example: coach merge the PR.');
    }
    const safe = redactSecrets(text);
    const intent = parseCoachIntent(text);

    // Guided lesson capture: situation -> cause -> fix.
    if (lessonCapture) {
      if (lessonCapture.stage === "situation") {
        lessonCapture.situation = safe;
        lessonCapture.stage = "cause";
        return done('What went wrong? (You can say "skip".)');
      }
      if (lessonCapture.stage === "cause") {
        lessonCapture.cause = /^skip$/iu.test(text) ? "" : safe;
        lessonCapture.stage = "fix";
        return done("What fixed it?");
      }
      const capture = lessonCapture;
      lessonCapture = null;
      const { saved } = appendLesson(
        lessonsFile,
        lessons,
        { date: null, situation: capture.situation, cause: capture.cause, fix: safe, skill: capture.skill },
        now,
      );
      if (session && session.mode === "skill") {
        const skill = skillByName(session.skillName);
        if (skill) {
          return done(`Lesson saved. Back to ${session.skillName}.\n\n${renderStep(skill, session.step, { short: shortFor(session) })}`);
        }
      }
      return done(saved ? "Lesson saved. Say \"save lesson\" any time to add another." : "Nothing to save: I need a situation or a fix.");
    }

    // Inside a session every other word is either a coach command or a result.
    if (session && session.mode === "skill") {
      const skill = skillByName(session.skillName);
      if (!skill) {
        session = null;
        persistSession();
        return done("The skill file is gone, so I stopped the coach. Say \"coach <topic>\" to start another.");
      }
      if (intent?.kind === "start" && !intent.topic) {
        return done(`Back to ${session.skillName}.\n\n${renderStep(skill, session.step, { short: shortFor(session) })}`);
      }
      if (intent?.kind === "start" && intent.topic) {
        return handleStart(intent.topic);
      }
      if (intent?.kind === "status") {
        return done(`You are in ${session.skillName}, step ${session.step} of ${skill.steps.length}.`);
      }
      if (intent?.kind === "learned") {
        const rows = learnedList(store);
        return done(rows.length ? `Learned: ${rows.map((row) => `${row.name} (${row.count})`).join(", ")}.` : "Nothing learned yet. Finish the same skill twice and it counts as learned.");
      }
      if (intent?.kind === "saveLesson") {
        lessonCapture = { stage: "situation", skill: session.skillName };
        return done("What situation are we saving? (One short sentence.)");
      }
      if (intent?.kind === "saveExample") {
        return doneSaveExample();
      }

      const { action } = await handleSession(session, skill, safe, judge);
      if (action.reason === "bad") session.lastBad = true;
      else if (action.kind === "ok_next" || action.kind === "finished") session.lastBad = false;

      if (action.kind === "show_step") {
        return done(renderStep(skill, session.step, { short: shortFor(session) }));
      }
      if (action.kind === "why") {
        return done(renderWhy(skill, session.step));
      }
      if (action.kind === "info") {
        return done(action.text);
      }
      if (action.kind === "retry") {
        const step = skill.steps[session.step - 1];
        const lesson = action.reason === "bad" ? lessonLine(`${session.skillName} ${session.lastSnippet}`) : null;
        const hint = step?.failHint ? ` ${step.failHint}` : "";
        const parts = [`Not quite.${hint}`];
        if (lesson) parts.push(lesson);
        parts.push(renderStep(skill, session.step, { short: false }));
        return done(parts.join("\n\n"));
      }
      if (action.kind === "escalate") {
        const grokBotText = buildGrokBotText({
          skillName: session.skillName,
          stepIndex: session.step,
          stepTitle: skill.steps[session.step - 1]?.title,
          whatTried: session.lastSnippet,
        });
        const reply = escalateReply({ reason: "failed", skillName: session.skillName, stepIndex: session.step });
        return done(reply, { escalate: true, grokBotText });
      }
      if (action.kind === "finished") {
        const name = session.skillName;
        session = null;
        store = recordCompletion(learnedFile, store, name, now);
        const learnedNow = isLearned(store, name);
        return done(
          `Skill "${name}" completed. Great job!${
            learnedNow ? ` You have learned ${name} — from now I keep its steps shorter.` : ""
          }`,
        );
      }
      // ok_next
      return done(renderStep(skill, session.step, { short: shortFor(session) }));
    }

    // Pending (low-confidence) skill waits for a yes.
    if (pendingSkill) {
      if (isYesWord(text)) {
        const skill = pendingSkill;
        return beginSkill(skill);
      }
      if (intent?.kind === "stop") {
        pendingSkill = null;
        return done("Coach stopped.");
      }
      pendingSkill = null;
      return { handled: false, reply: "", state: stateView(), escalate: false, speak: speakableStep("") };
    }

    // No session: coach commands only.
    if (intent?.kind === "start") {
      if (!intent.topic) {
        return done('What do you want to practice? Say "coach <topic>", for example: coach merge the PR. Say "coach skills" to see the list.');
      }
      return handleStart(intent.topic);
    }
    if (intent?.kind === "stop") {
      pendingSkill = null;
      return done("Coach stopped.");
    }
    if (intent?.kind === "status") {
      const rows = learnedList(store);
      const learned = rows.length ? ` Learned: ${rows.map((row) => `${row.name} (${row.count})`).join(", ")}.` : "";
      return done(`Coach is off. Say "coach <topic>" to start.${learned}`);
    }
    if (intent?.kind === "learned") {
      const rows = learnedList(store);
      return done(rows.length ? `Learned: ${rows.map((row) => `${row.name} (${row.count})`).join(", ")}.` : "Nothing learned yet. Finish the same skill twice and it counts as learned.");
    }
    if (intent?.kind === "saveLesson") {
      lessonCapture = { stage: "situation", skill: "" };
      return done("What situation are we saving? (One short sentence.)");
    }
    if (intent?.kind === "saveExample") {
      return doneSaveExample();
    }
    if (isSessionWord(intent?.kind)) {
      return { handled: false, reply: "", state: stateView(), escalate: false, speak: speakableStep("") };
    }
    return { handled: false, reply: "", state: stateView(), escalate: false, speak: speakableStep("") };
  }

  function skills() {
    return entries()
      .filter((entry) => entry.ok)
      .map((entry) => ({
        name: entry.skill.name,
        when: entry.skill.when,
        valid: true,
        learned: isLearned(store, entry.skill.name),
      }));
  }

  function state() {
    return stateView();
  }

  function escalate() {
    const ctx = session
      ? {
          skillName: session.skillName,
          stepIndex: session.step,
          stepTitle: skillByName(session.skillName)?.steps[session.step - 1]?.title,
          whatTried: session.lastSnippet,
        }
      : { topic: pendingSkill ? pendingSkill.name : "" };
    const prompt = buildPaidPrompt(ctx);
    const estimateUsd = estimatePaidCostUsd(prompt.length, 2048);
    const gate = allowPaid(dataDir, estimateUsd, now());
    return {
      prompt,
      estimateUsd,
      spentTodayUsd: gate.spentTodayUsd,
      capUsd: gate.capUsd,
      allowed: gate.allowed,
      reason: gate.reason,
      grokBotText: buildGrokBotText(ctx),
    };
  }

  return { turn, state, skills, escalate };
}
