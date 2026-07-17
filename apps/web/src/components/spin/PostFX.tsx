"use client";

import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";

/**
 * 포스트프로세싱 — 저사양에선 통째로 비활성 (리서치: multisampling 0이 모바일 필수,
 * mipmapBlur 블룸 + luminanceThreshold 1 = HDR emissive만 선택적으로 빛남).
 */
export function PostFX({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={1} intensity={1.15} />
      <Vignette eskil={false} offset={0.25} darkness={0.65} />
    </EffectComposer>
  );
}
