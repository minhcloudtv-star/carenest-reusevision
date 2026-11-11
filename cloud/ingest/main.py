from fastapi import FastAPI

from cloud.notify.router import router as notify_router
from cloud.notify.runtime import notify_lifespan

app = FastAPI(title="CareNest Cloud Ingest", lifespan=notify_lifespan)
app.include_router(notify_router)


@app.get("/health")
def health():
    return {"status": "ok"}
