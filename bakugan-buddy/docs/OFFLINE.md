# Preyas Offline Knowledge

Preyas can answer encyclopedic and how-to questions from local Kiwix packs,
pictures included, and can run a tiny model when there is no internet at all.
Nothing here is downloaded in CI, and no pack or model file is ever committed.

Everything lives on the Agent drive:

| What | Where |
| --- | --- |
| Packs (ZIM) | `/Volumes/Agent/agent/knowledge/zim/` |
| Tiny model (GGUF) | `/Volumes/Agent/agent/models/` |

## 1. Install Kiwix

The packs are served by `kiwix-serve`, which is a one-line Homebrew install:

```sh
brew install kiwix-tools
```

CI does **not** install `kiwix-tools` and never downloads a pack.

## 2. Download packs

```sh
scripts/offline/get-zims.sh
```

By default this fetches two packs:

- the newest English astronomy Wikipedia (`wikipedia_en_astronomy_maxi_*`),
  which has pictures;
- the newest English iFixit how-to pack (`ifixit_en_all_*`).

The script:

- **resumes** an interrupted download instead of starting over;
- **picks the newest filename by pattern**, so a new monthly release needs no
  edit here;
- **verifies the checksum** whenever Kiwix publishes its `.sha256` sidecar,
  and deletes a corrupt file so the next run starts clean;
- prints a warning and keeps going when no sidecar exists.

Check what a run would fetch without downloading anything:

```sh
scripts/offline/get-zims.sh --list
```

Narrow a run to one pack with `PREYAS_ZIM_ONLY`:

```sh
PREYAS_ZIM_ONLY=astronomy scripts/offline/get-zims.sh
PREYAS_ZIM_ONLY=ifixit    scripts/offline/get-zims.sh
```

### Full Wikipedia is opt-in

The full English Wikipedia (`wikipedia_en_all_maxi`, about 119 GB) is never
downloaded by default. Ask for it explicitly:

```sh
PREYAS_DOWNLOAD_FULL_WIKIPEDIA=1 scripts/offline/get-zims.sh
```

No wikiHow pack is downloaded.

## 3. Run Kiwix

```sh
scripts/offline/serve-kiwix.sh
```

This serves every `.zim` in the knowledge folder and is deliberately pinned to
**`127.0.0.1:8791`**. It cannot be pointed at the LAN, because devices talk to
brain-server instead.

## 4. How Preyas uses it

brain-server exposes three paired routes. Every route follows the normal
pairing rules, so a device must be paired exactly as it is for chat:

| Route | Purpose |
| --- | --- |
| `GET /v1/offline/search?q=...` | search the packs; returns title, a short snippet, the source pack and proxied picture URLs |
| `GET /v1/offline/image?path=...` | one picture, byte-capped, image types only |
| `GET /v1/offline/article?path=...` | one article, byte-capped and sandboxed |

Both proxies refuse any destination that is not loopback kiwix-serve, cap the
response size, and use a bounded timeout. The article response is sent with a
`sandbox` CSP so pack HTML cannot act on the brain origin.

Because an `<img>` tag cannot send a header, those two GETs are the only
routes that also accept the device token as a `?token=` query parameter.
Every other route requires the `X-Preyas-Token` header.

### Routing

Preyas looks in the offline library first for:

- anything the user marks as offline or without internet;
- astronomy and reference questions ("what is a supernova");
- how-to and repair questions ("how do I replace an iPhone battery").

If the packs have nothing, the existing web search runs exactly as before. All
other chat keeps its current behaviour, and the offline path never triggers for
small talk, code help, or questions about Preyas itself.

When results come back, chat shows the source pack as a small
`offline · Wikipedia` or `offline · iFixit` tag, renders pictures inline, opens a
picture full-size when tapped, and opens the proxied article when the source is
tapped.

### Tools

The offline library is also callable by the agent as `offline_search`, which
returns the same title, snippet and pack data. It is a read-only tool.

## 5. The tiny off-grid model

The optional tiny model is **Qwen3.5 0.8B**, quantized `Q4_K_M`. It comes from
`unsloth/Qwen3.5-0.8B-GGUF`; Qwen3.5 0.8B is a general chat model, and unsloth
is the publisher with the complete set of quantizations, since Qwen does not
ship a GGUF repo for it.

**Qwen3-8B stays the default.** The tiny model is only used after you choose
`Tiny model (off-grid)` in the model switcher, and the 8B returns on its own
after the usual idle window and on any failed load.

```sh
scripts/offline/get-tiny-model.sh
```

The download is about 530 MB, resumes if interrupted, and only runs when you
run it. The script also refuses a download that is not a real GGUF.

| Override | Meaning |
| --- | --- |
| `PREYAS_TINY_QWEN_QUANT` | `Q4_K_M` (default) or another published quantization such as `Q5_K_M` |
| `PREYAS_TINY_QWEN_REPO` | a different Hugging Face repository |
| `PREYAS_TINY_QWEN_FILE` | an exact file name, for anything the two settings above do not cover |
| `PREYAS_MODELS_DIR` | where the file is stored |

The tiny tier uses a 16K context, the same as the other small tiers. If the file
is missing, the switch fails and rolls back to the 8B with the usual note.

## Tests

These run without kiwix, without packs and without a network:

```sh
bash scripts/offline/get-zims.test.sh       # pack selection, full-Wikipedia opt-in
cd bakugan-buddy/brain-server && npm test   # search parsing, proxies, pairing
cd bakugan-buddy/packages/alive && npm test # routing and source mapping
cd bakugan-buddy/apps/mobile && npm test    # chat UI
```
