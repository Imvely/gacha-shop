import type { Metadata } from "next";

import { AdminPanel } from "@/components/admin/AdminPanel";

export const metadata: Metadata = { title: "어드민 — PONG!" };

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">어드민</h1>
      <AdminPanel />
    </div>
  );
}
