"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CameraShake,
  ContactShadows,
  Environment,
  Instance,
  Instances,
  Lightformer,
  MeshTransmissionMaterial,
  Preload,
  Sparkles,
  Trail,
} from "@react-three/drei";
import type { ShakeController } from "@react-three/drei";
import { easing } from "maath";
import * as THREE from "three";
import { RARITY_TOKENS, type Rarity } from "@pong/shared";

import { useSpinStore } from "@/stores/spinStore";
import { sfx } from "@/lib/sfx";
import { haptic } from "@/lib/haptics";
import { ParticleBurst } from "./effects/ParticleBurst";
import { ImpactRing } from "./effects/ImpactRing";

/**
 * 프리미티브 가챠 머신 (v1 — Blender glb 준비 시 이 컴포넌트만 교체).
 *
 * 연출 기법 (리서치 기반):
 *  - trauma² 회전 셰이크 (Eiserloh GDC 2016): 스핀 중 기계가 "일하는" 진동
 *  - 히트스톱 70ms + 스쿼시&스트레치(1.3,0.6) + 충격 링 + 파티클 (Vlambeer)
 *  - 정직한 등급 예고: 낙하 캡슐 글로우 = 서버 결과의 실제 등급 색 (가짜 니어미스 금지)
 *  - 에픽 이상은 낙하 20~35% 감속, 시크릿은 미드슈트 0.3s 홀드(서스펜스 비트)
 *  - 개봉: 뚜껑이 elastic overshoot로 튀어오르고 반신은 팔로스루
 * 저사양(lowFx): transmission·파티클·트레일·셰이크 오프 / reduced-motion: 연출 자체 생략
 */

const SPIN_DURATION = 1.1;
const HIT_STOP = 0.07; // 70ms (리서치: 60~80ms가 "묵직한" 이벤트)
const OPEN_DURATION = 0.5;

const DROP_PATH = [
  new THREE.Vector3(0, 1.55, 0),
  new THREE.Vector3(0, 0.85, 0.7),
  new THREE.Vector3(0, 0.62, 1.25),
  new THREE.Vector3(0, 0.42, 1.5),
];
const TRAY = DROP_PATH[3];

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const bounceOut = (t: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
// back.out(1.7) 상당 — 뚜껑 오버슈트
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

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
const RARITY_ORDER: Rarity[] = ["normal", "rare", "epic", "secret"];

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
  const capTopRef = useRef<THREE.Mesh>(null);
  const capGlowRef = useRef<THREE.MeshStandardMaterial>(null);
  const shakeRef = useRef<ShakeController>(null);

  const phaseTimer = useRef(0);
  const trauma = useRef(0); // trauma² 셰이크 (기계 자체의 회전 진동)
  const hitStop = useRef(0);
  const squash = useRef(0); // 1 = 최대 스쿼시 → 0으로 감쇠
  const wobbleT = useRef(-1); // 착지 후 감쇠 진동 시계 (-1 = 비활성)
  const holdTimer = useRef(0); // 시크릿 미드슈트 홀드
  const holdDone = useRef(false);
  const ratchetAcc = useRef(0);
  const [burstId, setBurstId] = useState(0);
  const [burstColor, setBurstColor] = useState("#FFD166");

  const pile = usePileLayout();

  const rarity: Rarity = useMemo(() => {
    if (!results?.length) return "normal";
    return results.reduce((a, b) =>
      RARITY_ORDER.indexOf(b.rarity) > RARITY_ORDER.indexOf(a.rarity) ? b : a,
    ).rarity;
  }, [results]);
  const rarityColor = RARITY_TOKENS[rarity].color;
  const slowDrop = rarity === "epic" || rarity === "secret";

  useEffect(() => {
    phaseTimer.current = 0;
    if (phase === "spinning") {
      sfx.spinStart();
      holdDone.current = false;
    }
    if (phase === "opening") {
      sfx.pop();
      haptic.pop();
      setBurstColor(rarityColor);
      setBurstId((b) => b + 1);
    }
    if (phase === "idle") {
      squash.current = 0;
      wobbleT.current = -1;
      trauma.current = 0;
    }
  }, [phase, rarityColor]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    const machine = machineRef.current;
    const knob = knobRef.current;
    const drop = dropRef.current;
    if (!machine || !knob || !drop) return;

    // ── 히트스톱: 임팩트 순간 모든 연출 정지 (착지의 "무게") ──────────
    if (hitStop.current > 0) {
      hitStop.current -= delta;
      return;
    }

    // ── trauma² 회전 셰이크 — 기계가 일하는 진동 (카메라 아님) ────────
    trauma.current = Math.max(0, trauma.current - delta * 1.6);
    const shake = trauma.current * trauma.current;
    machine.rotation.z = shake * 0.06 * Math.sin(t * 47);
    machine.rotation.x = shake * 0.04 * Math.sin(t * 39 + 1.7);
    machine.rotation.y = Math.sin(t * 0.4) * 0.05 + shake * 0.05 * Math.sin(t * 43);

    // 캡슐 무더기 — 평소 잔잔, 스핀 중 요동
    if (pileRef.current) {
      const amp = phase === "spinning" ? 0.07 : 0.012;
      pileRef.current.position.y = Math.sin(t * 6) * amp;
      if (phase === "spinning") pileRef.current.rotation.y += delta * 1.4;
      else easing.damp(pileRef.current.rotation, "y", 0, 0.4, delta);
    }

    if (phase === "spinning") {
      phaseTimer.current += delta;
      trauma.current = Math.min(1, trauma.current + delta * 1.2); // 지속 진동 축적
      knob.rotation.z -= delta * 13;
      // 라쳇 틱: 회전 20°마다
      ratchetAcc.current += delta * 13;
      if (ratchetAcc.current > 0.35) {
        ratchetAcc.current = 0;
        sfx.ratchet();
        haptic.tick();
      }
      if (phaseTimer.current >= SPIN_DURATION) {
        trauma.current = 0.55; // 배출 스파이크
        advance("spinning", "dropping");
      }
    } else if (phase === "idle") {
      easing.dampE(knob.rotation, [0, 0, 0], 0.25, delta); // 노브 스프링 복귀
    }

    if (phase === "dropping") {
      // 시크릿: 미드슈트 서스펜스 홀드 (정직한 예고 — 색은 이미 진짜 등급)
      if (holdTimer.current > 0) {
        holdTimer.current -= delta;
        const pulse = 1 + Math.sin(t * 30) * 0.12;
        drop.scale.setScalar(pulse);
        if (capGlowRef.current)
          capGlowRef.current.emissiveIntensity = 3 + Math.sin(t * 30) * 2;
        return;
      }
      const speed = slowDrop ? 0.62 : 0.85;
      const prev = phaseTimer.current;
      phaseTimer.current = Math.min(phaseTimer.current + delta * speed, 1);
      if (
        rarity === "secret" &&
        !holdDone.current &&
        prev < 0.5 &&
        phaseTimer.current >= 0.5
      ) {
        holdDone.current = true;
        holdTimer.current = 0.3;
      }
      const seg = phaseTimer.current * 3;
      const i = Math.min(Math.floor(seg), 2);
      const f = seg - i;
      drop.visible = true;
      drop.scale.setScalar(1);
      drop.position.lerpVectors(
        DROP_PATH[i],
        DROP_PATH[i + 1],
        i === 2 ? bounceOut(f) : easeOutCubic(f),
      );
      drop.rotation.x += delta * 7;

      if (phaseTimer.current >= 1) {
        // ★ 임팩트 프레임: 히트스톱 + 스쿼시 + 링 + 버스트 + 사운드 + 햅틱 + 캠셰이크
        if (!lowFx) hitStop.current = HIT_STOP;
        squash.current = 1;
        wobbleT.current = 0;
        sfx.thunk();
        haptic.impact();
        setBurstColor(rarityColor);
        setBurstId((b) => b + 1);
        shakeRef.current?.setIntensity(rarity === "secret" ? 1 : 0.35);
        if (rarity === "secret") haptic.secret();
        advance("dropping", "landed");
      }
    }

    if (phase === "landed") {
      drop.visible = true;
      drop.position.copy(TRAY);
      drop.rotation.y += delta * 1.2;

      // 스쿼시&스트레치: (1.3, 0.6) → 1 로 감쇠 (부피 보존 느낌)
      easing.damp(squash, "current", 0, 0.18, delta);
      const s = squash.current;
      const breathe = 1 + Math.sin(t * 5) * 0.035;
      drop.scale.set(breathe * (1 + 0.3 * s), breathe * (1 - 0.4 * s), breathe * (1 + 0.3 * s));

      // 착지 워블: A·e^(-4t)·sin(18t)
      if (wobbleT.current >= 0) {
        wobbleT.current += delta;
        const w = wobbleT.current;
        drop.rotation.z = 0.15 * Math.exp(-4 * w) * Math.sin(18 * w);
      }
      // 글로우 브리딩 (등급 색 — 블룸이 받아서 빛남)
      if (capGlowRef.current)
        capGlowRef.current.emissiveIntensity =
          rarity === "normal" ? 0 : 2.2 + Math.sin(t * 4) * 1.2;
    }

    if (phase === "opening") {
      phaseTimer.current += delta;
      const p = Math.min(phaseTimer.current / OPEN_DURATION, 1);
      drop.visible = true;
      // 뚜껑: elastic overshoot로 날아오르며 회전, 몸통은 살짝 가라앉는 팔로스루
      if (capTopRef.current) {
        capTopRef.current.position.y = easeOutBack(p) * 0.55;
        capTopRef.current.rotation.z = p * 2.4;
        capTopRef.current.position.x = p * 0.18;
      }
      drop.position.y = TRAY.y - p * 0.03;
      if (p >= 1) advance("opening", "opened");
    }

    if (phase === "idle" || phase === "opened") {
      drop.visible = false;
      drop.scale.setScalar(1);
      drop.rotation.z = 0;
      if (capTopRef.current) {
        capTopRef.current.position.set(0, 0, 0);
        capTopRef.current.rotation.z = 0;
      }
    }
  });

  const shadows = !lowFx;

  return (
    <group>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 6, 4]} intensity={1.0} castShadow={shadows} />
      <pointLight position={[-3, 2, 2]} intensity={8} color="#FF5FA2" />
      <pointLight position={[3, 1, 3]} intensity={6} color="#59E3C2" />

      {/* 프로시저럴 스튜디오 환경 — CDN 없이 번쩍이는 플라스틱 하이라이트 */}
      <Environment resolution={256}>
        <Lightformer intensity={4} position={[0, 3, 2]} scale={[4, 1, 1]} form="rect" />
        <Lightformer intensity={2} position={[-3, 1, -1]} scale={2} form="circle" color="#B07CFF" />
        <Lightformer intensity={1.5} position={[3, 2, 1]} scale={2} form="circle" color="#FF5FA2" />
      </Environment>

      {/* 원샷 카메라 셰이크 (회전 전용) — 착지/시크릿 임팩트 시 트리거 */}
      {!lowFx && (
        <CameraShake
          ref={shakeRef}
          intensity={0}
          decay
          decayRate={2.2}
          maxYaw={0.03}
          maxPitch={0.03}
          maxRoll={0.05}
          yawFrequency={9}
          pitchFrequency={8}
          rollFrequency={6}
        />
      )}

      <group ref={machineRef}>
        {/* 바디 + 네온 밴드 + 받침 */}
        <mesh position={[0, 0.75, 0]} castShadow={shadows}>
          <cylinderGeometry args={[1.05, 1.2, 1.5, 40]} />
          <meshStandardMaterial color="#FF5FA2" roughness={0.32} metalness={0.08} envMapIntensity={1.2} />
        </mesh>
        {/* 네온 밴드 — 블룸 임계값(1.0) 아래로 유지: 임계값 걸치면 스웨이 때마다
            블룸이 점멸해 번개처럼 번쩍인다 */}
        <mesh position={[0, 1.42, 0]}>
          <torusGeometry args={[1.06, 0.02, 12, 48]} />
          <meshStandardMaterial color="#FF5FA2" emissive="#FF5FA2" emissiveIntensity={0.8} />
        </mesh>
        <mesh position={[0, 0.11, 0]} receiveShadow={shadows}>
          <cylinderGeometry args={[1.3, 1.35, 0.22, 40]} />
          <meshStandardMaterial color="#2A2144" roughness={0.6} />
        </mesh>

        {/* 유리 돔 — 고사양: 리얼 굴절(transmission) / 저사양: 반투명 폴백 */}
        <mesh position={[0, 1.62, 0]}>
          <sphereGeometry args={[1.12, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
          {lowFx ? (
            <meshStandardMaterial
              color="#BFD8FF"
              transparent
              opacity={0.18}
              roughness={0.15}
              envMapIntensity={1.5}
              side={THREE.DoubleSide}
            />
          ) : (
            /* 얇고 맑은 유리: thickness·색수차·블러를 낮춰 캡슐이 또렷하게 비치도록 */
            <MeshTransmissionMaterial
              samples={4}
              resolution={384}
              transmission={1}
              thickness={0.12}
              roughness={0.02}
              chromaticAberration={0.015}
              anisotropicBlur={0.02}
              side={THREE.DoubleSide}
            />
          )}
        </mesh>
        <mesh position={[0, 1.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.09, 0.06, 14, 48]} />
          <meshStandardMaterial color="#FFF3E6" roughness={0.5} envMapIntensity={1} />
        </mesh>

        {/* 돔 속 은은한 반짝임 — 크고 밝으면 번개처럼 보인다 */}
        {!lowFx && (
          <Sparkles
            count={12}
            position={[0, 1.8, 0]}
            scale={[1.1, 0.5, 1.1]}
            size={0.9}
            speed={0.25}
            opacity={0.45}
            color="#DCE6FF"
          />
        )}
        {/* 돔 내부 보조광 — 캡슐 무더기 가시성 (과하면 중앙이 하얗게 탄다) */}
        <pointLight position={[0, 2.35, 0.3]} intensity={0.9} distance={2.4} color="#FFF6E8" />

        {/* 배출구 + 트레이 */}
        <mesh position={[0, 0.62, 1.181]}>
          <circleGeometry args={[0.26, 24]} />
          <meshStandardMaterial color="#2A2144" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.28, 1.28]} rotation={[0, -Math.PI / 2, 0]}>
          <cylinderGeometry args={[0.42, 0.5, 0.14, 28, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#59E3C2" roughness={0.4} envMapIntensity={1.2} />
        </mesh>

        {/* 레버(노브) */}
        <group ref={knobRef} position={[0, 1.0, 1.2]} name="knob">
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.12, 28]} />
            <meshStandardMaterial color="#FFF3E6" roughness={0.5} envMapIntensity={1} />
          </mesh>
          <mesh position={[0, 0, 0.07]}>
            <boxGeometry args={[0.62, 0.16, 0.14]} />
            <meshStandardMaterial color="#59E3C2" roughness={0.4} envMapIntensity={1.2} />
          </mesh>
        </group>

        {/* 캡슐 무더기 — Instances 2드로우콜 */}
        <group ref={pileRef}>
          <Instances limit={pile.length}>
            <sphereGeometry args={[0.155, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial roughness={0.28} envMapIntensity={1.3} />
            {pile.map((c, i) => (
              <Instance key={i} position={[...c.position]} rotation={[...c.rotation]} color={c.color} />
            ))}
          </Instances>
          <Instances limit={pile.length}>
            <sphereGeometry args={[0.155, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
            <meshStandardMaterial color="#FFFDF7" roughness={0.32} envMapIntensity={1.1} />
            {pile.map((c, i) => (
              <Instance key={i} position={[...c.position]} rotation={[...c.rotation]} />
            ))}
          </Instances>
        </group>
      </group>

      {/* 배출 캡슐 — 글로우 색 = 서버 결과의 실제 등급 (정직한 예고).
          Trail은 낙하 중에만 마운트 (첫 로드 셰이더 부하 절감) */}
      <group ref={dropRef} visible={false}>
        {!lowFx && phase === "dropping" && (
          <Trail width={1.6} length={4} decay={1.5} color={rarityColor} attenuation={(w) => w * w}>
            <group />
          </Trail>
        )}
        <mesh ref={capTopRef} castShadow={shadows}>
          <sphereGeometry args={[0.2, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            ref={capGlowRef}
            color={rarityColor}
            emissive={rarityColor}
            emissiveIntensity={!lowFx && rarity !== "normal" ? 2.5 : 0}
            toneMapped={false}
            roughness={0.25}
            envMapIntensity={1.4}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.2, 20, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#FFFDF7" roughness={0.32} envMapIntensity={1.1} />
        </mesh>
      </group>

      {/* 임팩트 이펙트 (저사양 오프) */}
      {!lowFx && (
        <>
          <ParticleBurst
            burstId={burstId}
            origin={[TRAY.x, TRAY.y + 0.05, TRAY.z]}
            color={burstColor}
            count={rarity === "secret" ? 34 : rarity === "epic" ? 22 : 12}
            speed={rarity === "secret" ? 3.2 : 2.2}
          />
          <ImpactRing burstId={burstId} position={[TRAY.x, 0.02, TRAY.z]} color={burstColor} />
          <ContactShadows frames={1} position={[0, 0.01, 0]} opacity={0.5} scale={5} blur={2.2} far={2} />
        </>
      )}

      {/* 바닥 */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <circleGeometry args={[2.6, 48]} />
        <meshStandardMaterial color="#1B1830" roughness={0.9} />
      </mesh>
    </group>
  );
}
