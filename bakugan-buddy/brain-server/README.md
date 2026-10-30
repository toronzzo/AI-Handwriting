# Preyas brain (M1 Pro, 16 GB)

The language model is an advisor. It suggests a spoken line, a goal, and a mood shift. The phone's skill loop still decides every frame. If this server is off, Preyas keeps using his bark lines and the room does not wait.

Weights stay on the **external drive**. Nothing in this folder is a GGUF.

## One-time setup

Plug in the APFS volume named **Agent** (`/Volumes/Agent`), then:

```bash
cd bakugan-buddy/brain-server
./setup.sh
```

The default data root is `/Volumes/Agent/agent` (GGUFs in `models/`). If Agent is not mounted, setup stops. Pass `BAKUGAN_DATA_DIR=/Volumes/<Other>/agent` to use another mounted volume. It will not download onto the internal disk.

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

That is the command you run each session. It prints a URL like `http://192.168.1.20:8788`. Put that in the room's brain field on the phone (same Wi-Fi). A LiteLLM gateway on port 4000 is the same field with a different URL. The server also advertises `_bakugan-brain._tcp` via `dns-sd`.

`./start.sh` also starts `whisper-server` on port 8178 when the binary and `WHISPER_MODEL` are present. The proxy turns a finished utterance into text and streams a wav back one sentence at a time: Kokoro `am_puck` for English, Piper `ru_RU-dmitri-medium` for Russian.

## Voice

`./setup-all.sh` is the one-shot installer for this Mac. It is safe to run twice.

It uses the llama-server already on PATH (build 11867 is enough; it is not reinstalled). It `brew install`s `python@3.11`, `ffmpeg`, `whisper-cpp`, and `espeak-ng`. It does not install Docker, Ollama, or full Xcode. The system Python 3.9 is not used. The Kokoro and Piper venv is `$BAKUGAN_DATA_DIR/venvs/tts`.

Speech weights, also only on the drive:

| Piece | File | Why |
| --- | --- | --- |
| Hearing | `models/whisper/ggml-base.bin` | multilingual English and Russian, small enough to sit beside the 8B brain |
| Optional ear | `models/whisper/ggml-small.bin` | better accuracy, about 0.5 GB. Point `WHISPER_MODEL` at it if you switch the brain to the 4B tier |
| English voice | `models/kokoro/kokoro-v1.0.onnx` plus `voices-v1.0.bin` | Kokoro-82M, voice `am_puck`. Original Kokoro voice, Apache-2.0, not a show recording |
| Russian voice | `models/piper-voices/ru_RU-dmitri-medium.onnx` | Kokoro has no Russian voice. This is a published Piper voice |

Kokoro-82M is the English voice because it is small (well under 1 GB) and expressive, so it fits next to the 8B Q4 brain and Whisper base on 16 GB. Orpheus, Chatterbox, and F5-TTS are larger, and F5/Chatterbox are cloning stacks. This setup does not download them and does not train on any show audio. Piper is only the Russian fallback.

Rough 16 GB budget with the default 8B Q4 brain: macOS about 5 GB, llama about 7 GB, Whisper base under 1 GB, Kokoro under 1 GB. That fits if a browser is not also holding a few gigabytes. If the machine swaps, use `./use-model.sh fast` or stay on Whisper base rather than `ggml-small.bin`.

The phone streams the mic only after voice activity says the person has stopped. If they start again, playback stops. An excited or happy mood speaks a little faster; a sad or sleepy mood speaks slower. If `/v1/stt` or `/v1/tts` is down, the room stays on text bubbles.

A dev-client build can later swap in `whisper.rn` for on-device hearing. Expo Go keeps using the Mac. Do not import `whisper.rn` into the Expo Go bundle.

```bash
./setup-all.sh
./start.sh
./speak.sh "The window's mine."
./transcribe.sh take.wav
```

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
| `memory/` | JSONL exports plus `facts.sqlite` (at most 40 lasting facts) |
| `cache/llama-slots/` | Saved llama slot for Preyas's system prompt (same folder agent-drive uses) |
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
