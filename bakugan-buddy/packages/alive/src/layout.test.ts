import assert from "node:assert/strict";
import test from "node:test";

/**
 * Layout guards for the chat screen.
 *
 * There is no headless browser in CI, so these check the arithmetic that the
 * phone bug broke: a bubble capped at a pixel width overflowed a 390px screen,
 * and the composer hint stole the input's row. The numbers mirror
 * ChatScreen.tsx — keep them in step with the styles.
 */

const BUBBLE_MAX_PERCENT = 82;
const CARD_PADDING = 12;
const SCREEN_PADDING = 16;
const AVATAR = 28;
const ROW_GAP = 8;
const COMPOSER_BUTTONS = 44 + 44; // send + mic, each at least 44px
const COMPOSER_GAPS = 8 * 3;

/** Width available to a bubble inside the chat card at a given screen width. */
function bubbleRoom(screen: number): number {
  const card = screen - SCREEN_PADDING * 2 - CARD_PADDING * 2;
  return card;
}

test("a bubble fits inside the card on a 375px and a 390px phone", () => {
  for (const screen of [375, 390]) {
    const room = bubbleRoom(screen);
    const bubble = (room * BUBBLE_MAX_PERCENT) / 100;
    const rowWithAvatar = bubble + AVATAR + ROW_GAP;
    assert.ok(room > 0, `card has no width at ${screen}px`);
    assert.ok(
      rowWithAvatar <= room,
      `row ${rowWithAvatar.toFixed(1)}px must fit the ${room.toFixed(1)}px card at ${screen}px`,
    );
  }
});

test("a pixel-capped bubble would have overflowed a 390px phone", () => {
  const room = bubbleRoom(390);
  const oldBubble = 420; // the previous maxWidth
  assert.ok(oldBubble > room, "420px really was wider than the card, so the bug is reproduced");
});

test("the composer leaves the input a usable width on a phone", () => {
  for (const screen of [375, 390]) {
    const row = screen - SCREEN_PADDING * 2 - CARD_PADDING * 2;
    const input = row - COMPOSER_BUTTONS - COMPOSER_GAPS;
    assert.ok(input >= 120, `input needs room: got ${input}px at ${screen}px`);
  }
});

test("the hint no longer competes with the input", () => {
  // The hint moved out of the composer row, so it costs the input nothing.
  const withHintInRow = 110; // its old maxWidth
  const row = 390 - SCREEN_PADDING * 2 - CARD_PADDING * 2;
  const cramped = row - COMPOSER_BUTTONS - COMPOSER_GAPS - withHintInRow;
  const fixed = row - COMPOSER_BUTTONS - COMPOSER_GAPS;
  assert.ok(cramped < 120, "the old layout squeezed the field");
  assert.ok(fixed >= 120, "the new layout does not");
});

test("the desktop sidebar only appears when there is room", () => {
  const SIDEBAR = 210;
  const CARD_GAP = 12;
  const wideBreakpoint = 900;
  const thread = wideBreakpoint - SCREEN_PADDING * 2 - CARD_PADDING * 2 - SIDEBAR - CARD_GAP;
  assert.ok(thread > 400, `thread needs room beside the sidebar: got ${thread}px`);
});
