"""Write a short summary of one session by asking the local model."""

from __future__ import annotations

import argparse
import os
import sys

from agent_drive.chat import ChatError, chat_completion
from agent_drive.history import add_summary, latest_session_with_messages, session_transcript
from agent_drive.mount import DriveNotReady, check_root
from agent_drive.paths import agent_root

_SYSTEM = (
    "Summarize this session in under 80 words. "
    "Keep only decisions, facts, and open questions. No preamble."
)
_MAX_TRANSCRIPT = 8000


def summarize_session(session_id: str, *, base_url: str, model: str, root=None) -> str:
    transcript = session_transcript(session_id, root)
    if not transcript.strip():
        raise ChatError(f"Session {session_id} has no messages to summarize.")
    if len(transcript) > _MAX_TRANSCRIPT:
        transcript = transcript[-_MAX_TRANSCRIPT:]
    summary = chat_completion(
        base_url=base_url,
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": transcript},
        ],
    )
    add_summary(session_id, summary, root)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Summarize a history session with the local model.")
    parser.add_argument("--session", help="Session id. Defaults to the latest session that has messages.")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("AGENT_DRIVE_SUMMARY_API_BASE", "http://127.0.0.1:4000/v1"),
        help="OpenAI-compatible base URL. Default is the local gateway.",
    )
    parser.add_argument("--model", default=os.environ.get("AGENT_DRIVE_SUMMARY_MODEL", "local"))
    args = parser.parse_args(argv)
    root = agent_root()
    try:
        check_root(root)
        session_id = args.session or latest_session_with_messages(root)
        if not session_id:
            print("No session with messages yet.", file=sys.stderr)
            return 1
        summary = summarize_session(session_id, base_url=args.base_url, model=args.model, root=root)
    except (DriveNotReady, ChatError) as exc:
        print(exc, file=sys.stderr)
        return 1
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
