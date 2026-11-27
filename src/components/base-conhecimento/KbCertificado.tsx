// Certificado da trilha de conhecimento ORC (16:9). Aparece ao passar no teste e ao concluir a
// trilha; só ele sai na impressão (ver styles.css).
import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AREA_INFO, type KbArea } from "./kb-api";

const FRASES = [
  "O tanque tá cheio. Agora é pé na estrada!",
  "Você já sabe o caminho. Bora fazer cada cliente chegar bem.",
  "Bem-vindo de verdade ao time ORC. A viagem só começou!",
  "Mapa na mão, chave na ignição: partiu!",
];

/** Certificado 16:9 com a identidade da ORC. Só ele sai na impressão (ver styles.css). */
export function Certificado({ area }: { area: KbArea }) {
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kb-cert-name");
      if (saved) return setName(saved);
    } catch {
      /* ignora */
    }
    void supabase.auth.getSession().then(({ data }) => {
      const meta = (data.session?.user.user_metadata ?? {}) as Record<string, unknown>;
      setName(String(meta["full_name"] ?? meta["name"] ?? "").trim());
    });
  }, []);
  const salvar = (v: string) => {
    setName(v);
    try {
      localStorage.setItem("kb-cert-name", v);
    } catch {
      /* ignora */
    }
  };
  const hoje = new Date();
  const data = hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const frase = FRASES[(hoje.getDate() + name.length) % FRASES.length]!;
  return (
    <section className="space-y-4">
      <label className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-sm font-medium text-foreground">Nome no certificado</span>
        <input
          value={name}
          onChange={(e) => salvar(e.target.value.slice(0, 60))}
          placeholder="Digite seu nome para aparecer no certificado"
          autoFocus={!name}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </label>

      <div
        id="kb-cert"
        className="@container relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0d2a17] text-white shadow-2xl [print-color-adjust:exact] motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in motion-safe:duration-700"
      >
        {/* Fundo: brilho limão e faixas diagonais da marca */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,rgba(68,229,0,0.35),transparent_55%),radial-gradient(ellipse_at_0%_100%,rgba(68,229,0,0.18),transparent_50%)]" />
        <div className="absolute -right-[12%] top-0 h-full w-[38%] skew-x-[-18deg] bg-[#44e500]/10" />
        <div className="absolute -right-[4%] top-0 h-full w-[3%] skew-x-[-18deg] bg-[#44e500]/70" />
        <div className="absolute inset-[3%] rounded-xl border border-[#44e500]/40" />

        <div className="relative flex h-full flex-col justify-between p-[6%]">
          <div className="flex items-center gap-[2%]">
            <img src="/logo-orc.png" alt="ORC" className="h-[6.75cqw] w-auto rounded-lg" />
            <div className="leading-tight">
              <p className="text-[2.16cqw] font-semibold tracking-[0.2em] text-[#44e500]">
                TRILHA DE CONHECIMENTO ORC
              </p>
              <p className="text-[1.62cqw] text-white/70">Certificado de conclusão</p>
            </div>
          </div>

          <div className="space-y-[2%]">
            <p className="text-[1.89cqw] text-white/75">Parabéns,</p>
            <p className="text-[6.21cqw] font-extrabold leading-none tracking-tight">
              {name ? `${name.split(" ")[0]}! 🎉` : "você! 🎉"}
            </p>
            <div className="h-[3px] w-[18%] rounded-full bg-[#44e500]" />
            <p className="max-w-[70%] text-[1.96cqw] leading-snug text-white/85">
              Você concluiu a <strong className="text-white">trilha de onboarding</strong> do{" "}
              <strong className="text-white">{AREA_INFO[area].short}</strong> e já conhece o caminho
              das pedras por aqui. Agora é com você: bora caminhar com a gente! 🚗💨
            </p>
          </div>

          <div className="flex items-end justify-between gap-4">
            <p className="max-w-[60%] text-[2.03cqw] italic leading-snug text-[#c8ff9e]">
              “{frase}”
            </p>
            <div className="flex items-center gap-[2.03cqw]">
              <div className="text-right leading-tight">
                <p className="text-[1.62cqw] text-white/60">Concluído em</p>
                <p className="text-[1.89cqw] font-semibold">{data}</p>
              </div>
              <div className="flex aspect-square w-[10.8cqw] flex-col items-center justify-center rounded-full border-2 border-[#44e500] bg-[#44e500]/15 text-center">
                <GraduationCap className="size-[45%] text-[#44e500]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Imprimir ou salvar em PDF
        </button>
      </div>
    </section>
  );
}
