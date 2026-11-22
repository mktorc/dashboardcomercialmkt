import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { REGION_COLOR } from "@/lib/frota-config";
import { carName } from "@/lib/frota-sugestao";
import type { Action } from "@/lib/frota-acoes";
import type { Bar, Timeline, UnassignedItem } from "@/lib/frota-timeline";
import { fmt } from "@/components/frota/shared";
import { ActionCard, type ResInfo } from "@/components/frota/FilaAcoes";

export type Selection =
  { kind: "car"; vehicleId: number } | { kind: "reservation"; reservationId: string } | null;

function ReservationLine({
  b,
  customer,
  now,
}: {
  b: Bar;
  customer?: string | null | undefined;
  now: number;
}) {
  const status = b.end <= now ? "Encerrada" : b.started ? "Em andamento" : "Próxima";
  return (
    <div className="rounded-md border p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Reserva {b.reservationId}</span>
        <Badge variant="outline" className="text-[10px]">
          {status}
        </Badge>
      </div>
      <div className="text-muted-foreground">Cliente: {customer ?? "—"}</div>
      {(
        [
          ["Retirada", b.pickRegion, b.pickLocation, b.start],
          ["Devolução", b.retRegion, b.retLocation, b.end],
        ] as const
      ).map(([label, r, l, t]) => (
        <div key={label} className="flex items-center gap-1">
          <span
            className="size-2 rounded-full"
            style={{ background: r ? REGION_COLOR[r] : "#64748b" }}
          />
          {label}: {l ?? "—"} · {fmt(t)}
        </div>
      ))}
    </div>
  );
}

export function PainelFrota({
  selection,
  onClose,
  timeline,
  actions,
  resInfo,
  onDone,
  onAdjust,
  onApply,
  now,
}: {
  selection: Selection;
  onClose: () => void;
  timeline: Timeline;
  actions: Action[];
  resInfo: Map<string, ResInfo>;
  onDone: (a: Action) => void;
  onAdjust?: ((a: Action) => void) | undefined;
  onApply?: ((a: Action) => Promise<boolean>) | undefined;
  now: number;
}) {
  let body: React.ReactNode = null;
  let title = "";
  let desc = "";
  const cards = (list: Action[]) =>
    list.length === 0 ? (
      <p className="text-xs text-muted-foreground">Nenhuma ação pendente.</p>
    ) : (
      list.map((a) => (
        <ActionCard
          key={a.key}
          a={a}
          now={now}
          resInfo={resInfo}
          onDone={onDone}
          onAdjust={onAdjust}
          onApply={onApply}
        />
      ))
    );

  if (selection?.kind === "car") {
    const row = timeline.groups
      .flatMap((g) => g.rows)
      .find((r) => r.vehicle.id === selection.vehicleId);
    if (row) {
      const v = row.vehicle;
      title = carName(v);
      desc = `${v.class_label ?? "—"} · ${v.plate ?? "sem placa"}`;
      const mine = actions.filter(
        (a) =>
          a.vehicle?.id === v.id ||
          a.currentVehicle?.id === v.id ||
          a.transfer?.vehicle.id === v.id,
      );
      body = (
        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Ações</h3>
            {cards(mine)}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Reservas</h3>
            {row.bars.map((b) => (
              <ReservationLine
                key={b.reservationId}
                b={b}
                customer={resInfo.get(b.reservationId)?.customer}
                now={now}
              />
            ))}
          </section>
        </div>
      );
    }
  } else if (selection?.kind === "reservation") {
    let item: UnassignedItem | undefined;
    let cls = "";
    for (const g of timeline.groups) {
      const f = g.unassigned.find((u) => u.bar.reservationId === selection.reservationId);
      if (f) {
        item = f;
        cls = g.classLabel;
      }
    }
    if (item) {
      title = `Reserva ${item.bar.reservationId}`;
      desc = `${cls} · sem carro escalado no HQ`;
      body = (
        <div className="space-y-4">
          <ReservationLine
            b={item.bar}
            customer={resInfo.get(item.bar.reservationId)?.customer}
            now={now}
          />
          <section>
            <h3 className="mb-2 text-sm font-semibold">Ações</h3>
            {cards(actions.filter((a) => a.reservationId === item!.bar.reservationId))}
          </section>
        </div>
      );
    }
  }

  return (
    <Sheet open={selection != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title || "—"}</SheetTitle>
          <SheetDescription>{desc}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
