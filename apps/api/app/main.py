from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, draws, machines, shipments, wallet, webhooks

app = FastAPI(title="PONG! Gacha Shop API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(machines.router)
app.include_router(draws.router)
app.include_router(wallet.router)
app.include_router(shipments.router)
app.include_router(admin.router)
app.include_router(webhooks.router)


@app.get("/health")
def health():
    return {"status": "ok"}


# ── 약관 (F-08: 버전 관리 — 최신 제공 + 과거 버전 조회) ────────────────────
from app.terms import TERMS_VERSIONS, get_terms, latest_terms  # noqa: E402


@app.get("/terms")
def terms_latest():
    return {
        "latest": latest_terms(),
        "versions": [
            {"version": t["version"], "effective_date": t["effective_date"]}
            for t in TERMS_VERSIONS
        ],
    }


@app.get("/terms/{version}")
def terms_by_version(version: str):
    t = get_terms(version)
    if t is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="없는 약관 버전")
    return t
