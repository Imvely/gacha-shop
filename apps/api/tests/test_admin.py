"""F-07 어드민 acceptance 테스트

1. 재고 수정 이력 남김 (생성 initial + 입출고 restock/damage, before/after/actor)
2. 머신 오픈 시 seed_hash 자동 생성·공개 (커밋 검증, 재오픈·재생성 금지)
3. 출고 CSV 내보내기
"""
import csv
import io

import pytest
from sqlalchemy import select

from tests.conftest import TestSession
from app.models import Machine, MachineItem, StockAudit
from app.services.admin_service import (
    AdminError,
    adjust_stock,
    create_machine,
    open_machine,
)
from app.services.draw_engine import seed_hash_of

ITEMS = [
    {"name": "노멀 스트랩", "rarity": "normal", "retail_price": 4500, "stock": 10},
    {"name": "시크릿 피규어", "rarity": "secret", "retail_price": 30000, "stock": 1},
]


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


ADMIN = {"X-Admin-Key": "dev-admin-key"}


# ── 1) 재고 수정 이력 ─────────────────────────────────────────────────────


def test_stock_changes_leave_audit_trail(db):
    machine = create_machine(db, "admin", "테스트 머신", 500, ITEMS)
    mi = db.execute(
        select(MachineItem).where(MachineItem.machine_id == machine.id).order_by(MachineItem.id)
    ).scalars().first()

    # 생성 시 initial 이력
    audits = db.execute(
        select(StockAudit).where(StockAudit.machine_item_id == mi.id).order_by(StockAudit.id)
    ).scalars().all()
    assert len(audits) == 1
    assert (audits[0].reason, audits[0].delta, audits[0].stock_before, audits[0].stock_after) == (
        "initial", 10, 0, 10,
    )

    adjust_stock(db, "admin", mi.id, +5, "restock")
    adjust_stock(db, "admin", mi.id, -2, "damage")

    audits = db.execute(
        select(StockAudit).where(StockAudit.machine_item_id == mi.id).order_by(StockAudit.id)
    ).scalars().all()
    assert [(a.reason, a.delta, a.stock_before, a.stock_after) for a in audits] == [
        ("initial", 10, 0, 10),
        ("restock", 5, 10, 15),
        ("damage", -2, 15, 13),
    ]
    assert all(a.actor == "admin" for a in audits)

    db.expire_all()
    mi = db.get(MachineItem, mi.id)
    assert mi.stock == 13
    assert mi.initial_stock == 15, "입고분은 전체 수량(분모)에 반영, 차감분은 미반영"


def test_negative_stock_blocked(db):
    machine = create_machine(db, "admin", "머신", 500, ITEMS)
    mi = db.execute(
        select(MachineItem).where(MachineItem.machine_id == machine.id)
    ).scalars().first()

    with pytest.raises(AdminError) as exc:
        adjust_stock(db, "admin", mi.id, -999, "damage")
    assert exc.value.status_code == 409
    audits = db.execute(
        select(StockAudit).where(StockAudit.machine_item_id == mi.id)
    ).scalars().all()
    assert len(audits) == 1, "실패한 조정은 이력 없음 (initial만)"


# ── 2) 오픈 시 seed 자동 생성·공개 ────────────────────────────────────────


def test_open_generates_and_commits_seed(db):
    machine = create_machine(db, "admin", "머신", 500, ITEMS)
    assert machine.seed_hash is None and machine.status == "draft"

    opened = open_machine(db, machine.id)

    assert opened.status == "open"
    assert opened.seed_hash is not None and opened.seed_reveal is not None
    assert opened.seed_hash == seed_hash_of(opened.seed_reveal), "seed_hash = SHA256(seed) 커밋"

    # 공개 확인: 퍼블릭 머신 상세 API에 seed_hash 노출
    res = _client().get(f"/machines/{machine.id}")
    assert res.status_code == 200
    body = res.json()
    assert body["seed_hash"] == opened.seed_hash
    assert "seed_reveal" not in body, "원본 seed는 회차 종료 전 비공개"

    # 재오픈 금지 (seed 재생성 불가)
    with pytest.raises(AdminError) as exc:
        open_machine(db, machine.id)
    assert exc.value.status_code == 409


def test_draft_machine_cannot_draw(db, make_user):
    """draft(seed 미커밋) 머신은 추첨 불가 — 오픈 절차 강제"""
    from app.services.draw_engine import DrawError, execute_draws

    machine = create_machine(db, "admin", "머신", 500, ITEMS)
    uid = make_user(coins=1000)
    with pytest.raises(DrawError) as exc:
        execute_draws(db, user_id=uid, machine_id=machine.id, count=1)
    assert exc.value.status_code == 409


# ── 3) 출고 CSV ───────────────────────────────────────────────────────────


def test_shipments_export_csv(db, make_user, make_machine):
    from app.services.draw_engine import execute_draws
    from app.services.shipping import request_shipment
    from app.models import UserItem

    uid = make_user(coins=5000)
    machine_id, _ = make_machine({"normal-a": 5}, price_coin=100)
    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    ids = db.execute(select(UserItem.id).where(UserItem.user_id == uid)).scalars().all()
    request_shipment(
        db, uid, ids,
        {"recipient": "임다영", "phone": "010-1111-2222", "postcode": "04524",
         "address1": "서울시 중구 세종대로 110", "address2": "3층"},
    )

    res = _client().get("/admin/shipments/export.csv?status=requested", headers=ADMIN)
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]

    rows = list(csv.reader(io.StringIO(res.text)))
    assert rows[0] == [
        "shipment_id", "recipient", "phone", "postcode", "address", "item_count", "items",
    ]
    assert len(rows) == 2, "requested 배송 1건 = 데이터 1행"
    assert rows[1][1] == "임다영"
    assert rows[1][4] == "서울시 중구 세종대로 110 3층"
    assert rows[1][5] == "2"


def test_admin_requires_key(db):
    client = _client()
    assert client.get("/admin/machines").status_code == 401
    assert client.get("/admin/machines", headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert client.get("/admin/machines", headers=ADMIN).status_code == 200


def test_tracking_bulk_register(db, make_user, make_machine):
    from app.services.draw_engine import execute_draws
    from app.services.shipping import request_shipment
    from app.models import Shipment, UserItem
    from app.services.admin_service import register_tracking

    uid = make_user(coins=5000)
    machine_id, _ = make_machine({"normal-a": 5}, price_coin=100)
    execute_draws(db, user_id=uid, machine_id=machine_id, count=1)
    ids = db.execute(select(UserItem.id).where(UserItem.user_id == uid)).scalars().all()
    shipment = request_shipment(
        db, uid, ids,
        {"recipient": "임다영", "phone": "010-1111-2222", "postcode": "04524",
         "address1": "서울시 중구 세종대로 110"},
    )

    updated = register_tracking(db, [
        {"shipment_id": shipment.id, "tracking_no": "CJ123456789"},
        {"shipment_id": 99999, "tracking_no": "IGNORED"},
    ])
    assert updated == 1
    db.expire_all()
    s = db.get(Shipment, shipment.id)
    assert s.status == "shipped" and s.tracking_no == "CJ123456789"
