/**
 * 캡슐 게이지 — 잔여 수량을 캡슐 알갱이로 표현 (시그니처 요소).
 * 숫자는 서버 응답 필드(stock_remaining/stock_initial)를 그대로 표시하고,
 * 알갱이는 그 비율의 장식적 시각화일 뿐이다.
 */
const DOTS = 12;

export function CapsuleGauge({
  remaining,
  initial,
  compact = false,
}: {
  remaining: number;
  initial: number;
  compact?: boolean;
}) {
  const filled = initial > 0 ? Math.round((remaining / initial) * DOTS) : 0;
  const dots = Array.from({ length: DOTS }, (_, i) => i < filled);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1" aria-hidden>
        {dots.map((on, i) => (
          <span
            key={i}
            className={`${compact ? "h-2.5 w-1.5" : "h-3.5 w-2"} rounded-full transition-colors ${
              on ? "bg-pong" : "bg-surface-2"
            }`}
          />
        ))}
      </div>
      <p className={`text-muted ${compact ? "text-xs" : "text-sm"}`}>
        남은 캡슐{" "}
        <span className="font-mono text-foreground">
          {remaining}/{initial}
        </span>
      </p>
    </div>
  );
}
