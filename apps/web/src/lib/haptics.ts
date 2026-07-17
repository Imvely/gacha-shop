"use client";

/**
 * 웹 햅틱 — Android Chrome은 navigator.vibrate, iOS Safari는 미지원(조용히 무시).
 * 강도 가이드 (리서치): UI 틱 15~50ms, 임팩트 60~100ms, 빅 이벤트는 패턴.
 */
export const haptic = {
  tick: () => navigator.vibrate?.(15),
  impact: () => navigator.vibrate?.(60),
  pop: () => navigator.vibrate?.(30),
  secret: () => navigator.vibrate?.([80, 50, 80, 50, 160]),
};
