# CLAUDE.md — 온라인 가챠샵 "PONG!" (가칭)

> 이 파일은 Claude Code가 이 저장소에서 작업할 때 항상 따라야 하는 프로젝트 헌법이다.
> 충돌 시 우선순위: 이 문서 > features.json > 개별 지시.

## 1. 프로젝트 한 줄 정의
"온라인에서 가챠를 **뽑는 경험**"을 파는 커머스. 유저가 3D 머신을 스핀 → 서버가 실물 재고에서
추첨 → 결과 리빌 → 보관함 적립 → 묶음배송. 전 머신 확률·잔여수량 공개가 브랜드 원칙.

## 2. 절대 원칙 (위반 금지)
1. **추첨은 반드시 서버에서.** 클라이언트(브라우저) 코드에서 결과를 결정하는 로직을 절대 작성하지 않는다.
   프론트는 서버가 준 결과를 "연출"만 한다.
2. **추첨 + 재고 차감 = 단일 트랜잭션.** PostgreSQL `SELECT ... FOR UPDATE`(행 잠금)로
   동시 뽑기 시 같은 재고가 두 번 나가는 것을 막는다. (schema.sql의 draw 프로시저 주석 참조)
3. **모든 추첨은 감사 로그를 남긴다.** seed_hash(사전 커밋), seed(사후 공개), 결과, 당시 재고 스냅샷.
4. **현금성 환급 기능 금지.** 중복템 처리 등 모든 보상은 코인/교환권 재화 내 순환만 허용. (사행성 차단선)
5. **확률·잔여수량은 항상 실데이터.** 하드코딩·과장 표기 금지. 확률 = item.stock / machine 총 stock.
6. **결제 금액·재고 등 돈과 관련된 값은 프론트에서 신뢰하지 않는다.** 항상 서버 재계산.

## 3. 스택
- FE: Next.js(App Router) + TypeScript + Tailwind + Framer Motion
- 3D: three.js — React 통합은 @react-three/fiber(R3F) + @react-three/drei
- BE: FastAPI(Python 3.11) + SQLAlchemy + PostgreSQL(Neon) / Redis(락·세션 캐시, 선택)
- 결제: 포트원(PortOne) — PG 추상화 레이어. 결제 검증은 서버 웹훅으로만 확정
- 배포: Vercel(FE) / Cloud Run(BE)

## 4. 저장소 구조
```
apps/web        # Next.js (페이지, 3D 씬, 상태: zustand)
apps/api        # FastAPI (도메인별 라우터: auth, machines, draws, wallet, shipments, admin)
packages/shared # 타입(OpenAPI 스키마에서 생성), 상수(등급/색상 토큰)
assets/blender  # .blend 원본 (git-lfs)
assets/models   # 최적화된 .glb (배포용)
docs/           # ADR(아키텍처 결정 기록)
```

## 5. 추첨 API 계약 (핵심 플로우)
```
POST /draws  { machine_id, count: 1|10 }
  1) 지갑 코인 차감 (부족 시 402)
  2) 트랜잭션 시작 → machine_items 행 잠금 → 잔여 stock 가중 추첨 count회
  3) stock 차감, draws 기록(seed_hash는 머신 회차 오픈 시 선공개된 값)
  4) 커밋 → { results: [{item, rarity, retail_price}], seed_reveal? }
프론트는 결과를 받은 뒤에 낙하/개봉 애니메이션을 재생한다. (연출은 결과의 후행)
```

## 6. 3D 에셋 파이프라인 (Blender → 웹)
1. **모델링(Blender):** 머신/캡슐. 로우폴리 유지 — Decimate 모디파이어로 감축,
   화면에 안 보이는 바닥면 폴리곤 삭제. 정적 조명·그림자는 텍스처 베이킹으로 미리 구움.
2. **내보내기:** File > Export > glTF 2.0. 텍스처가 Base64로 ~33% 부풀 수 있는 .gltf 대신
   단일 바이너리 **.glb** 사용. 모디파이어는 적용(apply) 후 내보낼 것.
3. **압축·변환:** `npx gltfjsx model.glb --transform --types`
   → Draco 압축 + 텍스처 1024 리사이즈 + WebP + 중복 제거로 70~90% 감량,
   R3F용 JSX 컴포넌트 자동 생성(메시 노드 접근 용이). 산출물 `*-transformed.glb`.
4. **성능 예산:** 씬 총 에셋 ≤ 2MB, 드로우콜 수백 이하. 반복되는 캡슐은
   drei의 <Instances>로 인스턴싱(같은 지오메트리 1드로우콜). 계측은 r3f-perf.
5. **로딩 UX:** useGLTF.preload + Suspense 스켈레톤. 저사양 기기는
   `navigator.hardwareConcurrency`/DPR 기준으로 그림자·후처리 자동 오프.
6. **v1 전략:** Blender 에셋 없이도 돌아가는 프리미티브(기본 도형) 씬을 먼저 구현
   (prototype/gacha-spin-prototype.html 참조). glb 교체는 컴포넌트 1개 스왑으로 가능하게 설계.

## 7. 등급(rarity) 토큰 — FE/BE 공통 상수
| key | 한글 | 컬러 | 연출 |
|---|---|---|---|
| normal | 노멀 | #9AA3B2 | 기본 |
| rare | 레어 | #5BA8FF | 블루 글로우 |
| epic | 에픽 | #B07CFF | 퍼플 파티클 |
| secret | 시크릿 | #FFC24D | 골드 폭죽 + 화면 진동 |

## 8. 작업 방식 (하네스 규칙)
- 기능 단위는 features.json의 id로 관리. 작업 시작 시 status를 in_progress로,
  acceptance 전 항목 통과 시 done으로 갱신하고 커밋 메시지에 `[F-xx]` 포함.
- 스키마 변경은 반드시 Alembic 마이그레이션 + schema.sql 주석 동기화.
- 돈/재고를 만지는 코드는 pytest 동시성 테스트(스레드 20개 동시 draw) 없이는 done 처리 금지.
- UI 문구는 docs/copy.md의 톤(친근·짧게·이모지 절제)을 따른다.
- 비밀키/PG 키는 .env로만. 코드·로그에 절대 노출 금지.

## 9. 하네스 (일일 워크플로)
- 세션 시작은 `/morning`(어제 로그+git log 대조 → 오늘 할 일 → 자동 진행),
  마감은 `/evening`(worklog 작성 → features/STATE 갱신 → 커밋·푸쉬 → 메모리 → 내일 계획).
  사용자가 슬래시 없이 "morning" / "evening" 한마디만 입력해도 해당 루틴을 그대로 수행한다.
- **STATE.md** = 현재 스냅샷(SessionStart 훅으로 자동 주입, 히스토리 금지).
  **docs/worklog/YYYY-MM-DD.md** = 히스토리. 기능 단위 작업은 `/feature F-xx`.
- features.json의 status를 `done`으로 바꾸는 유일한 경로는 **`/done` 게이트**다.
  **acceptance 배열을 수정·삭제·완화하거나 테스트를 지워서 통과시키는 것은 금지** —
  기준이 틀렸다고 판단되면 사용자에게 변경을 제안한다.
- 지갑/원장/결제/추첨/재고/교환 코드를 만지기 전에 `money-safety` 스킬을 확인한다.
- 로그·상태 파일의 주장은 git 커밋/실행 결과와 대조해서만 믿는다. (완료 = 증명된 것)

## 10. 법적 가드 (제품에 내장)
- 결제/스핀 화면에 확률표 진입점 상시 노출, 결과 화면에 "정가 OO원" 표기(최저 보장 각인)
- 1일/월 구매 한도 설정(기본값 존재, 유저 하향 조정 가능), 미성년자 고지
- 스핀 확정 = 청약 확정임을 약관·UI에서 이중 고지
