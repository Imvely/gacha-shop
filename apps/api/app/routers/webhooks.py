"""PG 웹훅 (F-02) — 결제 확정의 유일한 진입점.

프론트 결제 성공 콜백으로 status='paid' 전환하는 경로는 어디에도 없다 (money-safety 5).
TODO(실 포트원 연동): 웹훅 서명(Webhook-Signature) 검증 추가 — PG 추상화에 포함 예정.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.pg import PgClient, get_pg_client
from app.services.wallet_service import PaymentError, cancel_topup, confirm_topup

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class PortOneWebhook(BaseModel):
    type: str  # "Transaction.Paid" | "Transaction.Cancelled"
    pg_tx_id: str


@router.post("/portone")
def portone_webhook(
    body: PortOneWebhook,
    db: Session = Depends(get_db),
    pg: PgClient = Depends(get_pg_client),
):
    try:
        if body.type == "Transaction.Paid":
            payment = confirm_topup(db, pg, body.pg_tx_id)
        elif body.type == "Transaction.Cancelled":
            payment = cancel_topup(db, pg, body.pg_tx_id)
        else:
            return {"ok": True, "ignored": body.type}
    except PaymentError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return {"ok": True, "status": payment.status}
