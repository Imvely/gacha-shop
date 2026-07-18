"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { RARITY_TOKENS } from "@pong/shared";
import type { MachineDetail } from "@pong/shared";

import { useSpinStore } from "@/stores/spinStore";
import { sfx } from "@/lib/sfx";

/** 결과 리빌 카드 — 서버가 준 결과를 그대로 표시. 정가 표기는 법적 가드(각인). */
export function RevealOverlay({
  machine,
  onAgain,
}: {
  machine: MachineDetail;
  onAgain: () => void;
}) {
  const phase = useSpinStore((s) => s.phase);
  const results = useSpinStore((s) => s.results);
  const seedReveal = useSpinStore((s) => s.seedReveal);
  const lowFx = useSpinStore((s) => s.lowFx);
  const reducedMotion = useSpinStore((s) => s.reducedMotion);
  const reset = useSpinStore((s) => s.reset);
  const router = useRouter();

  const item = results?.[0];
  const token = item ? RARITY_TOKENS[item.rarity] : null;
  const open = phase === "opened" && !!item;

  // 시크릿 = 화면 진동 + 골드 폭죽 / 에픽 = 퍼플 파티클 (저사양·모션 최소화 시 생략)
  const celebrate = open && !lowFx && !reducedMotion;
  const confetti = useMemo(() => {
    if (!celebrate || !item || (item.rarity !== "secret" && item.rarity !== "epic"))
      return [];
    const palette =
      item.rarity === "secret"
        ? ["#FFC24D", "#FF5FA2", "#59E3C2", "#FFFFFF"]
        : ["#B07CFF", "#E3D2FF"];
    return Array.from({ length: item.rarity === "secret" ? 40 : 24 }, (_, i) => ({
      left: `${(i * 37) % 100}vw`,
      background: palette[i % palette.length],
      duration: 1.4 + ((i * 13) % 10) / 8,
      delay: ((i * 7) % 10) / 20,
    }));
  }, [celebrate, item]);

  useEffect(() => {
    if (!open || !item) return;
    sfx.fanfare(item.rarity); // 등급 팡파레 (높을수록 화려한 아르페지오)
    if (item.rarity === "secret" && celebrate) {
      document.body.classList.add("secret-shake");
      const t = setTimeout(() => document.body.classList.remove("secret-shake"), 500);
      return () => clearTimeout(t);
    }
  }, [open, item, celebrate]);

  return (
    <AnimatePresence>
      {open && item && token && (
        <motion.div
          key="reveal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
          data-testid="reveal-card"
        >
          {confetti.length > 0 && (
            <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
              {confetti.map((c, i) => (
                <span
                  key={i}
                  className="confetti-piece"
                  style={{
                    left: c.left,
                    background: c.background,
                    animationDuration: `${c.duration}s`,
                    animationDelay: `${c.delay}s`,
                  }}
                />
              ))}
            </div>
          )}

          <motion.div
            initial={reducedMotion ? { opacity: 0 } : { scale: 0.5, rotate: -4, opacity: 0 }}
            animate={reducedMotion ? { opacity: 1 } : { scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            className="relative w-full max-w-xs overflow-hidden rounded-3xl border border-line bg-surface p-6 text-center"
          >
            {/* 등급 리본 빛 */}
            <div
              aria-hidden
              className="absolute -top-16 left-1/2 h-32 w-56 -translate-x-1/2 rounded-full opacity-50 blur-3xl"
              style={{ background: token.color }}
            />
            <span
              className="relative inline-block rounded-full px-3 py-1 text-xs font-semibold tracking-widest"
              style={{ color: "#14121F", backgroundColor: token.color }}
            >
              {token.label}
            </span>
            <h3 className="relative mt-3 font-display text-2xl">{item.name}</h3>
            <p className="relative mt-1 text-xs text-muted">{machine.name}</p>
            <p className="relative mt-4 rounded-xl bg-background px-3 py-2.5 text-sm">
              정가 <b className="font-mono">{item.retail_price.toLocaleString()}원</b> 상품 ·
              보관함에 담겼어요
            </p>
            {seedReveal && (
              <p className="relative mt-2 break-all rounded-xl bg-background p-2 font-mono text-[10px] text-muted">
                회차 종료 — 시드 공개 {seedReveal}
              </p>
            )}
            <div className="relative mt-5 flex gap-2">
              <button
                onClick={() => {
                  reset();
                  router.push("/storage");
                }}
                className="flex-1 rounded-xl bg-surface-2 px-4 py-3 text-sm font-medium"
              >
                보관함으로
              </button>
              <button
                onClick={() => {
                  reset();
                  onAgain();
                }}
                className="flex-1 rounded-xl bg-pong px-4 py-3 text-sm font-medium text-background"
              >
                한 번 더!
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
