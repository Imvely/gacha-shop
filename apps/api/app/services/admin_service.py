"""어드민: 머신/재고/출고 (F-07)

- 재고를 바꾸는 모든 경로는 stock_audits에 이력을 남긴다 (수정 전/후/사유/행위자).
- 머신 오픈 시 seed를 서버가 자동 생성해 seed_hash(SHA-256)를 선공개(커밋).
  오픈 이후 seed 재생성 금지 — 커밋-리빌의 신뢰 근간.
- 재고 증감은 machine_items 행 잠금 후 수행 (진행 중 추첨과 직렬화).
"""
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants import RARITIES
from app.db import begin_txn
from app.models import Item, Machine, MachineItem, Shipment, StockAudit
from app.services.draw_engine import seed_hash_of


class AdminError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def create_machine(
    db: Session, actor: str, name: str, price_coin: int, items: list[dict]
) -> Machine:
    """머신 생성(draft) — 상품·수량 입력, 확률은 재고에서 자동 (별도 입력 없음)."""
    if not items:
        raise AdminError(422, "상품이 최소 1개 필요해요")
    if price_coin <= 0:
        raise AdminError(422, "스핀 가격은 1코인 이상")
    for it in items:
        if it["rarity"] not in RARITIES:
            raise AdminError(422, f"알 수 없는 등급: {it['rarity']}")
        if it["stock"] < 0 or it["retail_price"] <= 0:
            raise AdminError(422, "수량은 0 이상, 정가는 1원 이상")

    with begin_txn(db):
        machine = Machine(name=name, price_coin=price_coin, status="draft")
        db.add(machine)
        db.flush()
        for idx, it in enumerate(items):
            item = Item(
                sku=it.get("sku") or f"m{machine.id}-{idx}",
                name=it["name"],
                rarity=it["rarity"],
                retail_price=it["retail_price"],
                series=it.get("series"),
            )
            db.add(item)
            db.flush()
            mi = MachineItem(
                machine_id=machine.id,
                item_id=item.id,
                stock=it["stock"],
                initial_stock=it["stock"],
            )
            db.add(mi)
            db.flush()
            db.add(
                StockAudit(
                    machine_item_id=mi.id,
                    delta=it["stock"],
                    stock_before=0,
                    stock_after=it["stock"],
                    reason="initial",
                    actor=actor,
                )
            )
    return machine


def open_machine(db: Session, machine_id: int) -> Machine:
    """오픈 — seed 자동 생성, seed_hash 선공개. 재오픈/seed 재생성 금지."""
    with begin_txn(db):
        machine = db.execute(
            select(Machine)
            .where(Machine.id == machine_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if machine is None:
            raise AdminError(404, "머신을 찾을 수 없어요")
        if machine.status != "draft":
            raise AdminError(409, f"draft 상태만 오픈 가능 (현재: {machine.status})")
        if machine.seed_hash is not None:
            raise AdminError(409, "seed가 이미 커밋된 머신")

        seed = secrets.token_hex(32)
        machine.seed_reveal = seed  # API로는 회차 종료 후에만 노출
        machine.seed_hash = seed_hash_of(seed)  # 선공개 커밋
        machine.status = "open"
        machine.opened_at = func.now()
    return machine


def adjust_stock(
    db: Session, actor: str, machine_item_id: int, delta: int, reason: str
) -> StockAudit:
    """입출고 — 행 잠금 후 증감, 반드시 이력 기록. 음수 재고 불가."""
    if delta == 0:
        raise AdminError(422, "증감량이 0이에요")
    if reason not in ("restock", "damage", "correction"):
        raise AdminError(422, "사유는 restock|damage|correction 중 하나")

    with begin_txn(db):
        mi = db.execute(
            select(MachineItem)
            .where(MachineItem.id == machine_item_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if mi is None:
            raise AdminError(404, "머신 상품을 찾을 수 없어요")
        before = mi.stock
        after = before + delta
        if after < 0:
            raise AdminError(409, f"재고 부족 (현재 {before}, 요청 {delta})")

        mi.stock = after
        if delta > 0:
            mi.initial_stock += delta  # 입고분은 확률표 분모(전체)에도 반영
        audit = StockAudit(
            machine_item_id=mi.id,
            delta=delta,
            stock_before=before,
            stock_after=after,
            reason=reason,
            actor=actor,
        )
        db.add(audit)
        db.flush()
    return audit


def register_tracking(db: Session, entries: list[dict]) -> int:
    """송장 일괄 등록 — requested|packed → shipped + tracking_no."""
    updated = 0
    with begin_txn(db):
        for e in entries:
            shipment = db.execute(
                select(Shipment)
                .where(Shipment.id == e["shipment_id"])
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalar_one_or_none()
            if shipment is None or shipment.status not in ("requested", "packed"):
                continue
            shipment.tracking_no = e["tracking_no"]
            shipment.status = "shipped"
            updated += 1
    return updated
