import { createContext, useContext } from "react";
import type { KbAreaData } from "./kb-api";

// Dados da área carregados pelo layout (/base-conhecimento/$area) e usados pelas páginas filhas.
export const KbAreaContext = createContext<KbAreaData | null>(null);

export function useKbAreaData(): KbAreaData {
  const d = useContext(KbAreaContext);
  if (!d) throw new Error("useKbAreaData fora do layout da área");
  return d;
}
