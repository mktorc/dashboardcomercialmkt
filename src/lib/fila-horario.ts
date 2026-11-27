// Horário programado da Fila de Leads. Mesma regra da função SQL fila_no_horario
// (sql-para-gravar/fila_horarios.sql): fuso America/Sao_Paulo, 0 = domingo … 6 = sábado.
export type Janela = { ini: string; fim: string };
export type Horarios = Partial<Record<string, Janela>>;

export const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
export const FUSO = "America/Sao_Paulo";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valida e normaliza o JSON de horários vindo do cliente; null se inválido. */
export function parseHorarios(v: unknown): Horarios | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Horarios = {};
  for (const [k, j] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(k)) return null;
    if (j == null) continue;
    const { ini, fim } = j as Record<string, unknown>;
    if (typeof ini !== "string" || typeof fim !== "string") return null;
    if (!HHMM.test(ini) || !HHMM.test(fim) || ini >= fim) return null;
    out[k] = { ini, fim };
  }
  return out;
}

function agoraNoFuso(agora: Date) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dow, hhmm: `${get("hour")}:${get("minute")}` };
}

export function noHorario(usar: boolean, horarios: Horarios | null, agora = new Date()): boolean {
  if (!usar) return true;
  const { dow, hhmm } = agoraNoFuso(agora);
  const j = horarios?.[String(dow)];
  return !!j && hhmm >= j.ini && hhmm < j.fim;
}

/** Resumo curto: "Seg–Sex 09:00–18:00 · Sáb 09:00–13:00". */
export function resumoHorarios(h: Horarios | null): string {
  const grupos: { de: number; ate: number; txt: string }[] = [];
  for (let d = 1; d <= 7; d++) {
    const dia = d % 7; // começa na segunda
    const j = h?.[String(dia)];
    if (!j) continue;
    const txt = `${j.ini}–${j.fim}`;
    const ult = grupos[grupos.length - 1];
    if (ult && ult.txt === txt && ult.ate === d - 1) ult.ate = d;
    else grupos.push({ de: d, ate: d, txt });
  }
  if (!grupos.length) return "Nenhum dia configurado";
  return grupos
    .map((g) =>
      g.de === g.ate
        ? `${DIAS[g.de % 7]} ${g.txt}`
        : `${DIAS[g.de % 7]}–${DIAS[g.ate % 7]} ${g.txt}`,
    )
    .join(" · ");
}
