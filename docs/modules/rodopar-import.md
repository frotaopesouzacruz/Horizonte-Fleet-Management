# Gestão de Pneus › Pipeline oficial Rodopar 10 (sincronização e contingência)

Rota: `/frota/pneus?aba=sincronizacao` (Sincronização Rodopar; o envio manual
fica em "Envio manual (contingência)") · Permissão: `tires.import` (ver o
histórico também com `tires.audit.view`) · Rotinas: `tire_import_start`,
`tire_import_stage`, `tire_import_validate`, `tire_import_preview`,
`tire_import_confirm`, `tire_import_cancel`, `tire_import_history`
(`supabase/migrations/20261006102000_tires_import.sql`).

O relatório **Rodopar 10** é a fonte oficial dos pneus — desde 07/10/2026
lido **automaticamente** da planilha *Base Geral Pneus Rodorpar.xlsx* no
SharePoint (ver [`tire-sync-sharepoint.md`](./tire-sync-sharepoint.md)). Cada
arquivo confirmado vira os **dados da data de referência**
(`tire_daily_snapshots`, uma linha por pneu × data). O cadastro do pneu
(`tires`) é a identidade; os dados diários são o estado naquela data.

```
LER (servidor na sincronização · navegador no envio manual) → VALIDAR → COMPARAR
  → PRÉVIA → CONFIRMAR → DADOS DA DATA → HISTÓRICO
```

A sincronização e o envio manual usam **o mesmo leitor**
(`readRodoparWorkbook`) e **as mesmas rotinas** abaixo; a diferença é só a
origem (`source_kind = sharepoint | upload`) e que a sincronização confirma
sozinha quando não há erro bloqueante.

---

## 1. Leitura (navegador)

`src/lib/tires/rodopar-sheet.ts` (`readRodoparWorkbook`) + `src/lib/tires/import-client.ts`.

- Procura o cabeçalho nas primeiras 30 linhas de cada aba; a janela oficial vai
  de **N.Fogo** a **Borracha** (layout `rodopar10_v1`). Colunas fora da janela
  são registradas como ignoradas; colunas desconhecidas, como não reconhecidas —
  **nenhuma coluna é inventada**.
- Cabeçalhos são comparados sem acento/maiúsculas (aliases em `RODOPAR_ALIASES`).
- Obrigatórias: Nº Fogo, Situação Pneu, N. Frota, Posição, Sulco 1–4,
  Dt. Medição, Calibragem, Dt. Calibragem, N. Vida. Faltando alguma, o envio
  não começa.
- **Nº Fogo é texto**: um inteiro vindo como número vira `String(n)` sem `.0`;
  zeros à esquerda ficam. Nunca é convertido para número.
- Datas viram horário de parede `AAAA-MM-DDTHH:MM:SS` (sem fuso); uma data
  gravada em coluna numérica volta ao número serial do Excel e recebe a marca
  `numero_formatado_como_data` (o valor bruto é preservado em `raw`).
- A data de referência sugerida é a **maior data de atualização** do arquivo
  (não a data de cadastro, não `created_at`). A pessoa confirma ou altera.
- O hash SHA-256 do arquivo é calculado no navegador (idempotência).

Linhas vão ao banco em partes de 300 (`tire_import_stage`, reenviar a mesma
parte não duplica). **Nada é gravado no cadastro de pneus durante a leitura nem
na validação** — só na área de preparação do lote (`tire_import_staging`).

## 2. Abertura do lote (`tire_import_start`)

- Data de referência obrigatória, não futura e **posterior** aos últimos dados
  confirmados (`tire_reference_not_after_latest`) — ou **igual**, como
  **revisão do mesmo dia** (`replace_same_day`, usada pela sincronização): o
  lote confirmado da data passa a `superseded` na confirmação e cada linha
  alterada é arquivada em `tire_snapshot_revisions` antes de ser atualizada.
- O mesmo arquivo (mesmo hash) já confirmado é recusado
  (`unique_violation`, hint `tire_duplicate_file`) — reimportar não duplica.

## 3. Validação, enriquecimento e comparação (`tire_import_validate`)

Uma só rotina (`private.tire_import_run_validation`) alimenta a prévia e a
confirmação:

| Etapa | O que faz |
|---|---|
| Normalização | Nº Fogo (`private.tire_fire_number`), posição, dimensão, situação canônica (`private.tire_canonical_status`: em_uso, estoque, ressolagem, descartado, baixado, outro — a coluna *Condição* é recomendação e nunca decide a situação). |
| Sulco | Menor milimetragem **calculada** a partir dos sulcos 1–4 × **informada** pelo Rodopar; diferença acima da tolerância vira `menor_mm_divergente` (os dois valores são guardados). |
| Limites | Sulco e PSI acima do limite técnico vigente (`max_valid_tread_mm`, `max_valid_psi`) → inválidos; datas futuras além da tolerância → `data_futura`. |
| KM | KM Real negativo é **problema de qualidade** (`km_real_negativo`), nunca somado. O KM dos pneus não substitui a Gestão de KM. |
| Enriquecimento | N. Frota → veículo do Cadastro de Frotas (por código de frota/placa); contexto (operação, UF, cidade, BR, liderança, filial) resolvido na data. **Nenhum veículo é criado**; frota desconhecida vira `frota_nao_encontrada`. |
| Coerência | Em uso sem frota/posição, fora de uso com frota, posição fora do dicionário, vida que regride, pneu que volta após descarte. |
| Comparação | Contra os dados da data anterior (nunca contra a versão do mesmo dia): novo, atualizado (com o tipo de mudança: medição, calibragem, posição, frota, vida, situação…), sem mudança; pneus da data anterior que **não vieram** = ausentes; ausentes que voltaram = reaparecidos. |

Erros bloqueantes (o lote fica `blocked` e não pode ser confirmado): Nº Fogo
ausente/inválido/duplicado no arquivo, dois pneus na mesma frota e posição,
colunas oficiais ausentes, nenhuma linha válida, data anterior aos dados
vigentes (ou igual sem revisão do dia), arquivo já importado. Os demais
problemas são avisos e seguem para os dados com a marca de qualidade (e viram
achados na Central de Auditoria dos Dados).

## 4. Prévia (`tire_import_preview`)

Paginada no servidor, por seção: `issues` (inconsistências, filtro por
severidade), `changes` (mudanças, filtro por tipo), `new`, `rows`, `absent`,
`reappeared`. O lote traz contadores por situação canônica, por tipo de
mudança e por problema, frotas não encontradas e motivos de bloqueio.

## 5. Confirmação (`tire_import_confirm`) — transação única

1. Grava os dados de cada pneu na data de referência (`tire_daily_snapshots`;
   na revisão do dia, atualiza a linha arquivando a versão anterior).
2. Cria/atualiza o cadastro (`tires`) — chave `tire_id`, Nº Fogo como texto.
3. Gera os eventos (`tire_events`): primeiro registro, medição, calibragem,
   troca de posição, movimentação entre frotas, mudança de vida/situação,
   envio para ressolagem, descarte, retorno ao estoque, ausente, reaparecido.
4. **Ausentes não são excluídos**: o pneu fica `presence_status = absent` com a
   última situação conhecida e o evento `TIRE_ABSENT`.
5. Concilia as vistorias de campo pendentes de lançamento
   (`private.tire_reconcile_inspections`): sincronizada, pendente ou
   divergência persistente — ver [`tire-inspection-app.md`](./tire-inspection-app.md).
6. Dispara a varredura da Central de Auditoria dos Dados
   (`private.tire_after_confirm` → `tire_audit_scan`; uma falha da auditoria
   nunca desfaz a confirmação).
7. Audita (`tire_audit_events`, autor = pessoa autenticada ou "Sincronização
   automática (SharePoint)") e publica `tires.snapshot.confirmed` em
   `outbox_events`.

Lote não confirmado pode ser descartado (`tire_import_cancel`) sem alterar a
base; lote confirmado ou substituído (`superseded`) não pode ser cancelado.

## 6. Primeira carga real (produção, 06/10/2026)

Arquivo `Rodopar_10.xlsx` (sha256 `1a700605…177dd099`), data de referência
**05/10/2026** (maior data de atualização do arquivo), pelo mesmo pipeline da
tela (`tire_import_start` → `tire_import_stage` em 6 partes, cada uma com soma
MD5 conferida no banco antes de gravar → `tire_import_validate` →
`tire_import_confirm`), com a pessoa administradora como autora:

| Etapa | Resultado |
|---|---|
| Validação | 617 linhas, 617 válidas, **0 erros**, 93 com aviso (80 KM Real negativo, 15 números gravados como data, 2 sulcos fora do limite, 1 menor sulco divergente, 1 data futura). |
| Situação canônica | 409 em uso, 99 estoque, 68 descartados, 41 baixados. |
| Enriquecimento | 75 frotas no arquivo, 75 resolvidas no Cadastro de Frotas, 0 não encontradas; nenhum veículo criado. |
| Confirmação | 617 pneus, 617 linhas de dados da data, 617 eventos `TIRE_CREATED`, trilha de auditoria e `tires.snapshot.confirmed` no outbox. |
| Idempotência | Reenvio do mesmo arquivo recusado com `tire_duplicate_file` ("já importado e confirmado como dados de 05/10/2026"); nenhum lote criado. |

Uma primeira tentativa de confirmação foi revertida por inteiro porque a
consulta de conferência executada na mesma transação falhou — prova prática de
que a confirmação é atômica (nada ficou pela metade).

## Fora do Escopo Atual

### CPK DE PNEUS

Não foi construído nesta etapa e **não deve ser inferido** a partir desta
importação: custo por km (CPK), custo por vida, custo acumulado de recapagens,
ROI de pneus, controle financeiro por vida, comparativo de custo entre 1ª, 2ª e
3ª vidas, custo de ressolagem por vida, rentabilidade de recapagem, dashboard
financeiro, tabelas, rotas, APIs ou permissões de CPK. Nenhuma planilha de CPK
é importada e nenhum valor de recapagem é solicitado. O KM Rodado/KM Real do
Rodopar é guardado apenas como dado operacional do pneu e não é base de custo.
