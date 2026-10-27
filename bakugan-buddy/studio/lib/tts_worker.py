#!/usr/bin/env python3
"""Warm Piper TTS worker — load voice(s) once, synthesize many sentences.

Protocol (stdin/stdout NDJSON lines):
  → {"id":1,"cmd":"synth","text":"...","model":"/path/voice.onnx","length_scale":1.0,"noise_w":0.6,"out":"/tmp/x.wav"}
  ← {"id":1,"ok":true,"ms":12.3,"out":"/tmp/x.wav"}
  → {"id":2,"cmd":"ping"}
  ← {"id":2,"ok":true,"pong":true}
  → {"cmd":"quit"}
"""
from __future__ import annotations

import json
import sys
import time
import wave
from pathlib import Path

voices = {}


def load_voice(model: str):
    model = str(model)
    if model in voices:
        return voices[model]
    try:
        from piper import PiperVoice
    except ImportError as e:
        raise RuntimeError(
            "piper package missing — run download-models.sh or: pip install piper-tts"
        ) from e
    voice = PiperVoice.load(model)
    voices[model] = voice
    return voice


def synth(req: dict) -> dict:
    text = (req.get("text") or "").strip()
    out = req.get("out")
    model = req.get("model")
    if not text or not out or not model:
        return {"ok": False, "error": "need text, model, out"}
    t0 = time.perf_counter()
    voice = load_voice(model)
    length_scale = float(req.get("length_scale") or 1.0)
    noise_w = req.get("noise_w")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(out, "wb") as wav_file:
        # piper synthesize API varies by version — try kwargs then positional
        try:
            kwargs = {"length_scale": length_scale}
            if noise_w is not None:
                kwargs["noise_w"] = float(noise_w)
            voice.synthesize(text, wav_file, **kwargs)
        except TypeError:
            voice.synthesize(text, wav_file)
    ms = (time.perf_counter() - t0) * 1000
    return {"ok": True, "ms": round(ms, 2), "out": out}


def main() -> None:
    # line-buffered
    sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, "reconfigure") else None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"bad_json:{e}"}), flush=True)
            continue
        cmd = req.get("cmd") or "synth"
        rid = req.get("id")
        if cmd == "quit":
            print(json.dumps({"id": rid, "ok": True, "bye": True}), flush=True)
            break
        if cmd == "ping":
            print(json.dumps({"id": rid, "ok": True, "pong": True, "loaded": list(voices)}), flush=True)
            continue
        if cmd == "synth":
            try:
                result = synth(req)
            except Exception as e:  # noqa: BLE001 — worker must never die on one sentence
                result = {"ok": False, "error": str(e)}
            result["id"] = rid
            print(json.dumps(result), flush=True)
            continue
        print(json.dumps({"id": rid, "ok": False, "error": f"unknown_cmd:{cmd}"}), flush=True)


if __name__ == "__main__":
    main()
