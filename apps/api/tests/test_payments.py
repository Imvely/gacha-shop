"""F-02 지갑/결제 acceptance 테스트

1. 결제 승인은 서버 웹훅 검증으로만 확정 (PG 미검증/금액 불일치 → 지급 거부)
2. 잔액 = 원장 합계 항상 일치 (불변식)
3. 충전 취소 시 원장 역분개
+ money-safety: 중복 웹훅 20스레드 멱등성 (원장 정확히 1행)
"""
import threading

import pytest
from sqlalchemy import func, select

from tests.conftest import TestSession
from app.models import Payment, WalletLedger
from app.services.pg import FakePgClient
from app.services.wallet_service import (
    PaymentError,
    cancel_topup,
    confirm_topup,
    create_topup,
)


def balance_of(db, user_id: int) -> int:
    return db.execute(
        select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
            WalletLedger.user_id == user_id
        )
    ).scalar_one()


def ledger_rows(db, user_id: int) -> list[WalletLedger]:
    return db.execute(
        select(WalletLedger).where(WalletLedger.user_id == user_id).order_by(WalletLedger.id)
    ).scalars().all()


@pytest.fixture
def pg():
    return FakePgClient()


# ── 1) 서버 웹훅 검증으로만 확정 ──────────────────────────────────────────


def test_confirm_credits_coins_via_pg_verification(db, make_user, pg):
    uid = make_user(coins=0)
    payment = create_topup(db, uid, "standard")  # 10000원 → 1100코인 (서버 결정)
    assert payment.status == "pending"
    assert balance_of(db, uid) == 0, "확정 전 지급 금지"

    pg.arm(payment.pg_tx_id, "paid", 10000)
    confirmed = confirm_topup(db, pg, payment.pg_tx_id)

    assert confirmed.status == "paid"
    assert balance_of(db, uid) == 1100
    rows = ledger_rows(db, uid)
    assert len(rows) == 1
    assert rows[0].reason == "topup" and rows[0].ref_type == "payment" and rows[0].ref_id == payment.id


def test_unverified_payment_rejected(db, make_user, pg):
    """PG가 모르는 거래(프론트가 '결제했다'고 우겨도) → 지급 거부"""
    uid = make_user(coins=0)
    payment = create_topup(db, uid, "starter")
    # pg.arm 없음 — PG 조회 결과 failed

    with pytest.raises(PaymentError) as exc:
        confirm_topup(db, pg, payment.pg_tx_id)
    assert exc.value.status_code == 400
    assert balance_of(db, uid) == 0
    assert db.get(Payment, payment.id).status == "pending"


def test_amount_mismatch_rejected(db, make_user, pg):
    """PG 실결제 금액이 우리 기록과 다르면(위변조) 지급 거부"""
    uid = make_user(coins=0)
    payment = create_topup(db, uid, "standard")  # 서버 기록 10000원
    pg.arm(payment.pg_tx_id, "paid", 100)  # 실제론 100원만 결제

    with pytest.raises(PaymentError) as exc:
        confirm_topup(db, pg, payment.pg_tx_id)
    assert exc.value.status_code == 400
    assert balance_of(db, uid) == 0


def test_webhook_http_path(db, make_user, pg):
    """HTTP 웹훅 경로로도 확정 동작 (라우터 연결 검증)"""
    from fastapi.testclient import TestClient

    from app.db import get_db
    from app.main import app
    from app.services.pg import get_pg_client

    uid = make_user(coins=0)
    payment = create_topup(db, uid, "starter")
    pg.arm(payment.pg_tx_id, "paid", 5000)

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_pg_client] = lambda: pg
    try:
        res = TestClient(app).post(
            "/webhooks/portone",
            json={"type": "Transaction.Paid", "pg_tx_id": payment.pg_tx_id},
        )
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200 and res.json()["status"] == "paid"
    assert balance_of(db, uid) == 500


# ── money-safety: 중복 웹훅 멱등성 (20스레드) ─────────────────────────────


def test_duplicate_webhooks_20_threads_credit_once(db, make_user, pg):
    uid = make_user(coins=0)
    payment = create_topup(db, uid, "big")  # 3500코인
    pg.arm(payment.pg_tx_id, "paid", 30000)

    errors: list[Exception] = []

    def deliver():
        session = TestSession()
        try:
            confirm_topup(session, pg, payment.pg_tx_id)
        except Exception as e:  # noqa: BLE001
            errors.append(e)
        finally:
            session.close()

    threads = [threading.Thread(target=deliver) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"중복 웹훅 처리 중 예외: {errors}"
    assert balance_of(db, uid) == 3500, "이중 지급 발생"
    assert len(ledger_rows(db, uid)) == 1, "원장에 topup 행이 1개여야 함"


# ── 2) 잔액 = 원장 합계 불변식 ────────────────────────────────────────────


def test_balance_always_equals_ledger_sum(db, make_user, make_machine, pg):
    """충전 → 스핀 → 취소가 섞여도 잔액은 원장 합계와 일치"""
    from app.services.draw_engine import execute_draws

    uid = make_user(coins=0)
    p1 = create_topup(db, uid, "standard")
    pg.arm(p1.pg_tx_id, "paid", 10000)
    confirm_topup(db, pg, p1.pg_tx_id)  # +1100

    machine_id, _ = make_machine({"normal-a": 10}, price_coin=100)
    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)  # -100

    p2 = create_topup(db, uid, "starter")
    pg.arm(p2.pg_tx_id, "paid", 5000)
    confirm_topup(db, pg, p2.pg_tx_id)  # +500
    pg.arm(p2.pg_tx_id, "cancelled", 5000)
    cancel_topup(db, pg, p2.pg_tx_id)  # -500 역분개

    rows = ledger_rows(db, uid)
    assert balance_of(db, uid) == sum(r.amount for r in rows) == 1000
    assert [r.reason for r in rows] == ["topup", "draw", "topup", "refund"]


# ── 3) 취소 역분개 ────────────────────────────────────────────────────────


def test_cancel_reverses_ledger(db, make_user, pg):
    uid = make_user(coins=0)
    payment = create_topup(db, uid, "standard")
    pg.arm(payment.pg_tx_id, "paid", 10000)
    confirm_topup(db, pg, payment.pg_tx_id)
    assert balance_of(db, uid) == 1100

    pg.arm(payment.pg_tx_id, "cancelled", 10000)
    canceled = cancel_topup(db, pg, payment.pg_tx_id)

    assert canceled.status == "canceled"
    rows = ledger_rows(db, uid)
    assert len(rows) == 2, "역분개 = 마이너스 행 추가 (기존 행 수정 금지)"
    assert rows[1].amount == -1100 and rows[1].reason == "refund"
    assert balance_of(db, uid) == 0

    # 취소 웹훅 중복 수신 — 멱등
    cancel_topup(db, pg, payment.pg_tx_id)
    assert len(ledger_rows(db, uid)) == 2


def test_cancel_before_paid_no_ledger(db, make_user, pg):
    """pending 상태 취소 — 지급된 적 없으니 역분개도 없음"""
    uid = make_user(coins=0)
    payment = create_topup(db, uid, "starter")
    pg.arm(payment.pg_tx_id, "cancelled", 5000)

    canceled = cancel_topup(db, pg, payment.pg_tx_id)
    assert canceled.status == "canceled"
    assert ledger_rows(db, uid) == []

    # 취소된 거래에 뒤늦게 paid 웹훅 → 거부
    pg.arm(payment.pg_tx_id, "paid", 5000)
    with pytest.raises(PaymentError) as exc:
        confirm_topup(db, pg, payment.pg_tx_id)
    assert exc.value.status_code == 409
    assert balance_of(db, uid) == 0


def test_unknown_package_rejected(db, make_user):
    uid = make_user(coins=0)
    with pytest.raises(PaymentError) as exc:
        create_topup(db, uid, "mega-9999")
    assert exc.value.status_code == 422
