/**
 * F-05 acceptance 검증 (playwright)
 *  1. 서버 응답 이후에만 결과 연출 시작 — /draws에 지연 주입, 지연 동안 phase가
 *     연출 단계(spinning/dropping/...)로 넘어가지 않음을 단언
 *  2. 저사양 모드 — hardwareConcurrency=2 주입 → 그림자 오프(lowfx) 동작
 *  3. reduced-motion — 스핀/낙하 연출 생략, 결과 확인 흐름은 유지
 * 사용: node apps/web/scripts/verify-spin.mjs <스크린샷 출력디렉>
 * 전제: 웹 :3000, API :8000, 시드 머신 1(재고>0), 유저 1(코인 충분)
 */
import { chromium } from "playwright";

const OUT = process.argv[2] ?? ".";
const URL = "http://localhost:3000/machines/1";
const results = {};
const browser = await chromium.launch();

const phaseOf = (page) =>
  page.getAttribute('[data-testid="spin-stage"]', "data-phase");

// ── 1) 서버 응답 이후에만 연출 시작 ─────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const DELAY = 2000;
  await page.route("**/draws", async (route) => {
    await new Promise((r) => setTimeout(r, DELAY));
    await route.continue();
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="spin-button"]:not([disabled])');

  const before = await phaseOf(page);
  await page.click('[data-testid="spin-button"]');
  await page.waitForTimeout(300);
  const during1 = await phaseOf(page); // 응답 대기 초반
  await page.waitForTimeout(1200);
  const during2 = await phaseOf(page); // 응답 대기 후반 (아직 지연 중)
  await page.screenshot({ path: `${OUT}/spin-requesting.png` });
  // 응답 도착 후 연출 시작 대기
  await page.waitForFunction(
    () =>
      ["spinning", "dropping", "landed"].includes(
        document.querySelector('[data-testid="spin-stage"]')?.dataset.phase ?? "",
      ),
    { timeout: DELAY + 3000 },
  );
  const after = await phaseOf(page);
  await page.screenshot({ path: `${OUT}/spin-animating.png` });

  // 낙하 완료 → 탭 개봉 → 리빌 카드(정가 표기)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="spin-stage"]')?.dataset.phase === "landed",
    { timeout: 8000 },
  );
  await page.click('[data-testid="spin-stage"] canvas');
  await page.waitForSelector('[data-testid="reveal-card"]');
  const cardText = await page.innerText('[data-testid="reveal-card"]');
  await page.screenshot({ path: `${OUT}/spin-reveal.png` });

  results.animationAfterResponseOnly = {
    before, // idle
    duringDelay: [during1, during2], // 전부 requesting이어야 함
    afterResponse: after, // spinning|dropping
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
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="spin-stage"] canvas');
  results.lowFx = {
    lowfxAttr: await page.getAttribute('[data-testid="spin-stage"]', "data-lowfx"),
    canvasRendered: (await page.locator('[data-testid="spin-stage"] canvas').count()) > 0,
  };
  await page.screenshot({ path: `${OUT}/spin-lowfx.png` });
  await page.close();
}

// ── 3) reduced-motion 존중 ──────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="spin-button"]:not([disabled])');

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
    { timeout: 8000 },
  );
  await page.click('[data-testid="spin-stage"] canvas');
  await page.waitForSelector('[data-testid="reveal-card"]');
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
