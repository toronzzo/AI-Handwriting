/**
 * The event parser: plain text -> life events. Pure code, no model, no
 * network. Past or present facts only: questions, wishes, plans and advice
 * requests produce nothing. When a fact is clear but a number is missing it
 * returns `ask` and NEVER guesses. Crisis phrases produce no events at all.
 */
import { dayKey, noonInZone } from "./events.mjs";

const CYRILLIC = /[\u0400-\u04FF]/;

const MONEY_CATEGORIES = [
  [/coffee|кофе|латте|капучино/i, "coffee"],
  [/taxi|такси|яндекс такси/i, "transport"],
  [/transport|проезд|автобус|метро|bus|metro/i, "transport"],
  [/groceries|продукты|еда|еду|еды|food|магазин/i, "food"],
  [/rent|аренда|квартплата|квартир/i, "rent"],
  [/phone|телефон|связь|интернет|internet/i, "phone"],
  [/clothes|одежда|обувь/i, "clothes"],
  [/salary|зарплат/i, "salary"],
  [/gift|подарок/i, "gift"],
];

const MONEY_UNITS = ["₸", "тг", "tg", "tenge", "тенге"];
const AMOUNT_UNITS = ["k", "к", "тыс", "тысяч", "тысячи", "тысяча"];

const OUT_VERBS = /spent|bought|paid|потратил|потратила|потратили|купил|купила|купили|заплатил|заплатила|оплатил|оплатила|отдал|отдала/i;
const IN_VERBS = /got\s+paid|earned|salary|зарплат|получил|получила|получили|перевели мне|пришла зарплата/i;
const POSSESSION = /i have|у меня есть|на счету|у меня на/i;

const FOOD_VERBS = /ate|had|съел|съела|поел|поела|позавтракал|позавтракала|пообедал|пообедала|поужинал|поужинала|перекусил|перекусила/i;
const FOOD_MEALS = [
  [/breakfast|позавтракал|позавтракала|завтрак/i, "breakfast"],
  [/lunch|пообедал|пообедала|обед/i, "lunch"],
  [/dinner|поужинал|поужинала|ужин/i, "dinner"],
  [/snack|перекусил|перекусила|перекус/i, "snack"],
];

const STOMACH_WORDS = /stomach|живот|животик|тошнит|тошнота|вздуло|вздутие|изжога|heartburn|nauseous|nausea/i;
const STOMACH_3 = [/severe|sharp|невыносимо|нестерпимо|сильно болит|очень болит|очень плохо/i, "severe"];
const STOMACH_2 = [/hurts|pain|болит|боли|тошнит|тошнота|nauseous|nausea|hurt/i, "pain"];
const STOMACH_1 = [/bloated|heavy|вздуло|вздутие|тяжесть|ноет|изжога|heartburn/i, "bloated"];
const STOMACH_0 = [/fine|ok|okay|нормально|всё хорошо|все хорошо|хорошо себя/i, "fine"];

const SLEEP_VERBS = /slept|спал|спала|спали/i;
const BOOK_STARTED = /(?:started|начал|начала)\s+(?:reading|читать|читаю)\s+(.+)/i;
const BOOK_PAGES = /(?:read|прочитал|прочитала|читаю|читал|читала)\s+(\d+)\s+(?:pages?|страниц[аыу]?)\s+(?:of\s+)?(.+)/i;
const BOOK_FINISHED = /(?:finished|дочитал|дочитала|закончил|закончила|прочитал до конца|прочитала до конца)\s+(.+)/i;
const FILM_WATCHED = /(?:watched|посмотрел|посмотрела|смотрел|смотрела)\s+(?:(?:the\s+)?film|фильм|movie)?\s*(.+)/i;
const FILM_RATING = /(\d{1,2})\s*\/\s*10|оценка\s+(\d{1,2})/i;

const QUESTION_START = /^(how|when|where|what|why|which|did|do|does|can|could|should|is|are|сколько|как|где|когда|почему|что|какой|какая|какие)\b/i;
const WISH_PLAN = /\b(хочу|буду|собираюсь|планирую|мечтаю|will|wish)\b|going to|plan to|want to/i;

/** Small, documented crisis list: English and Russian. */
const CRISIS_PHRASES = [
  /want to die|want to kill myself|kill myself|end my life|hurt myself|self.?harm|suicide/i,
  /не хочу жить|хочу умереть|убью себя|покончу с собой|покончить с собой|причиню себе вред|навредить себе|наврежу себе|суицид/i,
];

/** detectCrisis is separate and pure: true -> nothing is ever logged. */
export function detectCrisis(text) {
  return CRISIS_PHRASES.some((pattern) => pattern.test(String(text ?? "")));
}

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function parseAmount(raw) {
  let text = String(raw ?? "").replace(/[\s\u00A0]/g, "");
  const k = text.match(/^(\d+(?:[.,]\d+)?)(k|к|тыс|тысяч|тысячи|тысяча)$/i);
  if (k) {
    const base = parseFloat(k[1].replace(",", "."));
    if (Number.isFinite(base)) return Math.round(base * 1000);
    return null;
  }
  const plain = text.match(/^(\d+(?:[.,]\d+)?)$/);
  if (!plain) return null;
  const value = parseFloat(plain[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function categoryOf(text) {
  for (const [pattern, name] of MONEY_CATEGORIES) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function stripArticle(value) {
  return String(value ?? "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[.,!?;:]+$/g, "")
    .trim();
}

function titleOf(rawTitle) {
  let title = String(rawTitle ?? "").replace(/\s+/g, " ").trim();
  const rating = title.match(FILM_RATING);
  if (rating) {
    title = title.replace(FILM_RATING, "").trim();
  }
  title = title.replace(/[.,!?;:]+$/g, "").trim();
  return stripArticle(title);
}

function findAmounts(text) {
  const matches = [];
  const pattern = /(\d[\d\s\u00A0]*(?:[.,]\d+)?\s*(?:k|к|тыс|тысяч|тысячи|тысяча)?)\s*(₸|тг|tg|tenge|тенге)?/gi;
  let match = pattern.exec(text);
  while (match) {
    const amount = parseAmount(match[1]);
    if (amount !== null) {
      matches.push({ amount, currency: match[2] || null, index: match.index, raw: match[0] });
    }
    match = pattern.exec(text);
  }
  return matches;
}

function hasCyrillic(text) {
  return CYRILLIC.test(text);
}

/** Known tenge spellings normalise to KZT; anything else stays as written. */
function normalizeCurrency(unit, fallback) {
  if (!unit) return fallback;
  if (/^(₸|тг|tg|tenge|тенге)$/i.test(unit)) return "KZT";
  return unit;
}

function moneyEvent(text, now, tz, currency) {
  const amounts = findAmounts(text);
  const outVerb = OUT_VERBS.test(text);
  const inVerb = IN_VERBS.test(text);
  const hasUnit = amounts.some((row) => row.currency);

  if (outVerb && amounts.length === 0) {
    return { ask: hasCyrillic(text) ? "Сколько?" : "How much?" };
  }
  const first = amounts[0];
  if (!first) return null;
  if (!outVerb && !inVerb && !hasUnit) return null; // "I have 500 tasks"
  if (POSSESSION.test(text)) return null;

  const direction = inVerb ? "in" : "out";
  const eventCurrency = normalizeCurrency(first.currency, currency);
  return {
    event: {
      type: "money",
      data: {
        amount: first.amount,
        currency: eventCurrency,
        direction,
        category: categoryOf(text),
        note: null,
      },
    },
  };
}

function foodEvent(text) {
  const verb = text.match(FOOD_VERBS);
  if (!verb) return null;
  const rest = text.slice((verb.index || 0) + verb[0].length).trim();
  // Cut at a delimiter or at a stomach clause.
  const cut = rest.search(/[,.;]|\sand\s|\sbut\s|\sи\s|\sно\s|stomach|живот|тошн|взду/i);
  const itemRaw = cut >= 0 ? rest.slice(0, cut) : rest;
  let item = stripArticle(itemRaw).replace(/^(?:some|немного|a bit of|тарелку|тарелка|порцию|порция)\s+/i, "").trim();
  item = item.replace(/\s+(?:for|на)\s+(?:breakfast|lunch|dinner|snack|завтрак|обед|ужин|перекус).*$/i, "").trim();
  item = item.replace(/[.,!?;:]+$/g, "").trim();
  if (!item) return { ask: hasCyrillic(text) ? "Что ты ел?" : "What did you eat?" };
  // "had a headache" is not food.
  if (/headache|toothache|pain|flu|fever|a cold|болит|температура|простуда|грипп/i.test(item)) return null;
  let meal = null;
  for (const [pattern, name] of FOOD_MEALS) {
    if (pattern.test(text)) {
      meal = name;
      break;
    }
  }
  return { event: { type: "food", data: { item, meal } }, item };
}

function stomachEvent(text, linkedFoodId) {
  if (!STOMACH_WORDS.test(text)) return null;
  let level = null;
  let words = [];
  const levels = [
    [STOMACH_3, 3],
    [STOMACH_2, 2],
    [STOMACH_1, 1],
    [STOMACH_0, 0],
  ];
  for (const [pattern, value] of levels) {
    const match = text.match(pattern[0]);
    if (match) {
      level = value;
      words.push(pattern[1]);
      break;
    }
  }
  if (level === null) level = 2; // stomach mentioned with pain verbs is the default reading
  return {
    event: {
      type: "stomach",
      data: { level, words, foodId: linkedFoodId || null },
    },
  };
}

function sleepEvent(text) {
  const bedWake = text.match(
    /(?:went to bed(?:\s+at)?|лег(?:ла)?(?:\s+в)?|лёг(?:\s+в)?|bed at)\s+(\d{1,2})[.:](\d{2})[^.]*?(?:woke up|проснулся|проснулась|woke at|up at)\s+(\d{1,2})[.:](\d{2})/i,
  );
  if (bedWake) {
    const bed = Number(bedWake[1]) * 60 + Number(bedWake[2]);
    const wake = Number(bedWake[3]) * 60 + Number(bedWake[4]);
    const minutes = (wake - bed + 1440) % 1440;
    return {
      event: {
        type: "sleep",
        data: {
          minutes,
          bedtime: `${String(bedWake[1]).padStart(2, "0")}:${String(bedWake[2]).padStart(2, "0")}`,
          wake: `${String(bedWake[3]).padStart(2, "0")}:${String(bedWake[4]).padStart(2, "0")}`,
        },
      },
    };
  }
  const hasSleepVerb = SLEEP_VERBS.test(text);
  const hourMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hours?|час|часа|часов)/i);
  const minuteMatch = text.match(/(\d+)\s*(?:min|minutes?|мин|минут)/i);
  if (!hourMatch && !minuteMatch) {
    if (hasSleepVerb) return { ask: hasCyrillic(text) ? "Сколько часов?" : "How long did you sleep?" };
    return null;
  }
  let minutes = 0;
  if (hourMatch) minutes += Math.round(parseFloat(hourMatch[1].replace(",", ".")) * 60);
  if (minuteMatch) minutes += Number(minuteMatch[1]);
  if (minutes <= 0) return null;
  return {
    event: {
      type: "sleep",
      data: { minutes, bedtime: null, wake: null },
    },
  };
}

function bookEvent(text) {
  const started = text.match(BOOK_STARTED);
  if (started) {
    return { event: { type: "book", data: { title: stripArticle(started[1]), pages: null, status: "started", rating: null } } };
  }
  const pages = text.match(BOOK_PAGES);
  if (pages) {
    return { event: { type: "book", data: { title: stripArticle(pages[2]), pages: Number(pages[1]), status: "reading", rating: null } } };
  }
  const finished = text.match(BOOK_FINISHED);
  if (finished) {
    return { event: { type: "book", data: { title: stripArticle(finished[1]), pages: null, status: "finished", rating: null } } };
  }
  return null;
}

function filmEvent(text) {
  const watched = text.match(FILM_WATCHED);
  if (!watched) return null;
  const ratingMatch = text.match(FILM_RATING);
  const rating = ratingMatch ? Number(ratingMatch[1] || ratingMatch[2]) : null;
  const title = titleOf(watched[1]);
  if (!title) return null;
  return { event: { type: "film", data: { title, rating, status: "watched" } } };
}

/**
 * parseEvents(text, { now, tz, currency, recent }) ->
 *   { events: [{type, data, ref?}], ask: string | null, crisis: boolean, matched: string[] }
 * `recent` is a list of past food events ({id, ts, data}) for stomach
 * linking. A stomach event links to the most recent food ONLY when there is
 * exactly one in the previous 4 hours; its data.foodId is that id.
 */
export function parseEvents(text, { now, tz, currency, recent = [] } = {}) {
  const cleaned = clean(text);
  if (!cleaned) return { events: [], ask: null, crisis: false, matched: [] };
  if (detectCrisis(cleaned)) return { events: [], ask: null, crisis: true, matched: [] };

  // Questions, wishes, plans, advice requests: not facts.
  if (QUESTION_START.test(cleaned) || cleaned.endsWith("?") || WISH_PLAN.test(cleaned)) {
    return { events: [], ask: null, crisis: false, matched: [] };
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const yesterday = /(?:^|\s)(?:yesterday|вчера)(?=\s|$)/i.test(cleaned);
  const events = [];
  const matched = [];

  const target = new Date(nowMs - (yesterday ? 24 * 3600 * 1000 : 0));
  const day = dayKey(target.getTime(), tz);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(target);
  const dayParts = {};
  for (const part of parts) dayParts[part.type] = part.value;
  const ts = noonInZone(Number(dayParts.year), Number(dayParts.month), Number(dayParts.day), tz);

  // Money: one event per sentence.
  const money = moneyEvent(cleaned, now, tz, currency);
  if (money && money.ask) return { events: [], ask: money.ask, crisis: false, matched: ["money-ask"] };
  if (money && money.event) {
    events.push(money.event);
    matched.push(`money-${money.event.data.direction}`);
  }

  // Food and stomach, linked when they share a sentence.
  let food = null;
  if (!money) {
    food = foodEvent(cleaned);
    if (food && food.ask) return { events: [], ask: food.ask, crisis: false, matched: ["food-ask"] };
  }
  let linkedFoodId = null;
  let recentItem = null;
  if (food && food.event) {
    food.event.ref = "food0";
    events.push(food.event);
    matched.push("food");
    linkedFoodId = "@food0";
  } else {
    const windowStart = nowMs - 4 * 3600 * 1000;
    const fresh = recent.filter((event) => event && event.type === "food" && Number(event.ts) >= windowStart);
    if (fresh.length === 1) {
      linkedFoodId = fresh[0].id;
      recentItem = fresh[0].data && fresh[0].data.item;
    }
  }

  const stomach = stomachEvent(cleaned, linkedFoodId);
  if (stomach && stomach.event) {
    events.push({ ...stomach.event, _afterItem: recentItem });
    matched.push("stomach");
  }

  if (!money) {
    const sleep = sleepEvent(cleaned);
    if (sleep && sleep.ask) return { events: [], ask: sleep.ask, crisis: false, matched: ["sleep-ask"] };
    if (sleep && sleep.event) {
      events.push(sleep.event);
      matched.push("sleep");
    }
    const book = bookEvent(cleaned);
    if (book && book.event) {
      events.push(book.event);
      matched.push("book");
    }
    const film = filmEvent(cleaned);
    if (film && film.event) {
      events.push(film.event);
      matched.push("film");
    }
  }

  for (const event of events) event.day = day;
  return { events, ask: null, crisis: false, matched, ts, day };
}
