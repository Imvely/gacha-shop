"use client";

import { create } from "zustand";
import type { DrawResultItem } from "@pong/shared";

import { ApiError, postDraw } from "@/lib/clientApi";

/**
 * 스핀 상태머신 (절대 원칙: 연출은 결과의 후행)
 *
 *   idle → requesting → spinning → dropping → landed → opening(캡슐 팝) → opened
 *
 * 'spinning'(연출 시작)은 오직 requestSpin이 서버 응답을 저장한 뒤에만 진입한다.
 * 프론트 어디에도 결과를 결정하는 코드가 없다 — results는 항상 서버 응답 그대로.
 * reduced-motion: requesting→landed, landed→opened (연출 단계 생략)
 */
export type SpinPhase =
  | "idle"
  | "requesting"
  | "spinning"
  | "dropping"
  | "landed"
  | "opening"
  | "opened";

interface SpinState {
  phase: SpinPhase;
  results: DrawResultItem[] | null; // 서버가 결정한 결과 (변형 금지)
  seedReveal: string | null;
  balance: number | null;
  error: string | null;
  lowFx: boolean; // 저사양: 그림자·파티클 오프
  reducedMotion: boolean; // 접근성: 모션 최소화

  setBalance: (balance: number) => void;
  setProfile: (p: { lowFx: boolean; reducedMotion: boolean }) => void;
  clearError: () => void;
  requestSpin: (machineId: number) => Promise<void>;
  advance: (from: SpinPhase, to: SpinPhase) => void;
  reset: () => void;
}

const ALLOWED: Partial<Record<SpinPhase, SpinPhase[]>> = {
  spinning: ["dropping"],
  dropping: ["landed"],
  landed: ["opening", "opened"], // reduced-motion은 팝 연출 없이 바로 opened
  opening: ["opened"],
};

export const useSpinStore = create<SpinState>((set, get) => ({
  phase: "idle",
  results: null,
  seedReveal: null,
  balance: null,
  error: null,
  lowFx: false,
  reducedMotion: false,

  setBalance: (balance) => set({ balance }),
  setProfile: ({ lowFx, reducedMotion }) => set({ lowFx, reducedMotion }),
  clearError: () => set({ error: null }),

  requestSpin: async (machineId) => {
    if (get().phase !== "idle") return;
    set({ phase: "requesting", error: null, results: null });
    try {
      // ★ 서버 호출이 먼저 — 응답이 오기 전에는 어떤 연출도 시작하지 않는다.
      const res = await postDraw(machineId, 1);
      set({
        results: res.results,
        seedReveal: res.seed_reveal ?? null,
        balance: res.balance,
        // reduced-motion: 스핀/낙하 연출 생략, 바로 캡슐 탭 대기로
        phase: get().reducedMotion ? "landed" : "spinning",
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 402
            ? "코인이 부족해요"
            : e.status === 409
              ? "남은 캡슐이 부족해요"
              : e.message
          : "연결이 불안정해요. 다시 시도해 주세요";
      set({ phase: "idle", error: msg });
    }
  },

  // 연출 단계 전이 — 결과(results)가 없으면 어떤 연출 단계로도 못 간다.
  advance: (from, to) => {
    const s = get();
    if (s.phase !== from || !ALLOWED[from]?.includes(to) || !s.results) return;
    set({ phase: to });
  },

  reset: () => set({ phase: "idle", results: null, seedReveal: null }),
}));
