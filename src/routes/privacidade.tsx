import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade | Orlando Rent Car Analytics" },
      { name: "description", content: "Política de privacidade do painel interno Orlando Rent Car Analytics." },
    ],
  }),
  component: Privacidade,
});

function Privacidade() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Orlando Rent Car Analytics</h1>
      <p>
        Painel interno de uso exclusivo da equipe da Orlando Rent Car, que reúne dados de marketing, comercial e
        reservas da própria empresa.
      </p>
      <h2 className="text-lg font-semibold">Política de Privacidade</h2>
      <p>
        <strong>Dados acessados.</strong> O painel se conecta à conta de Google Ads da Orlando Rent Car, com permissão
        somente de leitura, para obter métricas de campanhas (custo, cliques, impressões e conversões). Nenhum dado
        pessoal de usuários do Google é lido, vendido ou compartilhado.
      </p>
      <p>
        <strong>Uso.</strong> Os dados são usados apenas para exibir indicadores de desempenho à equipe autorizada e
        ficam armazenados em banco de dados protegido por autenticação e controle de acesso por perfil.
      </p>
      <p>
        <strong>Compartilhamento.</strong> Não compartilhamos esses dados com terceiros, exceto prestadores de
        infraestrutura necessários ao funcionamento do painel (hospedagem e banco de dados).
      </p>
      <p>
        <strong>Contato e exclusão.</strong> Para dúvidas ou para revogar o acesso, entre em contato com
        matheushcoliveira@gmail.com. O acesso também pode ser revogado a qualquer momento em
        myaccount.google.com/permissions.
      </p>
    </main>
  );
}
