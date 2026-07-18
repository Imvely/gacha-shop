"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShipmentInfo, ShippingAddress, StorageItem } from "@/lib/clientApi";
import {
  changeShipmentAddress,
  createShipment,
  getShippingFee,
  getStorage,
  listShipments,
} from "@/lib/clientApi";
import { RarityChip } from "@/components/RarityChip";

const STATUS_LABEL: Record<ShipmentInfo["status"], string> = {
  requested: "신청됨",
  packed: "포장 중",
  shipped: "출고됨",
  delivered: "배송 완료",
};

const EMPTY_ADDRESS: ShippingAddress = {
  recipient: "",
  phone: "",
  postcode: "",
  address1: "",
  address2: "",
};

export function StoragePanel() {
  const [items, setItems] = useState<StorageItem[]>([]);
  const [shipments, setShipments] = useState<ShipmentInfo[]>([]);
  const [fee, setFee] = useState<{ fee_coin: number; fee_krw: number } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [editing, setEditing] = useState<number | null>(null); // 주소 수정 중인 배송 id
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getStorage().then(setItems).catch(() => setNotice("보관함을 불러오지 못했어요"));
    listShipments().then(setShipments).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    getShippingFee().then(setFee).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setField = (k: keyof ShippingAddress, v: string) =>
    setAddress((a) => ({ ...a, [k]: v }));

  const addressValid =
    address.recipient.trim() &&
    address.phone.trim() &&
    address.postcode.trim() &&
    address.address1.trim();

  const submit = async () => {
    if (busy || selected.size === 0 || !addressValid) return;
    setBusy(true);
    try {
      await createShipment([...selected], address);
      setSelected(new Set());
      refresh();
      setNotice("배송 신청 완료! 출고 전까지 주소를 바꿀 수 있어요");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "배송 신청에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const saveAddress = async (shipmentId: number) => {
    if (busy || !addressValid) return;
    setBusy(true);
    try {
      await changeShipmentAddress(shipmentId, address);
      setEditing(null);
      refresh();
      setNotice("주소를 바꿨어요");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "주소 변경에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const stored = items.filter((i) => i.status === "stored");

  return (
    <div className="flex flex-col gap-6" data-testid="storage-panel">
      {/* 보관함 */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">내 캡슐 ({stored.length})</h2>
        {stored.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-muted">
            아직 보관함이 비어 있어요. 머신에서 뽑아보세요!
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stored.map((it) => (
              <button
                key={it.user_item_id}
                onClick={() => toggle(it.user_item_id)}
                data-testid={`storage-item-${it.user_item_id}`}
                className={`flex flex-col gap-1.5 rounded-2xl border p-3 text-left transition-colors ${
                  selected.has(it.user_item_id)
                    ? "border-pong bg-pong/10"
                    : "border-line bg-surface"
                }`}
              >
                <RarityChip rarity={it.rarity} />
                <span className="text-sm leading-snug">{it.name}</span>
                <span className="text-xs text-muted">
                  정가 {it.retail_price.toLocaleString()}원
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 배송 신청 / 주소 수정 폼 — 아이템 선택 중이거나 주소 수정 중일 때 표시 */}
      {(selected.size > 0 || editing !== null) && (
        <section className="flex flex-col gap-3 rounded-2xl border border-pong/40 bg-surface p-4">
          <h3 className="font-display text-lg">
            {editing !== null ? (
              "배송지 수정"
            ) : (
              <>
                {selected.size}개 묶음배송
                {fee && (
                  <span className="ml-2 font-mono text-sm text-coin">
                    배송비 {fee.fee_coin} 코인 (1회)
                  </span>
                )}
              </>
            )}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="받는 사람"
              value={address.recipient}
              onChange={(e) => setField("recipient", e.target.value)}
              data-testid="addr-recipient"
              className="rounded-xl border border-line bg-background px-3 py-2.5 text-sm"
            />
            <input
              placeholder="연락처"
              value={address.phone}
              onChange={(e) => setField("phone", e.target.value)}
              data-testid="addr-phone"
              className="rounded-xl border border-line bg-background px-3 py-2.5 text-sm"
            />
            <input
              placeholder="우편번호"
              value={address.postcode}
              onChange={(e) => setField("postcode", e.target.value)}
              data-testid="addr-postcode"
              className="rounded-xl border border-line bg-background px-3 py-2.5 text-sm"
            />
            <input
              placeholder="상세 주소"
              value={address.address2}
              onChange={(e) => setField("address2", e.target.value)}
              className="rounded-xl border border-line bg-background px-3 py-2.5 text-sm"
            />
            <input
              placeholder="주소"
              value={address.address1}
              onChange={(e) => setField("address1", e.target.value)}
              data-testid="addr-address1"
              className="col-span-2 rounded-xl border border-line bg-background px-3 py-2.5 text-sm"
            />
          </div>
          {editing === null && (
            <button
              onClick={submit}
              disabled={busy || !addressValid}
              data-testid="ship-submit"
              className="rounded-xl bg-pong px-4 py-3 text-sm font-semibold text-background disabled:opacity-40"
            >
              {busy ? "신청 중…" : "배송 신청"}
            </button>
          )}
        </section>
      )}

      {/* 배송 현황 */}
      {shipments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl">배송 현황</h2>
          {shipments.map((s) => (
            <div
              key={s.id}
              data-testid={`shipment-${s.id}`}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-surface-2 px-3 py-1 text-xs">
                  {STATUS_LABEL[s.status]}
                </span>
                <span className="text-xs text-muted">
                  {s.items.length}개 · 배송비 {s.fee_krw.toLocaleString()}원
                </span>
              </div>
              <p className="text-sm">
                {s.address.recipient} · {s.address.address1} {s.address.address2}
              </p>
              {s.tracking_no && (
                <p className="font-mono text-xs text-muted">송장 {s.tracking_no}</p>
              )}
              {(s.status === "requested" || s.status === "packed") &&
                (editing === s.id ? (
                  <button
                    onClick={() => saveAddress(s.id)}
                    disabled={!addressValid || busy}
                    data-testid={`save-address-${s.id}`}
                    className="rounded-xl bg-pong px-3 py-2 text-xs font-semibold text-background disabled:opacity-40"
                  >
                    위 입력폼의 주소로 변경
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setAddress({ ...EMPTY_ADDRESS, ...s.address });
                      setEditing(s.id);
                    }}
                    data-testid={`edit-address-${s.id}`}
                    className="self-start rounded-xl border border-line px-3 py-2 text-xs hover:border-pong"
                  >
                    주소 변경 (출고 전까지)
                  </button>
                ))}
            </div>
          ))}
        </section>
      )}

      {notice && (
        <p
          data-testid="storage-notice"
          className="rounded-full bg-black/60 px-4 py-2 text-center text-sm"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
