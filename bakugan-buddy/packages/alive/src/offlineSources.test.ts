import assert from "node:assert/strict";
import test from "node:test";
import { offlineProxyUrl, offlineSourceTag, offlineSourceView } from "./offlineSources.ts";

const BRAIN = "http://192.168.1.20:8787";

test("the source tag names Wikipedia, iFixit or the pack", () => {
  assert.equal(offlineSourceTag({ title: "Mars", url: "/a", sourceLabel: "Offline · Wikipedia" }), "offline · Wikipedia");
  assert.equal(offlineSourceTag({ title: "Screen", url: "/a", sourceLabel: "Offline · iFixit" }), "offline · iFixit");
  assert.equal(offlineSourceTag({ title: "Mars", url: "/a", pack: "wikipedia_en_astronomy_maxi" }), "offline · Wikipedia");
  assert.equal(offlineSourceTag({ title: "Battery", url: "/a", pack: "ifixit_en_all" }), "offline · iFixit");
  assert.equal(offlineSourceTag({ title: "Mars", url: "/a" }), "offline");
});

test("unknown packs get a short tag rather than a long filename", () => {
  const tag = offlineSourceTag({ title: "X", url: "/a", pack: "some_other_pack_name_that_is_long" });
  assert.ok(tag.startsWith("offline · "));
  assert.ok(tag.length <= "offline · ".length + 24);
});

test("proxy urls stay on brain-server and carry the token", () => {
  const url = offlineProxyUrl(BRAIN, "/v1/offline/image?path=%2FI%2Fmars.jpg", "tok");
  assert.equal(url, "http://192.168.1.20:8787/v1/offline/image?path=%2FI%2Fmars.jpg&token=tok");
});

test("proxy urls refuse anything that is not an offline proxy path", () => {
  // A pack must never be able to point the app at another host.
  assert.equal(offlineProxyUrl(BRAIN, "http://evil.example/x.png", "tok"), "");
  assert.equal(offlineProxyUrl(BRAIN, "//evil.example/x.png", "tok"), "");
  assert.equal(offlineProxyUrl(BRAIN, "/v1/chat?q=1", "tok"), "");
  assert.equal(offlineProxyUrl(BRAIN, "", "tok"), "");
});

test("a missing token leaves the url ready for the header", () => {
  assert.equal(offlineProxyUrl(BRAIN, "/v1/offline/article?path=%2FA", ""), "http://192.168.1.20:8787/v1/offline/article?path=%2FA");
  assert.equal(offlineProxyUrl("http://brain:1/", "/v1/offline/image?path=%2FI", "t"), "http://brain:1/v1/offline/image?path=%2FI&token=t");
});

test("an offline result maps to an inline picture and a proxied article", () => {
  const view = offlineSourceView(
    {
      title: "Mars",
      url: "/v1/offline/article?path=%2FA%2FMars",
      snippet: "Red planet",
      offline: true,
      pack: "Wikipedia",
      imageUrl: "/v1/offline/image?path=%2FI%2Fmars.jpg",
    },
    BRAIN,
    "tok",
  );
  assert.equal(view.tag, "offline · Wikipedia");
  assert.equal(view.title, "Mars");
  assert.match(view.imageUrl, /^http:\/\/192\.168\.1\.20:8787\/v1\/offline\/image\?path=/);
  assert.match(view.articleUrl, /^http:\/\/192\.168\.1\.20:8787\/v1\/offline\/article\?path=/);
});

test("an offline result without a picture leaves the image empty", () => {
  const view = offlineSourceView(
    { title: "Saturn", url: "/v1/offline/article?path=%2FB", offline: true, pack: "iFixit" },
    BRAIN,
    "tok",
  );
  assert.equal(view.imageUrl, "");
  assert.equal(view.tag, "offline · iFixit");
  assert.match(view.articleUrl, /\/v1\/offline\/article\?/);
});

test("an ordinary web source keeps its own link and gets no tag or image", () => {
  const view = offlineSourceView(
    { title: "Weather", url: "https://example.com/weather", snippet: "Sunny" },
    BRAIN,
    "tok",
  );
  assert.equal(view.tag, "");
  assert.equal(view.imageUrl, "");
  assert.equal(view.articleUrl, "");
  assert.equal(view.title, "Weather");
});

test("a hostile image url on an offline result is dropped, not followed", () => {
  const view = offlineSourceView(
    { title: "Mars", url: "/v1/offline/article?path=%2FA", offline: true, imageUrl: "http://evil.example/x.png" },
    BRAIN,
    "tok",
  );
  assert.equal(view.imageUrl, "");
});
