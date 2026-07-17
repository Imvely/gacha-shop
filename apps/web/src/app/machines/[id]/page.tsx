import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchMachine } from "@/lib/api";
import { CapsuleGauge } from "@/components/CapsuleGauge";
import { SpinStageLoader } from "@/components/spin/SpinStageLoader";

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
    <div className="flex flex-col gap-4">
      <nav className="flex items-center justify-between gap-3">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← 머신 목록
        </Link>
        {machine.is_soldout && (
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">품절</span>
        )}
      </nav>

      <section className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl leading-snug">{machine.name}</h1>
          <p className="mt-1 font-mono text-sm text-coin">1회 {machine.price_coin} 코인</p>
        </div>
        <CapsuleGauge
          remaining={machine.stock_remaining}
          initial={machine.stock_initial}
          compact
        />
      </section>

      {/* 스핀 무대: 3D 씬 + 조작부(확률표 진입점 상시 노출) */}
      <SpinStageLoader machine={machine} />
    </div>
  );
}
