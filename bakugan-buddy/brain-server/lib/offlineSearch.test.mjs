import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanOfflineQuery,
  exactOfflineTitle,
  firstArticleImage,
  isLoopbackUrl,
  orderOfflineBooks,
  parseKiwixBookNames,
  parseKiwixSearchJson,
  parseKiwixSearchXml,
  parseKiwixSuggest,
  proxyOfflineArticle,
  proxyOfflineImage,
  rankOfflineHits,
  searchOffline,
} from "./offlineSearch.mjs";

/** A fake kiwix-serve response; no sockets are opened in these tests. */
function fakeResponse(body, { ok = true, status = 200, type = "application/json" } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) },
    json: async () => body,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    arrayBuffer: async () => bytes,
    text: async () => String(body),
  };
}

function xmlResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => "application/xml" },
    text: async () => body,
    json: async () => ({}),
    body: null,
  };
}

test("parseKiwixSearchJson reads a kiwix-serve suggestions payload", () => {
  const rows = parseKiwixSearchJson({
    suggestions: [
      { title: "Mars", description: "Fourth planet", url: "/wikipedia_en_astronomy/Mars", img: "/I/mars.jpg" },
      { title: "Mars", description: "duplicate", url: "/wikipedia_en_astronomy/Mars" },
      { title: "Moon", text: "Natural satellite", url: "/wikipedia_en_astronomy/Moon" },
    ],
  }, 5);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Mars");
  assert.equal(rows[0].snippet, "Fourth planet");
  assert.equal(rows[0].imageUrl, "/I/mars.jpg");
  assert.equal(rows[1].title, "Moon");
});

test("parseKiwixSearchJson strips markup and honours the result limit", () => {
  const rows = parseKiwixSearchJson({
    suggestions: [
      { title: "<b>Jupiter</b>", description: "  largest  <i>planet</i> ", url: "/A" },
      { title: "Saturn", description: "rings", url: "/B" },
      { title: "Venus", description: "hot", url: "/C" },
    ],
  }, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Jupiter");
  assert.equal(rows[0].snippet, "largest planet");
});

test("parseKiwixSearchJson tolerates junk and an empty payload", () => {
  assert.deepEqual(parseKiwixSearchJson(null), []);
  assert.deepEqual(parseKiwixSearchJson({ suggestions: [null, {}, { title: "", url: "/x" }] }), []);
});

test("parseKiwixSearchXml reads an RSS search payload", () => {
  const rows = parseKiwixSearchXml(`<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Mars</title>
    <link>/content/wikipedia_en_astronomy_maxi_2026-08/Mars</link>
    <description>Fourth &lt;b&gt;planet&lt;/b&gt;</description>
  </item>
  <item>
    <title>Mars</title>
    <link>/content/wikipedia_en_astronomy_maxi_2026-08/Mars</link>
    <description>duplicate</description>
  </item>
</channel></rss>`, 5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Mars");
  assert.equal(rows[0].snippet, "Fourth planet");
  assert.equal(rows[0].pack, "wikipedia_en_astronomy_maxi_2026-08");
});

test("parseKiwixBookNames reads content hrefs from the catalog", () => {
  assert.deepEqual(
    parseKiwixBookNames(`<feed><link href="/content/wikipedia_en_astronomy_maxi_2026-08"/><link href="/content/ifixit_en_all_2025-12/A"/></feed>`),
    ["wikipedia_en_astronomy_maxi_2026-08", "ifixit_en_all_2025-12"],
  );
});

test("firstArticleImage resolves relative pack assets", () => {
  assert.equal(
    firstArticleImage('<img src="./_assets_/mars.jpg" />', "/content/wikipedia_en_astronomy_maxi_2026-08/Mars"),
    "/content/wikipedia_en_astronomy_maxi_2026-08/_assets_/mars.jpg",
  );
});

test("searchOffline returns titles, snippets, pack and proxied image urls", async () => {
  const result = await searchOffline("Mars", {
    enrichImages: false,
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes("/catalog/")) {
        return xmlResponse(`<feed><link href="/content/wikipedia_en_astronomy_maxi_2026-08"/></feed>`);
      }
      if (href.includes("/search?")) {
        return xmlResponse(`<?xml version="1.0"?><rss><channel>
          <item><title>Mars</title><link>/content/wikipedia_en_astronomy_maxi_2026-08/Mars</link><description>Red planet</description></item>
        </channel></rss>`);
      }
      throw new Error(`unexpected fetch ${href}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  const [hit] = result.results;
  assert.equal(hit.title, "Mars");
  assert.equal(hit.snippet, "Red planet");
  assert.equal(hit.offline, true);
  assert.match(hit.sourceLabel, /wikipedia_en_astronomy/i);
  assert.match(hit.url, /^\/v1\/offline\/article\?path=/);
});

test("searchOffline reports unavailable kiwix without throwing", async () => {
  const result = await searchOffline("Mars", {
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.results, []);
  assert.match(result.error, /refused/);
});

test("searchOffline treats a non-2xx kiwix answer as unavailable", async () => {
  const result = await searchOffline("Mars", {
    fetchImpl: async (url) => {
      if (String(url).includes("/catalog/")) {
        return xmlResponse(`<feed><link href="/content/wikipedia_en_astronomy_maxi_2026-08"/></feed>`);
      }
      return fakeResponse({}, { ok: false, status: 503 });
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /503/);
});

test("searchOffline rejects an empty query without calling kiwix", async () => {
  let called = false;
  const result = await searchOffline("   ", {
    fetchImpl: async () => {
      called = true;
      return fakeResponse({});
    },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("searchOffline refuses a non-loopback kiwix server", async () => {
  const result = await searchOffline("Mars", {
    baseUrl: "http://example.com:8791",
    fetchImpl: async () => fakeResponse({}),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /loopback/);
});

test("searchOffline passes a bounded timeout to fetch", async () => {
  let sawSignal = false;
  await searchOffline("Mars", {
    timeoutMs: 1234,
    enrichImages: false,
    fetchImpl: async (_url, init) => {
      sawSignal = init && init.signal instanceof AbortSignal;
      return xmlResponse(`<feed></feed>`);
    },
  });
  assert.equal(sawSignal, true);
});

test("isLoopbackUrl only allows the local kiwix port", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:8791/I/mars.jpg"), true);
  assert.equal(isLoopbackUrl("http://localhost:8791/I/mars.jpg"), true);
  assert.equal(isLoopbackUrl("http://example.com/I/mars.jpg"), false);
  assert.equal(isLoopbackUrl("http://127.0.0.1:9999/I/mars.jpg"), false);
  assert.equal(isLoopbackUrl("http://192.168.1.5:8791/I/mars.jpg"), false);
  // No port means port 80, which is some other local server, not kiwix.
  assert.equal(isLoopbackUrl("http://127.0.0.1/I/mars.jpg"), false);
  assert.equal(isLoopbackUrl(""), false);
});

test("proxyOfflineImage returns a verified png", async () => {
  const result = await proxyOfflineImage("/I/mars.png", {
    fetchImpl: async () => fakeResponse(Buffer.from([1, 2, 3]), { type: "image/png" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.type, "image/png");
  assert.equal(result.buffer.byteLength, 3);
});

test("proxyOfflineImage rejects a non-image content type", async () => {
  const result = await proxyOfflineImage("/I/mars.png", {
    fetchImpl: async () => fakeResponse("<html>nope</html>", { type: "text/html" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 415);
});

test("proxyOfflineImage enforces the byte limit", async () => {
  const result = await proxyOfflineImage("/I/big.jpg", {
    maxBytes: 2,
    fetchImpl: async () => fakeResponse(Buffer.from([1, 2, 3, 4]), { type: "image/jpeg" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test("offline proxies stop reading once a streamed body exceeds the byte limit", async () => {
  let cancelled = false;
  const result = await proxyOfflineArticle("/A/Big", {
    maxBytes: 2,
    fetchImpl: async () => ({
      ...fakeResponse("", { type: "text/html" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("too large"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      arrayBuffer: async () => {
        throw new Error("must not buffer the complete response");
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
});

test("proxyOfflineImage refuses remote and traversal paths", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return fakeResponse(Buffer.from([1]), { type: "image/png" });
  };
  assert.equal((await proxyOfflineImage("http://evil.example/x.png", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineImage("//evil.example/x.png", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineImage("relative.png", { fetchImpl })).ok, false);
  assert.equal(called, false);
});

test("proxyOfflineArticle returns html through the loopback", async () => {
  let seen = "";
  const result = await proxyOfflineArticle("/wikipedia_en_astronomy/A/Mars", {
    fetchImpl: async (url) => {
      seen = url;
      return fakeResponse("<h1>Mars</h1>", { type: "text/html; charset=utf-8" });
    },
  });
  assert.equal(result.ok, true);
  assert.match(seen, /^http:\/\/127\.0\.0\.1:8791\//);
  assert.match(result.type, /text\/html/);
  assert.equal(result.buffer.toString("utf8"), "<h1>Mars</h1>");
});

test("proxyOfflineArticle caps the body size", async () => {
  const result = await proxyOfflineArticle("/A/Big", {
    maxBytes: 4,
    fetchImpl: async () => fakeResponse("<p>too big</p>", { type: "text/html" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test("proxyOfflineArticle rejects remote, protocol-relative and bad paths", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return fakeResponse("<p>x</p>", { type: "text/html" });
  };
  assert.equal((await proxyOfflineArticle("http://evil.example/A", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineArticle("//evil.example/A", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineArticle("A/B", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineArticle("", { fetchImpl })).ok, false);
  assert.equal(called, false);
});

const ASTRONOMY = "wikipedia_en_astronomy_maxi_2026-08";
const GENERAL = "wikipedia_en_all_maxi_2026-08";
const IFIXIT = "ifixit_en_all_2025-12";

function itemXml(title, book, description) {
  const path = `/content/${book}/${title.replace(/\s+/g, "_")}`;
  return `<item><title>${title}</title><link>${path}</link><description>${description}</description></item>`;
}

function rss(...items) {
  return `<?xml version="1.0"?><rss><channel>${items.join("")}</channel></rss>`;
}

test("filler words are stripped and the subject is kept", () => {
  const cleaned = cleanOfflineQuery("tell me about Saturn the planet, with a picture");
  assert.deepEqual(cleaned.terms, ["saturn", "planet"]);
  assert.equal(cleaned.pattern, "saturn planet");
  assert.equal(cleanOfflineQuery("Saturn").pattern, "saturn");
});

test("space questions search the astronomy pack before iFixit", () => {
  assert.deepEqual(orderOfflineBooks([IFIXIT, GENERAL, ASTRONOMY], "tell me about Saturn the planet"), [
    ASTRONOMY,
    GENERAL,
    IFIXIT,
  ]);
  assert.equal(orderOfflineBooks([ASTRONOMY, IFIXIT], "how do I replace an iPhone battery")[0], IFIXIT);
});

test("title match outranks a company, a disambiguation page and film awards", () => {
  const hits = [
    { title: "Big Fish", snippet: "Won a Saturn Award", pack: GENERAL, url: "/content/films/Big_Fish" },
    { title: "Marjorie Prime", snippet: "Nominated for a Saturn Award", pack: GENERAL, url: "/content/films/Marjorie_Prime" },
    { title: "Saturn Corporation", snippet: "American car company", pack: GENERAL, url: "/content/co/Saturn_Corporation" },
    { title: "Saturn (disambiguation)", snippet: "Saturn may refer to", pack: GENERAL, url: "/content/d/Saturn_disambiguation" },
    { title: "Saturn", snippet: "Sixth planet from the Sun", pack: ASTRONOMY, url: "/content/astro/Saturn" },
  ];
  const ranked = rankOfflineHits(hits, ["saturn", "planet"], { space: true });
  assert.equal(ranked[0].title, "Saturn");
  assert.equal(exactOfflineTitle(ranked[0], ["saturn", "planet"]), true);
  assert.equal(exactOfflineTitle(hits[3], ["saturn"]), false);
  assert.ok(ranked.findIndex((hit) => hit.title === "Big Fish") > 0);
});

test("parseKiwixSuggest reads an OpenSearch suggestion list", () => {
  const rows = parseKiwixSuggest(
    ["saturn", ["Saturn", "Saturn Corporation"], ["Sixth planet", "Carmaker"], [`/content/${ASTRONOMY}/Saturn`, `/content/${GENERAL}/Saturn_Corporation`]],
    ASTRONOMY,
    5,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Saturn");
  assert.equal(rows[0].pack, ASTRONOMY);
  assert.equal(rows[0].url, `/content/${ASTRONOMY}/Saturn`);
});

/**
 * A realistic kiwix-serve: full-text across a general wiki prefers film pages
 * that mention the Saturn Award, and "Saturn" alone prefers the car company.
 * Title search on the astronomy pack has the planet.
 */
function kiwixFixture(urls) {
  return async (url) => {
    const href = String(url);
    urls.push(href);
    if (href.includes("/catalog/")) {
      return xmlResponse(
        `<feed><link href="/content/${ASTRONOMY}"/><link href="/content/${GENERAL}"/><link href="/content/${IFIXIT}"/></feed>`,
      );
    }
    const parsed = new URL(href);
    const book = parsed.searchParams.get("books.name") || parsed.searchParams.get("content") || "";
    const pattern = parsed.searchParams.get("pattern") || parsed.searchParams.get("term") || "";
    if (href.includes("/suggest?") || pattern.startsWith("title:")) {
      return href.includes("/suggest?")
        ? fakeResponse([
            pattern,
            ["Saturn (disambiguation)", "Saturn", "Saturn Corporation"],
            ["Saturn may refer to", "Sixth planet from the Sun", "Former car company"],
            [`/content/${ASTRONOMY}/Saturn_(disambiguation)`, `/content/${ASTRONOMY}/Saturn`, `/content/${GENERAL}/Saturn_Corporation`],
          ])
        : xmlResponse(
            rss(
              itemXml("Saturn (disambiguation)", ASTRONOMY, "Saturn may refer to"),
              itemXml("Saturn", ASTRONOMY, "Sixth planet from the Sun"),
              itemXml("Saturn Corporation", GENERAL, "Former car company"),
            ),
          );
    }
    if (book.includes("astronomy")) {
      return xmlResponse(
        rss(
          itemXml("Big Fish", GENERAL, "The film won several Saturn Awards"),
          itemXml("Marjorie Prime", GENERAL, "Nominated for a Saturn Award"),
          itemXml("Saturn Corporation", GENERAL, "American automobile company"),
        ),
      );
    }
    return xmlResponse(
      rss(itemXml("The Family Man", GENERAL, "A Saturn Award nominee"), itemXml("Drag Me to Hell", GENERAL, "Saturn Award winner")),
    );
  };
}

test("Saturn the planet is the astronomy article, not films or the car company", async () => {
  const urls = [];
  const result = await searchOffline("tell me about Saturn the planet, with a picture", {
    enrichImages: false,
    fetchImpl: kiwixFixture(urls),
  });
  assert.equal(result.ok, true);
  assert.equal(result.results[0].title, "Saturn");
  assert.match(result.results[0].url, new RegExp(ASTRONOMY));
  assert.ok(result.results.every((hit) => !/Big Fish|Marjorie Prime|Family Man|Drag Me to Hell/.test(hit.title)));
  const firstSearch = urls.find((href) => href.includes("/search?"));
  assert.match(firstSearch, /pattern=saturn\+planet|pattern=saturn%20planet/);
  assert.match(firstSearch, new RegExp(`books.name=${ASTRONOMY}`));
  assert.ok(!/tell|picture/.test(firstSearch));
  assert.ok(urls.some((href) => href.includes("/suggest?") && href.includes("term=saturn")));
  assert.ok(urls.some((href) => href.includes("pattern=title%3Asaturn") || href.includes("pattern=title:saturn")));
});

test("a bare Saturn query still prefers the planet article over Saturn Corporation", async () => {
  const result = await searchOffline("Saturn", {
    enrichImages: false,
    fetchImpl: kiwixFixture([]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.results[0].title, "Saturn");
  assert.notEqual(result.results[0].title, "Saturn Corporation");
  assert.ok(result.results.every((hit) => hit.title !== "Big Fish"));
});

test("proxyOfflineArticle maps failures to non-200 statuses", async () => {
  const notFound = await proxyOfflineArticle("/A/Missing", {
    fetchImpl: async () => fakeResponse("", { ok: false, status: 404 }),
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);

  const down = await proxyOfflineArticle("/A/Mars", {
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(down.ok, false);
  assert.equal(down.status, 502);
});
