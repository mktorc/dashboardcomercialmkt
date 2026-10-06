import { auth, defineMcp } from "@lovable.dev/mcp-js";
import marketingSummary from "./tools/marketing-summary";
import salesBySeller from "./tools/sales-by-seller";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "pixel-perfect-pixel",
  title: "Pixel Perfect Pixel",
  version: "0.1.0",
  instructions:
    "Painel de Analytics da Orlando Rent Car. Use `marketing_summary` para investimento, leads, CPL e ROAS, e `sales_by_seller` para desempenho de vendas por vendedor. Valores em USD.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [marketingSummary, salesBySeller],
});
