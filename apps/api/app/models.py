"""SQLAlchemy 모델 — docs/schema.sql과 1:1 동기화 (변경 시 Alembic 마이그레이션 필수)"""
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# PostgreSQL에선 JSONB, 그 외(테스트용 SQLite 등)에선 JSON
JsonB = JSON().with_variant(JSONB(), "postgresql")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str | None] = mapped_column(Text, unique=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False, default="kakao")
    nickname: Mapped[str] = mapped_column(Text, nullable=False)
    is_adult_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    monthly_limit_krw: Mapped[int] = mapped_column(Integer, nullable=False, default=300000)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WalletLedger(Base):
    """잔액은 컬럼이 아니라 원장이다 — 잔액 = SUM(amount). (money-safety 불변식 1)"""

    __tablename__ = "wallet_ledger"
    __table_args__ = (CheckConstraint("amount <> 0", name="ck_ledger_amount_nonzero"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)  # topup|draw|refund|trade_in|admin
    ref_type: Mapped[str | None] = mapped_column(Text)
    ref_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    pg_provider: Mapped[str] = mapped_column(Text, nullable=False)
    pg_tx_id: Mapped[str] = mapped_column(Text, unique=True, nullable=False)  # 웹훅 멱등성 키
    amount_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    coin_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    series: Mapped[str | None] = mapped_column(Text)
    rarity: Mapped[str] = mapped_column(Text, nullable=False, default="normal")
    retail_price: Mapped[int] = mapped_column(Integer, nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    kc_certified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Machine(Base):
    __tablename__ = "machines"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price_coin: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft")  # draft|open|soldout|closed
    seed_hash: Mapped[str | None] = mapped_column(Text)  # 커밋-리빌: 오픈 시 SHA-256(seed) 선공개
    seed_reveal: Mapped[str | None] = mapped_column(Text)  # 회차 종료 후 원본 공개
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MachineItem(Base):
    """머신 안의 실물 재고이자 확률표 — stock이 곧 확률의 분자."""

    __tablename__ = "machine_items"
    __table_args__ = (
        CheckConstraint("stock >= 0", name="ck_machine_items_stock_nonneg"),
        UniqueConstraint("machine_id", "item_id", name="uq_machine_item"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    machine_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("machines.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id"), nullable=False)
    stock: Mapped[int] = mapped_column(Integer, nullable=False)
    initial_stock: Mapped[int] = mapped_column(Integer, nullable=False)


class Draw(Base):
    """추첨 감사 로그 — rng_value + stock_snapshot + 머신 seed 커밋-리빌로 재현·검증 가능."""

    __tablename__ = "draws"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    machine_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("machines.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id"), nullable=False)
    cost_coin: Mapped[int] = mapped_column(Integer, nullable=False)
    rng_value: Mapped[float] = mapped_column(Float, nullable=False)
    stock_snapshot: Mapped[dict] = mapped_column(JsonB, nullable=False)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)  # 10연이면 같은 batch_id 10행
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserItem(Base):
    __tablename__ = "user_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id"), nullable=False)
    draw_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("draws.id"), unique=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="stored")  # stored|shipping_locked|shipped|traded
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    address: Mapped[dict] = mapped_column(JsonB, nullable=False)  # 주소 스냅샷
    fee_krw: Mapped[int] = mapped_column(Integer, nullable=False, default=3000)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="requested")
    tracking_no: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ShipmentItem(Base):
    __tablename__ = "shipment_items"

    shipment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("shipments.id"), primary_key=True
    )
    user_item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("user_items.id"), primary_key=True
    )


class Trade(Base):
    """중복템 교환 — 보상은 코인 재화로만. 현금 환급 경로 없음 (절대 원칙 4)"""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    user_item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("user_items.id"), unique=True, nullable=False
    )
    coin_credit: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
