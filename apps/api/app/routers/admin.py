"""어드민 API (F-07) — X-Admin-Key 인증 스텁 (F-01 후 계정/권한으로 교체)"""
import csv
import io

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Item, Machine, MachineItem, Shipment, ShipmentItem, StockAudit, UserItem
from app.services.admin_service import (
    AdminError,
    adjust_stock,
    create_machine,
    open_machine,
    register_tracking,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(x_admin_key: str | None = Header(default=None)) -> str:
    if x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="어드민 인증 실패")
    return "admin"  # TODO(F-01): 실제 어드민 식별자


class MachineItemInput(BaseModel):
    name: str
    rarity: str
    retail_price: int
    stock: int
    sku: str | None = None
    series: str | None = None


class MachineCreate(BaseModel):
    name: str
    price_coin: int
    items: list[MachineItemInput]


class StockAdjust(BaseModel):
    delta: int
    reason: str  # restock | damage | correction


class TrackingEntry(BaseModel):
    shipment_id: int
    tracking_no: str


class AuditRow(BaseModel):
    id: int
    machine_item_id: int
    delta: int
    stock_before: int
    stock_after: int
    reason: str
    actor: str


class MachineItemRow(BaseModel):
    machine_item_id: int
    item_id: int
    name: str
    rarity: str
    stock: int
    initial_stock: int


class MachineRow(BaseModel):
    id: int
    name: str
    price_coin: int
    status: str
    seed_hash: str | None
    items: list[MachineItemRow]


def _machine_row(db: Session, machine: Machine) -> MachineRow:
    rows = db.execute(
        select(MachineItem, Item)
        .join(Item, Item.id == MachineItem.item_id)
        .where(MachineItem.machine_id == machine.id)
        .order_by(MachineItem.id)
    ).all()
    return MachineRow(
        id=machine.id,
        name=machine.name,
        price_coin=machine.price_coin,
        status=machine.status,
        seed_hash=machine.seed_hash,
        items=[
            MachineItemRow(
                machine_item_id=mi.id,
                item_id=item.id,
                name=item.name,
                rarity=item.rarity,
                stock=mi.stock,
                initial_stock=mi.initial_stock,
            )
            for mi, item in rows
        ],
    )


@router.get("/machines", response_model=list[MachineRow])
def list_machines(
    db: Session = Depends(get_db), _: str = Depends(require_admin)
) -> list[MachineRow]:
    machines = db.execute(select(Machine).order_by(Machine.id.desc())).scalars().all()
    return [_machine_row(db, m) for m in machines]


@router.post("/machines", response_model=MachineRow)
def post_machine(
    body: MachineCreate,
    db: Session = Depends(get_db),
    actor: str = Depends(require_admin),
) -> MachineRow:
    try:
        machine = create_machine(
            db, actor, body.name, body.price_coin, [i.model_dump() for i in body.items]
        )
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return _machine_row(db, machine)


@router.post("/machines/{machine_id}/open", response_model=MachineRow)
def post_open(
    machine_id: int,
    db: Session = Depends(get_db),
    _: str = Depends(require_admin),
) -> MachineRow:
    try:
        machine = open_machine(db, machine_id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    db.expire_all()
    return _machine_row(db, db.get(Machine, machine_id))


@router.post("/machine-items/{machine_item_id}/stock", response_model=AuditRow)
def post_stock(
    machine_item_id: int,
    body: StockAdjust,
    db: Session = Depends(get_db),
    actor: str = Depends(require_admin),
) -> AuditRow:
    try:
        audit = adjust_stock(db, actor, machine_item_id, body.delta, body.reason)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return AuditRow(
        id=audit.id,
        machine_item_id=audit.machine_item_id,
        delta=audit.delta,
        stock_before=audit.stock_before,
        stock_after=audit.stock_after,
        reason=audit.reason,
        actor=audit.actor,
    )


@router.get("/machine-items/{machine_item_id}/audits", response_model=list[AuditRow])
def get_audits(
    machine_item_id: int,
    db: Session = Depends(get_db),
    _: str = Depends(require_admin),
) -> list[AuditRow]:
    rows = db.execute(
        select(StockAudit)
        .where(StockAudit.machine_item_id == machine_item_id)
        .order_by(StockAudit.id)
    ).scalars().all()
    return [
        AuditRow(
            id=a.id,
            machine_item_id=a.machine_item_id,
            delta=a.delta,
            stock_before=a.stock_before,
            stock_after=a.stock_after,
            reason=a.reason,
            actor=a.actor,
        )
        for a in rows
    ]


@router.post("/shipments/tracking")
def post_tracking(
    entries: list[TrackingEntry],
    db: Session = Depends(get_db),
    _: str = Depends(require_admin),
) -> dict:
    updated = register_tracking(db, [e.model_dump() for e in entries])
    return {"updated": updated}


@router.get("/shipments/export.csv")
def export_shipments_csv(
    status: str = "requested",
    db: Session = Depends(get_db),
    _: str = Depends(require_admin),
) -> StreamingResponse:
    """출고 대상 CSV — 택배사 접수용 (배송건, 수령인, 주소, 품목)"""
    shipments = db.execute(
        select(Shipment).where(Shipment.status == status).order_by(Shipment.id)
    ).scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["shipment_id", "recipient", "phone", "postcode", "address", "item_count", "items"]
    )
    for s in shipments:
        rows = db.execute(
            select(Item.name)
            .join(UserItem, UserItem.item_id == Item.id)
            .join(ShipmentItem, ShipmentItem.user_item_id == UserItem.id)
            .where(ShipmentItem.shipment_id == s.id)
        ).scalars().all()
        addr = s.address
        writer.writerow(
            [
                s.id,
                addr.get("recipient", ""),
                addr.get("phone", ""),
                addr.get("postcode", ""),
                f"{addr.get('address1', '')} {addr.get('address2', '')}".strip(),
                len(rows),
                " / ".join(rows),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=shipments-{status}.csv"},
    )
