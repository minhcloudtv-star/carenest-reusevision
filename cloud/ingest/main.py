from fastapi import FastAPI

app = FastAPI(title="CareNest Cloud Ingest")


@app.get("/health")
def health():
    return {"status": "ok"}
