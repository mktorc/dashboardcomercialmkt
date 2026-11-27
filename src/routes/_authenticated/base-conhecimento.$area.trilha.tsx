import { createFileRoute } from "@tanstack/react-router";
import { useKbAreaData } from "@/components/base-conhecimento/kb-context";
import { KbTrilhaPage } from "@/components/base-conhecimento/KbPages";

export const Route = createFileRoute("/_authenticated/base-conhecimento/$area/trilha")({
  component: TrilhaPage,
});

function TrilhaPage() {
  return <KbTrilhaPage data={useKbAreaData()} />;
}
