import { createFileRoute } from "@tanstack/react-router";
import { useKbAreaData } from "@/components/base-conhecimento/kb-context";
import { KbTemplatesPage } from "@/components/base-conhecimento/KbPages";

export const Route = createFileRoute("/_authenticated/base-conhecimento/$area/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  return <KbTemplatesPage data={useKbAreaData()} />;
}
