"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 원샷 파티클 버스트 — 링 분포 + 지터 (리서치: 순수 랜덤은 뭉침, 링+지터가 정답).
 * Points 1드로우콜. burstId가 바뀔 때마다 재발사.
 */
export function ParticleBurst({
  burstId,
  origin,
  color,
  count = 14,
  speed = 2.2,
  lifetime = 0.9,
  size = 0.06,
  gravity = -4.5,
}: {
  burstId: number;
  origin: [number, number, number];
  color: string;
  count?: number;
  speed?: number;
  lifetime?: number;
  size?: number;
  gravity?: number;
}) {
  const points = useRef<THREE.Points>(null);
  const mat = useRef<THREE.PointsMaterial>(null);
  const age = useRef(0);
  const lastBurst = useRef(burstId);

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const s = speed * (0.45 + 0.55 * Math.random());
      velocities[i * 3] = Math.cos(a) * s;
      velocities[i * 3 + 1] = 1.6 + Math.random() * 1.2; // 위로 튀어오르는 아크
      velocities[i * 3 + 2] = Math.sin(a) * s;
    }
    return { positions, velocities };
    // burstId 변경 시 속도 재생성 (매 발사가 다른 모양)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, speed, burstId]);

  useFrame((_, delta) => {
    if (!points.current || !mat.current) return;
    if (lastBurst.current !== burstId) {
      lastBurst.current = burstId;
      age.current = 0;
    }
    if (age.current >= lifetime) {
      points.current.visible = false;
      return;
    }
    points.current.visible = true;
    age.current += delta;
    const t = age.current;
    const pos = points.current.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      pos.setXYZ(
        i,
        origin[0] + velocities[i * 3] * t,
        origin[1] + velocities[i * 3 + 1] * t + 0.5 * gravity * t * t,
        origin[2] + velocities[i * 3 + 2] * t,
      );
    }
    pos.needsUpdate = true;
    mat.current.opacity = Math.max(0, 1 - t / lifetime);
  });

  return (
    <points ref={points} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={mat}
        color={color}
        size={size}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}
