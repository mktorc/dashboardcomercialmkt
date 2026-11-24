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
   | `DRIVE_FOLDER_IDS` | os IDs do passo (c) |
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

Depois disso, o Vercel roda a sincronização todo dia às 06h (horário de Brasília) e reprocessa só
os arquivos alterados.

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
