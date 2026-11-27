import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileText, MessageSquare, Search } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { buildIndex, quickAnswer, searchArticles } from "./kb-search";
import { useLogMiss, type KbAreaData } from "./kb-api";

/** Abre com Ctrl/⌘ + K. Busca dentro da área, agrupa por categoria e destaca o trecho. */
export function KbSearchPalette({
  data,
  open,
  onOpenChange,
}: {
  data: KbAreaData;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const index = useMemo(() => buildIndex(data.articles), [data.articles]);
  const hits = useMemo(() => searchArticles(index, q, 25), [index, q]);
  const answer = useMemo(() => quickAnswer(data.articles, q), [data.articles, q]);
  useLogMiss(data.area, q, !hits.length && !answer);
  const catTitle = (id: string) => data.categories.find((c) => c.id === id)?.title ?? id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const groups = new Map<string, typeof hits>();
  for (const h of hits)
    groups.set(h.article.category, [...(groups.get(h.article.category) ?? []), h]);

  const go = (artigo: string) => {
    onOpenChange(false);
    void navigate({ to: "/base-conhecimento/$area/$artigo", params: { area: data.area, artigo } });
  };
  const ask = () => {
    onOpenChange(false);
    void navigate({
      to: "/base-conhecimento/$area/chat",
      params: { area: data.area },
      search: { q },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] max-w-2xl translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Buscar na base</DialogTitle>
        <Command shouldFilter={false} className="bg-popover">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar processos, regras, templates…"
              className="h-14 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
              ESC
            </kbd>
          </div>
          <CommandList className="max-h-[60vh]">
            {q.trim() && (
              <CommandEmpty className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nada encontrado para “{q}”.
              </CommandEmpty>
            )}
            {!q.trim() && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Digite para buscar. Erros de digitação e acentos não atrapalham.
              </p>
            )}
            {answer && (
              <CommandGroup heading="Resposta">
                <CommandItem
                  value="__answer"
                  onSelect={() => go(answer.article.id)}
                  className="flex cursor-pointer items-center gap-3 rounded-md bg-primary/10 px-3 py-3"
                >
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {answer.value}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {answer.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      em {answer.article.title}
                    </span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {[...groups.entries()].map(([cat, items]) => (
              <CommandGroup key={cat} heading={catTitle(cat)}>
                {items.map((h) => (
                  <CommandItem
                    key={h.article.id}
                    value={h.article.id}
                    onSelect={() => go(h.article.id)}
                    className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5"
                  >
                    <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {h.article.title}
                      </p>
                      {h.snippet && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {h.snippet.before}
                          <mark className="rounded bg-primary/30 px-0.5 text-foreground">
                            {h.snippet.match}
                          </mark>
                          {h.snippet.after}
                        </p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {q.trim() && (
              <CommandGroup heading="Não achou?">
                <CommandItem
                  value="__ask"
                  onSelect={ask}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5"
                >
                  <MessageSquare className="size-4 text-primary" />
                  <span className="text-sm">
                    Perguntar à ORCI: <span className="font-medium">“{q}”</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
