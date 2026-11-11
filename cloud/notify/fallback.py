import math
import re
import sqlite3
import time
from collections.abc import Callable
from datetime import datetime

from .telegram import DeliveryError, send_telegram


class FallbackService:
    """Durable single-hub queue. Feed from trusted ingest/ack handlers only."""

    def __init__(self, path: str, delay: float, sender: Callable = send_telegram,
                 clock: Callable = time.time):
        if not math.isfinite(delay) or delay <= 0:
            raise ValueError("BED_EXIT_FALLBACK_SECONDS must be positive")
        self.path, self.delay, self.sender, self.clock = path, delay, sender, clock
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS telegram_settings (
                    scope TEXT PRIMARY KEY, chat_id TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS fallback_jobs (
                    scope TEXT NOT NULL, event_id TEXT NOT NULL,
                    event_ts TEXT NOT NULL, due REAL NOT NULL,
                    acknowledged INTEGER NOT NULL DEFAULT 0,
                    delivered INTEGER NOT NULL DEFAULT 0,
                    lease_until REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (scope, event_id)
                );
            """)

    def db(self):
        return sqlite3.connect(self.path, timeout=10)

    def settings(self, scope: str) -> str:
        with self.db() as db:
            row = db.execute("SELECT chat_id FROM telegram_settings WHERE scope=?", (scope,)).fetchone()
        return row[0] if row else ""

    def configure(self, scope: str, chat_id: str):
        if chat_id and not re.fullmatch(r"-?[1-9][0-9]{0,19}", chat_id):
            raise ValueError("Telegram chat ID không hợp lệ")
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO telegram_settings VALUES (?, ?)", (scope, chat_id))

    def record_event(self, scope: str, event: dict):
        # No changes to docs/event-schema.md. Other event types are ignored.
        if event["type"] != "BED_EXIT":
            return
        timestamp = datetime.fromisoformat(event["ts"])
        if timestamp.tzinfo is None:
            raise ValueError("Event timestamp must include timezone")
        with self.db() as db:
            db.execute("""INSERT OR IGNORE INTO fallback_jobs
                (scope, event_id, event_ts, due, acknowledged) VALUES (?, ?, ?, ?, ?)""",
                (scope, event["event_id"], event["ts"], timestamp.timestamp() + self.delay,
                 int(bool(event.get("acknowledged_by")))))
            if event.get("acknowledged_by"):
                db.execute("UPDATE fallback_jobs SET acknowledged=1 WHERE scope=? AND event_id=?",
                           (scope, event["event_id"]))

    def acknowledge(self, scope: str, event_id: str):
        with self.db() as db:
            db.execute("UPDATE fallback_jobs SET acknowledged=1 WHERE scope=? AND event_id=?",
                       (scope, event_id))

    def send_test(self, scope: str):
        chat_id = self.settings(scope)
        if not chat_id:
            raise ValueError("Hãy lưu Telegram chat ID trước")
        self.sender(chat_id, "CareNest: Tin nhắn thử kênh dự phòng. Không phải cảnh báo sự kiện.")

    def process_due(self):
        now = self.clock()
        with self.db() as db:
            rows = db.execute("""SELECT scope, event_id FROM fallback_jobs
                WHERE acknowledged=0 AND delivered=0 AND due<=? AND lease_until<=?""",
                (now, now)).fetchall()
        for scope, event_id in rows:
            with self.db() as db:
                claimed = db.execute("""UPDATE fallback_jobs SET lease_until=?
                    WHERE scope=? AND event_id=? AND acknowledged=0 AND delivered=0
                    AND lease_until<=?""", (now + 60, scope, event_id, now)).rowcount
            if not claimed:
                continue
            with self.db() as db:
                row = db.execute("""SELECT j.event_ts, s.chat_id FROM fallback_jobs j
                    JOIN telegram_settings s ON s.scope=j.scope
                    WHERE j.scope=? AND j.event_id=? AND j.acknowledged=0 AND s.chat_id<>''""",
                    (scope, event_id)).fetchone()
            if not row:
                continue
            try:
                # Text only, no identity, camera ID, images or sensitive deep links.
                self.sender(row[1], f"CareNest: Rời giường · {row[0]} · Chưa được xác nhận.")
            except DeliveryError:
                # Retry after the lease expires; no secrets in error logs.
                continue
            with self.db() as db:
                db.execute("UPDATE fallback_jobs SET delivered=1 WHERE scope=? AND event_id=?",
                           (scope, event_id))
