from fastapi import Header, HTTPException


def get_current_user_id(x_user_id: int | None = Header(default=None)) -> int:
    """임시 인증 스텁 — F-01(카카오 OAuth + JWT) 구현 시 교체.

    프로덕션 배포 전 반드시 제거. 결과 결정·금액 계산은 어차피 서버에서만 하므로
    이 스텁으로도 F-04 엔진 검증에는 문제 없음.
    """
    if x_user_id is None:
        raise HTTPException(status_code=401, detail="X-User-Id 헤더 필요 (임시 인증)")
    return x_user_id
