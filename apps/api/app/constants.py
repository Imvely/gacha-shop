"""등급(rarity) 토큰 — FE/BE 공통 상수 (packages/shared/src/rarity.ts와 동기화)"""

RARITIES = ("normal", "rare", "epic", "secret")

RARITY_TOKENS = {
    "normal": {"label": "노멀", "color": "#9AA3B2"},
    "rare": {"label": "레어", "color": "#5BA8FF"},
    "epic": {"label": "에픽", "color": "#B07CFF"},
    "secret": {"label": "시크릿", "color": "#FFC24D"},
}
