from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user_id
from app.models import WalletLedger

router = APIRouter(prefix="/wallet", tags=["wallet"])


class BalanceResponse(BaseModel):
    balance: int


@router.get("/balance", response_model=BalanceResponse)
def get_balance(
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> BalanceResponse:
    """잔액 = 원장 합계 (읽기 전용). 충전/역분개 등 쓰기는 F-02에서."""
    balance = db.execute(
        select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
            WalletLedger.user_id == user_id
        )
    ).scalar_one()
    return BalanceResponse(balance=balance)
