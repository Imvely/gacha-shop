---
description: features.json의 기능 하나를 처음부터 끝까지 진행 (in_progress → 구현 → acceptance 검증 → done)
argument-hint: F-04 (기능 id)
---

# /feature — 기능 단위 작업 워크플로

대상 기능: **$ARGUMENTS** (비어 있으면 STATE.md와 features.json을 보고 다음 우선순위 기능을 스스로 골라라)

## 컨텍스트

- 기능 백로그: @features.json
- 프로젝트 상태: @STATE.md

## 수행 순서

1. **착수**: features.json에서 해당 기능의 status를 `in_progress`로 갱신.
   desc와 acceptance 배열을 정독하고, acceptance를 "검증 가능한 체크리스트"로 옮겨 적어라.

2. **계획**: 구현 단계를 TaskCreate로 등록. 스키마 변경이 필요하면
   Alembic 마이그레이션 + docs/schema.sql 주석 동기화를 반드시 계획에 포함 (CLAUDE.md 8절).

3. **구현**: CLAUDE.md 절대 원칙 준수. 특히 —
   - 추첨/결제/재고 로직은 서버에서만, 단일 트랜잭션(`SELECT ... FOR UPDATE`)
   - 프론트는 서버 결과의 연출만 담당
   - UI 문구는 docs/copy.md 톤 (파일이 있으면)

4. **중간 커밋**: 구현이 동작 단위로 완성될 때마다 `[F-xx]` 포함 메시지로 커밋하라.
   더러운 워킹트리로 다음 단계로 넘어가지 마라.

5. **완료 판정은 /done으로**: 구현이 끝났다고 판단되면 `/done F-xx` 게이트를 수행하라
   (.claude/commands/done.md의 절차). status를 `done`으로 바꾸는 유일한 경로다.
   acceptance 배열을 수정해서 통과시키는 것은 금지.
