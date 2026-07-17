from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, draws, machines, shipments, wallet

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


@app.get("/health")
def health():
    return {"status": "ok"}
