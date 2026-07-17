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
