import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { moeda } from "@/lib/comissoes/format";
import { salvarComissaoManual } from "@/lib/comissoes/service";
import { calcularComissao, type Reserva } from "@/lib/comissoes/types";

interface Props {
  reserva: Reserva | null;
  onClose: () => void;
  onSalvo: () => void;
}

const numero = (t: string) => (t.trim() === "" ? null : Number(t.replace(",", ".")));

export function EditarComissaoDialog({ reserva, onClose, onSalvo }: Props) {
  const [pct, setPct] = useState("");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setPct(reserva?.commission_rate_manual?.toString() ?? "");
    setValor(reserva?.commission_amount?.toString() ?? "");
    setErro(null);
  }, [reserva]);

  if (!reserva) return null;
  const pctN = numero(pct);
  const valorN = numero(valor);
  const invalido =
    (pctN != null && (!Number.isFinite(pctN) || pctN < 0 || pctN > 100)) ||
    (valorN != null && (!Number.isFinite(valorN) || valorN < 0));
  const padrao = calcularComissao(reserva, null, null);
  const novo = calcularComissao(reserva, pctN, valorN);

  async function salvar(ajuste: { pct: number | null; valor: number | null }) {
    if (!reserva) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarComissaoManual(reserva.id, ajuste);
      onSalvo();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Comissão da reserva {reserva.hq_reservation_id}</DialogTitle>
          <DialogDescription>
            {reserva.commission_partner} · rack rate {moeda(reserva.rack_rate)} · padrão do parceiro{" "}
            {reserva.commission_rate ?? 0}% = {moeda(padrao)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-foreground">
            Percentual manual (%)
            <Input
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder={`padrão ${reserva.commission_rate ?? 0}`}
              className="mt-1"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Valor fixo (US$)
            <Input
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="opcional"
              className="mt-1"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Deixe em branco para usar o padrão. Se os dois forem preenchidos, vale o valor fixo. O
          percentual manual é aplicado sobre o rack rate.
        </p>

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          Comissão resultante: <strong>{invalido ? "—" : moeda(novo)}</strong>
          {!invalido && novo !== padrao && (
            <span className="ml-2 text-muted-foreground">(padrão: {moeda(padrao)})</span>
          )}
        </div>
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            disabled={salvando}
            onClick={() => salvar({ pct: null, valor: null })}
          >
            Voltar ao padrão
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={salvando} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={salvando || invalido}
              onClick={() => salvar({ pct: pctN, valor: valorN })}
            >
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
