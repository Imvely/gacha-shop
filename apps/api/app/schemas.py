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
