from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def begin_txn(db: Session):
    """명시적 트랜잭션 시작 — 직전 조회로 autobegin된 유휴 트랜잭션이 있으면 닫는다.

    돈/재고 서비스는 호출 전 미커밋 쓰기를 들고 있지 않는 것이 규약이다
    (조회만 있던 세션이므로 commit은 사실상 no-op).
    """
    if db.in_transaction():
        db.commit()
    return db.begin()
