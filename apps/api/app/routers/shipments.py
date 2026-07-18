"""보관함 & 묶음배송 (F-06)"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants import SHIPPING_FEE_COIN, SHIPPING_FEE_KRW
from app.db import get_db
from app.deps import get_current_user_id
from app.models import Item, Shipment, ShipmentItem, UserItem
from app.services.shipping import ShippingError, request_shipment, update_address

router = APIRouter(prefix="/shipments", tags=["shipments"])


class StorageItem(BaseModel):
    user_item_id: int
    item_id: int
    name: str
    rarity: str
    retail_price: int
    status: str
    shipment_id: int | None = None


class AddressBody(BaseModel):
    recipient: str
    phone: str
    postcode: str
    address1: str
    address2: str = ""


class ShipmentRequest(BaseModel):
    user_item_ids: list[int]
    address: AddressBody


class ShipmentInfo(BaseModel):
    id: int
    status: str
    fee_krw: int
    tracking_no: str | None
    address: dict
    items: list[StorageItem]


FEE_INFO = {"fee_coin": SHIPPING_FEE_COIN, "fee_krw": SHIPPING_FEE_KRW}


def _storage_rows(db: Session, user_id: int, statuses: tuple[str, ...]) -> list[StorageItem]:
    rows = db.execute(
        select(UserItem, Item, ShipmentItem.shipment_id)
        .join(Item, Item.id == UserItem.item_id)
        .outerjoin(ShipmentItem, ShipmentItem.user_item_id == UserItem.id)
        .where(UserItem.user_id == user_id, UserItem.status.in_(statuses))
        .order_by(UserItem.id.desc())
    ).all()
    return [
        StorageItem(
            user_item_id=ui.id,
            item_id=item.id,
            name=item.name,
            rarity=item.rarity,
            retail_price=item.retail_price,
            status=ui.status,
            shipment_id=shipment_id,
        )
        for ui, item, shipment_id in rows
    ]


@router.get("/storage", response_model=list[StorageItem])
def storage(
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> list[StorageItem]:
    """보관함 — 아직 배송 안 간 실물들"""
    return _storage_rows(db, user_id, ("stored", "shipping_locked"))


@router.get("/fee")
def fee() -> dict:
    return FEE_INFO


@router.post("", response_model=ShipmentInfo)
def create_shipment(
    body: ShipmentRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> ShipmentInfo:
    try:
        shipment = request_shipment(
            db, user_id, body.user_item_ids, body.address.model_dump()
        )
    except ShippingError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return _shipment_info(db, user_id, shipment.id)


@router.get("", response_model=list[ShipmentInfo])
def list_shipments(
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> list[ShipmentInfo]:
    ids = db.execute(
        select(Shipment.id).where(Shipment.user_id == user_id).order_by(Shipment.id.desc())
    ).scalars().all()
    return [_shipment_info(db, user_id, sid) for sid in ids]


@router.patch("/{shipment_id}/address", response_model=ShipmentInfo)
def change_address(
    shipment_id: int,
    body: AddressBody,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> ShipmentInfo:
    try:
        update_address(db, user_id, shipment_id, body.model_dump())
    except ShippingError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return _shipment_info(db, user_id, shipment_id)


def _shipment_info(db: Session, user_id: int, shipment_id: int) -> ShipmentInfo:
    shipment = db.execute(
        select(Shipment).where(Shipment.id == shipment_id, Shipment.user_id == user_id)
    ).scalar_one_or_none()
    if shipment is None:
        raise HTTPException(status_code=404, detail="배송 건을 찾을 수 없어요")
    rows = db.execute(
        select(UserItem, Item)
        .join(ShipmentItem, ShipmentItem.user_item_id == UserItem.id)
        .join(Item, Item.id == UserItem.item_id)
        .where(ShipmentItem.shipment_id == shipment_id)
        .order_by(UserItem.id)
    ).all()
    return ShipmentInfo(
        id=shipment.id,
        status=shipment.status,
        fee_krw=shipment.fee_krw,
        tracking_no=shipment.tracking_no,
        address=shipment.address,
        items=[
            StorageItem(
                user_item_id=ui.id,
                item_id=item.id,
                name=item.name,
                rarity=item.rarity,
                retail_price=item.retail_price,
                status=ui.status,
                shipment_id=shipment_id,
            )
            for ui, item in rows
        ],
    )
