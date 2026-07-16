from fastapi import APIRouter

router = APIRouter(prefix="/machines", tags=["machines"])

# F-03에서 구현: 머신 목록/상세, 확률표(machine_odds 뷰 = 실데이터만)
