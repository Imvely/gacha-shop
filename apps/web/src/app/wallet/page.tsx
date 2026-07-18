import type { Metadata } from "next";
import Link from "next/link";

import { WalletPanel } from "@/components/wallet/WalletPanel";

export const metadata: Metadata = { title: "지갑 — PONG!" };

export default function WalletPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav>
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← 머신 목록
        </Link>
      </nav>
      <section>
        <h1 className="font-display text-3xl leading-tight">지갑</h1>
        <p className="mt-1 text-sm text-muted">
          코인은 스핀에만 써요. 현금으로 돌려받을 수는 없어요.
        </p>
      </section>
      <WalletPanel />
    </div>
  );
}
