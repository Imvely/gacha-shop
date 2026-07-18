import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "이용약관 — PONG!" };

const API_URL = process.env.API_URL ?? "http://localhost:8000";

interface TermsDoc {
  version: string;
  effective_date: string;
  content: string;
}

async function fetchTerms(version?: string): Promise<{
  doc: TermsDoc;
  versions: { version: string }[];
}> {
  const listRes = await fetch(`${API_URL}/terms`, { cache: "no-store" });
  if (!listRes.ok) throw new Error("약관 조회 실패");
  const list = await listRes.json();
  if (!version || version === list.latest.version) {
    return { doc: list.latest, versions: list.versions };
  }
  const res = await fetch(`${API_URL}/terms/${version}`, { cache: "no-store" });
  if (!res.ok) return { doc: list.latest, versions: list.versions };
  return { doc: await res.json(), versions: list.versions };
}

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  const { doc, versions } = await fetchTerms(v);

  return (
    <div className="flex flex-col gap-5">
      <nav>
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← 머신 목록
        </Link>
      </nav>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">이용약관</h1>
        <div className="flex gap-1.5">
          {versions.map((ver) => (
            <Link
              key={ver.version}
              href={`/terms?v=${ver.version}`}
              className={`rounded-full border px-3 py-1 font-mono text-xs ${
                ver.version === doc.version
                  ? "border-pong text-pong"
                  : "border-line text-muted"
              }`}
            >
              {ver.version}
            </Link>
          ))}
        </div>
      </div>
      <article className="whitespace-pre-wrap rounded-2xl border border-line bg-surface p-5 text-sm leading-relaxed">
        {doc.content}
      </article>
      <p className="text-xs text-muted">시행일 {doc.effective_date}</p>
    </div>
  );
}
