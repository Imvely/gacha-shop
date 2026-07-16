---
paths:
  - "apps/api/**/*.py"
---

# 백엔드(FastAPI) 규칙

- 도메인별 라우터 분리: auth / machines / draws / wallet / shipments / admin
- 모든 요청/응답 스키마는 Pydantic 모델로. dict 반환 금지 — OpenAPI에서 packages/shared 타입이 생성되므로.
- 돈/재고/추첨 코드를 만지기 전에 money-safety 스킬을 호출해 체크리스트를 확인하라.
- DB 세션은 요청 스코프. 추첨 서비스는 하나의 세션·하나의 트랜잭션 안에서
  잠금(FOR UPDATE) → 추첨 → 차감 → draws/user_items/wallet_ledger 기록까지 완결한다.
- 에러 규약: 코인 부족 402, 재고 소진 409, 검증 실패 422. 에러 응답에도 절대 스택/시드 노출 금지.
- 스키마 변경 = Alembic 마이그레이션 생성 + docs/schema.sql 주석 동기화 (둘 중 하나만 하면 미완료).
- 테스트: 돈/재고 로직은 pytest 동시성 테스트(스레드 20개) 없이는 완료로 치지 않는다.
- 비밀키는 .env → pydantic-settings로만 로드. 코드/로그에 리터럴 금지.
