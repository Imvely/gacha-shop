import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchMachine } from "@/lib/api";
import { CapsuleGauge } from "@/components/CapsuleGauge";
import { OddsModal } from "@/components/OddsModal";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const machine = await fetchMachine(id);
  return { title: machine ? `${machine.name} — PONG!` : "PONG!" };
}

export default async function MachinePage({ params }: Props) {
  const { id } = await params;
  const machine = await fetchMachine(id);
  if (!machine) notFound();

  return (
    <div className="flex flex-col gap-6">
      <nav>
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← 머신 목록
        </Link>
      </nav>

      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl leading-snug">{machine.name}</h1>
          {machine.is_soldout && (
            <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">
              품절
            </span>
          )}
        </div>
        <CapsuleGauge
          remaining={machine.stock_remaining}
          initial={machine.stock_initial}
        />
        <p className="font-mono text-lg text-coin">1회 {machine.price_coin} 코인</p>
      </section>

      {/* 조작부 — 하단 고정, safe-area 안 (확률표 진입점 상시 노출: 법적 가드) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl gap-3 px-4 py-3">
          <div className="flex-1">
            <OddsModal machine={machine} />
          </div>
          <button
            disabled
            className="flex-1 rounded-xl bg-surface-2 px-4 py-3 text-sm font-medium text-muted"
            title="3D 스핀은 준비 중이에요"
          >
            {machine.is_soldout ? "이번 회차 마감" : "스핀 준비 중"}
          </button>
        </div>
      </div>
    </div>
  );
}
