from typing import Literal

from pydantic import BaseModel


class DrawRequest(BaseModel):
    machine_id: int
    count: Literal[1, 10] = 1


class DrawResultItem(BaseModel):
    item_id: int
    name: str
    rarity: str
    retail_price: int  # 결과 화면 "정가 OO원" 표기 근거 (법적 가드)


class DrawResponse(BaseModel):
    results: list[DrawResultItem]
    seed_reveal: str | None = None  # 회차 종료(soldout) 시에만 공개
    balance: int


class MachineSummary(BaseModel):
    id: int
    name: str
    price_coin: int
    status: str  # open | soldout (재고 0이면 서버가 soldout으로 계산)
    stock_remaining: int
    stock_initial: int
    is_soldout: bool


class OddsRow(BaseModel):
    item_id: int
    name: str
    rarity: str
    retail_price: int  # "정가 OO원" 최저 보장 각인 (법적 가드)
    stock: int
    initial_stock: int
    odds_pct: float  # 실데이터: stock / total_stock (최대잉여법으로 합계 100.00 보장)


class MachineDetail(MachineSummary):
    seed_hash: str | None  # 커밋-리빌 선공개 해시 — 누구나 회차 종료 후 검증 가능
    odds: list[OddsRow]
    odds_total_pct: float
