import { RARITY_TOKENS, type Rarity } from "@pong/shared";

/** 등급 칩 — 컬러는 shared 토큰만 사용 (하드코딩 금지) */
export function RarityChip({ rarity }: { rarity: Rarity }) {
  const token = RARITY_TOKENS[rarity];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color: token.color, backgroundColor: `${token.color}1f` }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: token.color }}
      />
      {token.label}
    </span>
  );
}
