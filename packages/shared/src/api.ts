/**
 * 추첨 API 계약 타입 (CLAUDE.md 5절)
 * TODO: OpenAPI 스키마 자동 생성으로 대체 예정 — 그 전까지 수동 동기화.
 */
import type { Rarity } from "./rarity";

export interface DrawRequest {
  machine_id: number;
  count: 1 | 10;
}

export interface DrawResultItem {
  item_id: number;
  name: string;
  rarity: Rarity;
  retail_price: number;
}

export interface DrawResponse {
  results: DrawResultItem[];
  /** 회차 종료 후에만 공개되는 원본 seed (커밋-리빌) */
  seed_reveal?: string;
  balance: number;
}
