import { createFileRoute } from "@tanstack/react-router";
import { useKbAreaData } from "@/components/base-conhecimento/kb-context";
import { KbHome } from "@/components/base-conhecimento/KbPages";

export const Route = createFileRoute("/_authenticated/base-conhecimento/$area/")({
  component: AreaHomePage,
});

function AreaHomePage() {
  return <KbHome data={useKbAreaData()} />;
}
