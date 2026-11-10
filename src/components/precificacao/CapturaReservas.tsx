import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { cancelByCategory, captureProfile, captureSpeed, hasCancelData } from "@/lib/capture";
import type { PaceRow } from "@/lib/occupancy-pace";
import { dataBR } from "@/lib/pricing-format";

const pct = (v: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

/**
 * Perfil histórico de captura: parcela da ocupação final já contratada em cada antecedência (datas encerradas), o que historicamente
 * ainda falta capturar e a velocidade de entrada. Líquida = só reservas confirmadas hoje; bruta = tudo que foi criado, inclusive o que
 * depois cancelou. É potencial histórico restante, não previsão de ocupação.
 */
export function CapturaReservas({
  rows,
  base,
  historyStart,
  category,
}: {
  rows: PaceRow[];
  base: string;
  historyStart: string;
  category: string | null;
}) {
  const profile = useMemo(
    () => captureProfile(rows, base, historyStart, category),
    [rows, base, historyStart, category],
  );
  const speed = useMemo(() => captureSpeed(profile), [profile]);
  const cancels = useMemo(() => hasCancelData(rows), [rows]);
  const byCat = useMemo(
    () => (category || !cancels ? [] : cancelByCategory(rows, base, historyStart, 60)),
    [rows, base, historyStart, category, cancels],
  );
  const has = profile.some((p) => p.share != null && p.L > 0);
  const fastest = speed.reduce<(typeof speed)[number] | null>(
    (m, s) => (!m || s.ppPerDay > m.ppPerDay ? s : m),
    null,
  );
  const at = (L: number) => profile.find((p) => p.L === L);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Curva histórica de captura de reservas</h2>
        <span className="text-xs text-muted-foreground">
          {category ?? "todas as categorias"} · datas encerradas até {dataBR(base)}
        </span>
      </div>
      {!has ? (
        <p className="text-sm text-muted-foreground">Sem histórico suficiente para este recorte.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs tabular-nums">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Antec.</th>
                  <th className="font-medium">Líquida</th>
                  {cancels ? <th className="font-medium">Bruta</th> : null}
                  {cancels ? <th className="font-medium">Cancelou</th> : null}
                  <th className="font-medium">Falta capturar</th>
                  <th className="font-medium">Velocidade até o próximo ponto</th>
                </tr>
              </thead>
              <tbody>
                {profile.map((p) => {
                  const sp = speed.find((s) => s.from === p.L);
                  return (
                    <tr key={p.L} className="border-t border-border">
                      <td className="py-1">D-{p.L}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 rounded bg-muted">
                            <div
                              className="h-2 rounded bg-primary"
                              style={{ width: `${Math.min(100, (p.share ?? 0) * 100)}%` }}
                            />
                          </div>
                          <b>{pct(p.share)}</b>
                        </div>
                      </td>
                      {cancels ? <td>{pct(p.bruta)}</td> : null}
                      {cancels ? <td>{pct(p.cancelamento, 1)}</td> : null}
                      <td>{p.share == null ? "—" : pct(1 - p.share)}</td>
                      <td className="text-muted-foreground">
                        {sp ? `+${sp.ppPerDay.toFixed(2)} p.p./dia (até D-${sp.to})` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 rounded border border-border p-3 text-sm">
            <p>
              Em D-120 já costuma estar capturado <b>{pct(at(120)?.share ?? null)}</b> da ocupação
              final; em D-90, <b>{pct(at(90)?.share ?? null)}</b>; em D-75,{" "}
              <b>{pct(at(75)?.share ?? null)}</b>; em D-60, <b>{pct(at(60)?.share ?? null)}</b>.
              Historicamente ainda faltam{" "}
              <b>{at(60)?.share == null ? "—" : pct(1 - at(60)!.share!)}</b> em D-60.
            </p>
            {fastest ? (
              <p className="text-muted-foreground">
                Maior velocidade histórica: entre D-{fastest.from} e D-{fastest.to} (
                {fastest.ppPerDay.toFixed(2)} p.p. da ocupação final por dia).
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              “Falta capturar” é o que historicamente ainda entra depois dessa antecedência
              (potencial histórico), não uma previsão de ocupação.
            </p>
          </div>
          {cancels ? (
            byCat.length ? (
              <p className="text-xs text-muted-foreground">
                Cancelamento entre as diárias criadas com 60+ dias:{" "}
                {byCat.map((c) => `${c.category} ${pct(c.rate, 1)}`).join(" · ")}.
              </p>
            ) : null
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Sem dados de cancelamento neste relatório (publique de novo com ritmo.py): só a
              captura líquida está disponível.
            </p>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Captura = diárias contratadas ÷ diárias finais; não é a ocupação da frota. Reconstruída pela
        data de criação das reservas; o cancelamento usa a data da última atualização como proxy
        (indeterminado quando posterior à retirada). Alterações de data ou categoria não são
        rastreáveis. Fotos anteriores ao início da base são excluídas.
      </p>
    </Card>
  );
}
