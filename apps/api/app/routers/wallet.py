from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.constants import COIN_PACKAGES
from app.db import get_db
from app.deps import get_current_user_id
from app.models import Payment, WalletLedger
from app.models import User
from app.services.pg import FakePgClient, PgClient, get_pg_client
from app.services.wallet_service import (
    PaymentError,
    confirm_topup,
    create_topup,
    month_paid_total,
    set_monthly_limit,
)

router = APIRouter(prefix="/wallet", tags=["wallet"])


class BalanceResponse(BaseModel):
    balance: int


class PackageInfo(BaseModel):
    id: str
    label: str
    amount_krw: int
    coin_amount: int


class TopupRequest(BaseModel):
    package_id: str  # 금액은 안 받는다 — 서버 패키지 테이블이 결정


class TopupResponse(BaseModel):
    pg_tx_id: str
    amount_krw: int
    coin_amount: int
    status: str


@router.get("/balance", response_model=BalanceResponse)
def get_balance(
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> BalanceResponse:
    """잔액 = 원장 합계 (읽기 전용)"""
    balance = db.execute(
        select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
            WalletLedger.user_id == user_id
        )
    ).scalar_one()
    return BalanceResponse(balance=balance)


class LimitInfo(BaseModel):
    monthly_limit_krw: int
    month_paid_krw: int


class LimitUpdate(BaseModel):
    monthly_limit_krw: int


@router.get("/limit", response_model=LimitInfo)
def get_limit(
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> LimitInfo:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="존재하지 않는 유저")
    return LimitInfo(
        monthly_limit_krw=user.monthly_limit_krw,
        month_paid_krw=month_paid_total(db, user_id),
    )


@router.patch("/limit", response_model=LimitInfo)
def patch_limit(
    body: LimitUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> LimitInfo:
    try:
        set_monthly_limit(db, user_id, body.monthly_limit_krw)
    except PaymentError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return LimitInfo(
        monthly_limit_krw=body.monthly_limit_krw,
        month_paid_krw=month_paid_total(db, user_id),
    )


@router.get("/packages", response_model=list[PackageInfo])
def list_packages() -> list[PackageInfo]:
    return [
        PackageInfo(id=pid, label=p["label"], amount_krw=p["amount_krw"], coin_amount=p["coin_amount"])
        for pid, p in COIN_PACKAGES.items()
    ]


@router.post("/topups", response_model=TopupResponse)
def start_topup(
    body: TopupRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> TopupResponse:
    """충전 인텐트 생성 — 실결제는 PG 창에서, 확정은 웹훅에서만."""
    try:
        payment = create_topup(db, user_id, body.package_id)
    except PaymentError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return TopupResponse(
        pg_tx_id=payment.pg_tx_id,
        amount_krw=payment.amount_krw,
        coin_amount=payment.coin_amount,
        status=payment.status,
    )


@router.post("/topups/{pg_tx_id}/dev-complete", response_model=TopupResponse)
def dev_complete_topup(
    pg_tx_id: str,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
    pg: PgClient = Depends(get_pg_client),
) -> TopupResponse:
    """개발 전용: Fake PG에 결제 완료를 심고 웹훅 확정 플로우를 그대로 태운다.

    실 PG 모드에선 404 — 프로덕션에 이 경로는 존재하지 않는 것과 같다.
    확정 로직은 웹훅과 동일한 confirm_topup 하나뿐이라 우회 경로가 아니다.
    """
    if settings.pg_provider != "fake" or not isinstance(pg, FakePgClient):
        raise HTTPException(status_code=404, detail="Not found")
    payment = db.execute(
        select(Payment).where(Payment.pg_tx_id == pg_tx_id)
    ).scalar_one_or_none()
    if payment is None or payment.user_id != user_id:
        raise HTTPException(status_code=404, detail="알 수 없는 거래")
    pg.arm(pg_tx_id, "paid", payment.amount_krw)
    try:
        payment = confirm_topup(db, pg, pg_tx_id)
    except PaymentError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return TopupResponse(
        pg_tx_id=payment.pg_tx_id,
        amount_krw=payment.amount_krw,
        coin_amount=payment.coin_amount,
        status=payment.status,
    )
