import { chromium } from "playwright";

const OUT = process.argv[2] ?? ".";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
});

// 1) 머신 목록
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/375-list.png`, fullPage: true });

// 가로 스크롤 발생 여부 (375px 레이아웃 정상성의 핵심 판정)
const listOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth
);

// 2) 머신 상세 (열린 머신)
await page.goto("http://localhost:3000/machines/1", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/375-detail.png`, fullPage: true });
const detailOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth
);

// 3) 확률표 모달 열기
await page.getByRole("button", { name: "확률표 보기" }).click();
await page.waitForSelector('[role="dialog"]');
await page.screenshot({ path: `${OUT}/375-odds-modal.png` });
const modalOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth
);

// 모달 안 확률 합계 텍스트 추출 (실데이터 100% 검증)
const totalText = await page
  .locator('[role="dialog"] tfoot td:last-child')
  .innerText();

// 4) 품절 머신 상세
await page.goto("http://localhost:3000/machines/3", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/375-soldout.png`, fullPage: true });

console.log(
  JSON.stringify({ listOverflow, detailOverflow, modalOverflow, oddsTotal: totalText })
);
await browser.close();
