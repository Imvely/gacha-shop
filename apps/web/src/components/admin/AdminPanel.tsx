"use client";

import { useCallback, useEffect, useState } from "react";
import { RARITIES, type Rarity } from "@pong/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface MachineItemRow {
  machine_item_id: number;
  item_id: number;
  name: string;
  rarity: Rarity;
  stock: number;
  initial_stock: number;
}
interface MachineRow {
  id: number;
  name: string;
  price_coin: number;
  status: string;
  seed_hash: string | null;
  items: MachineItemRow[];
}
interface NewItem {
  name: string;
  rarity: Rarity;
  retail_price: number;
  stock: number;
}

export function AdminPanel() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState(500);
  const [newItems, setNewItems] = useState<NewItem[]>([
    { name: "", rarity: "normal", retail_price: 4500, stock: 10 },
  ]);

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": key,
          ...init?.headers,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `실패 (${res.status})`);
      }
      return res.json();
    },
    [key],
  );

  const refresh = useCallback(async () => {
    const list = await call<MachineRow[]>("/admin/machines");
    setMachines(list);
    setAuthed(true);
  }, [call]);

  useEffect(() => {
    const saved = localStorage.getItem("pong-admin-key");
    if (saved) setKey(saved);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const login = async () => {
    try {
      localStorage.setItem("pong-admin-key", key);
      await refresh();
    } catch {
      setNotice("어드민 키가 틀렸어요");
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      await refresh();
      setNotice(ok);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "실패했어요");
    }
  };

  if (!authed) {
    return (
      <div className="flex max-w-sm flex-col gap-3">
        <input
          type="password"
          placeholder="어드민 키"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
        />
        <button
          onClick={login}
          className="rounded-xl bg-pong px-4 py-2.5 text-sm font-semibold text-background"
        >
          접속
        </button>
        {notice && <p className="text-sm text-muted">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 출고 관리 */}
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl">출고</h2>
        <a
          href={`${API_URL}/admin/shipments/export.csv?status=requested`}
          onClick={(e) => {
            // 다운로드에 어드민 키 헤더가 필요해 fetch로 처리
            e.preventDefault();
            fetch(`${API_URL}/admin/shipments/export.csv?status=requested`, {
              headers: { "X-Admin-Key": key },
            })
              .then((r) => r.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "shipments-requested.csv";
                a.click();
                URL.revokeObjectURL(url);
              });
          }}
          className="self-start rounded-xl border border-line px-4 py-2.5 text-sm hover:border-pong"
        >
          📄 출고 대상 CSV 내려받기
        </a>
      </section>

      {/* 머신 생성 */}
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-display text-xl">새 머신</h2>
        <div className="flex gap-2">
          <input
            placeholder="머신 이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-xl border border-line bg-background px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={newPrice}
            onChange={(e) => setNewPrice(+e.target.value)}
            className="w-28 rounded-xl border border-line bg-background px-3 py-2 font-mono text-sm"
          />
          <span className="self-center text-xs text-muted">코인/스핀</span>
        </div>
        {newItems.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input
              placeholder="상품명"
              value={it.name}
              onChange={(e) =>
                setNewItems((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
              className="flex-1 rounded-xl border border-line bg-background px-3 py-2 text-sm"
            />
            <select
              value={it.rarity}
              onChange={(e) =>
                setNewItems((arr) =>
                  arr.map((x, j) => (j === i ? { ...x, rarity: e.target.value as Rarity } : x)),
                )
              }
              className="rounded-xl border border-line bg-background px-2 py-2 text-sm"
            >
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              type="number"
              title="정가(원)"
              value={it.retail_price}
              onChange={(e) =>
                setNewItems((arr) =>
                  arr.map((x, j) => (j === i ? { ...x, retail_price: +e.target.value } : x)),
                )
              }
              className="w-24 rounded-xl border border-line bg-background px-2 py-2 font-mono text-sm"
            />
            <input
              type="number"
              title="수량"
              value={it.stock}
              onChange={(e) =>
                setNewItems((arr) => arr.map((x, j) => (j === i ? { ...x, stock: +e.target.value } : x)))
              }
              className="w-20 rounded-xl border border-line bg-background px-2 py-2 font-mono text-sm"
            />
          </div>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() =>
              setNewItems((arr) => [...arr, { name: "", rarity: "normal", retail_price: 4500, stock: 10 }])
            }
            className="rounded-xl border border-line px-3 py-2 text-xs"
          >
            + 상품 줄 추가
          </button>
          <button
            onClick={() =>
              act(
                () =>
                  call("/admin/machines", {
                    method: "POST",
                    body: JSON.stringify({ name: newName, price_coin: newPrice, items: newItems }),
                  }),
                "머신을 만들었어요 (draft)",
              )
            }
            className="rounded-xl bg-pong px-4 py-2 text-xs font-semibold text-background"
          >
            생성
          </button>
        </div>
      </section>

      {/* 머신 목록 */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">머신 목록</h2>
        {machines.map((m) => (
          <div key={m.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                #{m.id} {m.name}{" "}
                <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs">{m.status}</span>
              </span>
              {m.status === "draft" && (
                <button
                  onClick={() =>
                    act(
                      () => call(`/admin/machines/${m.id}/open`, { method: "POST" }),
                      "오픈! seed_hash가 커밋됐어요",
                    )
                  }
                  className="rounded-xl bg-pong px-3 py-1.5 text-xs font-semibold text-background"
                >
                  오픈 (seed 커밋)
                </button>
              )}
            </div>
            {m.seed_hash && (
              <p className="break-all font-mono text-[10px] text-muted">seed 커밋 {m.seed_hash}</p>
            )}
            <table className="text-sm">
              <tbody>
                {m.items.map((it) => (
                  <tr key={it.machine_item_id} className="border-t border-line/50">
                    <td className="py-1.5">{it.name}</td>
                    <td className="py-1.5 text-xs text-muted">{it.rarity}</td>
                    <td className="py-1.5 text-right font-mono">
                      {it.stock}/{it.initial_stock}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <button
                        onClick={() =>
                          act(
                            () =>
                              call(`/admin/machine-items/${it.machine_item_id}/stock`, {
                                method: "POST",
                                body: JSON.stringify({ delta: 1, reason: "restock" }),
                              }),
                            "입고 +1 (이력 기록)",
                          )
                        }
                        className="rounded-lg border border-line px-2 py-1 text-xs"
                      >
                        +1
                      </button>
                      <button
                        onClick={() =>
                          act(
                            () =>
                              call(`/admin/machine-items/${it.machine_item_id}/stock`, {
                                method: "POST",
                                body: JSON.stringify({ delta: -1, reason: "damage" }),
                              }),
                            "차감 -1 (이력 기록)",
                          )
                        }
                        className="ml-1 rounded-lg border border-line px-2 py-1 text-xs"
                      >
                        -1
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {notice && (
        <p className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}
