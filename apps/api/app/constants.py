"""등급(rarity) 토큰 — FE/BE 공통 상수 (packages/shared/src/rarity.ts와 동기화)"""

RARITIES = ("normal", "rare", "epic", "secret")

RARITY_TOKENS = {
    "normal": {"label": "노멀", "color": "#9AA3B2"},
    "rare": {"label": "레어", "color": "#5BA8FF"},
    "epic": {"label": "에픽", "color": "#B07CFF"},
    "secret": {"label": "시크릿", "color": "#FFC24D"},
}

# 묶음배송 수수료 — 배송 1건당 1회만 부과 (코인 결제, 기록은 원화 병기)
SHIPPING_FEE_COIN = 300
SHIPPING_FEE_KRW = 3000

# 코인 충전 패키지 — 금액·지급 코인은 항상 서버가 결정 (절대 원칙 6: 클라 금액 불신)
COIN_PACKAGES = {
    "starter": {"amount_krw": 5000, "coin_amount": 500, "label": "스타터"},
    "standard": {"amount_krw": 10000, "coin_amount": 1100, "label": "스탠다드 (+10%)"},
    "big": {"amount_krw": 30000, "coin_amount": 3500, "label": "빅 (+16%)"},
}
