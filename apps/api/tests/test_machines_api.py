"""F-03 머신 목록/상세 acceptance 테스트

1. 확률 합계 100% 표시 (실데이터, 반올림 후에도 정확히 100.00)
2. 재고 0 머신 자동 품절 처리
"""
import pytest

from tests.conftest import TestSession
from app.services.draw_engine import execute_draws
from app.services.odds import odds_percentages


def _client():
    from fastapi.testclient import TestClient

    from app.db import get_db
    from app.main import app

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


# ── 1) 확률 합계 100% ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "stocks",
    [
        [1, 1, 1],          # 33.33 + 33.33 + 33.34
        [7, 11, 13, 3],     # 반올림 잔여 배분 케이스
        [1, 1, 1, 1, 1, 1, 1],
        [999, 1],
        [5],
    ],
)
def test_odds_always_sum_to_exactly_100(stocks):
    pcts = odds_percentages(stocks)
    assert round(sum(pcts), 2) == 100.00
    # 실데이터 검증: 비율이 stock/total과 0.01%p 이내로 일치
    total = sum(stocks)
    for s, p in zip(stocks, pcts):
        assert abs(p - s / total * 100) <= 0.01


def test_detail_api_odds_sum_100_and_real_data(db, make_machine):
    machine_id, _ = make_machine({"normal-a": 7, "rare-b": 11, "epic-c": 13, "secret-d": 3})

    res = _client().get(f"/machines/{machine_id}")
    assert res.status_code == 200
    body = res.json()

    assert body["odds_total_pct"] == 100.00
    assert round(sum(row["odds_pct"] for row in body["odds"]), 2) == 100.00
    # 확률은 재고 그 자체에서 나온다 (하드코딩 불가 증명: 재고와 대조)
    by_stock = {row["stock"]: row["odds_pct"] for row in body["odds"]}
    assert by_stock[13] > by_stock[3]
    assert body["seed_hash"], "커밋-리빌 해시는 상세에 항상 공개"
    assert all(row["retail_price"] > 0 for row in body["odds"]), "정가 표기 근거"


def test_odds_update_as_stock_depletes(db, make_user, make_machine):
    """뽑을수록 확률이 실시간 재고를 따라 변한다 (실데이터 원칙)"""
    machine_id, _ = make_machine({"normal-a": 9, "rare-b": 1}, price_coin=10)
    uid = make_user(coins=100)

    before = _client().get(f"/machines/{machine_id}").json()
    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    after = _client().get(f"/machines/{machine_id}").json()

    assert after["stock_remaining"] == before["stock_remaining"] - 1
    assert round(sum(r["odds_pct"] for r in after["odds"]), 2) == 100.00
    assert after["odds"] != before["odds"], "재고가 줄었는데 확률표가 그대로면 실데이터가 아님"


# ── 2) 재고 0 → 자동 품절 ────────────────────────────────────────────────


def test_zero_stock_machine_marked_soldout(db, make_machine):
    """status가 open이어도 재고 합 0이면 서버가 품절로 내려준다."""
    machine_id, _ = make_machine({"normal-a": 0, "rare-b": 0})

    listed = _client().get("/machines").json()
    me = next(m for m in listed if m["id"] == machine_id)
    assert me["is_soldout"] is True
    assert me["status"] == "soldout"
    assert me["stock_remaining"] == 0

    detail = _client().get(f"/machines/{machine_id}").json()
    assert detail["is_soldout"] is True
    assert all(row["odds_pct"] == 0.0 for row in detail["odds"])


def test_soldout_by_draws_reflected_in_list(db, make_user, make_machine):
    """마지막 재고가 뽑히면 목록에서도 품절 (엔진의 자동 soldout 전환 연동)"""
    machine_id, _ = make_machine({"normal-a": 1}, price_coin=10)
    uid = make_user(coins=100)

    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)

    me = next(m for m in _client().get("/machines").json() if m["id"] == machine_id)
    assert me["is_soldout"] is True and me["status"] == "soldout"


def test_draft_machine_hidden(db, make_machine):
    machine_id, _ = make_machine({"normal-a": 5})
    session = TestSession()
    from app.models import Machine

    m = session.get(Machine, machine_id)
    m.status = "draft"
    session.commit()
    session.close()

    assert all(m["id"] != machine_id for m in _client().get("/machines").json())
    assert _client().get(f"/machines/{machine_id}").status_code == 404
