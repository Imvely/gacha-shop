"""머신 목록/상세 (F-03) — 확률·잔여수량은 항상 실데이터 (절대 원칙 5)"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Item, Machine, MachineItem
from app.schemas import MachineDetail, MachineSummary, OddsRow
from app.services.odds import odds_percentages

router = APIRouter(prefix="/machines", tags=["machines"])

VISIBLE_STATUSES = ("open", "soldout")


def _summary(machine: Machine, remaining: int, initial: int) -> MachineSummary:
    # 재고 0인데 아직 open이면 서버가 품절로 계산해 내려준다 (자동 품절 처리)
    soldout = machine.status == "soldout" or remaining == 0
    return MachineSummary(
        id=machine.id,
        name=machine.name,
        price_coin=machine.price_coin,
        status="soldout" if soldout else machine.status,
        stock_remaining=remaining,
        stock_initial=initial,
        is_soldout=soldout,
    )


@router.get("", response_model=list[MachineSummary])
def list_machines(db: Session = Depends(get_db)) -> list[MachineSummary]:
    rows = db.execute(
        select(
            Machine,
            func.coalesce(func.sum(MachineItem.stock), 0),
            func.coalesce(func.sum(MachineItem.initial_stock), 0),
        )
        .outerjoin(MachineItem, MachineItem.machine_id == Machine.id)
        .where(Machine.status.in_(VISIBLE_STATUSES))
        .group_by(Machine.id)
        .order_by(Machine.opened_at.desc().nulls_last(), Machine.id.desc())
    ).all()
    return [_summary(m, int(remaining), int(initial)) for m, remaining, initial in rows]


@router.get("/{machine_id}", response_model=MachineDetail)
def machine_detail(machine_id: int, db: Session = Depends(get_db)) -> MachineDetail:
    machine = db.get(Machine, machine_id)
    if machine is None or machine.status not in VISIBLE_STATUSES:
        raise HTTPException(status_code=404, detail="머신을 찾을 수 없어요")

    rows = db.execute(
        select(MachineItem, Item)
        .join(Item, Item.id == MachineItem.item_id)
        .where(MachineItem.machine_id == machine_id)
        .order_by(MachineItem.id)
    ).all()

    stocks = [mi.stock for mi, _ in rows]
    pcts = odds_percentages(stocks)
    odds = [
        OddsRow(
            item_id=item.id,
            name=item.name,
            rarity=item.rarity,
            retail_price=item.retail_price,
            stock=mi.stock,
            initial_stock=mi.initial_stock,
            odds_pct=pct,
        )
        for (mi, item), pct in zip(rows, pcts)
    ]

    summary = _summary(machine, sum(stocks), sum(mi.initial_stock for mi, _ in rows))
    return MachineDetail(
        **summary.model_dump(),
        seed_hash=machine.seed_hash,
        odds=odds,
        odds_total_pct=round(sum(pcts), 2),
    )
