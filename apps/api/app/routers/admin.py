from fastapi import APIRouter

router = APIRouter(prefix="/admin", tags=["admin"])

# F-07에서 구현: 머신 생성(seed_hash 자동 생성·공개), 입출고, 송장
