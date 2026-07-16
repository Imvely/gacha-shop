import type { MachineDetail, MachineSummary } from "@pong/shared";

// 서버 컴포넌트에서만 호출 — 확률·재고의 진실은 항상 서버(FastAPI)에 있다.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function fetchMachines(): Promise<MachineSummary[]> {
  const res = await fetch(`${API_URL}/machines`, { cache: "no-store" });
  if (!res.ok) throw new Error(`머신 목록 조회 실패 (${res.status})`);
  return res.json();
}

export async function fetchMachine(id: string): Promise<MachineDetail | null> {
  const res = await fetch(`${API_URL}/machines/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`머신 상세 조회 실패 (${res.status})`);
  return res.json();
}
