"use client";

import { useCallback, useEffect, useState } from "react";
import type { CoinPackage } from "@/lib/clientApi";
import {
  devCompleteTopup,
  getBalance,
  getLimit,
  getPackages,
  startTopup,
  updateLimit,
} from "@/lib/clientApi";

/**
 * 지갑 패널 — 잔액(원장 합계)과 충전 패키지.
 * 결제 확정은 서버 웹훅 검증에서만 일어난다. 프론트는 인텐트 생성과
 * (개발 모드) PG 시뮬레이션 트리거만 담당하고, 잔액은 다시 서버에서 읽는다.
 */
export function WalletPanel() {
  const [balance, setBalance] = useState<number | null>(null);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [limit, setLimit] = useState<{ monthly_limit_krw: number; month_paid_krw: number } | null>(
    null,
  );
  const [limitInput, setLimitInput] = useState("");

  const refresh = useCallback(() => {
    getBalance()
      .then((r) => setBalance(r.balance))
      .catch(() => setNotice("잔액을 불러오지 못했어요"));
    getLimit().then(setLimit).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    getPackages()
      .then(setPackages)
      .catch(() => setNotice("패키지를 불러오지 못했어요"));
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const buy = async (pkg: CoinPackage) => {
    if (busy) return;
    setBusy(pkg.id);
    try {
      const intent = await startTopup(pkg.id);
      // TODO(실 PG): 여기서 포트원 결제창 오픈 → 이후 확정은 웹훅이 처리.
      // 지금은 개발용 Fake PG 완료 시뮬레이션 (동일한 서버 확정 경로를 태움)
      await devCompleteTopup(intent.pg_tx_id);
      refresh();
      setNotice(`${pkg.coin_amount.toLocaleString()}코인이 들어왔어요!`);
    } catch {
      setNotice("충전에 실패했어요. 다시 시도해 주세요");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="wallet-panel">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-xs text-muted">보유 코인</p>
        <p className="mt-1 font-mono text-3xl text-coin" data-testid="wallet-balance">
          {balance === null ? "—" : balance.toLocaleString()}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">코인 충전</h2>
        {packages.map((pkg) => (
          <button
            key={pkg.id}
            onClick={() => buy(pkg)}
            disabled={busy !== null}
            data-testid={`package-${pkg.id}`}
            className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-pong disabled:opacity-50"
          >
            <span>
              <span className="block font-medium">{pkg.label}</span>
              <span className="mt-0.5 block font-mono text-sm text-coin">
                {pkg.coin_amount.toLocaleString()} 코인
              </span>
            </span>
            <span className="rounded-xl bg-pong px-4 py-2 text-sm font-semibold text-background">
              {busy === pkg.id ? "충전 중…" : `${pkg.amount_krw.toLocaleString()}원`}
            </span>
          </button>
        ))}
        <p className="text-[11px] text-muted">
          지금은 개발 모드라 실제 결제 없이 충전돼요. 실서비스에선 결제창이 열려요.
        </p>
      </section>

      {/* 월 구매 한도 (법적 가드) */}
      {limit && (
        <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-lg">월 구매 한도</h2>
          <p className="text-sm text-muted">
            이번 달 <b className="font-mono text-foreground">{limit.month_paid_krw.toLocaleString()}원</b>
            {" / "}한도 <b className="font-mono text-foreground">{limit.monthly_limit_krw.toLocaleString()}원</b>
            {" "}— 한도를 넘는 결제는 자동으로 막혀요
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="한도 낮추기 (10,000~300,000)"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              className="flex-1 rounded-xl border border-line bg-background px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={async () => {
                try {
                  const updated = await updateLimit(parseInt(limitInput, 10));
                  setLimit(updated);
                  setLimitInput("");
                  setNotice("한도를 바꿨어요");
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : "한도 변경 실패");
                }
              }}
              disabled={!limitInput}
              className="rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-40"
            >
              변경
            </button>
          </div>
        </section>
      )}

      {notice && (
        <p
          data-testid="wallet-notice"
          className="rounded-full bg-black/60 px-4 py-2 text-center text-sm"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
