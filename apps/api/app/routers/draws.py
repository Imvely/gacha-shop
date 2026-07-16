from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user_id
from app.schemas import DrawRequest, DrawResponse, DrawResultItem
from app.services.draw_engine import DrawError, execute_draws

router = APIRouter(prefix="/draws", tags=["draws"])


@router.post("", response_model=DrawResponse)
def create_draws(
    body: DrawRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> DrawResponse:
    """추첨 실행 (CLAUDE.md 5절 계약). 프론트는 이 응답을 받은 뒤에만 연출을 재생한다."""
    try:
        outcome = execute_draws(db, user_id=user_id, machine_id=body.machine_id, count=body.count)
    except DrawError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return DrawResponse(
        results=[
            DrawResultItem(
                item_id=item.id,
                name=item.name,
                rarity=item.rarity,
                retail_price=item.retail_price,
            )
            for item in outcome.results
        ],
        seed_reveal=outcome.seed_reveal,
        balance=outcome.balance,
    )
