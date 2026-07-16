import Link from "next/link";
import type { MachineSummary } from "@pong/shared";

import { CapsuleGauge } from "./CapsuleGauge";

export function MachineCard({ machine }: { machine: MachineSummary }) {
  return (
    <Link
      href={`/machines/${machine.id}`}
      className="group relative flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pong"
    >
      {machine.is_soldout && (
        <span className="absolute right-3 top-3 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
          품절
        </span>
      )}
      <div
        className={`font-display text-lg leading-snug ${
          machine.is_soldout ? "pr-12 text-muted" : "text-foreground"
        }`}
      >
        {machine.name}
      </div>
      <CapsuleGauge
        remaining={machine.stock_remaining}
        initial={machine.stock_initial}
        compact
      />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="whitespace-nowrap font-mono text-sm text-coin">
          {machine.price_coin} 코인
        </span>
        <span className="whitespace-nowrap text-xs text-muted group-hover:text-pong">
          {machine.is_soldout ? "확률 기록 →" : "구경하기 →"}
        </span>
      </div>
    </Link>
  );
}
