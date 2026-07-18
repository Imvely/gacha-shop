"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { MachineDetail } from "@pong/shared";

import { getBalance } from "@/lib/clientApi";
import { useSpinStore } from "@/stores/spinStore";
import { isMuted, setMuted, sfx } from "@/lib/sfx";
import { haptic } from "@/lib/haptics";
import { OddsModal } from "@/components/OddsModal";
import { GachaMachine } from "./GachaMachine";
import { PostFX } from "./PostFX";
import { RevealOverlay } from "./RevealOverlay";

/**
 * 스핀 무대 = 3D 씬 + HUD + 조작부.
 * 저사양 판정: hardwareConcurrency < 6 또는 DPR > 2.5 → 그림자·파티클 오프.
 * prefers-reduced-motion → 스핀/낙하 연출 생략(결과 확인 흐름은 유지).
 */
export function SpinStage({ machine }: { machine: MachineDetail }) {
  const phase = useSpinStore((s) => s.phase);
  const balance = useSpinStore((s) => s.balance);
  const error = useSpinStore((s) => s.error);
  const lowFx = useSpinStore((s) => s.lowFx);
  const reducedMotion = useSpinStore((s) => s.reducedMotion);
  const requestSpin = useSpinStore((s) => s.requestSpin);
  const advance = useSpinStore((s) => s.advance);
  const setBalance = useSpinStore((s) => s.setBalance);
  const setProfile = useSpinStore((s) => s.setProfile);
  const clearError = useSpinStore((s) => s.clearError);

  const [remaining, setRemaining] = useState(machine.stock_remaining);
  const [mutedState, setMutedState] = useState(false);

  useEffect(() => setMutedState(isMuted()), []);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () =>
      setProfile({
        lowFx:
          (navigator.hardwareConcurrency ?? 8) < 6 || devicePixelRatio > 2.5,
        reducedMotion: mq.matches,
      });
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [setProfile]);

  useEffect(() => {
    getBalance()
      .then((r) => setBalance(r.balance))
      .catch(() => {});
  }, [setBalance]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 2500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const spin = useCallback(() => {
    if (remaining <= 0) return;
    void requestSpin(machine.id).then(() => {
      const s = useSpinStore.getState();
      if (s.results) setRemaining((r) => Math.max(0, r - s.results!.length));
    });
  }, [machine.id, remaining, requestSpin]);

  // 레버 드래그: 수평 드래그 누적량이 임계치를 넘으면 스핀 (idle에서만)
  const drag = useRef<{ x: number; acc: number; tick: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    // HUD 버튼(음소거 등) 클릭이 무대까지 버블링돼 캡슐이 열리는 것 방지
    if ((e.target as HTMLElement).closest("button")) return;
    if (phase === "landed") {
      // reduced-motion은 3D 팝 연출 없이 바로 결과로
      advance("landed", reducedMotion ? "opened" : "opening");
      return;
    }
    if (phase === "idle") drag.current = { x: e.clientX, acc: 0, tick: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || phase !== "idle") return;
    const dx = Math.abs(e.clientX - drag.current.x);
    drag.current.acc += dx;
    drag.current.tick += dx;
    drag.current.x = e.clientX;
    if (drag.current.tick > 26) {
      // 드르륵 — 26px마다 라쳇 틱 (리서치: 노치 단위 피드백)
      drag.current.tick = 0;
      sfx.ratchet();
      haptic.tick();
    }
    if (drag.current.acc > 140) {
      drag.current = null;
      spin();
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const spinDisabled = phase !== "idle" || remaining <= 0;

  return (
    <div
      data-testid="spin-stage"
      data-phase={phase}
      data-lowfx={lowFx}
      data-reduced={reducedMotion}
      className="flex flex-col gap-4"
    >
      {/* 3D 무대 */}
      <div
        className="relative h-[52dvh] min-h-72 touch-none overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-[#171233] to-[#2E2260]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <Canvas
          shadows={!lowFx}
          dpr={lowFx ? 1 : [1, 1.5]}
          gl={{ antialias: lowFx }} // 컴포저 사용 시 MSAA 오프 (mipmapBlur 블룸이 커버)
          // rotation을 명시해야 CameraShake가 이 각도를 기준으로 잡는다 (lookAt은 마운트 순서에 따라 무시됨)
          camera={{ fov: 42, position: [0, 1.9, 6.2], rotation: [-0.104, 0, 0] }}
          onCreated={({ gl }) => {
            // 검증용: 실제 렌더러의 그림자 상태를 DOM에 노출 (verify-spin.mjs가 단언)
            gl.domElement.dataset.shadows = String(gl.shadowMap.enabled);
          }}
        >
          <GachaMachine />
          <PostFX enabled={!lowFx} />
        </Canvas>

        {/* HUD: 잔액 + 남은 캡슐 + 사운드 토글 */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 text-xs">
          <span className="rounded-full bg-black/40 px-3 py-1.5 backdrop-blur">
            🪙 <b className="font-mono text-coin">{balance ?? "—"}</b> 코인
          </span>
          <span className="rounded-full bg-black/40 px-3 py-1.5 backdrop-blur">
            남은 캡슐 <b className="font-mono">{remaining}</b>
          </span>
        </div>
        <button
          aria-label={mutedState ? "소리 켜기" : "소리 끄기"}
          onClick={() => {
            setMuted(!mutedState);
            setMutedState(!mutedState);
          }}
          className="absolute right-3 top-3 rounded-full bg-black/40 px-3 py-1.5 text-xs backdrop-blur"
        >
          {mutedState ? "🔇" : "🔊"}
        </button>

        {/* 상태 안내 */}
        {phase === "requesting" && (
          <p className="absolute inset-x-0 bottom-4 text-center text-sm font-medium text-foreground/90">
            캡슐 섞는 중…
          </p>
        )}
        {phase === "landed" && (
          <p className="absolute inset-x-0 bottom-4 animate-bounce text-center text-sm font-semibold">
            캡슐을 탭해서 열어보세요!
          </p>
        )}
        {phase === "idle" && !spinDisabled && (
          <p className="absolute inset-x-0 bottom-4 text-center text-xs text-foreground/60">
            레버를 드르륵 — 옆으로 드래그해도 돌아가요
          </p>
        )}

        {/* 에러 토스트 */}
        {error && (
          <p
            data-testid="spin-error"
            className="absolute inset-x-6 bottom-4 rounded-full bg-black/70 px-4 py-2 text-center text-sm"
          >
            {error}
          </p>
        )}
      </div>

      {/* 조작부 — 확률표 진입점 상시 노출 (법적 가드) */}
      <div className="flex gap-3">
        <div className="flex-1">
          <OddsModal machine={machine} />
        </div>
        <button
          data-testid="spin-button"
          onClick={spin}
          disabled={spinDisabled}
          className="flex-1 rounded-xl bg-pong px-4 py-3 text-sm font-semibold text-background transition-transform enabled:active:scale-95 disabled:opacity-40"
        >
          {remaining <= 0
            ? "이번 회차 마감"
            : phase === "idle"
              ? `스핀 · ${machine.price_coin} 코인`
              : phase === "requesting"
                ? "뽑는 중…"
                : "진행 중…"}
        </button>
      </div>
      <p className="text-center text-[11px] text-muted">
        <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
          스핀 확정 시 청약이 확정돼요
        </a>{" "}
        · 결과 실물은 보관함에 적립 후 묶음배송 · 미성년자는 법정대리인 동의 필요
      </p>

      <RevealOverlay machine={machine} onAgain={spin} />
    </div>
  );
}
