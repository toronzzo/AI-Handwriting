import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCrisis, parseEvents } from "./eventsParse.mjs";

const TZ = "Europe/Warsaw";
const NOW = new Date("2026-11-18T11:00:00.000Z").getTime(); // 12:00 local

function parse(text, options = {}) {
  return parseEvents(text, { now: NOW, tz: TZ, currency: "KZT", recent: options.recent ?? [], ...options });
}

function money(amount, currency, direction, category) {
  return { type: "money", data: { amount, currency, direction, category, note: null } };
}

// [sentence, expected] — expected is {events:[...]}, {ask}, {crisis} or {none:true}
const FIXTURES = [
  ["coffee 1500₸", { events: [money(1500, "KZT", "out", "coffee")] }],
  ["потратил 2 500 тг на такси", { events: [money(2500, "KZT", "out", "transport")] }],
  ["купил кофе за 1.5к", { events: [money(1500, "KZT", "out", "coffee")] }],
  ["получил зарплату 300 000 ₸", { events: [money(300000, "KZT", "in", "salary")] }],
  [
    "ate pizza, stomach hurts",
    {
      events: [
        { type: "food", data: { item: "pizza", meal: null } },
        { type: "stomach", data: { level: 2, words: ["pain"], foodId: "@food0" } },
      ],
    },
  ],
  [
    "съел борщ, живот вздуло",
    {
      events: [
        { type: "food", data: { item: "борщ", meal: null } },
        { type: "stomach", data: { level: 1, words: ["bloated"], foodId: "@food0" } },
      ],
    },
  ],
  ["slept 7h", { events: [{ type: "sleep", data: { minutes: 420, bedtime: null, wake: null } }] }],
  ["спал 6,5 часа", { events: [{ type: "sleep", data: { minutes: 390, bedtime: null, wake: null } }] }],
  [
    "went to bed at 00:30, woke up 07:45",
    { events: [{ type: "sleep", data: { minutes: 435, bedtime: "00:30", wake: "07:45" } }] },
  ],
  ["slept 7 hours 20 min", { events: [{ type: "sleep", data: { minutes: 440, bedtime: null, wake: null } }] }],
  [
    "read 30 pages of Dune",
    { events: [{ type: "book", data: { title: "Dune", pages: 30, status: "reading", rating: null } }] },
  ],
  [
    "прочитал 50 страниц Войны и мира",
    { events: [{ type: "book", data: { title: "Войны и мира", pages: 50, status: "reading", rating: null } }] },
  ],
  [
    "дочитал Мастер и Маргарита",
    { events: [{ type: "book", data: { title: "Мастер и Маргарита", pages: null, status: "finished", rating: null } }] },
  ],
  [
    "started reading Dune",
    { events: [{ type: "book", data: { title: "Dune", pages: null, status: "started", rating: null } }] },
  ],
  [
    "watched Dune 2, 8/10",
    { events: [{ type: "film", data: { title: "Dune 2", rating: 8, status: "watched" } }] },
  ],
  [
    "посмотрел фильм Брат 2",
    { events: [{ type: "film", data: { title: "Брат 2", rating: null, status: "watched" } }] },
  ],
  ["потратил 2к на кофе", { events: [money(2000, "KZT", "out", "coffee")] }],
  ["bought groceries for 4 500 ₸", { events: [money(4500, "KZT", "out", "food")] }],
  ["paid 300 tenge for a taxi", { events: [money(300, "KZT", "out", "transport")] }],
  ["зарплата пришла 200 000 тенге", { events: [money(200000, "KZT", "in", "salary")] }],
  ["I feel fine, stomach ok", { events: [{ type: "stomach", data: { level: 0, words: ["fine"], foodId: null } }] }],
  ["у меня болит живот", { events: [{ type: "stomach", data: { level: 2, words: ["pain"], foodId: null } }] }],
  ["today ate salad for lunch", { events: [{ type: "food", data: { item: "salad", meal: "lunch" } }] }],
  ["перекусил яблоком", { events: [{ type: "food", data: { item: "яблоком", meal: "snack" } }] }],
  ["поужинал пастой", { events: [{ type: "food", data: { item: "пастой", meal: "dinner" } }] }],
  ["I spent a lot", { ask: "How much?" }],
  ["I slept well", { ask: "How long did you sleep?" }],
  ["I ate", { ask: "What did you eat?" }],
  // Negatives: questions, wishes, plans, advice, no clear fact.
  ["I have 500 tasks", { none: true }],
  ["how much did I spend today?", { none: true }],
  ["хочу купить ноутбук", { none: true }],
  ["should I eat more?", { none: true }],
  ["I will buy a car next year", { none: true }],
  ["advise me how to sleep better", { none: true }],
  ["nice weather today", { none: true }],
  ["5 задач", { none: true }],
  ["сколько я потратил вчера?", { none: true }],
  ["хочу спать", { none: true }],
  ["получил пятерку по матану", { none: true }],
  ["I read a nice article", { none: true }],
  ["I had a headache", { none: true }],
  ["у меня на счету 5000 тенге", { none: true }],
];

test("fixture table: every sentence parses exactly as expected", () => {
  for (const [text, expected] of FIXTURES) {
    const parsed = parse(text);
    const label = JSON.stringify(text);
    assert.equal(parsed.crisis, false, label);
    if (expected.none) {
      assert.deepEqual(parsed.events, [], label);
      assert.equal(parsed.ask, null, label);
      continue;
    }
    if (expected.ask) {
      assert.equal(parsed.ask, expected.ask, label);
      assert.deepEqual(parsed.events, [], label);
      continue;
    }
    const got = parsed.events.map((event) => ({ type: event.type, data: event.data }));
    assert.deepEqual(got, expected.events, label);
  }
});

test("yesterday changes the day (noon of that day in the zone)", () => {
  const parsed = parse("вчера потратил 1000 на еду");
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].day, "2026-11-17");
  const amount = parsed.events[0].data;
  assert.deepEqual(amount, { amount: 1000, currency: "KZT", direction: "out", category: "food", note: null });
});

test("stomach links to the most recent food only when exactly one is within 4 hours", () => {
  const fresh = { id: "evt_one", ts: NOW - 2 * 3600 * 1000, type: "food", data: { item: "pizza" } };
  const linked = parse("stomach hurts a bit", { recent: [fresh] });
  assert.equal(linked.events[0].data.foodId, "evt_one");
  assert.equal(linked.events[0]._afterItem, "pizza");

  const two = parse("stomach hurts a bit", {
    recent: [
      fresh,
      { id: "evt_two", ts: NOW - 3 * 3600 * 1000, type: "food", data: { item: "soup" } },
    ],
  });
  assert.equal(two.events[0].data.foodId, null);
  assert.equal(two.events[0]._afterItem, null);

  const old = parse("stomach hurts a bit", {
    recent: [{ id: "evt_old", ts: NOW - 5 * 3600 * 1000, type: "food", data: { item: "soup" } }],
  });
  assert.equal(old.events[0].data.foodId, null, "foods older than 4 hours do not link");
});

test("detectCrisis: EN and RU, and a false positive", () => {
  assert.equal(detectCrisis("I want to kill myself"), true);
  assert.equal(detectCrisis("не хочу жить"), true);
  assert.equal(detectCrisis("хочу умереть"), true);
  assert.equal(detectCrisis("i sometimes hurt myself in gym"), true);
  assert.equal(detectCrisis("my stomach hurts badly today"), false);
  assert.equal(detectCrisis("coffee 1500₸"), false);
});

test("crisis sentences produce NO events", () => {
  for (const text of ["I want to kill myself", "не хочу жить", "хочу умереть"]) {
    const parsed = parse(text);
    assert.equal(parsed.crisis, true, text);
    assert.deepEqual(parsed.events, [], text);
  }
});

test("money verb without an amount asks, never guesses", () => {
  const en = parse("I spent a lot");
  assert.equal(en.ask, "How much?");
  assert.deepEqual(en.events, []);
  const ru = parse("потратил много");
  assert.equal(ru.ask, "Сколько?");
  assert.deepEqual(ru.events, []);
});
