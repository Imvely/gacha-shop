import type { Metadata } from "next";
import Link from "next/link";

import { StoragePanel } from "@/components/storage/StoragePanel";

export const metadata: Metadata = { title: "보관함 — PONG!" };

export default function StoragePage() {
  return (
    <div className="flex flex-col gap-6">
      <nav>
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← 머신 목록
        </Link>
      </nav>
      <section>
        <h1 className="font-display text-3xl leading-tight">보관함</h1>
        <p className="mt-1 text-sm text-muted">
          뽑은 실물은 여기 쌓여요. 모아서 한 번에 배송받는 게 이득!
        </p>
      </section>
      <StoragePanel />
    </div>
  );
}
