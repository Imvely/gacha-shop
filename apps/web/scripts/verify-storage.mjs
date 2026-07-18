/**
 * F-06 보관함/배송 E2E — 선택 → 배송 신청(N개→1건) → 주소 변경(출고 전)
 * 사용: node apps/web/scripts/verify-storage.mjs <스크린샷 출력디렉>
 * 전제: 웹 :3000, API :8000, 유저 1의 보관함에 stored 아이템 ≥ 2
 */
import { chromium } from "playwright";

const OUT = process.argv[2] ?? ".";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
await page.goto("http://localhost:3000/storage", {
  waitUntil: "networkidle",
  timeout: 120000,
});
await page.waitForSelector('[data-testid^="storage-item-"]', { timeout: 30000 });

// 아이템 2개 선택 → 주소 입력 → 신청
const cards = page.locator('[data-testid^="storage-item-"]');
await cards.nth(0).click();
await cards.nth(1).click();
await page.fill('[data-testid="addr-recipient"]', "임다영");
await page.fill('[data-testid="addr-phone"]', "010-1234-5678");
await page.fill('[data-testid="addr-postcode"]', "04524");
await page.fill('[data-testid="addr-address1"]', "서울시 중구 세종대로 110");
await page.click('[data-testid="ship-submit"]');
await page.waitForSelector('[data-testid^="shipment-"]', { timeout: 30000 });
await page.screenshot({ path: `${OUT}/storage-shipped.png`, fullPage: true });

const shipmentText = await page.innerText('[data-testid^="shipment-"]');

// 주소 변경 (requested 상태 — 출고 전이므로 허용)
const editBtn = page.locator('[data-testid^="edit-address-"]').first();
await editBtn.click();
await page.fill('[data-testid="addr-address1"]', "부산시 해운대구 우동 123");
await page.click('[data-testid^="save-address-"]');
await page.waitForFunction(
  () =>
    document
      .querySelector('[data-testid^="shipment-"]')
      ?.textContent?.includes("부산시 해운대구"),
  null,
  { timeout: 15000 },
);
await page.screenshot({ path: `${OUT}/storage-address-changed.png`, fullPage: true });

console.log(
  JSON.stringify({
    shipmentCreated: /신청됨/.test(shipmentText),
    itemCount2: /2개/.test(shipmentText),
    addressChanged: true,
  }),
);
await browser.close();
