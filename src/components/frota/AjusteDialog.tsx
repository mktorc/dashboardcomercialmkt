import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { FrotaVehicle, Region } from "@/lib/frota";
import { categoryRank } from "@/lib/frota-config";
import type { Action } from "@/lib/frota-acoes";
import { KIND_LABEL, type AdjustmentKind } from "@/lib/frota-ajustes";
import { carName } from "@/lib/frota-sugestao";

const KIND_HELP: Record<AdjustmentKind, string> = {
  outro_carro: "Transferi, troquei ou dei upgrade com um carro diferente do sugerido.",
  mantido: "Fiquei com o carro que já estava na reserva (ex.: transferi em vez de dar upgrade).",
  fora: "Renegociei, mudou o horário ou cancelou: a reserva sai do planejamento.",
};

export type AjusteInput = {
  kind: AdjustmentKind;
  vehicleId: number | null;
  note: string;
};

export function AjusteDialog({
  action,
  vehicles,
  regionOf,
  onSave,
  onClose,
}: {
  action: Action | null;
  vehicles: FrotaVehicle[];
  /** Cidade atual de cada carro (pátio ou para onde volta). */
  regionOf: Map<number, Region | null>;
  onSave: (a: Action, input: AjusteInput) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<AdjustmentKind>("outro_carro");
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!action) return;
    setKind("outro_carro");
    setVehicleId(null);
    setBusca("");
    setNote("");
  }, [action]);

  // Carros sugeridos primeiro: mesma categoria/1 acima e já na cidade da retirada.
  const lista = useMemo(() => {
    if (!action) return [];
    const want = categoryRank(action.fromClass);
    const q = busca.trim().toLowerCase();
    const score = (v: FrotaVehicle) => {
      const r = categoryRank(v.class_label);
      const cls = want == null || r == null ? 2 : r === want ? 0 : r === want + 1 ? 1 : 3;
      const city = regionOf.get(v.id) === action.region ? 0 : 1;
      return cls * 2 + city;
    };
    return vehicles
      .filter(
        (v) =>
          !q ||
          (v.plate ?? "").toLowerCase().includes(q) ||
          (v.label ?? "").toLowerCase().includes(q) ||
          (v.class_label ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => score(a) - score(b) || a.id - b.id)
      .slice(0, 40);
  }, [action, vehicles, regionOf, busca]);

  if (!action) return null;
  const precisaCarro = kind === "outro_carro";
  const podeSalvar = !precisaCarro || vehicleId != null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Feito com ajuste · reserva {action.reservationId}</DialogTitle>
          <DialogDescription>
            O que você fez no lugar da sugestão? O painel trava esta reserva assim e replaneja as
            outras.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Sugestão do painel: {action.text}
        </p>

        <RadioGroup
          value={kind}
          onValueChange={(v) => setKind(v as AdjustmentKind)}
          className="space-y-1"
        >
          {(Object.keys(KIND_LABEL) as AdjustmentKind[])
            .filter((k) => k !== "mantido" || action.currentVehicle != null)
            .map((k) => (
              <label
                key={k}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary"
              >
                <RadioGroupItem value={k} className="mt-0.5" />
                <span>
                  <span className="font-medium">
                    {KIND_LABEL[k]}
                    {k === "mantido" && action.currentVehicle
                      ? ` (${carName(action.currentVehicle)})`
                      : ""}
                  </span>
                  <span className="block text-xs text-muted-foreground">{KIND_HELP[k]}</span>
                </span>
              </label>
            ))}
        </RadioGroup>

        {precisaCarro && (
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-busca">Qual carro foi para a reserva?</Label>
            <Input
              id="ajuste-busca"
              type="search"
              placeholder="Buscar placa, modelo ou categoria…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <div className="max-h-56 overflow-y-auto rounded-md border">
              {lista.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVehicleId(v.id)}
                  className={`flex w-full items-center justify-between gap-2 border-b px-2 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted ${
                    vehicleId === v.id ? "bg-primary/15 font-medium" : ""
                  }`}
                >
                  <span className="truncate">{carName(v)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {v.class_label ?? "—"} · {regionOf.get(v.id) ?? "sem local"}
                  </span>
                </button>
              ))}
              {lista.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">Nenhum carro encontrado.</p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ajuste-obs">Observação (opcional)</Label>
          <Textarea
            id="ajuste-obs"
            rows={2}
            placeholder="Ex.: preferi transferir para não dar upgrade"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!podeSalvar}
            onClick={() =>
              onSave(action, {
                kind,
                vehicleId: kind === "mantido" ? (action.currentVehicle?.id ?? null) : vehicleId,
                note,
              })
            }
          >
            Salvar ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
