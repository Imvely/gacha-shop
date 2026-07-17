"use client";

/**
 * 프로시저럴 사운드 — 오디오 파일 없이 오실레이터/노이즈로 합성 (용량 0).
 * 레시피 출처: 리서치 (valdemird game-feel, dev.to procedural audio):
 *  - 클릭 = 짧은 사각파 + 매 인스턴스 ±4% 디튠(로봇 느낌 방지)
 *  - 떨어지는 '텅' = 아래로 글라이드하는 사인파 + 로우패스 노이즈 슬랩
 *  - 팡파레 = 삼각파 아르페지오, 등급이 높을수록 음 수·상승폭 증가
 * AudioContext는 첫 사용자 제스처에서 생성/재개 (자동재생 정책).
 */

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
  if (typeof localStorage !== "undefined") localStorage.setItem("pong-muted", m ? "1" : "0");
}

export function isMuted() {
  if (typeof localStorage !== "undefined" && localStorage.getItem("pong-muted") === "1")
    muted = true;
  return muted;
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  vol = 0.06,
  glideTo?: number,
) {
  const c = ac();
  if (!c || muted) return;
  const o = c.createOscillator();
  const g = c.createGain();
  const detune = 1 + (Math.random() - 0.5) * 0.08; // ±4% — 생동감
  o.type = type;
  o.frequency.setValueAtTime(freq * detune, c.currentTime);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

function noiseBurst(dur: number, cutoff: number, vol = 0.12) {
  const c = ac();
  if (!c || muted) return;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(lp).connect(g).connect(c.destination);
  src.start();
}

export const sfx = {
  /** 레버 드르륵 틱 */
  ratchet: () => tone(2300, 0.02, "square", 0.05),
  /** 스핀 시작 삑-뽁 */
  spinStart: () => {
    tone(520, 0.06);
    setTimeout(() => tone(760, 0.06), 110);
  },
  /** 캡슐 착지 '텅' — 사인 글라이드 + 플라스틱 슬랩 */
  thunk: () => {
    tone(160, 0.09, "sine", 0.28, 55);
    noiseBurst(0.02, 800, 0.18);
  },
  /** 개봉 '팡' */
  pop: () => {
    noiseBurst(0.01, 1800, 0.15);
    tone(300, 0.05, "sine", 0.12, 900);
  },
  /** 등급 팡파레 — 높을수록 화려하게 */
  fanfare: (rarity: string) => {
    const seq: Record<string, number[]> = {
      normal: [523],
      rare: [523, 784],
      epic: [523, 659, 784],
      secret: [523, 659, 784, 1046],
    };
    (seq[rarity] ?? seq.normal).forEach((f, i) => {
      setTimeout(() => {
        tone(f, 0.14, "triangle", 0.07);
        if (rarity === "secret") tone(f * 2, 0.14, "triangle", 0.025); // 시머 레이어
      }, i * 75);
    });
  },
};
