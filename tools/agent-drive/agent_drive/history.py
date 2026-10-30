"""SQLite history: sessions, messages, and short summaries."""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from agent_drive.paths import agent_root

_LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  title TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  call_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_call_role
  ON messages(call_id, role)
  WHERE call_id IS NOT NULL;
"""

_MESSAGE_COLUMNS = (
    ("prompt_cache_hit_tokens", "INTEGER"),
    ("prompt_cache_miss_tokens", "INTEGER"),
    ("estimated_cost_usd", "TEXT"),
    ("rate_window", "TEXT"),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def history_db_path(root: Path | None = None) -> Path:
    return (root or agent_root()) / "history" / "history.db"


def connect(root: Path | None = None) -> sqlite3.Connection:
    path = history_db_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    have = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
    for name, decl in _MESSAGE_COLUMNS:
        if name not in have:
            conn.execute(f"ALTER TABLE messages ADD COLUMN {name} {decl}")
    return conn


def create_session(root: Path | None = None, title: str | None = None) -> str:
    session_id = "ses_" + uuid4().hex[:12]
    with _LOCK:
        conn = connect(root)
        try:
            conn.execute(
                "INSERT INTO sessions (id, created_at, title) VALUES (?, ?, ?)",
                (session_id, utc_now(), title),
            )
            conn.commit()
        finally:
            conn.close()
    return session_id


def ensure_session(session_id: str, root: Path | None = None) -> None:
    with _LOCK:
        conn = connect(root)
        try:
            conn.execute(
                "INSERT OR IGNORE INTO sessions (id, created_at, title) VALUES (?, ?, NULL)",
                (session_id, utc_now()),
            )
            conn.commit()
        finally:
            conn.close()


def call_already_logged(conn: sqlite3.Connection, call_id: str) -> bool:
    row = conn.execute("SELECT 1 FROM messages WHERE call_id = ? LIMIT 1", (call_id,)).fetchone()
    return row is not None


def add_message(
    conn: sqlite3.Connection,
    *,
    session_id: str,
    call_id: str | None,
    role: str,
    content: str,
    model: str | None,
    cache_hit: bool,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    prompt_cache_hit_tokens: int | None = None,
    prompt_cache_miss_tokens: int | None = None,
    estimated_cost_usd: str | None = None,
    rate_window: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO messages (
          session_id, call_id, role, content, model, cache_hit,
          prompt_tokens, completion_tokens, created_at,
          prompt_cache_hit_tokens, prompt_cache_miss_tokens,
          estimated_cost_usd, rate_window
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            call_id,
            role,
            content,
            model,
            1 if cache_hit else 0,
            prompt_tokens,
            completion_tokens,
            utc_now(),
            prompt_cache_hit_tokens,
            prompt_cache_miss_tokens,
            estimated_cost_usd,
            rate_window,
        ),
    )


def log_exchange(
    *,
    session_id: str,
    call_id: str | None,
    user_text: str,
    assistant_text: str,
    model: str | None,
    cache_hit: bool,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    root: Path | None = None,
    prompt_cache_hit_tokens: int | None = None,
    prompt_cache_miss_tokens: int | None = None,
    estimated_cost_usd: str | None = None,
    rate_window: str | None = None,
) -> bool:
    """Insert the user and assistant rows. Return False when this call id was already stored."""
    with _LOCK:
        conn = connect(root)
        try:
            conn.execute(
                "INSERT OR IGNORE INTO sessions (id, created_at, title) VALUES (?, ?, NULL)",
                (session_id, utc_now()),
            )
            if call_id and call_already_logged(conn, call_id):
                conn.commit()
                return False
            if user_text:
                add_message(
                    conn,
                    session_id=session_id,
                    call_id=call_id,
                    role="user",
                    content=user_text,
                    model=model,
                    cache_hit=cache_hit,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    prompt_cache_hit_tokens=prompt_cache_hit_tokens,
                    prompt_cache_miss_tokens=prompt_cache_miss_tokens,
                    estimated_cost_usd=estimated_cost_usd,
                    rate_window=rate_window,
                )
            if assistant_text:
                add_message(
                    conn,
                    session_id=session_id,
                    call_id=call_id,
                    role="assistant",
                    content=assistant_text,
                    model=model,
                    cache_hit=cache_hit,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    prompt_cache_hit_tokens=prompt_cache_hit_tokens,
                    prompt_cache_miss_tokens=prompt_cache_miss_tokens,
                    estimated_cost_usd=estimated_cost_usd,
                    rate_window=rate_window,
                )
            conn.commit()
            return True
        finally:
            conn.close()


def add_summary(session_id: str, summary: str, root: Path | None = None) -> None:
    text = summary.strip()
    if not text:
        raise ValueError("summary is empty")
    ensure_session(session_id, root)
    with _LOCK:
        conn = connect(root)
        try:
            conn.execute(
                "INSERT INTO summaries (session_id, summary, created_at) VALUES (?, ?, ?)",
                (session_id, text, utc_now()),
            )
            conn.commit()
        finally:
            conn.close()


def recent_summaries(limit: int = 3, root: Path | None = None) -> list[dict[str, Any]]:
    conn = connect(root)
    try:
        rows = conn.execute(
            """
            SELECT session_id, summary, created_at
            FROM summaries
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


def latest_session_with_messages(root: Path | None = None) -> str | None:
    conn = connect(root)
    try:
        row = conn.execute(
            """
            SELECT session_id FROM messages
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return str(row["session_id"])


def session_transcript(session_id: str, root: Path | None = None, limit: int = 40) -> str:
    conn = connect(root)
    try:
        rows = conn.execute(
            """
            SELECT role, content FROM messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
    finally:
        conn.close()
    lines = [f"{row['role']}: {row['content']}" for row in reversed(rows)]
    return "\n".join(lines)
