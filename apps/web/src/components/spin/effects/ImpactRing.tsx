"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** 착지 충격 링 — 0.3→1.4 스케일 확장하며 ~350ms 페이드 (리서치 수치) */
export function ImpactRing({
  burstId,
  position,
  color,
}: {
  burstId: number;
  position: [number, number, number];
  color: string;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const age = useRef(1); // 시작은 종료 상태
  const lastBurst = useRef(burstId);
  const DUR = 0.35;

  useFrame((_, delta) => {
    if (!mesh.current || !mat.current) return;
    if (lastBurst.current !== burstId) {
      lastBurst.current = burstId;
      age.current = 0;
    }
    if (age.current >= DUR) {
      mesh.current.visible = false;
      return;
    }
    age.current += delta;
    const t = Math.min(age.current / DUR, 1);
    mesh.current.visible = true;
    const s = 0.3 + t * 1.1;
    mesh.current.scale.setScalar(s);
    mat.current.opacity = 0.55 * (1 - t);
  });

  return (
    <mesh ref={mesh} position={position} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.7, 1, 32]} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
