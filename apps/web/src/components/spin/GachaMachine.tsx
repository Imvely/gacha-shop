"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Instance, Instances } from "@react-three/drei";
import * as THREE from "three";
import { RARITY_TOKENS, type Rarity } from "@pong/shared";

import { useSpinStore } from "@/stores/spinStore";

/**
 * 프리미티브 가챠 머신 (v1 전략 — CLAUDE.md 6절).
 * Blender glb가 준비되면 이 컴포넌트 하나만 gltfjsx 산출물로 교체한다.
 * 인터페이스(스토어 연동·낙하 경로·탭 개봉)는 그대로 유지.
 */

const SPIN_DURATION = 1.1;

// 낙하 경로: 돔 중심 → 바디 내부 → 배출구 → 트레이 (프로토타입 키프레임)
const DROP_PATH = [
  new THREE.Vector3(0, 1.55, 0),
  new THREE.Vector3(0, 0.85, 0.7),
  new THREE.Vector3(0, 0.62, 1.25),
  new THREE.Vector3(0, 0.42, 1.5),
];

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const bounceOut = (t: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

// 시드 고정 의사난수 — 캡슐 "배치"만 결정한다 (추첨 결과와 무관, 결과는 항상 서버가 결정)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAPSULE_COLORS = ["#FF5FA2", "#59E3C2", "#FFD166", "#5BA8FF", "#B07CFF"];

function usePileLayout(count = 24) {
  return useMemo(() => {
    const rand = mulberry32(20260717);
    return Array.from({ length: count }, (_, i) => {
      const a = rand() * Math.PI * 2;
      const rad = rand() * 0.72;
      return {
        position: [Math.cos(a) * rad, 1.7 + rand() * 0.32, Math.sin(a) * rad] as const,
        rotation: [rand() * 3, rand() * 3, 0] as const,
        color: CAPSULE_COLORS[i % CAPSULE_COLORS.length],
      };
    });
  }, [count]);
}

export function GachaMachine() {
  const phase = useSpinStore((s) => s.phase);
  const results = useSpinStore((s) => s.results);
  const lowFx = useSpinStore((s) => s.lowFx);
  const advance = useSpinStore((s) => s.advance);

  const machineRef = useRef<THREE.Group>(null);
  const knobRef = useRef<THREE.Group>(null);
  const pileRef = useRef<THREE.Group>(null);
  const dropRef = useRef<THREE.Group>(null);
  const phaseTimer = useRef(0);
  const pile = usePileLayout();
  const { invalidate } = useThree();

  // 배출 캡슐 색 = 서버 결과의 최고 등급 컬러 (shared 토큰만 사용)
  const dropColor = useMemo(() => {
    if (!results?.length) return CAPSULE_COLORS[0];
    const order: Rarity[] = ["normal", "rare", "epic", "secret"];
    const best = results.reduce((a, b) =>
      order.indexOf(b.rarity) > order.indexOf(a.rarity) ? b : a,
    );
    return RARITY_TOKENS[best.rarity].color;
  }, [results]);

  useEffect(() => {
    phaseTimer.current = 0;
    invalidate();
  }, [phase, invalidate]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    const machine = machineRef.current;
    const knob = knobRef.current;
    const drop = dropRef.current;
    if (!machine || !knob || !drop) return;

    // 살아있는 느낌의 아이들 모션
    machine.rotation.y = Math.sin(t * 0.4) * 0.05;
    if (pileRef.current) {
      const amp = phase === "spinning" ? 0.06 : 0.012;
      pileRef.current.position.y = Math.sin(t * 6) * amp;
      if (phase === "spinning") pileRef.current.rotation.y += delta * 1.2;
    }

    if (phase === "spinning") {
      phaseTimer.current += delta;
      knob.rotation.z -= delta * 13;
      machine.position.x = Math.sin(t * 40) * 0.02;
      if (phaseTimer.current >= SPIN_DURATION) {
        machine.position.x = 0;
        advance("spinning", "dropping");
      }
    } else {
      machine.position.x = 0;
    }

    if (phase === "dropping") {
      phaseTimer.current = Math.min(phaseTimer.current + delta * 0.85, 1);
      const seg = phaseTimer.current * 3;
      const i = Math.min(Math.floor(seg), 2);
      const f = seg - i;
      drop.visible = true;
      drop.position.lerpVectors(
        DROP_PATH[i],
        DROP_PATH[i + 1],
        i === 2 ? bounceOut(f) : easeOutCubic(f),
      );
      drop.rotation.x += delta * 6;
      if (phaseTimer.current >= 1) advance("dropping", "landed");
    }

    if (phase === "landed") {
      drop.visible = true;
      drop.position.copy(DROP_PATH[3]);
      drop.rotation.y += delta * 1.2;
      drop.scale.setScalar(1 + Math.sin(t * 5) * 0.04);
    }

    if (phase === "idle" || phase === "opened") {
      drop.visible = false;
      drop.scale.setScalar(1);
    }
  });

  const shadows = !lowFx;

  return (
    <group>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow={shadows} />
      <pointLight position={[-3, 2, 2]} intensity={8} color="#FF5FA2" />
      <pointLight position={[3, 1, 3]} intensity={6} color="#59E3C2" />

      <group ref={machineRef}>
        {/* 바디 + 받침 */}
        <mesh position={[0, 0.75, 0]} castShadow={shadows}>
          <cylinderGeometry args={[1.05, 1.2, 1.5, 40]} />
          <meshStandardMaterial color="#FF5FA2" roughness={0.35} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.11, 0]} receiveShadow={shadows}>
          <cylinderGeometry args={[1.3, 1.35, 0.22, 40]} />
          <meshStandardMaterial color="#2A2144" roughness={0.6} />
        </mesh>

        {/* 유리 돔 + 테두리 링 */}
        <mesh position={[0, 1.62, 0]}>
          <sphereGeometry args={[1.12, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
          <meshStandardMaterial
            color="#BFD8FF"
            transparent
            opacity={0.16}
            roughness={0.1}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 1.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.09, 0.06, 14, 48]} />
          <meshStandardMaterial color="#FFF3E6" roughness={0.5} />
        </mesh>

        {/* 배출구 + 트레이 */}
        <mesh position={[0, 0.62, 1.181]}>
          <circleGeometry args={[0.26, 24]} />
          <meshStandardMaterial color="#2A2144" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.28, 1.28]} rotation={[0, -Math.PI / 2, 0]}>
          <cylinderGeometry args={[0.42, 0.5, 0.14, 28, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#59E3C2" roughness={0.4} />
        </mesh>

        {/* 레버(노브): 드래그로 회전 */}
        <group ref={knobRef} position={[0, 1.0, 1.2]} name="knob">
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.12, 28]} />
            <meshStandardMaterial color="#FFF3E6" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.07]}>
            <boxGeometry args={[0.62, 0.16, 0.14]} />
            <meshStandardMaterial color="#59E3C2" roughness={0.4} />
          </mesh>
        </group>

        {/* 돔 속 캡슐 무더기 — Instances로 2드로우콜(위 반구 컬러 + 아래 반구 화이트) */}
        <group ref={pileRef}>
          <Instances limit={pile.length}>
            <sphereGeometry args={[0.155, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial roughness={0.3} />
            {pile.map((c, i) => (
              <Instance key={i} position={[...c.position]} rotation={[...c.rotation]} color={c.color} />
            ))}
          </Instances>
          <Instances limit={pile.length}>
            <sphereGeometry args={[0.155, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
            <meshStandardMaterial color="#FFFDF7" roughness={0.35} />
            {pile.map((c, i) => (
              <Instance key={i} position={[...c.position]} rotation={[...c.rotation]} />
            ))}
          </Instances>
        </group>
      </group>

      {/* 배출 연출 캡슐 — 색은 서버 결과 등급에서만 나온다 */}
      <group ref={dropRef} visible={false}>
        <mesh castShadow={shadows}>
          <sphereGeometry args={[0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={dropColor} roughness={0.3} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.2, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#FFFDF7" roughness={0.35} />
        </mesh>
      </group>

      {/* 바닥 (그림자 받이) */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <circleGeometry args={[2.6, 48]} />
        <meshStandardMaterial color="#1B1830" roughness={0.9} />
      </mesh>
    </group>
  );
}
