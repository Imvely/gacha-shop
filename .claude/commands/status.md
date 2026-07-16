---
description: 프로젝트 현황 대시보드 — 페이즈/기능 진행률, 최근 커밋, 다음 할 일을 한눈에
disable-model-invocation: true
---

# /status — 현황 브리핑

읽기만 하고 아무것도 수정하지 마라.

## 컨텍스트

- 상태 파일: @STATE.md
- 기능 백로그: @features.json
- 브랜치/워킹트리: !`git status -sb`
- 최근 커밋 10개: !`git log --oneline -10 2>/dev/null || echo "(no commits yet)"`

## 출력 형식

1. **진행률**: phase별 done/in_progress/todo 개수 (예: P1 — done 2 · 진행 1 · 대기 5)
2. **지금 하는 것**: in_progress 기능과 남은 acceptance 항목
3. **다음 3개**: 우선순위순 다음 할 일
4. **경고**: 워킹트리에 커밋 안 된 변경, 로그와 실제 코드의 불일치 등 발견 시
