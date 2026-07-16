from fastapi import APIRouter

router = APIRouter(prefix="/shipments", tags=["shipments"])

# F-06에서 구현: 보관함 → 묶음배송
