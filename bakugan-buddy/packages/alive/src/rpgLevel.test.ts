import assert from "node:assert/strict";
import { test } from "node:test";
import { levelOf, partnerFromAreas, partnerFromProgress, rankOf } from "./rpgLevel.ts";

test("levelOf matches the Today bar: 150 XP opens level 2", () => {
  assert.deepEqual(levelOf(0), { L: 1, into: 0, need: 150 });
  assert.deepEqual(levelOf(150), { L: 2, into: 0, need: 180 });
  assert.deepEqual(levelOf(200), { L: 2, into: 50, need: 180 });
});

test("chat level and bond come from total XP, not from which chat is open", () => {
  const today = partnerFromAreas(200);
  const again = partnerFromAreas(200);
  assert.equal(today.level, 2);
  assert.equal(today.bond, Math.round((50 / 180) * 100));
  assert.equal(today.caption.includes("Rookie"), true);
  assert.deepEqual(again, today);
  assert.equal(rankOf(today.level).name, "Rookie");

  const shown = partnerFromProgress({
    level: today.level,
    into: 50,
    need: 180,
    rankName: "Rookie",
    totalXp: 200,
  });
  assert.deepEqual(shown, today);
});

test("a brand new life is level 1, and nonsense XP does not throw", () => {
  const fresh = partnerFromAreas(0);
  assert.equal(fresh.level, 1);
  assert.equal(fresh.bond, 0);
  assert.equal(partnerFromAreas(Number.NaN).level, 1);
  assert.equal(partnerFromAreas(-4).level, 1);
});
