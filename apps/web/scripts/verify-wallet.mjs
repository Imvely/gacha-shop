/**
 * F-02 지갑 충전 플로우 E2E — 인텐트 생성 → (Fake PG) 웹훅 확정 → 잔액 반영
 * 사용: node apps/web/scripts/verify-wallet.mjs
 * 전제: 웹 :3000, API :8000 (PG_PROVIDER=fake)
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
await page.goto("http://localhost:3000/wallet", {
  waitUntil: "networkidle",
  timeout: 120000,
});
await page.waitForFunction(
  () => document.querySelector('[data-testid="wallet-balance"]')?.textContent !== "—",
  null,
  { timeout: 30000 },
);

const readBalance = async () =>
  parseInt(
    (await page.innerText('[data-testid="wallet-balance"]')).replace(/[^\d]/g, ""),
    10,
  );

const before = await readBalance();
await page.click('[data-testid="package-starter"]'); // 500코인
await page.waitForSelector('[data-testid="wallet-notice"]', { timeout: 30000 });
await page.waitForFunction(
  (prev) => {
    const el = document.querySelector('[data-testid="wallet-balance"]');
    return parseInt((el?.textContent ?? "0").replace(/[^\d]/g, ""), 10) !== prev;
  },
  before,
  { timeout: 15000 },
);
const after = await readBalance();

console.log(JSON.stringify({ before, after, credited: after - before }));
await browser.close();
