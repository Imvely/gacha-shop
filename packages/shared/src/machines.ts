/**
 * 머신 목록/상세 API 계약 타입 (apps/api/app/schemas.py와 동기화)
 * 확률·재고는 서버 실데이터 — 클라이언트는 이 값을 계산 없이 표시만 한다.
 */
import type { Rarity } from "./rarity";

export interface MachineSummary {
  id: number;
  name: string;
  price_coin: number;
  status: "open" | "soldout";
  stock_remaining: number;
  stock_initial: number;
  is_soldout: boolean;
}

export interface OddsRow {
  item_id: number;
  name: string;
  rarity: Rarity;
  retail_price: number;
  stock: number;
  initial_stock: number;
  odds_pct: number;
}

export interface MachineDetail extends MachineSummary {
  seed_hash: string | null;
  odds: OddsRow[];
  odds_total_pct: number;
}
