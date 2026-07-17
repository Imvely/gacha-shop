"use client";

import dynamic from "next/dynamic";
import type { MachineDetail } from "@pong/shared";

// R3F는 SSR 불가 — 클라이언트에서만 로드하고, 로딩 중엔 스켈레톤.
const SpinStage = dynamic(
  () => import("./SpinStage").then((m) => m.SpinStage),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[52dvh] min-h-72 animate-pulse items-center justify-center rounded-2xl border border-line bg-surface">
        <p className="text-sm text-muted">머신 준비 중…</p>
      </div>
    ),
  },
);

export function SpinStageLoader({ machine }: { machine: MachineDetail }) {
  return <SpinStage machine={machine} />;
}
