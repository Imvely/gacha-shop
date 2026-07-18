"use client";

import type { DrawResponse } from "@pong/shared";

// 클라이언트(브라우저)에서 FastAPI 직접 호출. CORS는 서버에서 localhost:3000 허용.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// TODO(F-01): 카카오 OAuth + JWT로 교체. 그 전까지 개발용 유저 스텁.
const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "1";

export class ApiError extends Error {
  constructor(
    public status: number,
    detail: string,
  ) {
    super(detail);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": DEV_USER_ID,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? `요청 실패 (${res.status})`);
  }
  return res.json();
}

/** 추첨 — 결과는 서버만 결정한다. 프론트는 이 응답을 받은 뒤에야 연출을 시작한다. */
export function postDraw(machineId: number, count: 1 | 10 = 1): Promise<DrawResponse> {
  return request<DrawResponse>("/draws", {
    method: "POST",
    body: JSON.stringify({ machine_id: machineId, count }),
  });
}

export function getBalance(): Promise<{ balance: number }> {
  return request<{ balance: number }>("/wallet/balance");
}

export interface CoinPackage {
  id: string;
  label: string;
  amount_krw: number;
  coin_amount: number;
}

export interface TopupResult {
  pg_tx_id: string;
  amount_krw: number;
  coin_amount: number;
  status: string;
}

export function getPackages(): Promise<CoinPackage[]> {
  return request<CoinPackage[]>("/wallet/packages");
}

export interface LimitInfo {
  monthly_limit_krw: number;
  month_paid_krw: number;
}

export function getLimit(): Promise<LimitInfo> {
  return request<LimitInfo>("/wallet/limit");
}

export function updateLimit(monthlyLimitKrw: number): Promise<LimitInfo> {
  return request<LimitInfo>("/wallet/limit", {
    method: "PATCH",
    body: JSON.stringify({ monthly_limit_krw: monthlyLimitKrw }),
  });
}

/** 충전 인텐트 생성 — 금액은 서버 패키지가 결정. 확정은 웹훅에서만. */
export function startTopup(packageId: string): Promise<TopupResult> {
  return request<TopupResult>("/wallet/topups", {
    method: "POST",
    body: JSON.stringify({ package_id: packageId }),
  });
}

/** 개발 전용: Fake PG 결제 완료 시뮬레이션 (실 PG 모드에선 404) */
export function devCompleteTopup(pgTxId: string): Promise<TopupResult> {
  return request<TopupResult>(`/wallet/topups/${pgTxId}/dev-complete`, {
    method: "POST",
  });
}

// ── 보관함 & 배송 (F-06) ────────────────────────────────────────────────

export interface StorageItem {
  user_item_id: number;
  item_id: number;
  name: string;
  rarity: import("@pong/shared").Rarity;
  retail_price: number;
  status: "stored" | "shipping_locked" | "shipped" | "traded";
  shipment_id: number | null;
}

export interface ShippingAddress {
  recipient: string;
  phone: string;
  postcode: string;
  address1: string;
  address2?: string;
}

export interface ShipmentInfo {
  id: number;
  status: "requested" | "packed" | "shipped" | "delivered";
  fee_krw: number;
  tracking_no: string | null;
  address: ShippingAddress;
  items: StorageItem[];
}

export function getStorage(): Promise<StorageItem[]> {
  return request<StorageItem[]>("/shipments/storage");
}

export function getShippingFee(): Promise<{ fee_coin: number; fee_krw: number }> {
  return request<{ fee_coin: number; fee_krw: number }>("/shipments/fee");
}

export function createShipment(
  userItemIds: number[],
  address: ShippingAddress,
): Promise<ShipmentInfo> {
  return request<ShipmentInfo>("/shipments", {
    method: "POST",
    body: JSON.stringify({ user_item_ids: userItemIds, address }),
  });
}

export function listShipments(): Promise<ShipmentInfo[]> {
  return request<ShipmentInfo[]>("/shipments");
}

export function changeShipmentAddress(
  shipmentId: number,
  address: ShippingAddress,
): Promise<ShipmentInfo> {
  return request<ShipmentInfo>(`/shipments/${shipmentId}/address`, {
    method: "PATCH",
    body: JSON.stringify(address),
  });
}
