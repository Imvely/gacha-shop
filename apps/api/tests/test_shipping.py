"""F-06 보관함 & 묶음배송 acceptance 테스트

1. 보관함 N개 → 배송 1건 생성 (배송비 1회)
2. 배송 신청 후 아이템 잠금 (재신청/교환 불가)
3. 주소 변경은 출고 전만 허용
+ money-safety: 20스레드 동시 신청 → 1건만 성공, 이중 과금 0
"""
import threading

import pytest
from sqlalchemy import func, select

from tests.conftest import TestSession
from app.constants import SHIPPING_FEE_COIN
from app.models import Shipment, ShipmentItem, UserItem, WalletLedger
from app.services.shipping import ShippingError, request_shipment, update_address

ADDRESS = {
    "recipient": "임다영",
    "phone": "010-0000-0000",
    "postcode": "04524",
    "address1": "서울시 중구 세종대로 110",
    "address2": "101호",
}


def balance_of(db, user_id: int) -> int:
    return db.execute(
        select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
            WalletLedger.user_id == user_id
        )
    ).scalar_one()


@pytest.fixture
def stored_items(db, make_user, make_machine):
    """유저 1명 + 스핀으로 얻은 보관함 아이템 3개 (실제 draw 경로로 적립)"""
    from app.services.draw_engine import execute_draws

    uid = make_user(coins=5000)
    machine_id, _ = make_machine({"normal-a": 10}, price_coin=100)
    for _ in range(3):
        execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    ids = db.execute(
        select(UserItem.id).where(UserItem.user_id == uid).order_by(UserItem.id)
    ).scalars().all()
    assert len(ids) == 3
    return uid, ids


# ── 1) N개 → 배송 1건 ────────────────────────────────────────────────────


def test_n_items_one_shipment_one_fee(db, stored_items):
    uid, ids = stored_items
    before = balance_of(db, uid)

    shipment = request_shipment(db, uid, ids, ADDRESS)

    assert db.scalar(select(func.count(Shipment.id)).where(Shipment.user_id == uid)) == 1
    linked = db.execute(
        select(ShipmentItem.user_item_id).where(ShipmentItem.shipment_id == shipment.id)
    ).scalars().all()
    assert sorted(linked) == sorted(ids), "아이템 3개가 배송 1건에 전부 연결"

    fee_rows = db.execute(
        select(WalletLedger).where(
            WalletLedger.user_id == uid, WalletLedger.reason == "shipping"
        )
    ).scalars().all()
    assert len(fee_rows) == 1, "배송비는 배송 1건당 1회"
    assert fee_rows[0].amount == -SHIPPING_FEE_COIN
    assert fee_rows[0].ref_type == "shipment" and fee_rows[0].ref_id == shipment.id
    assert balance_of(db, uid) == before - SHIPPING_FEE_COIN

    statuses = db.execute(
        select(UserItem.status).where(UserItem.id.in_(ids))
    ).scalars().all()
    assert statuses == ["shipping_locked"] * 3


# ── 2) 잠금: 재신청·동시 신청 방어 ───────────────────────────────────────


def test_locked_items_cannot_be_shipped_again(db, stored_items):
    uid, ids = stored_items
    request_shipment(db, uid, ids, ADDRESS)

    with pytest.raises(ShippingError) as exc:
        request_shipment(db, uid, [ids[0]], ADDRESS)
    assert exc.value.status_code == 409
    assert db.scalar(select(func.count(Shipment.id)).where(Shipment.user_id == uid)) == 1


def test_concurrent_20_requests_only_one_succeeds(db, stored_items):
    """같은 아이템으로 20스레드 동시 배송 신청 → 정확히 1건, 과금 1회"""
    uid, ids = stored_items
    results: list[str] = []

    def attempt():
        session = TestSession()
        try:
            request_shipment(session, uid, ids, ADDRESS)
            results.append("ok")
        except ShippingError as e:
            results.append(str(e.status_code))
        finally:
            session.close()

    threads = [threading.Thread(target=attempt) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count("ok") == 1, f"동시 신청 중 {results.count('ok')}건 성공 (1건이어야 함)"
    assert db.scalar(select(func.count(Shipment.id)).where(Shipment.user_id == uid)) == 1
    fee_count = db.scalar(
        select(func.count(WalletLedger.id)).where(
            WalletLedger.user_id == uid, WalletLedger.reason == "shipping"
        )
    )
    assert fee_count == 1, "이중 과금 발생"


def test_insufficient_coins_402_no_changes(db, make_user, make_machine):
    from app.services.draw_engine import execute_draws

    uid = make_user(coins=100)  # 스핀 후 잔액 0 → 배송비 부족
    machine_id, _ = make_machine({"normal-a": 5}, price_coin=100)
    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    item_id = db.scalar(select(UserItem.id).where(UserItem.user_id == uid))

    with pytest.raises(ShippingError) as exc:
        request_shipment(db, uid, [item_id], ADDRESS)
    assert exc.value.status_code == 402
    assert db.scalar(select(UserItem.status).where(UserItem.id == item_id)) == "stored"
    assert db.scalar(select(func.count(Shipment.id)).where(Shipment.user_id == uid)) == 0


# ── 3) 주소 변경: 출고 전만 ──────────────────────────────────────────────


def test_address_change_allowed_before_dispatch(db, stored_items):
    uid, ids = stored_items
    shipment = request_shipment(db, uid, ids, ADDRESS)

    new_addr = {**ADDRESS, "address1": "부산시 해운대구 우동 123", "address2": ""}
    updated = update_address(db, uid, shipment.id, new_addr)  # requested
    assert updated.address["address1"] == "부산시 해운대구 우동 123"

    session = TestSession()
    session.get(Shipment, shipment.id).status = "packed"
    session.commit()
    session.close()
    updated = update_address(db, uid, shipment.id, ADDRESS)  # packed도 출고 전
    assert updated.address["address1"] == ADDRESS["address1"]


def test_address_change_rejected_after_dispatch(db, stored_items):
    uid, ids = stored_items
    shipment = request_shipment(db, uid, ids, ADDRESS)

    session = TestSession()
    session.get(Shipment, shipment.id).status = "shipped"
    session.commit()
    session.close()

    with pytest.raises(ShippingError) as exc:
        update_address(db, uid, shipment.id, {**ADDRESS, "address1": "새 주소"})
    assert exc.value.status_code == 409
    db.expire_all()
    assert db.get(Shipment, shipment.id).address["address1"] == ADDRESS["address1"]


def test_missing_address_fields_rejected(db, stored_items):
    uid, ids = stored_items
    with pytest.raises(ShippingError) as exc:
        request_shipment(db, uid, ids, {"recipient": "임다영"})
    assert exc.value.status_code == 422
