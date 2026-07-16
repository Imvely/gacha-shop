# STATE.md — 프로젝트 현재 상태 (세션 간 이어달리기 파일)

> 이 파일은 `/morning`이 가장 먼저 읽고, `/evening`이 마지막에 갱신한다.
> 항상 "지금 어디까지 왔고, 다음에 뭘 해야 하는지"만 짧게 유지한다. 히스토리는 docs/worklog/에.

## 현재 페이즈
P1 (MVP) — 프로젝트 셋업 단계. 아직 앱 코드 없음 (기획/스키마/프로토타입만 존재).

## 진행 중인 기능
- (없음) — features.json 전부 todo

## 다음에 할 일 (우선순위순)
1. 모노레포 스캐폴딩: apps/web (Next.js) + apps/api (FastAPI) + packages/shared
2. [F-04] 추첨 엔진 — 스키마가 이미 설계되어 있으므로 코어부터 (서버 추첨 = 절대 원칙 1)
3. [F-03] 머신 목록/상세 — 추첨 엔진 위에 얹기

## 막힌 것 / 결정 대기
- (없음)

## 마지막 세션 요약
- 2026-07-17: Claude Code 하네스 구축 (commands/skills/hooks/settings, worklog 체계)
