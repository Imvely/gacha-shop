from fastapi import FastAPI

from app.routers import admin, auth, draws, machines, shipments, wallet

app = FastAPI(title="PONG! Gacha Shop API", version="0.1.0")

app.include_router(auth.router)
app.include_router(machines.router)
app.include_router(draws.router)
app.include_router(wallet.router)
app.include_router(shipments.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"status": "ok"}
