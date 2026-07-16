---
paths:
  - "apps/web/**/*.ts"
  - "apps/web/**/*.tsx"
  - "packages/shared/**/*.ts"
---

# 프론트(Next.js + R3F) 규칙

- **결과를 결정하는 로직 금지.** 프론트는 서버 응답(results)을 받은 뒤 연출만 한다.
  Math.random()으로 등급/아이템을 정하는 코드가 보이면 그 자리에서 삭제하고 서버 호출로 교체.
- 상태는 zustand. 서버 데이터는 서버가 진실 — 확률/재고/잔액을 클라이언트에서 계산해 표시하지 않는다
  (표시용 파생값도 서버 응답 필드 사용).
- 등급 토큰(normal/rare/epic/secret)과 컬러는 packages/shared 상수만 사용. 하드코딩 금지.
- 3D: R3F + drei. 반복 캡슐은 <Instances>. 씬 에셋 예산 총 2MB, 초과 시 gltfjsx --transform 재압축.
- 저사양 대응: navigator.hardwareConcurrency/DPR 기준 그림자·후처리 오프, prefers-reduced-motion 존중.
- 모바일 375px 기준 레이아웃 우선. 스핀 버튼 등 조작부는 하단 safe-area 안에.
- 결제/스핀 화면에는 확률표 진입점이 항상 보여야 한다 (법적 가드 — 빼먹으면 출시 불가).
