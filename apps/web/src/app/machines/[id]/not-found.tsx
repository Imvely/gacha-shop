import Link from "next/link";

export default function MachineNotFound() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-8 text-center">
      <p className="font-display text-lg">이 머신은 없어요</p>
      <p className="mt-1 text-sm text-muted">내려갔거나 주소가 잘못됐어요.</p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-xl bg-pong px-4 py-2 text-sm font-medium text-background"
      >
        머신 목록으로
      </Link>
    </div>
  );
}
