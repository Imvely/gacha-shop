"""F-04 추첨 엔진 acceptance 테스트 (features.json + money-safety 게이트)

1. 동시 20요청에서 재고 음수 0건 + 재고 합계 보존
2. 모든 draw에 seed 커밋-리빌 기록 (재현 검증 포함)
3. 코인 부족 시 402 및 원장/재고 무변화
4. 원장 불변식: 잔액 == SUM(wallet_ledger.amount)
5. 10연도 단일 트랜잭션·단일 batch_id
"""
import threading

import pytest
from sqlalchemy import func, select

from tests.conftest import TestSession
from app.models import Draw, Machine, MachineItem, UserItem, WalletLedger
from app.services.draw_engine import DrawError, derive_rng, execute_draws, seed_hash_of


def balance_of(db, user_id: int) -> int:
    return db.execute(
        select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
            WalletLedger.user_id == user_id
        )
    ).scalar_one()


# ── 1) 동시성: 20스레드 동시 draw ──────────────────────────────────────────


def test_concurrent_20_draws_no_negative_stock(db, make_user, make_machine):
    """재고 20개 머신에 20스레드 동시 스핀 → 전원 성공, 재고 음수 0건, 정확히 0으로 소진."""
    machine_id, _ = make_machine({"normal-a": 8, "rare-b": 6, "epic-c": 5, "secret-d": 1})
    user_ids = [make_user(coins=1000, nickname=f"u{i}") for i in range(20)]

    errors: list[Exception] = []

    def spin(uid: int):
        session = TestSession()
        try:
            execute_draws(session, user_id=uid, machine_id=machine_id, count=1)
        except Exception as e:  # noqa: BLE001 — 실패도 수집해서 단언
            errors.append(e)
        finally:
            session.close()

    threads = [threading.Thread(target=spin, args=(uid,)) for uid in user_ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"동시 draw 중 예외 발생: {errors}"

    stocks = db.execute(
        select(MachineItem.stock).where(MachineItem.machine_id == machine_id)
    ).scalars().all()
    assert all(s >= 0 for s in stocks), "재고 음수 발생"
    assert sum(stocks) == 0, "재고 20 - draw 20 = 0이어야 함 (이중 차감/누락 검출)"

    draw_count = db.scalar(select(func.count(Draw.id)).where(Draw.machine_id == machine_id))
    assert draw_count == 20

    # 완판 → soldout 전환
    machine = db.get(Machine, machine_id)
    assert machine.status == "soldout"


def test_concurrent_same_user_no_overdraft(db, make_user, make_machine):
    """잔액이 1스핀 분량뿐인 유저가 동시에 2번 스핀 → 1승 1패(402), 잔액 음수 금지."""
    machine_id, _ = make_machine({"normal-a": 10}, price_coin=100)
    uid = make_user(coins=100)

    outcomes: list[str] = []

    def spin():
        session = TestSession()
        try:
            execute_draws(session, user_id=uid, machine_id=machine_id, count=1)
            outcomes.append("ok")
        except DrawError as e:
            outcomes.append(str(e.status_code))
        finally:
            session.close()

    threads = [threading.Thread(target=spin) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(outcomes) == ["402", "ok"]
    assert balance_of(db, uid) == 0, "원장 이중 차감 발생"


# ── 2) 감사 로그: seed 커밋-리빌 ──────────────────────────────────────────


def test_every_draw_has_reproducible_seed_chain(db, make_user, make_machine):
    """모든 draw의 rng_value가 seed로 재현 가능 + seed_hash가 seed의 SHA-256 커밋."""
    machine_id, seed = make_machine({"normal-a": 5, "rare-b": 5})
    uid = make_user(coins=10000)

    execute_draws(db, user_id=uid, machine_id=machine_id, count=10)

    machine = db.get(Machine, machine_id)
    assert machine.seed_hash == seed_hash_of(seed), "seed_hash 커밋 불일치"

    draws = db.execute(
        select(Draw).where(Draw.machine_id == machine_id).order_by(Draw.id)
    ).scalars().all()
    assert len(draws) == 10
    for nonce, draw in enumerate(draws):
        assert draw.rng_value == pytest.approx(derive_rng(seed, nonce)), (
            f"draw #{draw.id}: rng_value가 seed 체인에서 재현되지 않음 (nonce={nonce})"
        )
        assert draw.stock_snapshot, "재고 스냅샷 누락"


# ── 3) 코인 부족: 402 + 무변화 롤백 ───────────────────────────────────────


def test_insufficient_coins_402_and_no_side_effects(db, make_user, make_machine):
    machine_id, _ = make_machine({"normal-a": 10}, price_coin=100)
    uid = make_user(coins=50)  # 1스핀(100)에 부족

    with pytest.raises(DrawError) as exc:
        execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    assert exc.value.status_code == 402

    assert balance_of(db, uid) == 50, "402인데 원장이 변함"
    total_stock = db.scalar(
        select(func.sum(MachineItem.stock)).where(MachineItem.machine_id == machine_id)
    )
    assert total_stock == 10, "402인데 재고가 변함"
    assert db.scalar(select(func.count(Draw.id))) == 0, "402인데 draw 기록됨"


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


def test_insufficient_coins_402_via_http(db, make_user, make_machine):
    """API 경로로도 402 계약 검증 (라우터 → 서비스 연결 확인)"""
    machine_id, _ = make_machine({"normal-a": 10}, price_coin=100)
    uid = make_user(coins=0)

    res = _client().post(
        "/draws",
        json={"machine_id": machine_id, "count": 1},
        headers={"X-User-Id": str(uid)},
    )

    assert res.status_code == 402
    assert balance_of(db, uid) == 0


def test_draw_happy_path_via_http(db, make_user, make_machine):
    """정상 추첨 HTTP 계약: results(등급·정가 포함) + balance (CLAUDE.md 5절)"""
    machine_id, _ = make_machine({"normal-a": 10}, price_coin=100)
    uid = make_user(coins=500)

    res = _client().post(
        "/draws",
        json={"machine_id": machine_id, "count": 1},
        headers={"X-User-Id": str(uid)},
    )

    assert res.status_code == 200
    body = res.json()
    assert len(body["results"]) == 1
    result = body["results"][0]
    assert result["rarity"] == "normal"
    assert result["retail_price"] == 5000  # 결과 화면 "정가 표기" 근거
    assert body["balance"] == 400
    assert body["seed_reveal"] is None  # 회차 진행 중엔 seed 비공개


# ── 4) 원장 불변식 ────────────────────────────────────────────────────────


def test_ledger_invariant_after_draws(db, make_user, make_machine):
    """잔액 == SUM(원장) 그리고 모든 원장 행이 근거 객체(draw)와 연결."""
    machine_id, _ = make_machine({"normal-a": 20}, price_coin=100)
    uid = make_user(coins=1100)

    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    execute_draws(db, user_id=uid, machine_id=machine_id, count=10)

    assert balance_of(db, uid) == 1100 - 100 - 1000

    draw_rows = db.execute(
        select(WalletLedger).where(
            WalletLedger.user_id == uid, WalletLedger.reason == "draw"
        )
    ).scalars().all()
    assert len(draw_rows) == 2, "배치당 원장 1행"
    assert all(r.ref_type == "draw" and r.ref_id is not None for r in draw_rows)


# ── 5) 10연: 단일 트랜잭션 · 단일 batch_id ────────────────────────────────


def test_ten_draw_single_batch(db, make_user, make_machine):
    machine_id, _ = make_machine({"normal-a": 30, "rare-b": 10}, price_coin=100)
    uid = make_user(coins=1000)

    outcome = execute_draws(db, user_id=uid, machine_id=machine_id, count=10)

    assert len(outcome.results) == 10
    batch_ids = db.execute(
        select(Draw.batch_id).where(Draw.machine_id == machine_id)
    ).scalars().all()
    assert len(batch_ids) == 10
    assert len(set(batch_ids)) == 1 and batch_ids[0] is not None, "10연은 같은 batch_id"

    # 보관함 적립 10건 (draw와 1:1)
    stored = db.scalar(select(func.count(UserItem.id)).where(UserItem.user_id == uid))
    assert stored == 10

    # 원장은 배치당 1행, -1000
    ledger = db.execute(
        select(WalletLedger).where(WalletLedger.user_id == uid, WalletLedger.reason == "draw")
    ).scalars().all()
    assert len(ledger) == 1 and ledger[0].amount == -1000


def test_insufficient_stock_409(db, make_user, make_machine):
    machine_id, _ = make_machine({"normal-a": 5}, price_coin=10)
    uid = make_user(coins=1000)

    with pytest.raises(DrawError) as exc:
        execute_draws(db, user_id=uid, machine_id=machine_id, count=10)
    assert exc.value.status_code == 409
    assert balance_of(db, uid) == 1000
