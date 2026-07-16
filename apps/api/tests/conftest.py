import os
import secrets

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import Item, Machine, MachineItem, User, WalletLedger
from app.services.draw_engine import seed_hash_of

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:55432/gacha_test",
)

engine = create_engine(TEST_DATABASE_URL, pool_size=25, max_overflow=10)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

ALL_TABLES = (
    "shipment_items, trades, user_items, draws, shipments, "
    "machine_items, machines, items, payments, wallet_ledger, users"
)


@pytest.fixture(autouse=True)
def clean_db():
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {ALL_TABLES} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def db():
    session = TestSession()
    yield session
    session.close()


@pytest.fixture
def make_user(db):
    """코인이 충전된 유저 생성 (원장 행으로만 충전 — 잔액 컬럼 없음)"""

    def _make(coins: int, nickname: str = "tester") -> int:
        user = User(nickname=nickname, provider="test")
        db.add(user)
        db.flush()
        if coins > 0:
            db.add(
                WalletLedger(
                    user_id=user.id, amount=coins, reason="topup", ref_type="test"
                )
            )
        db.commit()
        return user.id

    return _make


@pytest.fixture
def make_machine(db):
    """seed 커밋(오픈 절차)까지 끝난 open 머신 생성. 반환: (machine_id, seed)"""

    def _make(stocks: dict[str, int], price_coin: int = 100) -> tuple[int, str]:
        seed = secrets.token_hex(32)
        machine = Machine(
            name="테스트 머신",
            price_coin=price_coin,
            status="open",
            seed_hash=seed_hash_of(seed),
            seed_reveal=seed,
        )
        db.add(machine)
        db.flush()
        for rarity_sku, stock in stocks.items():
            item = Item(
                sku=f"{machine.id}-{rarity_sku}",
                name=f"상품 {rarity_sku}",
                rarity=rarity_sku.split("-")[0],
                retail_price=5000,
            )
            db.add(item)
            db.flush()
            db.add(
                MachineItem(
                    machine_id=machine.id,
                    item_id=item.id,
                    stock=stock,
                    initial_stock=stock,
                )
            )
        db.commit()
        return machine.id, seed

    return _make
