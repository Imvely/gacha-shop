import type { Metadata } from "next";
import { Geist_Mono, IBM_Plex_Sans_KR, Jua } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const jua = Jua({
  variable: "--font-jua",
  weight: "400",
  subsets: ["latin"],
});

const plexKr = IBM_Plex_Sans_KR({
  variable: "--font-plex-kr",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PONG! — 온라인 가챠샵",
  description: "확률도 재고도 전부 공개하는 온라인 가챠. 뽑는 재미는 그대로.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${jua.variable} ${plexKr.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4">
            <Link href="/" className="font-display text-2xl tracking-wide text-pong">
              PONG!
            </Link>
            <div className="flex items-center gap-2">
              <Link
                href="/storage"
                className="rounded-full border border-line px-3 py-1.5 text-xs hover:border-pong"
              >
                📦 보관함
              </Link>
              <Link
                href="/wallet"
                className="rounded-full border border-line px-3 py-1.5 text-xs hover:border-pong"
              >
                🪙 지갑
              </Link>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-6">{children}</main>
      </body>
    </html>
  );
}
