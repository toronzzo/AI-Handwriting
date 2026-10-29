# Preyas brain (M1 Pro, 16 GB)

The language model is an advisor. It suggests a spoken line, a goal, and a mood shift. The phone's skill loop still decides every frame. If this server is off, Preyas keeps using his bark lines and the room does not wait.

Weights stay on the **external drive**. Nothing in this folder is a GGUF.

## One-time setup

Plug in the external drive, then:

```bash
cd bakugan-buddy/brain-server
./setup.sh
```

The script lists `/Volumes`, asks which drive when there are several, and uses `/Volumes/<Drive>/BakuganBuddy`. If the drive is not mounted it stops. It will not download onto the internal disk.

It installs `llama-server` with `brew install llama.cpp` when needed, then downloads the **default** model (about 5.1 GB).

```bash
./setup.sh --model fast          # 4B, quicker
./setup.sh --model default-q5    # 8B Q5, a bit heavier
./setup.sh --model large         # 14B Q4, slow on 16 GB
./setup.sh --model all           # fast + both 8B quants, not the 14B
```

## Start

```bash
./start.sh
```

That is the command you run each session. It prints a URL like `http://192.168.1.20:8788`. Put that in the room's brain field on the phone (same Wi-Fi). The server also advertises `_bakugan-brain._tcp` via `dns-sd`.

Switch the loaded tier, then start again:

```bash
./use-model.sh fast
./use-model.sh default
./use-model.sh default-q5
./use-model.sh large
```

`large` asks you to type `LARGE` because it will swap on 16 GB. A non-interactive start needs `BRAIN_ALLOW_LARGE=1`.

## What lives on the drive

`BAKUGAN_DATA_DIR` (written into `brain.env`, which is gitignored):

| Path | Contents |
| --- | --- |
| `models/` | GGUF files |
| `hf/` | `HF_HOME` and the Hugging Face cache |
| `logs/` | llama-server log |
| `memory/` | JSONL exports the phone posts |
| `training/` | reserved for later training data |
| `rl/` | reserved for later RL checkpoints |

## RAM on a 16 GB M1 Pro

macOS wants several gigabytes before the model loads. Context is capped so the KV cache stays small (Qwen3's native context is far larger than 16 GB can hold). All tiers use Metal (`-ngl 99`) and q8 KV cache.

| Id | Model | Weights | Context | llama process | On 16 GB |
| --- | --- | --- | --- | --- | --- |
| `fast` | [Qwen3 4B abliterated Q4_K_M](https://huggingface.co/bartowski/mlabonne_Qwen3-4B-abliterated-GGUF) | 2.5 GB | 4096 | about 4 GB | comfortable, snappier |
| `default` | [Qwen3 8B v2 abliterated Q4_K_M](https://huggingface.co/mradermacher/Huihui-Qwen3-8B-abliterated-v2-GGUF) | 5.1 GB | 4096 | about 6.5–8 GB | daily driver. Leave a few GB for macOS. |
| `default-q5` | same repo, Q5_K_M | 6.0 GB | 4096 | about 8–9 GB | fits. Close the browser first. |
| `large` | [Qwen3 14B v2 abliterated Q4_K_M](https://huggingface.co/mradermacher/Huihui-Qwen3-14B-abliterated-v2-GGUF) | 9.1 GB | 2048 | about 11 GB | optional. Slow, swaps, smarter. Not the default. |

The 8B and 14B files are abliterated instruct models (refusal direction removed) so he stays in character instead of answering like a help desk. They are Apache-2.0 Qwen3 derivatives. The phone does not ship any of these files.

## Phone

The room has a brain host field. Expo Go can talk to this server. The on-device fallback is a separate dev-client build. See the repo README.
