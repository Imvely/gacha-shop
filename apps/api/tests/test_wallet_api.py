"""지갑 잔액 조회 (F-05 HUD용 읽기 전용 — 쓰기 경로는 F-02에서)"""
from tests.conftest import TestSession


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


def test_balance_equals_ledger_sum(db, make_user):
    uid = make_user(coins=700)

    res = _client().get("/wallet/balance", headers={"X-User-Id": str(uid)})

    assert res.status_code == 200
    assert res.json() == {"balance": 700}


def test_balance_requires_auth():
    assert _client().get("/wallet/balance").status_code == 401
