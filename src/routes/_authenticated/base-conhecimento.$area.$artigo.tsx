import { createFileRoute } from "@tanstack/react-router";
import { useKbAreaData } from "@/components/base-conhecimento/kb-context";
import { KbArticle } from "@/components/base-conhecimento/KbArticle";

export const Route = createFileRoute("/_authenticated/base-conhecimento/$area/$artigo")({
  component: ArticlePage,
});

function ArticlePage() {
  const { artigo } = Route.useParams();
  return <KbArticle key={artigo} data={useKbAreaData()} articleId={artigo} />;
}
