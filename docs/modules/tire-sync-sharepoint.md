# Gestão de Pneus › Sincronização com a fonte oficial (SharePoint)

Aba: `/frota/pneus?aba=sincronizacao` ("Sincronização Rodopar") · Permissão:
`tires.import` (sincronizar/reprocessar; ver também com `tires.audit.view`) ·
Configuração do local do arquivo: Parâmetros › Fonte oficial
(`tires.parameters.manage`) · Migration:
`supabase/migrations/20261007100000_tires_sharepoint_sync.sql` · Código:
`src/lib/tires/sync/{graph,engine,server}.ts`, rota agendada
`src/app/api/tires/sync/route.ts`, `vercel.json` · Testes:
`tests/integration/tires-sync.spec.ts` (`npx playwright test -c playwright.integration.config.ts`).

A planilha **Base Geral Pneus Rodorpar.xlsx** (site *Horizonte Fleet
Management* › Documentos Compartilhados › Gestão de Pneus) é a fonte
operacional oficial. O HFM a busca sozinho e a aplica pelo **mesmo pipeline**
da importação manual (`tire_import_start → stage → validate → confirm`): o
HFM estrutura, normaliza, historiza e calcula — a planilha continua sendo a
origem dos dados. O envio manual do XLSX ficou como **contingência**.

```
agenda (Vercel Cron) / "Sincronizar agora"
  → tire_sync_begin (trava, intervalo mínimo, execução presa expira)
  → Microsoft Graph: site → biblioteca → arquivo (ids guardados) → eTag
  → sem mudança? encerra "sem alteração"
  → download + SHA-256 → leitura (mesmo leitor da importação) → estrutura
  → data de referência = maior "Data última alteração" (nunca futura)
  → lote (sharepoint) → linhas em partes → validação/comparação → confirmação
  → tire_sync_finish (status, contadores, trilha, alerta de falha no outbox)
```

## 1. Integração segura (sem URL pública)

- **Microsoft Graph com credenciais de aplicativo** (client credentials do
  Entra ID). A URL da interface do SharePoint é só referência visual
  (`web_url`); o arquivo é localizado por **site → biblioteca → caminho**, e os
  ids resolvidos (site, drive, item) ficam guardados em `tire_sync_sources`.
  Se o item for substituído ou movido, a localização é refeita pelo caminho.
- Credenciais **só no servidor** (variáveis de ambiente da Vercel, nunca no
  banco nem no navegador):

  | Variável | Conteúdo |
  |---|---|
  | `MS_GRAPH_TENANT_ID` | Id do diretório (tenant) do Entra ID do Grupo Horizonte |
  | `MS_GRAPH_CLIENT_ID` | Id do aplicativo registrado |
  | `MS_GRAPH_CLIENT_SECRET` | Segredo do aplicativo (validade controlada pela TI) |
  | `CRON_SECRET` | Segredo que autoriza a rota agendada (a Vercel o envia no `Authorization`) |
  | `SUPABASE_SERVICE_ROLE_KEY` | Já existente: usado só pela execução agendada |

- **Permissão recomendada:** `Sites.Selected` (aplicativo) concedida **só** ao
  site *HorizonteFleetManagement*, com papel de leitura. Alternativa mais ampla:
  `Sites.Read.All` ou `Files.Read.All` (aplicativo), com consentimento do
  administrador.
- Tempo limite por chamada, repetição só do que é transitório (429/5xx com
  `Retry-After`), limite de tamanho do arquivo (40 MB) e códigos de erro
  estáveis (`credenciais_ausentes`, `graph_autenticacao`, `graph_sem_permissao`,
  `graph_nao_encontrado`, `graph_indisponivel`, `graph_tempo_esgotado`,
  `arquivo_grande_demais`).

### Como habilitar (TI do Grupo Horizonte)

1. Entra ID › Registros de aplicativo › **Novo registro** ("HFM — Leitura
   Base Pneus"), conta única do diretório.
2. Permissões de API › Microsoft Graph › **Permissões de aplicativo** ›
   `Sites.Selected` › conceder consentimento do administrador.
3. Conceder ao aplicativo leitura **apenas** no site (Graph:
   `POST /sites/{site-id}/permissions` com `roles: ["read"]` e a identidade do
   aplicativo; ou PnP `Grant-PnPAzureADAppSitePermission -Permissions Read`).
4. Certificados e segredos › **Novo segredo** (anotar validade).
5. Vercel › projeto `horizonte-fleet-management` › Environment Variables:
   `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` e
   `CRON_SECRET` (produção) → novo deploy.
6. No HFM: Gestão de Pneus › Sincronização Rodopar › **Sincronizar agora**.
   O resultado e o log por etapa ficam no histórico de sincronizações.

Sem as credenciais, cada tentativa fica registrada como **falhou —
credenciais ausentes** (nada é alterado), e o envio manual segue disponível.

## 2. Agenda

`vercel.json` agenda `GET /api/tires/sync` **diariamente às 00:00 UTC (21:00
em Brasília)** — antes da captura semanal dos indicadores (sexta, 22:00). A
rota só aceita `Authorization: Bearer <CRON_SECRET>` e, sem o segredo,
recusa tudo. Para rodar mais vezes por dia (plano Pro), basta adicionar
horários no `vercel.json`; o **intervalo mínimo** (`min_interval_minutes`,
padrão 60) e a trava no banco impedem execuções sobrepostas ou repetidas.

## 3. Garantias

| Garantia | Como |
|---|---|
| Sem execução duplicada | Índice único "uma em andamento por fonte"; execução presa há mais de 20 min é encerrada como falha com motivo. |
| Idempotência | eTag igual → "sem alteração" (nem baixa); conteúdo igual (SHA-256) ou arquivo já confirmado → "sem alteração". |
| Estrutura | Colunas oficiais ausentes → **bloqueada** (`estrutura_invalida`), nada gravado; colunas novas não reconhecidas são registradas e ignoradas. |
| Data | Planilha mais antiga que os dados vigentes → **bloqueada** (`referencia_desatualizada`). |
| Novos/alterados/removidos | A comparação do banco classifica novos, alterados (por tipo), sem mudança, ausentes e reaparecidos; ausentes **nunca** são excluídos. |
| Mesma data | **Revisão do dia**: o lote anterior da data vira `superseded`; cada linha alterada é arquivada inteira em `tire_snapshot_revisions` antes da atualização (gatilho); pneu que saiu da planilha no mesmo dia fica `removed_in_revision` (arquivado) e passa a ausente. Datas anteriores nunca são tocadas. |
| Lote bloqueado | Erros bloqueantes (Nº Fogo duplicado, dois pneus na mesma posição…) deixam o lote `blocked` visível na prévia; a próxima sincronização encerra lotes abertos antigos. |
| Reprocessamento controlado | "Reprocessar" (execução bloqueada/falhou) baixa e revalida mesmo sem mudança de versão; fica registrado (`trigger = reprocessamento`, `reprocess_of`). |
| Rastreabilidade | `tire_sync_runs`: quem/quando, gatilho, arquivo (nome, eTag, modificação, tamanho, hash), data dos dados, lote, estrutura, contadores, erro e log por etapa; `tire_import_batches.source_kind/sync_run_id`; trilha em `tire_audit_events` (`sync.*`, `import.confirmed`/`import.revised`); falhas publicam `tires.sync.failed` no outbox. |
| Autoria | "Sincronizar agora" roda com o cliente da própria pessoa (permissão conferida no banco, autoria nos registros); a agendada aparece como "Sincronização automática (SharePoint)". |

## Fora do Escopo Atual

### CPK DE PNEUS

A sincronização traz apenas os dados operacionais do Rodopar. Nenhum dado de
custo, CPK, custo por vida ou recapagem é lido, calculado ou importado.
