"""지갑/충전 서비스 (F-02)

money-safety 불변식:
- 잔액 갱신 = wallet_ledger 행 추가뿐. 모든 행은 ref_type/ref_id로 근거 연결.
- payments.status='paid' 전환 + 원장 '+' 기록 = 단일 트랜잭션.
- 확정은 서버가 PG에 직접 조회(verify)한 결과로만. 웹훅 payload 금액도 불신.
- 멱등성: pg_tx_id UNIQUE + 행 잠금(FOR UPDATE) + 상태 검사 → 중복 웹훅 안전.
- 취소 = 원장 역분개(마이너스 행 추가). 기존 행 수정/삭제 금지.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants import COIN_PACKAGES
from app.db import begin_txn
from app.models import Payment, WalletLedger
from app.services.pg import PgClient


class PaymentError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def create_topup(db: Session, user_id: int, package_id: str) -> Payment:
    """충전 인텐트 생성 — 금액·코인은 서버 패키지 테이블에서만 결정."""
    package = COIN_PACKAGES.get(package_id)
    if package is None:
        raise PaymentError(422, "존재하지 않는 충전 패키지")

    with begin_txn(db):
        payment = Payment(
            user_id=user_id,
            pg_provider="portone",
            pg_tx_id=f"topup-{uuid.uuid4()}",  # 실 연동 시 PG 발급 id로 대체
            amount_krw=package["amount_krw"],
            coin_amount=package["coin_amount"],
            status="pending",
        )
        db.add(payment)
    return payment


def _locked_payment(db: Session, pg_tx_id: str) -> Payment:
    """pg_tx_id로 결제 행을 잠근다 — 동시 웹훅(중복 수신)을 직렬화."""
    payment = db.execute(
        select(Payment)
        .where(Payment.pg_tx_id == pg_tx_id)
        .with_for_update()
        .execution_options(populate_existing=True)  # 잠금 시점의 최신 행 강제 반영
    ).scalar_one_or_none()
    if payment is None:
        raise PaymentError(404, "알 수 없는 거래")
    return payment


def confirm_topup(db: Session, pg: PgClient, pg_tx_id: str) -> Payment:
    """결제 확정 — 웹훅이 트리거하지만 근거는 PG 직접 조회 결과뿐."""
    with begin_txn(db):
        payment = _locked_payment(db, pg_tx_id)
        if payment.status == "paid":
            return payment  # 중복 웹훅 — 멱등 무시
        if payment.status == "canceled":
            raise PaymentError(409, "이미 취소된 거래")

        verification = pg.verify(pg_tx_id)  # ★ 서버 → PG 직접 검증
        if verification.status != "paid":
            raise PaymentError(400, f"PG 검증 실패 (상태: {verification.status})")
        if verification.amount_krw != payment.amount_krw:
            raise PaymentError(400, "결제 금액 불일치 — 지급 거부")

        payment.status = "paid"
        db.add(
            WalletLedger(
                user_id=payment.user_id,
                amount=payment.coin_amount,
                reason="topup",
                ref_type="payment",
                ref_id=payment.id,
            )
        )
    return payment


def cancel_topup(db: Session, pg: PgClient, pg_tx_id: str) -> Payment:
    """충전 취소 — paid였다면 원장 역분개(마이너스 행). 행 수정/삭제 없음."""
    with begin_txn(db):
        payment = _locked_payment(db, pg_tx_id)
        if payment.status == "canceled":
            return payment  # 멱등

        verification = pg.verify(pg_tx_id)
        if verification.status != "cancelled":
            raise PaymentError(400, f"PG 취소 검증 실패 (상태: {verification.status})")

        if payment.status == "paid":
            db.add(
                WalletLedger(
                    user_id=payment.user_id,
                    amount=-payment.coin_amount,
                    reason="refund",
                    ref_type="payment",
                    ref_id=payment.id,
                )
            )
        payment.status = "canceled"
    return payment
