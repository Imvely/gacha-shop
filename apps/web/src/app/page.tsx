import { fetchMachines } from "@/lib/api";
import { MachineCard } from "@/components/MachineCard";

export default async function Home() {
  const machines = await fetchMachines();

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="font-display text-3xl leading-tight">
          오늘의 머신
        </h1>
        <p className="mt-1 text-sm text-muted">
          전부 실물 재고예요. 남은 캡슐이 곧 확률이에요.
        </p>
      </section>

      {machines.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="font-display text-lg">지금은 머신을 채우는 중이에요</p>
          <p className="mt-1 text-sm text-muted">새 머신이 열리면 여기에 진열돼요.</p>
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {machines.map((m) => (
            <MachineCard key={m.id} machine={m} />
          ))}
        </section>
      )}
    </div>
  );
}
