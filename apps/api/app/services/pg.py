"""PG(결제 게이트웨이) 추상화 레이어 — CLAUDE.md 3절.

원칙: 결제 확정은 "우리 서버가 PG 서버에 직접 조회한 결과"로만 한다.
웹훅 payload든 프론트 콜백이든, 외부에서 온 값은 검증의 트리거일 뿐 근거가 아니다.

- PortOnePgClient: 실 연동(포트원 V2 REST). API 키가 설정된 환경에서만 사용.
  TODO(실 키 발급 후): GET /payments/{id} 조회 + 웹훅 서명 검증 구현.
- FakePgClient: 개발/테스트용 인메모리 PG. settings.pg_provider == "fake"일 때 사용.
"""
from dataclasses import dataclass
from typing import Protocol

from app.config import settings


@dataclass(frozen=True)
class PgVerification:
    status: str  # "paid" | "cancelled" | "pending" | "failed"
    amount_krw: int


class PgClient(Protocol):
    def verify(self, pg_tx_id: str) -> PgVerification:
        """PG 서버에 거래 상태를 직접 조회한다."""
        ...


class FakePgClient:
    """개발/테스트용 — 테스트가 거래 상태를 심어두면 verify가 그대로 돌려준다."""

    def __init__(self) -> None:
        self._transactions: dict[str, PgVerification] = {}

    def arm(self, pg_tx_id: str, status: str, amount_krw: int) -> None:
        self._transactions[pg_tx_id] = PgVerification(status=status, amount_krw=amount_krw)

    def verify(self, pg_tx_id: str) -> PgVerification:
        return self._transactions.get(pg_tx_id, PgVerification(status="failed", amount_krw=0))


class PortOnePgClient:
    """실 포트원 연동 — 키 설정 전까지는 사용 불가로 명시적 실패."""

    def verify(self, pg_tx_id: str) -> PgVerification:
        raise NotImplementedError(
            "포트원 실 연동은 API 키 발급 후 구현 (PORTONE_API_SECRET). "
            "그 전까지는 PG_PROVIDER=fake로 개발한다."
        )


_fake_singleton = FakePgClient()


def get_pg_client() -> PgClient:
    if settings.pg_provider == "fake":
        return _fake_singleton
    return PortOnePgClient()
