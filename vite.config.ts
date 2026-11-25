// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: { plugins: [mcpPlugin()] },
  // Só vale no deploy da Vercel (NITRO_PRESET=vercel); ignorado nos outros destinos.
  // O tipo do wrapper do Lovable não declara `vercel`, mas as opções passam direto para o Nitro.
  nitro: {
    vercel: {
      // Os syncs longos precisam de mais tempo por chamada (máx. 300s no plano Hobby com Fluid compute).
      functions: { maxDuration: 300 },
      // Syncs 3x ao dia: 08h, 12h e 16h de Brasília (UTC-3) = 11:00, 15:00 e 19:00 UTC.
      // Hobby só aceita cron que rode uma vez por dia, então são três programações separadas
      // (cada uma pode atrasar até 59 min nesse plano).
      config: {
        crons: [
          { path: "/api/public/sync/cron", schedule: "0 11 * * *" },
          { path: "/api/public/sync/cron", schedule: "0 15 * * *" },
          { path: "/api/public/sync/cron", schedule: "0 19 * * *" },
          // Base de Conhecimento: 1x por dia (06h de Brasília) confere o Drive; arquivo/pasta nova é
          // indexada e vira artigo. Sem mudança, só lista as pastas (sem custo de IA).
          { path: "/api/kb/sync", schedule: "0 9 * * *" },
        ],
      },
    },
  } as never,
});
