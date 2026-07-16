from fastapi import APIRouter

router = APIRouter(prefix="/wallet", tags=["wallet"])

# F-02에서 구현: 잔액 조회(원장 합계), 충전(포트원 웹훅 검증)
