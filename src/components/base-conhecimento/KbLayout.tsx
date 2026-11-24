import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BookOpen,
  ChevronRight,
  Home,
  LayoutGrid,
  Menu,
  MessageSquare,
  MessagesSquare,
  Search,
  Settings2,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AREA_INFO, type KbAreaData } from "./kb-api";
import { KbSearchPalette } from "./KbSearchPalette";

const navItem =
  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const navIdle = "text-muted-foreground hover:bg-muted/50 hover:text-foreground";
const navActive = "bg-primary/15 font-medium text-foreground";

function Sidebar({
  data,
  onSearch,
  onNavigate,
}: {
  data: KbAreaData;
  onSearch: () => void;
  onNavigate?: () => void;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = `/base-conhecimento/${data.area}`;
  const cats = data.categories.filter((c) => data.articles.some((a) => a.category === c.id));
  const activeArticle = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : "";
  const [openCats, setOpenCats] = useState<Set<string>>(() => {
    const cur = data.articles.find((a) => a.id === activeArticle)?.category;
    return new Set(cur ? [cur] : cats.slice(0, 1).map((c) => c.id));
  });
  const toggle = (id: string) =>
    setOpenCats((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Navegação da base">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Base de Conhecimento
          </p>
          <p className="truncate font-semibold text-foreground">{AREA_INFO[data.area].title}</p>
        </div>
        {data.areas.length > 1 && (
          <Link
            to="/base-conhecimento"
            onClick={onNavigate}
            title="Trocar de área"
            className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:border-primary hover:text-foreground"
          >
            <ArrowLeftRight className="size-4" />
          </Link>
        )}
      </div>

      <button
        type="button"
        onClick={onSearch}
        className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-left text-sm text-muted-foreground transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-4" />
        <span className="flex-1">Buscar…</span>
        <kbd className="rounded border border-border px-1.5 text-[10px]">⌘K</kbd>
      </button>

      <Link
        to="/base-conhecimento/$area"
        params={{ area: data.area }}
        onClick={onNavigate}
        className={`${navItem} ${path === base ? navActive : navIdle}`}
      >
        <Home className="size-4" /> Início
      </Link>

      <div className="mt-3 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {cats.map((c) => {
          const open = openCats.has(c.id);
          return (
            <div key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c.id)}
                aria-expanded={open}
                className={`${navItem} w-full justify-between font-medium text-foreground/90 hover:bg-muted/50`}
              >
                <span className="truncate">{c.title}</span>
                <ChevronRight
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                />
              </button>
              {open && (
                <div className="ml-3 space-y-0.5 border-l border-border pl-2">
                  {data.articles
                    .filter((a) => a.category === c.id)
                    .map((a) => (
                      <Link
                        key={a.id}
                        to="/base-conhecimento/$area/$artigo"
                        params={{ area: data.area, artigo: a.id }}
                        onClick={onNavigate}
                        className={`${navItem} ${activeArticle === a.id ? navActive : navIdle}`}
                      >
                        <span className="truncate">{a.title}</span>
                      </Link>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 space-y-0.5 border-t border-border pt-2">
        <Link
          to="/base-conhecimento/$area/templates"
          params={{ area: data.area }}
          onClick={onNavigate}
          className={`${navItem} ${path === `${base}/templates` ? navActive : navIdle}`}
        >
          <MessagesSquare className="size-4" /> Templates
        </Link>
        <Link
          to="/base-conhecimento/$area/chat"
          params={{ area: data.area }}
          onClick={onNavigate}
          className={`${navItem} ${path === `${base}/chat` ? navActive : navIdle}`}
        >
          <MessageSquare className="size-4" /> Chat com IA
        </Link>
        {data.admin && (
          <Link
            to="/base-conhecimento/admin"
            onClick={onNavigate}
            className={`${navItem} ${navIdle}`}
          >
            <Settings2 className="size-4" /> Administração
          </Link>
        )}
        <Link to="/app" onClick={onNavigate} className={`${navItem} ${navIdle}`}>
          <LayoutGrid className="size-4" /> Voltar aos módulos
        </Link>
      </div>
    </nav>
  );
}

export function KbLayout({ data, children }: { data: KbAreaData; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      {/* Celular: barra no topo com a gaveta */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted/50"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
        <BookOpen className="size-4 text-primary" />
        <span className="flex-1 truncate text-sm font-semibold">{AREA_INFO[data.area].title}</span>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted/50"
          aria-label="Buscar"
        >
          <Search className="size-5" />
        </button>
      </header>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-[290px] p-0">
          <SheetTitle className="sr-only">Menu da base</SheetTitle>
          <Sidebar
            data={data}
            onSearch={() => {
              setDrawer(false);
              setPalette(true);
            }}
            onNavigate={() => setDrawer(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 border-r border-border lg:block">
          <Sidebar data={data} onSearch={() => setPalette(true)} />
        </aside>
        <main className="min-w-0 flex-1 animate-in fade-in-0 duration-300">{children}</main>
      </div>
      <KbSearchPalette data={data} open={palette} onOpenChange={setPalette} />
    </div>
  );
}

export function KbLayoutSkeleton() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] bg-background">
      <aside className="hidden w-[280px] shrink-0 space-y-3 border-r border-border p-4 lg:block">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </aside>
      <main className="flex-1 space-y-4 p-6 sm:p-10">
        <Skeleton className="h-8 w-2/3 max-w-md" />
        <Skeleton className="h-12 w-full max-w-2xl" />
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </main>
    </div>
  );
}
