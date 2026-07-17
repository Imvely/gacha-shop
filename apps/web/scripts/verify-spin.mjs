/**
 * F-05 acceptance 검증 (playwright)
 *  1. 서버 응답 이후에만 결과 연출 시작 — /draws에 지연 주입, 지연 동안 phase가
 *     연출 단계(spinning/dropping/...)로 넘어가지 않음을 단언
 *  2. 저사양 모드 — hardwareConcurrency=2 주입 → 그림자 오프(lowfx) 동작
 *  3. reduced-motion — 스핀/낙하 연출 생략, 결과 확인 흐름은 유지
 * 사용: node apps/web/scripts/verify-spin.mjs <스크린샷 출력디렉>
 * 전제: 웹 :3000, API :8000, 시드 머신 1(재고>0), 유저 1(코인 충분)
 *   코인 충전: docker exec gacha-test-pg psql -U postgres -d gacha_dev -c
 *     "INSERT INTO wallet_ledger (user_id, amount, reason, ref_type) VALUES (1, 100000, 'topup', 'dev')"
 *
 * ⚠ 헤드리스 크로뮴은 SwiftShader(소프트웨어 GL)라 transmission/블룸 셰이더 컴파일이
 *   수십 초 걸리고 초기 프레임이 검게 찍힐 수 있다 — 단언은 전부 페이지 내부 타임스탬프
 *   기반이라 영향 없지만, 스크린샷 화질 판단은 헤드풀(headless:false)로 할 것.
 */
import { chromium } from "playwright";

const OUT = process.argv[2] ?? ".";
const URL = "http://localhost:3000/machines/1";
const results = {};
const browser = await chromium.launch();

const phaseOf = (page) =>
  page.getAttribute('[data-testid="spin-stage"]', "data-phase");

// 웜업: dev 서버 첫 컴파일 + 셰이더 컴파일을 미리 치러 계측 왜곡 방지
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForSelector('[data-testid="spin-button"]:not([disabled])', {
    timeout: 120000,
  });
  await page.waitForTimeout(2000); // 첫 프레임 렌더/셰이더 컴파일 여유
  await page.close();
}

// ── 1) 서버 응답 이후에만 연출 시작 ─────────────────────────────────────
// 페이지 내부에서 fetch 완료·phase 변화의 벽시계 타임스탬프를 기록해 순서를 단언.
// (CDP 폴링은 소프트웨어 렌더링 등 메인스레드 부하 시 늦게 읽혀 왜곡될 수 있음)
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const DELAY = 2000;
  await page.route("**/draws", async (route) => {
    await new Promise((r) => setTimeout(r, DELAY));
    await route.continue();
  });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('[data-testid="spin-button"]:not([disabled])', {
    timeout: 60000,
  });

  await page.evaluate(() => {
    window.__tl = [];
    const el = document.querySelector('[data-testid="spin-stage"]');
    new MutationObserver(() =>
      window.__tl.push({ ev: "phase", phase: el.dataset.phase, t: Date.now() }),
    ).observe(el, { attributes: true, attributeFilter: ["data-phase"] });
    const orig = window.fetch;
    window.fetch = (...args) =>
      orig(...args).then((r) => {
        if (String(args[0]).includes("/draws"))
          window.__tl.push({ ev: "draw-response", t: Date.now() });
        return r;
      });
  });

  const before = await phaseOf(page);
  await page.click('[data-testid="spin-button"]');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="spin-stage"]')?.dataset.phase === "landed",
    null,
    { timeout: 120000 },
  );
  await page.screenshot({ path: `${OUT}/spin-animating.png` });

  const tl = await page.evaluate(() => window.__tl);
  const responseAt = tl.find((e) => e.ev === "draw-response")?.t ?? Infinity;
  const fxPhases = ["spinning", "dropping", "landed", "opening"];
  const phasesBeforeResponse = tl
    .filter((e) => e.ev === "phase" && e.t <= responseAt)
    .map((e) => e.phase);
  const firstFxAt = tl.find((e) => e.ev === "phase" && fxPhases.includes(e.phase))?.t;

  // 탭 개봉 → 리빌 카드(정가 표기)
  await page.click('[data-testid="spin-stage"] canvas');
  await page.waitForSelector('[data-testid="reveal-card"]', { timeout: 30000 });
  const cardText = await page.innerText('[data-testid="reveal-card"]');
  await page.screenshot({ path: `${OUT}/spin-reveal.png` });

  results.animationAfterResponseOnly = {
    before, // idle
    phasesBeforeResponse, // ["requesting"]만 있어야 함 — 응답 전 연출 단계 0건
    animationStartedAfterResponse: firstFxAt !== undefined && firstFxAt >= responseAt,
    revealHasRetailPrice: /정가 [\d,]+원/.test(cardText),
  };
  await page.close();
}

// ── 2) 저사양 모드 (그림자 오프) ────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 2 });
  });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('[data-testid="spin-stage"] canvas[data-shadows]', {
    timeout: 60000,
  });
  results.lowFx = {
    lowfxAttr: await page.getAttribute('[data-testid="spin-stage"]', "data-lowfx"),
    rendererShadowsEnabled: await page.getAttribute(
      '[data-testid="spin-stage"] canvas',
      "data-shadows",
    ), // "false"여야 함 — WebGL 렌더러의 실제 shadowMap 상태
  };
  await page.screenshot({ path: `${OUT}/spin-lowfx.png` });
  await page.close();
}

// ── 2b) 대조군: 일반 사양에선 그림자 켜짐 ──────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('[data-testid="spin-stage"] canvas[data-shadows]', {
    timeout: 60000,
  });
  results.normalFx = {
    lowfxAttr: await page.getAttribute('[data-testid="spin-stage"]', "data-lowfx"),
    rendererShadowsEnabled: await page.getAttribute(
      '[data-testid="spin-stage"] canvas',
      "data-shadows",
    ), // "true"여야 함
  };
  await page.close();
}

// ── 3) reduced-motion 존중 ──────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('[data-testid="spin-button"]:not([disabled])', {
    timeout: 60000,
  });

  const reducedAttr = await page.getAttribute(
    '[data-testid="spin-stage"]',
    "data-reduced",
  );
  const seenPhases = [];
  await page.exposeFunction("recordPhase", (p) => seenPhases.push(p));
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="spin-stage"]');
    new MutationObserver(() => window.recordPhase(el.dataset.phase)).observe(el, {
      attributes: true,
      attributeFilter: ["data-phase"],
    });
  });
  await page.click('[data-testid="spin-button"]');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="spin-stage"]')?.dataset.phase === "landed",
    null,
    { timeout: 60000 },
  );
  await page.click('[data-testid="spin-stage"] canvas');
  await page.waitForSelector('[data-testid="reveal-card"]', { timeout: 30000 });
  await page.screenshot({ path: `${OUT}/spin-reduced.png` });

  results.reducedMotion = {
    reducedAttr, // "true"
    seenPhases, // spinning/dropping이 없어야 함
    skippedSpinAnimation:
      !seenPhases.includes("spinning") && !seenPhases.includes("dropping"),
    revealReached: true,
  };
  await page.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
