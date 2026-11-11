import asyncio
import os
from contextlib import asynccontextmanager, suppress

from .fallback import FallbackService


@asynccontextmanager
async def notify_lifespan(app):
    path = os.environ.get("NOTIFY_DB_PATH", "").strip()
    app.state.fallback = None
    task = None
    if path:
        app.state.fallback = FallbackService(
            path, float(os.environ.get("BED_EXIT_FALLBACK_SECONDS", "60")))

        async def run():
            while True:
                await asyncio.to_thread(app.state.fallback.process_due)
                await asyncio.sleep(5)

        task = asyncio.create_task(run())
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
