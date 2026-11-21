# Preyas Offline Knowledge

Preyas can search local Kiwix encyclopedias and how-to packs, including pictures,
through the brain-server. Downloads stay on the Agent drive and never enter git.

## Install Kiwix

On macOS:

```sh
brew install kiwix-tools
```

There is no Kiwix package install in CI.

## Download packs

The default script downloads the astronomy and iFixit packs:

```sh
scripts/offline/get-zims.sh
```

Packs are stored in `/Volumes/Agent/agent/knowledge/zim/`. The script:

- resumes interrupted downloads,
- uses the newest matching ZIM filename,
- downloads astronomy Wikipedia with pictures,
- downloads iFixit in the available English ZIM format,
- verifies a published `.sha256` sidecar when Kiwix provides it.

The 119 GB full English Wikipedia pack is opt-in:

```sh
PREYAS_DOWNLOAD_FULL_WIKIPEDIA=1 scripts/offline/get-zims.sh
```

It is never downloaded by default.

## Run Kiwix

```sh
scripts/offline/serve-kiwix.sh
```

This binds only `127.0.0.1:8791` and serves every `.zim` in the knowledge folder.

The brain-server exposes paired-device routes:

- `GET /v1/offline/search?q=...`
- `GET /v1/offline/image?path=...`
- `GET /v1/offline/article?path=...`

The image and article proxies restrict destinations to loopback Kiwix and
validate media types and byte limits.

## Tiny off-grid model

The optional Qwen3.5 0.8B model is not default. Qwen3-8B remains the default.

```sh
scripts/offline/get-tiny-model.sh
```

The script downloads `Qwen3.5-0.8B-Q4_K_M.gguf` from
`unsloth/Qwen3.5-0.8B-GGUF` by default. A quantization or repository can be
selected with `PREYAS_TINY_QWEN_QUANT` or `PREYAS_TINY_QWEN_REPO`.

Models are stored in `/Volumes/Agent/agent/models/`. Choose the Tiny 0.8B tier
from the existing model selector; the tier uses 16K context and does not replace
the 8B idle default.
