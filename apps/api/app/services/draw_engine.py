"""추첨 엔진 코어 (F-04)

절대 원칙 (CLAUDE.md 2절 / money-safety 스킬):
- 추첨은 서버에서만. 이 모듈이 유일한 결과 결정 지점이다.
- 추첨 + 재고 차감 + 원장 차감 + 감사 로그 = 단일 DB 트랜잭션.
- 잔액은 원장(wallet_ledger) 합계로만 정의. 요청 값 불신 — 비용은 서버 재계산.
- 커밋-리빌: 머신 오픈 시 seed_hash=SHA256(seed) 선공개, rng는 HMAC(seed, nonce)로
  유도 → 회차 종료 후 seed 공개 시 모든 draw를 제3자가 재현·검증 가능.

동시성 설계 (잠금 순서 고정으로 데드락 방지):
  1) users 행 FOR UPDATE — 같은 유저의 동시 스핀을 직렬화 (원장 이중 차감 방지)
  2) machine_items 행 FOR UPDATE — 같은 머신의 재고 이중 차감 방지
"""
import hashlib
import hmac
import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Draw, Item, Machine, MachineItem, User, UserItem, WalletLedger


class DrawError(Exception):
    """추첨 실패 — status_code는 라우터에서 HTTP 응답으로 변환."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


@dataclass
class DrawOutcome:
    results: list[Item]
    balance: int
    seed_reveal: str | None = None
    draw_ids: list[int] = field(default_factory=list)
    batch_id: uuid.UUID | None = None


def derive_rng(seed: str, nonce: int) -> float:
    """HMAC-SHA256(seed, nonce) → [0, 1) 난수. seed 공개 후 누구나 재현 가능."""
    digest = hmac.new(seed.encode(), str(nonce).encode(), hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def seed_hash_of(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def execute_draws(db: Session, user_id: int, machine_id: int, count: int) -> DrawOutcome:
    """count회 추첨을 단일 트랜잭션으로 수행하고 커밋한다."""
    if count not in (1, 10):
        raise DrawError(422, "count는 1 또는 10만 허용")

    with db.begin():
        # ── 잠금 1: 유저 행 — 같은 유저의 동시 요청 직렬화 ──────────────
        locked_user = db.execute(
            select(User.id).where(User.id == user_id).with_for_update()
        ).scalar_one_or_none()
        if locked_user is None:
            raise DrawError(404, "존재하지 않는 유저")

        machine = db.get(Machine, machine_id)
        if machine is None:
            raise DrawError(404, "존재하지 않는 머신")
        if machine.status != "open":
            raise DrawError(409, f"머신이 open 상태가 아님 (현재: {machine.status})")
        if not machine.seed_reveal or not machine.seed_hash:
            raise DrawError(409, "머신에 seed가 커밋되지 않음 — 오픈 절차 누락")

        # 비용은 서버 재계산 (요청 body의 금액은 신뢰하지 않는다)
        cost = machine.price_coin * count

        balance = db.execute(
            select(func.coalesce(func.sum(WalletLedger.amount), 0)).where(
                WalletLedger.user_id == user_id
            )
        ).scalar_one()
        if balance < cost:
            raise DrawError(402, f"코인 부족 (잔액 {balance}, 필요 {cost})")

        # ── 잠금 2: 머신 재고 행 — 재고 이중 차감 방지 (id 순 고정) ──────
        machine_items = (
            db.execute(
                select(MachineItem)
                .where(MachineItem.machine_id == machine_id, MachineItem.stock > 0)
                .order_by(MachineItem.id)
                .with_for_update()
            )
            .scalars()
            .all()
        )
        total_stock = sum(mi.stock for mi in machine_items)
        if total_stock < count:
            raise DrawError(409, f"재고 부족 (잔여 {total_stock}, 요청 {count})")

        # 커밋-리빌 nonce: 이 머신의 누적 draw 수 (재고 행 잠금 하에서 안정)
        prior_draws = db.execute(
            select(func.count(Draw.id)).where(Draw.machine_id == machine_id)
        ).scalar_one()

        batch_id = uuid.uuid4() if count > 1 else None
        won_items: list[Item] = []
        draw_ids: list[int] = []

        for i in range(count):
            snapshot = {str(mi.item_id): mi.stock for mi in machine_items if mi.stock > 0}
            live = [mi for mi in machine_items if mi.stock > 0]
            remaining = sum(mi.stock for mi in live)

            rng = derive_rng(machine.seed_reveal, prior_draws + i)
            threshold = rng * remaining
            cumulative = 0
            won = live[-1]
            for mi in live:
                cumulative += mi.stock
                if threshold < cumulative:
                    won = mi
                    break

            won.stock -= 1

            draw = Draw(
                user_id=user_id,
                machine_id=machine_id,
                item_id=won.item_id,
                cost_coin=machine.price_coin,
                rng_value=rng,
                stock_snapshot=snapshot,
                batch_id=batch_id,
            )
            db.add(draw)
            db.flush()  # draw.id 확보 (user_items·ledger 연결용)
            draw_ids.append(draw.id)

            db.add(
                UserItem(
                    user_id=user_id,
                    item_id=won.item_id,
                    draw_id=draw.id,
                )
            )
            won_items.append(db.get(Item, won.item_id))

        # 원장 차감 — 배치당 1행, 근거는 첫 draw id (money-safety 불변식 1)
        db.add(
            WalletLedger(
                user_id=user_id,
                amount=-cost,
                reason="draw",
                ref_type="draw",
                ref_id=draw_ids[0],
            )
        )

        # 회차 종료(완판) 처리 → seed 공개
        seed_reveal = None
        if sum(mi.stock for mi in machine_items) == 0:
            machine.status = "soldout"
            machine.closed_at = func.now()
            seed_reveal = machine.seed_reveal

        new_balance = balance - cost

    return DrawOutcome(
        results=won_items,
        balance=new_balance,
        seed_reveal=seed_reveal,
        draw_ids=draw_ids,
        batch_id=batch_id,
    )
