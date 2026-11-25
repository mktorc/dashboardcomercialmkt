# Base de Conhecimento: como configurar

O módulo **Base de Conhecimento** responde às dúvidas do time usando só os arquivos de algumas
pastas do Google Drive. Para funcionar, ele precisa de:

- uma **conta de serviço** do Google, que é um "usuário robô" com permissão só de leitura nas pastas;
- uma **chave da API do Gemini** (Google AI Studio, gratuita), para a IA;
- as **tabelas no Supabase**;
- as **variáveis cadastradas no Vercel**.

Ninguém faz login com Google no painel. Basta compartilhar as pastas com o robô.

---

## 0) Criar as tabelas no Supabase (uma vez)

1. Abra o projeto no Supabase e vá em **SQL Editor → New query**.
2. Cole o conteúdo do arquivo `sql-para-gravar/base_conhecimento.sql` e clique em **Run**.
3. O SQL cria as tabelas `kb_files`, `kb_chunks`, `kb_sync_runs` e `kb_ask_log`. Também libera o
   módulo `base-conhecimento` na lista de módulos permitidos.

---

## a) Criar o projeto no Google Cloud e a conta de serviço

1. Acesse <https://console.cloud.google.com/> com a sua conta Google.
2. No topo, clique no seletor de projetos e depois em **Novo projeto**. Dê um nome (ex.:
   `orlando-base-conhecimento`) e clique em **Criar**. Confira que o projeto novo está selecionado.
3. Ative a Drive API: menu **APIs e serviços → Biblioteca**, procure **Google Drive API** e clique
   em **Ativar**.
4. Crie a conta de serviço: menu **IAM e administrador → Contas de serviço → Criar conta de
   serviço**.
   - Nome: `base-conhecimento` (o resto pode ficar em branco). Clique em **Concluir**.
   - Ela não precisa de nenhum papel (role) no projeto.
5. Anote o **e-mail da conta de serviço**, que tem o formato
   `base-conhecimento@NOME-DO-PROJETO.iam.gserviceaccount.com`. Ele é usado no passo (b).
6. Baixe a chave: clique na conta criada, abra a aba **Chaves → Adicionar chave → Criar nova chave
   → JSON → Criar**. Um arquivo `.json` será baixado.
   > ⚠️ Esse arquivo é uma senha. Não mande por WhatsApp/e-mail nem coloque no código.
7. Converta o arquivo para base64 (uma linha só). No Mac, no Terminal:

   ```bash
   base64 -i ~/Downloads/NOME-DO-ARQUIVO.json | tr -d '\n' | pbcopy
   ```

   O resultado vai para a área de transferência. Esse é o valor de `GOOGLE_SERVICE_ACCOUNT_JSON`.

---

## b) O que a responsável do comercial precisa fazer

Para **cada pasta** que deve entrar na base:

1. No Google Drive, clique com o botão direito na pasta e escolha **Compartilhar**.
2. No campo de pessoas, cole o **e-mail da conta de serviço** (passo a.5).
3. Escolha a permissão **Leitor**, desmarque "Notificar pessoas" e clique em **Compartilhar**.
4. Copie o link da pasta (**Compartilhar → Copiar link**) e envie para quem administra o painel.

As subpastas entram automaticamente, sem precisar compartilhar uma por uma. Arquivos novos colocados
nessas pastas aparecem na próxima sincronização.

---

## c) Como tirar o ID da pasta do link

O link de uma pasta tem este formato:

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz123456?usp=sharing
```

O ID é o trecho entre `/folders/` e o `?` (ou até o fim do link):

```
1AbCdEfGhIjKlMnOpQrStUvWxYz123456
```

Com várias pastas, junte os IDs separados por vírgula, sem espaços:

```
1AbC...456,1XyZ...789
```

Esse é o valor de `DRIVE_FOLDER_IDS`.

---

## d) Criar a chave da API do Gemini (gratuita)

1. Acesse <https://aistudio.google.com/> com uma conta Google (pode ser a mesma do Google Cloud).
2. Clique em **Get API key → Criar chave de API**. Se pedir, escolha o projeto
   `orlando-base-conhecimento`.
3. Copie a chave (começa com `AIza`). Esse é o valor de `GEMINI_API_KEY`.

O modelo padrão é o `gemini-4-hydrogen`. Para usar outro, cadastre `GEMINI_MODEL` com o nome do
modelo.

> ⚠️ **Privacidade na camada gratuita:** sem faturamento ativado no projeto, o Google pode usar as
> perguntas e os trechos enviados para melhorar os produtos dele, e pessoas podem revisar esse
> conteúdo. Não coloque na pasta dados pessoais de clientes ou informações sigilosas. Se precisar
> disso, ative o faturamento no projeto (camada paga, cobrada por uso).

A camada gratuita tem limite de requisições por minuto e por dia. Se o time usar muito, o chat pode
responder "Falha ao consultar a IA" até o limite renovar. O painel também limita a 20 perguntas a
cada 10 minutos por usuário.

---

## e) Cadastrar as variáveis no Vercel e fazer o redeploy

1. Abra o projeto no Vercel → **Settings → Environment Variables**.
2. Cadastre, marcando **Production** (e **Preview**, se quiser testar no PR):

   | Variável | Valor |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | o base64 do passo (a.7) |
   | `DRIVE_FOLDERS_COMERCIAL` / `DRIVE_FOLDERS_CS` | os IDs das pastas de cada área (veja "Áreas") |
   | `DRIVE_FOLDER_IDS` | (opcional) pasta de conteúdo compartilhado |
   | `GEMINI_API_KEY` | a chave do passo (d) |
   | `KB_SYNC_SECRET` | uma senha longa e aleatória (ex.: gere com `openssl rand -hex 32`) |

   O agendamento diário do Vercel envia o `CRON_SECRET` do projeto, que já é usado pelos outros
   syncs, e a rota aceita esse valor. Se o `CRON_SECRET` não existir no projeto, cadastre-o também.
3. Vá em **Deployments**, abra o último deploy, clique nos **⋯** e escolha **Redeploy**. As
   variáveis só valem depois de um novo deploy.

---

## f) Primeira sincronização e teste

1. Libere o módulo para as pessoas: no painel, **Configurações** → marque **Base de Conhecimento**
   nos usuários que devem usar (Admins já têm acesso).
2. Abra **Base de Conhecimento → aba Arquivos** e clique em **Sincronizar agora**.
   - A primeira vez pode levar alguns minutos. Se houver muitos arquivos, a sincronização termina
     como "parcial" e basta clicar de novo para continuar de onde parou.
   - Cada arquivo aparece com um status: **Indexado**, **Ignorado** (tipo não suportado, como
     imagens e vídeos), **Sem texto** (ex.: PDF escaneado, só imagem) ou **Erro** (passe o mouse
     no detalhe para ver o motivo).
3. Vá para a aba **Chat** e faça uma pergunta cuja resposta você sabe que está em algum arquivo.
   A resposta deve citar os arquivos com link no final.
4. Faça também uma pergunta que **não** está nos arquivos. A resposta esperada é *"Não encontrei
   essa informação nos arquivos da base."*

Depois disso, o Vercel roda a sincronização uma vez por dia, às 06h (horário de Brasília), e reprocessa só os arquivos alterados.

Para disparar manualmente de fora do painel:

```bash
curl -X POST https://SEU-DOMINIO/api/kb/sync -H "Authorization: Bearer $KB_SYNC_SECRET"
```

### Tipos de arquivo lidos

- **Texto direto:** Google Docs, Google Sheets (como CSV), Google Slides, PDF com texto, Word
  (.docx), .txt, .md e .csv.
- **Lidos pela IA (Gemini):**
  - **vídeos** (.mp4, .mov, .webm etc., até 1 GB): o Gemini gera resumo, passo a passo,
    transcrição da fala e os textos que aparecem na tela;
  - **imagens** (.jpg, .png, .webp, .heic): transcrição do texto e descrição;
  - **PDFs escaneados ou feitos de imagens** (menos de 300 caracteres de texto por página).

Os outros tipos são ignorados e aparecem na aba Arquivos como "Ignorado".

**Vídeos levam tempo.** Cada sincronização processa os documentos primeiro e depois só os vídeos
que couberem em cerca de 4 minutos (um vídeo de 20 minutos leva de 1 a 2 minutos). O restante fica
para a próxima rodada e o status aparece como "parcial". Na primeira vez, clique em **Sincronizar
agora** algumas vezes até não sobrar nada pendente. Depois disso, só arquivos novos ou alterados
são processados. Se um vídeo der erro (por exemplo, por atingir o limite gratuito do Gemini), ele
é tentado de novo na sincronização seguinte.

### Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Sincronização "com erro": *File not found* | A pasta não foi compartilhada com o e-mail da conta de serviço ou o ID está errado |
| *GOOGLE_SERVICE_ACCOUNT_JSON não configurada* | Variável não cadastrada ou faltou o redeploy |
| Chat responde "Falha ao consultar a IA" | Chave do Gemini errada ou limite gratuito atingido (veja o log da função no Vercel) |
| "Acesso negado" | O usuário não tem o módulo marcado em Configurações |

---

## Áreas: Comercial e CS

A base é dividida em duas áreas, cada uma com os próprios artigos, busca e chat:

- **Comercial** e **Sucesso do Cliente (CS)**. Conteúdo comum (políticas, frota, manual do cliente)
  aparece nas duas, marcado como **Compartilhado**.
- **Acesso:** em **Configurações**, marque para cada usuário o módulo
  **Base de Conhecimento - Comercial** e/ou **Base de Conhecimento - CS**. Admin vê as duas áreas e a
  página de Administração. Quem não tem a área recebe **403** do servidor nos artigos, no chat e no
  voto (não é só o menu que esconde).
- Rode antes o SQL `sql-para-gravar/base_conhecimento_areas.sql` no Supabase. Ele cria as colunas de
  área, as tabelas de visualizações e votos, e troca o módulo antigo `base-conhecimento` pelos dois novos.

### Como organizar as pastas no Drive

Crie uma pasta por área e, dentro dela, uma subpasta por assunto. **As subpastas viram as categorias**
dos arquivos (na Administração e nas fontes do chat).

```
Base de Conhecimento - Comercial/      → DRIVE_FOLDERS_COMERCIAL
  Regras e processos/
  Objeções/
  Templates de mensagem   (Google Docs)
Base de Conhecimento - CS/             → DRIVE_FOLDERS_CS
  Rotina/
  Pedágios/
  Templates de mensagem   (Google Docs)
```

1. Compartilhe cada pasta de área com o e-mail da conta de serviço como **Leitor** (como no passo b).
2. No Vercel, cadastre os IDs (passo c) em:

   | Variável | Valor |
   |---|---|
   | `DRIVE_FOLDERS_COMERCIAL` | ID(s) da pasta do Comercial, separados por vírgula |
   | `DRIVE_FOLDERS_CS` | ID(s) da pasta do CS, separados por vírgula |
   | `DRIVE_FOLDER_IDS` | (opcional) pastas de conteúdo **compartilhado** pelas duas áreas |

3. Faça o redeploy e clique em **Sincronizar** na Administração.

Enquanto as pastas não forem separadas, a pasta atual (em `DRIVE_FOLDER_IDS`) continua funcionando
e conta como compartilhada: o chat das duas áreas usa os mesmos arquivos.

### Documento "Templates de mensagem"

Para os templates aparecerem com o texto completo e o botão **Copiar**, crie em cada pasta de área
um Google Docs chamado **Templates de mensagem**:

- Cada template começa com o **nome em estilo de título** (Formatar → Estilos de parágrafo →
  Título 1, 2 ou 3), por exemplo `Boa viagem CS`.
- Abaixo do título, o texto da mensagem, do jeito que é enviado.
- Variáveis entre colchetes ou chaves ficam destacadas: `[NOME]`, `{data}`, `{{valor}}`.

Na sincronização seguinte, cada template vira um bloco com **Copiar**, na página Templates e dentro
dos artigos onde o nome dele aparece. Sem o documento, aparece só o nome do template.

---

## Artigos organizados

Os artigos são gerados automaticamente pela IA a partir dos arquivos das pastas `COMERCIAL` e `CS`.

- A cada sincronização (diária às 06h ou pelo botão), arquivo novo ou alterado, inclusive de uma
  pasta nova, vira um ou mais artigos com etapas, tabelas e avisos. Arquivo que saiu do Drive some.
- Cada artigo aparece só na área da pasta de onde veio. A subpasta vira a categoria na barra lateral.
- Arquivo sem mudança reaproveita o artigo já gerado (`gen/<id>.json` no bucket `kb`). Se o tempo da
  sincronização acabar, o resto fica para a próxima rodada e o status aparece como "parcial".
- Os artigos escritos à mão antes da geração automática ficam guardados em
  `articles-manual-backup.json`, no bucket `kb`.
- Para corrigir um artigo, ajuste o arquivo de origem no Drive. Na próxima sincronização ele é
  refeito.
