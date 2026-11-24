import { createFileRoute } from "@tanstack/react-router";
import { useKbAreaData } from "@/components/base-conhecimento/kb-context";
import { KbChat } from "@/components/base-conhecimento/KbChat";

// ?q= vem da busca, da página inicial ou de "Perguntar à IA sobre este artigo".
export const Route = createFileRoute("/_authenticated/base-conhecimento/$area/chat")({
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s["q"] === "string" && s["q"].trim() ? { q: s["q"].slice(0, 500) } : {},
  component: ChatPage,
});

function ChatPage() {
  const { q } = Route.useSearch();
  const data = useKbAreaData();
  return <KbChat key={data.area} data={data} initialQuestion={q} />;
}
