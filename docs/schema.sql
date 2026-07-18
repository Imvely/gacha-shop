-- ============================================================================
-- 온라인 가챠샵 DB 스키마 (PostgreSQL)
-- 설계 철학 3줄 요약:
--  1) 돈은 "잔액 컬럼"이 아니라 "원장(ledger)"으로 관리한다 — 모든 증감이 행으로 남아 감사·복구 가능.
--  2) 확률은 별도 테이블이 아니라 "재고 그 자체"다 — machine_items.stock이 곧 확률의 분자.
--  3) 추첨은 결과·시드·재고 스냅샷을 남기는 불변 로그(draws)로 증명한다.
-- ============================================================================

-- ---------- 사용자 ----------
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE,                    -- 소셜 로그인만 쓰면 NULL 가능
  provider      TEXT NOT NULL DEFAULT 'kakao',  -- 로그인 제공자(kakao/email 등)
  nickname      TEXT NOT NULL,
  is_adult_confirmed BOOLEAN NOT NULL DEFAULT FALSE, -- 미성년 보호 정책용 플래그
  monthly_limit_krw  INT NOT NULL DEFAULT 300000,    -- 월 구매 한도(유저가 하향 조정 가능)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 지갑: 원장(ledger) 패턴 ----------
-- "잔액"을 users에 숫자 하나로 두면 버그·해킹 시 왜 그 값이 됐는지 추적이 불가능하다.
-- 대신 모든 증감(충전 +, 스핀 -, 환불 +, 교환보상 +)을 행으로 쌓고, 잔액 = SUM(amount)로 정의한다.
CREATE TABLE wallet_ledger (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  amount      INT NOT NULL,          -- 코인 증감량. 양수=적립, 음수=사용 (0 금지)
  reason      TEXT NOT NULL,         -- 'topup' | 'draw' | 'refund' | 'trade_in' | 'shipping' | 'admin'
  ref_type    TEXT,                  -- 근거 객체 타입 ('payment','draw','trade' ...)
  ref_id      BIGINT,                -- 근거 객체 id → 모든 돈의 흐름이 원인과 연결됨
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount <> 0)
);
CREATE INDEX idx_ledger_user ON wallet_ledger(user_id, created_at);
-- 잔액 조회는 뷰로: (실서비스에선 머티리얼라이즈드 캐시 + 원장 대사 배치 병행)
CREATE VIEW wallet_balance AS
  SELECT user_id, COALESCE(SUM(amount),0) AS balance FROM wallet_ledger GROUP BY user_id;

-- ---------- 결제(PG) ----------
CREATE TABLE payments (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  pg_provider   TEXT NOT NULL,                 -- 'portone'
  pg_tx_id      TEXT UNIQUE NOT NULL,          -- PG 거래 고유번호(웹훅 검증 키)
  amount_krw    INT NOT NULL,
  coin_amount   INT NOT NULL,                  -- 지급 코인 수
  status        TEXT NOT NULL DEFAULT 'pending', -- pending → paid → (canceled)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 규칙: status='paid' 전환(=서버 웹훅 검증 성공)과 wallet_ledger '+' 기록은 같은 트랜잭션.

-- ---------- 상품 / 머신 / 재고(=확률) ----------
CREATE TABLE items (
  id           BIGSERIAL PRIMARY KEY,
  sku          TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  series       TEXT,                    -- 도감 묶음용 (예: '치이카와 마스코트 3탄')
  rarity       TEXT NOT NULL DEFAULT 'normal', -- normal|rare|epic|secret (연출 토큰과 일치)
  retail_price INT NOT NULL,            -- 소비자 정가 — "최저 보장 가치" 표기·검증 근거
  image_url    TEXT,
  kc_certified BOOLEAN NOT NULL DEFAULT TRUE   -- 어린이제품 KC 인증 여부(입고 검수 플래그)
);

CREATE TABLE machines (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  price_coin   INT NOT NULL,            -- 1스핀 가격(코인)
  status       TEXT NOT NULL DEFAULT 'draft', -- draft → open → soldout → closed
  seed_hash    TEXT,                    -- ★커밋-리빌: 오픈 시 SHA-256(seed) 선공개
  seed_reveal  TEXT,                    -- 회차 종료 후 원본 seed 공개 → 누구나 검증 가능
  opened_at    TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ
);

-- 머신 안의 "실물 재고"이자 "확률표". stock이 줄면 확률도 실시간으로 변한다.
CREATE TABLE machine_items (
  id           BIGSERIAL PRIMARY KEY,
  machine_id   BIGINT NOT NULL REFERENCES machines(id),
  item_id      BIGINT NOT NULL REFERENCES items(id),
  stock        INT NOT NULL CHECK (stock >= 0),  -- 남은 수량. CHECK로 음수 원천 봉쇄
  initial_stock INT NOT NULL,                    -- 최초 수량(확률표 표기·감사용)
  UNIQUE (machine_id, item_id)
);
-- 확률 뷰: 프론트 확률표는 반드시 이 뷰(실데이터)만 사용
CREATE VIEW machine_odds AS
  SELECT mi.machine_id, mi.item_id, i.name, i.rarity, mi.stock,
         ROUND(100.0 * mi.stock / NULLIF(SUM(mi.stock) OVER (PARTITION BY mi.machine_id),0), 2) AS odds_pct
  FROM machine_items mi JOIN items i ON i.id = mi.item_id;

-- ---------- 추첨 감사 로그 ----------
CREATE TABLE draws (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  machine_id    BIGINT NOT NULL REFERENCES machines(id),
  item_id       BIGINT NOT NULL REFERENCES items(id),   -- 뽑힌 상품
  cost_coin     INT NOT NULL,
  rng_value     DOUBLE PRECISION NOT NULL,  -- 사용된 난수(0~1). seed와 함께 재현·검증 가능
  stock_snapshot JSONB NOT NULL,            -- 추첨 직전 {item_id: stock} 스냅샷 — 확률 증빙
  batch_id      UUID,                       -- 10연이면 같은 batch_id 10행
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_draws_user ON draws(user_id, created_at);

-- ---------- 보관함(뽑은 실물) → 배송 ----------
CREATE TABLE user_items (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  item_id     BIGINT NOT NULL REFERENCES items(id),
  draw_id     BIGINT UNIQUE REFERENCES draws(id), -- 어느 추첨에서 왔는지 1:1
  status      TEXT NOT NULL DEFAULT 'stored',     -- stored → shipping_locked → shipped | traded
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipments (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  address      JSONB NOT NULL,           -- 스냅샷 저장(이후 주소 변경 영향 없음)
  fee_krw      INT NOT NULL DEFAULT 3000,-- 묶음배송: 건당 1회만 부과
  status       TEXT NOT NULL DEFAULT 'requested', -- requested→packed→shipped→delivered
  tracking_no  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE shipment_items (             -- 배송 N : 아이템 M 연결
  shipment_id BIGINT NOT NULL REFERENCES shipments(id),
  user_item_id BIGINT NOT NULL REFERENCES user_items(id),
  PRIMARY KEY (shipment_id, user_item_id)
);

-- ---------- 중복템 교환소 (현금 환급 금지 — 코인 재화로만) ----------
CREATE TABLE trades (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  user_item_id BIGINT UNIQUE NOT NULL REFERENCES user_items(id),
  coin_credit  INT NOT NULL,             -- 지급 코인(어드민이 비율 설정)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ★ 핵심: 추첨 프로시저의 동시성 처리 개념 (FastAPI 서비스 레이어에서 동일 로직 구현)
--
-- BEGIN;                                            -- 트랜잭션 시작(전부 성공 or 전부 취소)
--   SELECT * FROM machine_items
--    WHERE machine_id = :m AND stock > 0
--    FOR UPDATE;                                    -- ★행 잠금: 다른 요청은 이 행들이
--                                                   --   커밋될 때까지 대기 → 재고 이중 차감 불가
--   -- 가중 추첨: r = rng() * SUM(stock);  누적합을 넘는 첫 행이 당첨
--   UPDATE machine_items SET stock = stock - 1 WHERE id = :won;
--   INSERT INTO draws(...);                          -- 감사 로그
--   INSERT INTO user_items(...);                     -- 보관함 적립
--   INSERT INTO wallet_ledger(amount=-price, ...);   -- 코인 차감
-- COMMIT;
--
-- 잠금 경합이 커지면(동시 스핀 폭주) Redis 분산락 or 머신별 큐로 직렬화하는 v2 최적화 여지.
-- ============================================================================
