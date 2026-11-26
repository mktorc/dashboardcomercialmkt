import { dehydrate, hydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";

// Guarda no navegador (IndexedDB) os dados do Dashboard já carregados: ao abrir de novo, a tela
// aparece na hora com a última carga e as consultas se atualizam em segundo plano.
const DB = "dash-cache";
const STORE = "kv";
const KEY = "queries-v1";
const MAX_IDADE_MS = 24 * 60 * 60_000;
// Só as consultas pesadas do Dashboard.
const PERSISTIR = new Set(["analytics", "analytics-12m", "analytics-12m-prior", "team-costs"]);

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function op<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await abrir();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, modo).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function limparCacheLocal() {
  if (typeof indexedDB === "undefined") return;
  await op("readwrite", (s) => s.delete(KEY)).catch(() => {});
}

/** Restaura o cache salvo e passa a salvar as mudanças. Devolve a função de desligar. */
export function persistirConsultas(qc: QueryClient): () => void {
  if (typeof indexedDB === "undefined") return () => {};
  let ativo = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const salvar = () => {
    timer = null;
    const estado = dehydrate(qc, {
      shouldDehydrateQuery: (q) =>
        q.state.status === "success" && PERSISTIR.has(String(q.queryKey[0])),
    });
    void op("readwrite", (s) => s.put({ salvoEm: Date.now(), estado }, KEY)).catch(() => {});
  };

  void op<{ salvoEm: number; estado: DehydratedState } | undefined>("readonly", (s) => s.get(KEY))
    .then((salvo) => {
      if (!ativo || !salvo) return;
      if (Date.now() - salvo.salvoEm > MAX_IDADE_MS) return void limparCacheLocal();
      // hydrate não sobrescreve dados mais novos que já estejam em memória.
      hydrate(qc, salvo.estado);
    })
    .catch(() => {});

  const unsub = qc.getQueryCache().subscribe((ev) => {
    if (ev.type !== "updated" || ev.action.type !== "success") return;
    if (!PERSISTIR.has(String(ev.query.queryKey[0]))) return;
    if (!timer) timer = setTimeout(salvar, 2_000);
  });

  return () => {
    ativo = false;
    unsub();
    if (timer) clearTimeout(timer);
  };
}
