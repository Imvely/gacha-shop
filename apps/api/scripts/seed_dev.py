"""개발용 시드 데이터 — 로컬 확인용. 실서비스 데이터 아님.

사용: DATABASE_URL=... python scripts/seed_dev.py
멱등: 같은 이름의 머신이 있으면 건너뜀.
"""
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db import Base, SessionLocal, engine
from app.models import Item, Machine, MachineItem, User, WalletLedger
from app.services.draw_engine import seed_hash_of

MACHINES = [
    {
        "name": "말랑 프렌즈 마스코트 1탄",
        "price_coin": 500,
        "items": [
            ("노멀 스트랩 A", "normal", 4500, 30),
            ("노멀 스트랩 B", "normal", 4500, 25),
            ("레어 아크릴 스탠드", "rare", 8000, 12),
            ("에픽 피규어", "epic", 15000, 5),
            ("시크릿 골드 피규어", "secret", 30000, 1),
        ],
    },
    {
        "name": "심해 생물 볼체인 2탄",
        "price_coin": 300,
        "items": [
            ("해파리 볼체인", "normal", 3500, 2),
            ("아귀 볼체인", "rare", 6000, 1),
        ],
    },
    {
        "name": "레트로 게임기 미니어처 (완판)",
        "price_coin": 700,
        "items": [
            ("게임보이 미니", "normal", 6000, 0),
            ("조이스틱 미니", "rare", 9000, 0),
        ],
    },
]


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        for spec in MACHINES:
            exists = db.scalar(select(Machine.id).where(Machine.name == spec["name"]))
            if exists:
                print(f"skip (이미 있음): {spec['name']}")
                continue
            seed = secrets.token_hex(32)
            total = sum(stock for *_, stock in spec["items"])
            machine = Machine(
                name=spec["name"],
                price_coin=spec["price_coin"],
                status="soldout" if total == 0 else "open",
                seed_hash=seed_hash_of(seed),
                seed_reveal=seed,
            )
            db.add(machine)
            db.flush()
            for idx, (name, rarity, price, stock) in enumerate(spec["items"]):
                item = Item(
                    sku=f"seed-{machine.id}-{idx}",
                    name=name,
                    rarity=rarity,
                    retail_price=price,
                )
                db.add(item)
                db.flush()
                db.add(
                    MachineItem(
                        machine_id=machine.id,
                        item_id=item.id,
                        stock=stock,
                        initial_stock=stock or 20,
                    )
                )
            print(f"seeded: {spec['name']}")

        if not db.scalar(select(User.id).where(User.nickname == "데브테스터")):
            user = User(nickname="데브테스터", provider="dev")
            db.add(user)
            db.flush()
            db.add(WalletLedger(user_id=user.id, amount=10000, reason="topup", ref_type="dev"))
            print(f"seeded user id={user.id} (코인 10000)")

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
