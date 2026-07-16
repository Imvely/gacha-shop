"""확률표 계산 — 확률은 항상 실데이터 (절대 원칙 5: odds = stock / total_stock)

단순 반올림은 합계가 99.99%/100.01%가 될 수 있어, 최대잉여법(largest remainder)으로
소수 둘째 자리 기준 합계가 정확히 100.00%가 되도록 배분한다.
"""


def odds_percentages(stocks: list[int]) -> list[float]:
    """재고 목록 → 합계가 정확히 100.00이 되는 확률(%) 목록. 총재고 0이면 전부 0.0."""
    total = sum(stocks)
    if total == 0:
        return [0.0 for _ in stocks]

    # 0.01% 단위(만분율)로 floor 배분 후, 잔여분을 소수부 큰 순서로 +1
    units = 10000
    raw = [s * units / total for s in stocks]
    floored = [int(r) for r in raw]
    shortfall = units - sum(floored)
    by_fraction = sorted(range(len(stocks)), key=lambda i: raw[i] - floored[i], reverse=True)
    for i in by_fraction[:shortfall]:
        floored[i] += 1
    return [f / 100 for f in floored]
