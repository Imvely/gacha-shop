/**
 * 등급(rarity) 토큰 — FE/BE 공통 상수 (CLAUDE.md 7절과 동기화)
 * BE(apps/api/app/constants.py)와 값이 일치해야 한다.
 */
export const RARITIES = ["normal", "rare", "epic", "secret"] as const;

export type Rarity = (typeof RARITIES)[number];

export interface RarityToken {
  key: Rarity;
  label: string;
  color: string;
  effect: string;
}

export const RARITY_TOKENS: Record<Rarity, RarityToken> = {
  normal: { key: "normal", label: "노멀", color: "#9AA3B2", effect: "기본" },
  rare: { key: "rare", label: "레어", color: "#5BA8FF", effect: "블루 글로우" },
  epic: { key: "epic", label: "에픽", color: "#B07CFF", effect: "퍼플 파티클" },
  secret: {
    key: "secret",
    label: "시크릿",
    color: "#FFC24D",
    effect: "골드 폭죽 + 화면 진동",
  },
};
