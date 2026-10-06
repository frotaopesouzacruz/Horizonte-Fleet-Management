# Gestão de Pneus › Importação oficial Rodopar 10

Rota: `/frota/pneus?aba=importacao` · Permissão: `tires.import` (ver o histórico
também com `tires.audit.view`) · Rotinas: `tire_import_start`,
`tire_import_stage`, `tire_import_validate`, `tire_import_preview`,
`tire_import_confirm`, `tire_import_cancel`, `tire_import_history`
(`supabase/migrations/20261006102000_tires_import.sql`).

O relatório **Rodopar 10** é a fonte oficial dos pneus. Cada arquivo confirmado
vira uma **fotografia** (`tire_daily_snapshots`, uma linha por pneu × data de
referência). O cadastro do pneu (`tires`) é a identidade; a fotografia é o
estado naquela data. Cadastro ≠ fotografia.

```
LER (navegador) → VALIDAR → COMPARAR → PRÉVIA → CONFIRMAR → ATUALIZAR FOTOGRAFIA → HISTÓRICO
```

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

- Data de referência obrigatória, não futura e **posterior** à última
  fotografia confirmada (`tire_reference_not_after_latest`).
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
| Comparação | Contra a fotografia anterior: novo, atualizado (com o tipo de mudança: medição, calibragem, posição, frota, vida, situação…), sem mudança; pneus da fotografia anterior que **não vieram** = ausentes; ausentes que voltaram = reaparecidos. |

Erros bloqueantes (o lote fica `blocked` e não pode ser confirmado): Nº Fogo
ausente/inválido/duplicado no arquivo, dois pneus na mesma frota e posição,
colunas oficiais ausentes, nenhuma linha válida, data não posterior à última
fotografia, arquivo já importado. Os demais problemas são avisos e seguem para
a fotografia com a marca de qualidade.

## 4. Prévia (`tire_import_preview`)

Paginada no servidor, por seção: `issues` (inconsistências, filtro por
severidade), `changes` (mudanças, filtro por tipo), `new`, `rows`, `absent`,
`reappeared`. O lote traz contadores por situação canônica, por tipo de
mudança e por problema, frotas não encontradas e motivos de bloqueio.

## 5. Confirmação (`tire_import_confirm`) — transação única

1. Grava a fotografia de cada pneu na data de referência (`tire_daily_snapshots`).
2. Cria/atualiza o cadastro (`tires`) — chave `tire_id`, Nº Fogo como texto.
3. Gera os eventos (`tire_events`): primeira fotografia, medição, calibragem,
   troca de posição, movimentação entre frotas, mudança de vida/situação,
   envio para ressolagem, descarte, retorno ao estoque, ausente, reaparecido.
4. **Ausentes não são excluídos**: o pneu fica `presence_status = absent` com a
   última fotografia conhecida e o evento `TIRE_ABSENT`.
5. Concilia as vistorias de campo pendentes de lançamento
   (`private.tire_reconcile_inspections`): sincronizada, pendente ou
   divergência persistente — ver [`tire-inspection-app.md`](./tire-inspection-app.md).
6. Audita (`tire_audit_events`, autor = pessoa autenticada) e publica
   `tires.snapshot.confirmed` em `outbox_events`.

Lote não confirmado pode ser descartado (`tire_import_cancel`) sem alterar a
base; lote confirmado não pode ser cancelado.

## 6. Primeira carga real

Arquivo `Rodopar_10.xlsx` (sha256 `1a700605…177dd099`, 617 linhas: 409 USO,
99 ESTOQUE, 68 DESCARTE, 41 BAIXADO), data de referência **05/10/2026** (maior
data de atualização do arquivo). Reenviar o mesmo arquivo é recusado como
duplicado.

## Fora do Escopo Atual

### CPK DE PNEUS

Não foi construído nesta etapa e **não deve ser inferido** a partir desta
importação: custo por km (CPK), custo por vida, custo acumulado de recapagens,
ROI de pneus, controle financeiro por vida, comparativo de custo entre 1ª, 2ª e
3ª vidas, custo de ressolagem por vida, rentabilidade de recapagem, dashboard
financeiro, tabelas, rotas, APIs ou permissões de CPK. Nenhuma planilha de CPK
é importada e nenhum valor de recapagem é solicitado. O KM Rodado/KM Real do
Rodopar é guardado apenas como dado da fotografia e não é base de custo.
