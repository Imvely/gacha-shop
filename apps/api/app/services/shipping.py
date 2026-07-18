"""보관함 → 묶음배송 서비스 (F-06)

money-safety:
- 아이템 잠금 + 배송비 코인 차감(원장) + shipment 생성 = 단일 트랜잭션.
- user_items 행은 SELECT ... FOR UPDATE로 잠근 뒤 상태 검사 (동시 신청/교환 방어).
- 배송비는 배송 1건당 1회, 서버 상수로만 결정.
- 주소는 스냅샷(JSONB) — 변경은 출고 전(requested|packed)만 허용.
"""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants import SHIPPING_FEE_COIN, SHIPPING_FEE_KRW
from app.db import begin_txn
from app.models import Shipment, ShipmentItem, User, UserItem, WalletLedger


class ShippingError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


ADDRESS_REQUIRED = ("recipient", "phone", "postcode", "address1")
# 출고 전 상태 — 이후(shipped|delivered)엔 주소 변경 불가
PRE_DISPATCH_STATUSES = ("requested", "packed")


def _validate_address(address: dict) -> dict:
    missing = [k for k in ADDRESS_REQUIRED if not str(address.get(k, "")).strip()]
    if missing:
        raise ShippingError(422, f"주소 항목 누락: {', '.join(missing)}")
    return address


def request_shipment(
    db: Session, user_id: int, user_item_ids: list[int], address: dict
) -> Shipment:
    """보관함 N개 → 배송 1건. 잠금·과금·생성이 하나의 트랜잭션."""
    if not user_item_ids:
        raise ShippingError(422, "배송할 아이템을 골라주세요")
    address = _validate_address(address)
    ids = sorted(set(user_item_ids))  # 잠금 순서 고정 (데드락 방지)

    with begin_txn(db):
        # 잠금 1: 유저 행 — 동시 스핀/다른 배송 신청과 잔액 차감 직렬화
        #         (draw_engine과 동일한 잠금 순서: 유저 → 아이템. 데드락 방지)
        locked_user = db.execute(
            select(User.id).where(User.id == user_id).with_for_update()
        ).scalar_one_or_none()
        if locked_user is None:
            raise ShippingError(404, "존재하지 않는 유저")

        # 잠금 2: 아이템 행 — 같은 아이템 동시 배송/교환 방지 (id 순 고정)
        items = (
            db.execute(
                select(UserItem)
                .where(UserItem.id.in_(ids), UserItem.user_id == user_id)
                .order_by(UserItem.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            .scalars()
            .all()
        )
        if len(items) != len(ids):
            raise ShippingError(404, "보관함에 없는 아이템이 있어요")
        not_stored = [ui.id for ui in items if ui.status != "stored"]
        if not_stored:
            raise ShippingError(409, "이미 배송 신청됐거나 교환된 아이템이 있어요")

        balance = db.execute(
            select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
                WalletLedger.user_id == user_id
            )
        ).scalar_one()
        if balance < SHIPPING_FEE_COIN:
            raise ShippingError(402, f"배송비 코인 부족 (잔액 {balance}, 필요 {SHIPPING_FEE_COIN})")

        shipment = Shipment(
            user_id=user_id,
            address=address,
            fee_krw=SHIPPING_FEE_KRW,
            status="requested",
        )
        db.add(shipment)
        db.flush()

        db.add(
            WalletLedger(
                user_id=user_id,
                amount=-SHIPPING_FEE_COIN,
                reason="shipping",
                ref_type="shipment",
                ref_id=shipment.id,
            )
        )
        for ui in items:
            ui.status = "shipping_locked"
            db.add(ShipmentItem(shipment_id=shipment.id, user_item_id=ui.id))

    return shipment


def update_address(db: Session, user_id: int, shipment_id: int, address: dict) -> Shipment:
    """주소 변경 — 출고 전(requested|packed)만 허용."""
    address = _validate_address(address)
    with begin_txn(db):
        shipment = db.execute(
            select(Shipment)
            .where(Shipment.id == shipment_id, Shipment.user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)  # 잠금 시점의 최신 행 강제 반영
        ).scalar_one_or_none()
        if shipment is None:
            raise ShippingError(404, "배송 건을 찾을 수 없어요")
        if shipment.status not in PRE_DISPATCH_STATUSES:
            raise ShippingError(409, "이미 출고된 배송은 주소를 바꿀 수 없어요")
        shipment.address = address
    return shipment
