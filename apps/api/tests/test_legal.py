"""F-08 법적 가드 acceptance 테스트

1. 월 한도 초과 시 결제 차단 (인텐트 + 확정 이중 방어, 유저 하향 조정)
2. 결과 화면 정가 표기 → FE 검증 (verify-spin.mjs revealHasRetailPrice)
3. 약관 버전 관리 (최신 제공 + 과거 버전 조회)
"""
import pytest

from tests.conftest import TestSession
from app.services.pg import FakePgClient
from app.services.wallet_service import (
    PaymentError,
    confirm_topup,
    create_topup,
    set_monthly_limit,
)


def _paid(db, pg, uid, package_id):
    p = create_topup(db, uid, package_id)
    pg.arm(p.pg_tx_id, "paid", p.amount_krw)
    return confirm_topup(db, pg, p.pg_tx_id)


@pytest.fixture
def pg():
    return FakePgClient()


# ── 1) 월 한도 ────────────────────────────────────────────────────────────


def test_topup_blocked_over_default_monthly_limit(db, make_user, pg):
    """기본 한도 300,000원 — 도달까지는 허용, 초과분은 차단"""
    uid = make_user(coins=0)
    for _ in range(10):
        _paid(db, pg, uid, "big")  # 30,000 x 10 = 300,000 (딱 한도)

    with pytest.raises(PaymentError) as exc:
        create_topup(db, uid, "starter")  # +5,000 → 초과
    assert exc.value.status_code == 403
    assert "한도" in exc.value.detail


def test_user_can_lower_limit_and_it_blocks(db, make_user, pg):
    uid = make_user(coins=0)
    set_monthly_limit(db, uid, 15000)

    _paid(db, pg, uid, "standard")  # 10,000 — 한도 내
    with pytest.raises(PaymentError) as exc:
        create_topup(db, uid, "standard")  # 20,000 > 15,000
    assert exc.value.status_code == 403


def test_limit_bounds_validation(db, make_user):
    uid = make_user(coins=0)
    with pytest.raises(PaymentError):
        set_monthly_limit(db, uid, 5000)  # 최소 미만
    with pytest.raises(PaymentError):
        set_monthly_limit(db, uid, 400000)  # 기본 최대치 초과 상향 불가
    assert set_monthly_limit(db, uid, 10000) == 10000
    assert set_monthly_limit(db, uid, 300000) == 300000  # 범위 내 재상향은 허용


def test_confirm_level_guard_blocks_multi_intent_bypass(db, make_user, pg):
    """인텐트를 미리 여러 개 열어 한도를 우회 → 확정 단계에서 차단"""
    uid = make_user(coins=0)
    set_monthly_limit(db, uid, 20000)

    # paid 0원 시점 — 인텐트 3개는 전부 생성 가능 (각 10,000)
    p1 = create_topup(db, uid, "standard")
    p2 = create_topup(db, uid, "standard")
    p3 = create_topup(db, uid, "standard")

    for p in (p1, p2):
        pg.arm(p.pg_tx_id, "paid", 10000)
        confirm_topup(db, pg, p.pg_tx_id)  # 10,000 → 20,000 (한도 도달)

    pg.arm(p3.pg_tx_id, "paid", 10000)
    with pytest.raises(PaymentError) as exc:
        confirm_topup(db, pg, p3.pg_tx_id)
    assert exc.value.status_code == 403

    session = TestSession()
    from sqlalchemy import func, select

    from app.models import Payment, WalletLedger

    status = session.execute(
        select(Payment.status).where(Payment.pg_tx_id == p3.pg_tx_id)
    ).scalar_one()
    assert status == "pending", "차단된 결제는 pending 유지 (운영 환불 대상)"
    balance = session.execute(
        select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
            WalletLedger.user_id == uid
        )
    ).scalar_one()
    session.close()
    assert balance == 2200, "차단 건 코인 미지급 (1100 x 2건만)"


# ── 3) 약관 버전 관리 ─────────────────────────────────────────────────────


def _client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_terms_latest_and_versions():
    res = _client().get("/terms")
    assert res.status_code == 200
    body = res.json()
    versions = [v["version"] for v in body["versions"]]
    assert len(versions) >= 2, "버전 관리 = 복수 버전 보존"
    assert body["latest"]["version"] == versions[-1] == "2026-07-18"
    assert "청약이 확정" in body["latest"]["content"], "스핀=청약확정 조항 포함"


def test_terms_old_version_retrievable():
    res = _client().get("/terms/2026-07-01")
    assert res.status_code == 200
    assert res.json()["version"] == "2026-07-01"
    assert _client().get("/terms/1999-01-01").status_code == 404
