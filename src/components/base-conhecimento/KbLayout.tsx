import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BookOpen,
  ChevronRight,
  Home,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  MessagesSquare,
  Search,
  Settings2,
  Star,
  GraduationCap,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AREA_INFO, type KbAreaData } from "./kb-api";
import { KbSearchPalette } from "./KbSearchPalette";
import { catIcon } from "./kb-icons";
import { isRecent, useFavorites } from "./kb-api";

const navItem =
  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const navIdle = "text-muted-foreground hover:bg-muted/50 hover:text-foreground";
const navActive = "bg-primary/15 font-medium text-foreground";

function Sidebar({
  data,
  onSearch,
  onNavigate,
  onCollapse,
}: {
  data: KbAreaData;
  onSearch: () => void;
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = `/base-conhecimento/${data.area}`;
  const hasArticles = (id: string) =>
    data.articles.some((a) => a.category === id) ||
    data.categories.some((k) => k.parent === id && data.articles.some((a) => a.category === k.id));
  const cats = data.categories.filter((c) => !c.parent && hasArticles(c.id));
  const rootOf = (id: string | undefined) => {
    const c = data.categories.find((k) => k.id === id);
    return c?.parent ? [c.parent, c.id] : id ? [id] : [];
  };
  const activeArticle = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : "";
  const [openCats, setOpenCats] = useState<Set<string>>(() => {
    const cur = data.articles.find((a) => a.id === activeArticle)?.category;
    return new Set(cur ? rootOf(cur) : cats.slice(0, 1).map((c) => c.id));
  });
  const toggle = (id: string) =>
    setOpenCats((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const favIds = useFavorites(data.area);
  const favArts = favIds
    .map((id) => data.articles.find((a) => a.id === id))
    .filter((a): a is KbAreaData["articles"][number] => !!a);
  return (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Navegação da base">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/logo-orc.png" alt="Orlando Rent Car" className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Base de Conhecimento</p>
            <p className="font-semibold leading-tight text-foreground">
              {AREA_INFO[data.area].title}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Recolher barra lateral"
              title="Recolher barra lateral"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:border-primary hover:text-foreground"
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
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
      </div>

      {data.areas.length > 1 && (
        <div className="mb-2">
          <p className="px-1 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Áreas
          </p>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/30 p-1">
            {data.areas.map((a) => (
              <Link
                key={a}
                to="/base-conhecimento/$area"
                params={{ area: a }}
                onClick={onNavigate}
                className={`flex min-h-9 items-center justify-center rounded px-2 py-1.5 text-center text-sm leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  a === data.area
                    ? "bg-primary/15 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                {AREA_INFO[a].short}
              </Link>
            ))}
          </div>
        </div>
      )}

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
        {favArts.length > 0 && (
          <div className="mb-2 space-y-0.5 rounded-xl bg-primary/5 p-1.5">
            <p className="flex items-center gap-2 px-2 py-1 text-sm font-medium text-foreground">
              <Star className="size-4 fill-current text-primary" /> Meus favoritos
            </p>
            {favArts.map((a) => (
              <Link
                key={a.id}
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: a.id }}
                onClick={onNavigate}
                className={`${navItem} ${activeArticle === a.id ? navActive : navIdle}`}
              >
                <span className="line-clamp-2">{a.title}</span>
              </Link>
            ))}
          </div>
        )}
        {cats.map((c) => {
          const open = openCats.has(c.id);
          const kids = data.categories.filter((k) => k.parent === c.id && hasArticles(k.id));
          const link = (a: KbAreaData["articles"][number]) => (
            <Link
              key={a.id}
              to="/base-conhecimento/$area/$artigo"
              params={{ area: data.area, artigo: a.id }}
              onClick={onNavigate}
              className={`${navItem} ${activeArticle === a.id ? navActive : navIdle}`}
            >
              <span className="line-clamp-2">{a.title}</span>
              {isRecent(a.updatedAt) && (
                <span
                  aria-label="Atualizado esta semana"
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
                />
              )}
            </Link>
          );
          return (
            <div key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c.id)}
                aria-expanded={open}
                className={`${navItem} w-full justify-between font-medium text-foreground/90 hover:bg-muted/50`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-primary">{catIcon(c.title)}</span>
                  <span className="truncate">{c.title}</span>
                </span>
                <ChevronRight
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                />
              </button>
              {open && (
                <div className="ml-3 space-y-0.5 border-l border-border pl-2">
                  {data.articles.filter((a) => a.category === c.id).map(link)}
                  {kids.map((k) => {
                    const kOpen = openCats.has(k.id);
                    return (
                      <div key={k.id}>
                        <button
                          type="button"
                          onClick={() => toggle(k.id)}
                          aria-expanded={kOpen}
                          className={`${navItem} w-full justify-between font-medium text-foreground/80 hover:bg-muted/50`}
                        >
                          <span className="line-clamp-2">{k.title}</span>
                          <ChevronRight
                            className={`size-4 shrink-0 text-muted-foreground transition-transform ${kOpen ? "rotate-90" : ""}`}
                          />
                        </button>
                        {kOpen && (
                          <div className="ml-3 space-y-0.5 border-l border-border pl-2">
                            {data.articles.filter((a) => a.category === k.id).map(link)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 space-y-0.5 border-t border-border pt-2">
        <Link
          to="/base-conhecimento/$area/trilha"
          params={{ area: data.area }}
          onClick={onNavigate}
          className={`${navItem} ${path === `${base}/trilha` ? navActive : navIdle}`}
        >
          <GraduationCap className="size-4" /> Trilha de onboarding
        </Link>
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
          <MessageSquare className="size-4" /> ORCI
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
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("kb-sidebar-collapsed") === "1");
    } catch {
      /* sem armazenamento: começa aberta */
    }
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("kb-sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* ignora */
      }
      return !c;
    });
  return (
    <div className="kb-orc min-h-screen bg-background">
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

      <div className="mx-auto flex max-w-[1920px]">
        {!collapsed && (
          <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 border-r border-border lg:block">
            <Sidebar data={data} onSearch={() => setPalette(true)} onCollapse={toggle} />
          </aside>
        )}
        <main className="relative min-w-0 flex-1 animate-in fade-in-0 duration-300">
          {collapsed && (
            <div className="sticky top-0 z-20 hidden items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur lg:flex">
              <button
                type="button"
                onClick={toggle}
                aria-label="Expandir barra lateral"
                title="Expandir barra lateral"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                <PanelLeftOpen className="size-4" />
              </button>
              <BookOpen className="size-4 text-primary" />
              <span className="flex-1 truncate text-sm font-semibold">
                {AREA_INFO[data.area].title}
              </span>
              <button
                type="button"
                onClick={() => setPalette(true)}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Search className="size-4" /> Buscar
              </button>
            </div>
          )}
          {children}
        </main>
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
