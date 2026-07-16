"use client";

import { useState } from "react";
import type { MachineDetail } from "@pong/shared";

import { RarityChip } from "./RarityChip";

/**
 * 확률표 모달 — 서버가 계산한 실데이터(odds_pct)만 표시한다.
 * 진입 버튼은 상세 화면에 항상 노출 (법적 가드, CLAUDE.md 10절).
 */
export function OddsModal({ machine }: { machine: MachineDetail }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-pong focus-visible:outline focus-visible:outline-2 focus-visible:outline-pong"
      >
        확률표 보기
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${machine.name} 확률표`}
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl">{machine.name} 확률표</h2>
                <p className="mt-1 text-xs text-muted">
                  확률 = 남은 재고 ÷ 전체 재고. 뽑힐 때마다 실시간으로 바뀌어요.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="rounded-lg px-2 py-1 text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-pong"
              >
                ✕
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="pb-2 font-normal">상품</th>
                  <th className="pb-2 text-right font-normal">남은 수</th>
                  <th className="pb-2 text-right font-normal">확률</th>
                </tr>
              </thead>
              <tbody>
                {machine.odds.map((row) => (
                  <tr key={row.item_id} className="border-b border-line/50">
                    <td className="py-2.5 pr-2">
                      <div className="flex flex-col gap-1">
                        <span className={row.stock === 0 ? "text-muted line-through" : ""}>
                          {row.name}
                        </span>
                        <span className="flex items-center gap-2">
                          <RarityChip rarity={row.rarity} />
                          <span className="text-xs text-muted">
                            정가 {row.retail_price.toLocaleString()}원
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-mono text-muted">
                      {row.stock}/{row.initial_stock}
                    </td>
                    <td className="py-2.5 text-right font-mono">
                      {row.odds_pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-3 text-xs text-muted" colSpan={2}>
                    합계
                  </td>
                  <td className="pt-3 text-right font-mono text-pong">
                    {machine.odds_total_pct.toFixed(2)}%
                  </td>
                </tr>
              </tfoot>
            </table>

            {machine.seed_hash && (
              <p className="mt-4 break-all rounded-lg bg-background p-3 font-mono text-[10px] leading-relaxed text-muted">
                시드 커밋 {machine.seed_hash}
                <span className="mt-1 block font-sans text-[11px]">
                  오픈 때 미리 공개된 값이라 결과를 나중에 바꿀 수 없어요. 회차가 끝나면
                  원본 시드가 공개돼 누구나 검증할 수 있어요.
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
