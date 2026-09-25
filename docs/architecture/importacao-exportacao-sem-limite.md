# Importação e exportação sem teto de linhas

Migration: `supabase/migrations/20260925100000_import_export_without_limits.sql`
· Suíte: `supabase/tests/remote/19_import_without_limits.sql`
· UI: `tests/ui/import-batches.spec.ts`

Nenhuma importação e nenhuma exportação do HFM tem mais limite de linhas. Isso vale
para os seis fluxos de importação (Fidelização: alocações e BRs, Filiais,
Aderência, Frota e Usuários) e para as sete rotas de exportação.

O motivo: a importação de Fidelização recusava arquivos com a mensagem
*"A planilha excede 5000 linhas"*. Os outros módulos tinham tetos parecidos
(20.000 colaboradores na exportação de Usuários, 500 filiais marcadas, páginas
fixas nas exportações da Fidelização). E havia um teto que ninguém via: o
PostgREST devolve no máximo 1.000 linhas por consulta, então uma exportação sem
paginação cortava o arquivo em silêncio.

Tirar o teto não bastava. O arquivo inteiro numa chamada esbarra em três limites
reais da plataforma:

| Limite | Valor | O que ele impediria |
| --- | --- | --- |
| Corpo de uma requisição (Vercel) | 4,5 MB | enviar a planilha ao servidor |
| `statement_timeout` do papel `authenticated` | 8 s | validar ou gravar milhares de linhas numa chamada |
| `max_rows` do PostgREST | 1.000 | ler mais de 1.000 linhas numa consulta |

A solução mantém as regras de negócio exatamente como estão. Só muda **onde**
o arquivo é lido e em **quantas partes** ele trafega.

---

## 1. Importação: o protocolo em partes

```
navegador                              servidor (server action)        banco
─────────                              ───────────────────────        ─────
lê XLSX/CSV (ExcelJS no navegador)
SHA-256 do arquivo
fatias ≤ 1.000 linhas e ≤ 1,2 MB  ──►  load(batch, linhas)       ──►  import_rows 'pending'
   … repete até a última fatia                                        (on conflict do nothing)
validate(batch, limit)           ──►  validate                  ──►  valida as próximas N
   … repete até pending = 0                                           pendentes, em ordem
finalize(batch)                  ──►  finalize                  ──►  recontagem pelas linhas
                                                                      → prévia
[usuário confirma]
process(batch, limit)            ──►  process                   ──►  grava as próximas N
   … repete até done                                                  (retoma de 'processing')
```

* **Leitura no navegador** (`src/lib/import/client.ts`, `sheet-core.ts`). O
  ExcelJS é carregado sob demanda (`import("exceljs")`). O hash do arquivo é
  calculado por `crypto.subtle`. A mesma leitura serve para sugerir as colunas e
  para validar. A planilha QLP é escolhida pelo nome, como antes.
* **Envio**: cada parte tem até 1.000 linhas e 1,2 MB, com folga para o corpo
  de 4 MB das server actions (`next.config.ts`). Numeração: a linha 1 é o
  cabeçalho, então a primeira linha de dados é a 2, como o usuário vê no Excel.
* **Validar e gravar** usam um tamanho de parte adaptativo (`runInSteps`). A
  meta é cerca de 2,5 s por chamada. O tamanho cresce até 2.000 quando o banco
  responde rápido e encolhe quando responde devagar. Um tempo esgotado (57014)
  divide a parte pela metade e tenta de novo; uma falha de rede tenta até três
  vezes, com espera crescente. Um erro devolvido pelo servidor não é repetido:
  ele é a resposta.
* **Progresso**: `ImportProgress` mostra a fase (lendo, enviando, validando,
  gravando), *"N de M linhas"* e o aviso *"Não feche esta janela até
  terminar."*.

### 1.1 O que o banco garante

* **Mesmo resultado.** Validar em partes produz exatamente a mesma prévia que
  validar o arquivo inteiro de uma vez: a mesma situação e a mesma ação por
  linha, e os mesmos apontamentos. A suíte 19 compara a "assinatura" das duas
  formas em cada módulo.
* **Regras que dependem do arquivo inteiro.** Exemplos: código ou CNPJ repetido
  nas Filiais, sobreposição de períodos na Fidelização, e o líder que vem no
  mesmo arquivo em Usuários. Essas regras olham todas as linhas do lote, não só
  a parte da vez. Nas Filiais, as contagens do arquivo são calculadas uma vez,
  na primeira chamada de validação (`_file_counts`).
* **Reenvio idempotente.** Uma parte enviada duas vezes (por exemplo, numa
  repetição de rede) não duplica linhas: `on conflict (batch_id, row_number) do
  nothing`.
* **Guardas do protocolo.** O banco recusa: fechar a prévia com linhas
  pendentes; acrescentar linhas depois da validação; usar um lote de outro tipo
  ou de outra organização; e validar sem lote.
* **Gravação retomável.** `process_*_import(..., p_limit)` grava as próximas
  `p_limit` linhas e deixa o lote em `processing`. A chamada seguinte continua
  de onde parou, e o lote só fecha quando não sobra linha.
* **Sem mudança de regra.** Classificação, substituição, sobreposição,
  auditoria (autor real, nunca "Sistema"), RLS, isolamento por organização e a
  proibição de alterar perfis de acesso pela importação continuam idênticos. O
  modo "arquivo inteiro" (`phase: 'all'`, `p_limit` nulo) continua existindo e
  dá o mesmo resultado.

### 1.2 Funções

| Módulo | Etapa (load/validate/finalize) | Gravação |
| --- | --- | --- |
| Fidelização — alocações | `stage_fidelization_import` | `process_fidelization_import` |
| Fidelização — BRs | `stage_br_import` | `process_br_import` |
| Filiais | `stage_branch_import` | `process_branch_import` |
| Aderência | `stage_adherence_import` | `process_adherence_import` |
| Frota | carga por `import_rows` + `validate_vehicle_import(p_batch_id, p_limit)` | `process_vehicle_import(p_batch_id, p_limit)` |
| Usuários | carga por `import_rows` + `validate_employee_import(p_batch_id, p_limit)` | `process_employee_import(p_batch_id, p_limit)` |

As quatro funções `stage_*` recebem `phase` = `load` | `validate` | `finalize`
| `all`, `batch_id` e `limit`. As funções de validação devolvem
`pending_rows`. As de gravação devolvem `done`/`remaining` (jsonb) ou
`remaining_rows` (tabela).

A migration também cria os índices que mantêm constante o custo de cada parte.
Sem eles, cada parte ficaria mais lenta à medida que o lote cresce:

* expressões de `import_rows` por lote: identidade, BR, veículo, placa, frota,
  chassi, Renavam, matrícula, CPF e nome;
* `import_errors (batch_id, row_number)`;
* frota e placa normalizadas em `vehicles`;
* código normalizado em `operation_brs`.

### 1.3 Aplicação no banco

O arquivo do repositório foi aplicado em cinco migrations remotas, na ordem
abaixo. O corpo de cada função no banco foi conferido contra o arquivo por hash.

| Versão remota | Nome |
| --- | --- |
| `20260925181430` | `import_without_limits_indexes` |
| `20260925181823` | `import_without_limits_stage` |
| `20260925181904` | `import_without_limits_validate` |
| `20260925182737` | `import_without_limits_process` |
| `20260925184615` | `import_without_limits_normalizer_grants` |

Nenhuma delas é destrutiva: não há `drop` de tabela nem de coluna, e nenhum dado
foi alterado. As funções `validate_*`/`process_*` foram recriadas porque
ganharam um parâmetro (`p_limit`), com o mesmo corpo de regras.

**Incidente corrigido — `permission denied for function normalize_plate`.** Os
novos índices usam `normalize_plate` e `normalize_renavam` nas expressões, e o
Postgres exige `EXECUTE` nessas funções de quem insere em `import_rows`. O papel
`authenticated` não tinha esse `EXECUTE`. Por isso, a primeira carga de teste
feita depois dos índices falhou. A migration `import_without_limits_normalizer_grants`
concede `EXECUTE` a `authenticated` e `service_role`. Os logs mostram que só a
execução de teste foi afetada: nenhum usuário tentou importar nesse intervalo,
e nenhum dado ficou pela metade, porque a falha desfaz a transação inteira.

## 2. Exportação: tudo, em fluxo

As sete rotas de exportação são:

* `/governanca/fidelizacao/export`
* `/governanca/liderancas/export`
* `/checklist/aderencia/export`
* `/estrutura/filiais/export`
* `/frota/cadastro/export`
* `/administracao/usuarios/export`
* `/administracao/perfis/export`

Todas usam `spreadsheetResponse` (`src/lib/admin/spreadsheet.ts`):

* **XLSX em fluxo** (`ExcelJS.stream.xlsx.WorkbookWriter`): as linhas vão para
  a resposta uma a uma, sem montar a planilha inteira na memória. O cabeçalho
  sai em negrito e congelado, e a largura das colunas acompanha o conteúdo.
* **CSV em fluxo**: com BOM, para o Excel em pt-BR abrir os acentos; separador
  `;`; aspas escapadas.
* `maxDuration = 60` em cada rota.

A leitura de dados percorre todas as páginas:

* **`fetchAll`** (`src/lib/supabase/fetch-all.ts`) lê em páginas de 1.000 até
  receber uma página curta. Toda consulta paginada tem desempate por `id`, para
  que nenhuma linha se repita nem se perca entre páginas. Usam `fetchAll`: Frota,
  Usuários (inclusive as opções de gestor), Lideranças, histórico da
  Fidelização, planner de BRs, Filiais e vínculos filial × operação.
* **RPCs paginadas por contrato** são percorridas até o total:
  * mobilizações da Fidelização, de 200 em 200 (o teto da própria função);
  * diretório de BRs, de 200 em 200;
  * matriz de Aderência, de 500 em 500.
* **Retorno da Aderência**: `getReturnTracking(..., null)` pede todas as linhas.
* **Filiais selecionadas**: os ids vão no corpo de um `POST` (formulário), não
  na URL, por isso não há mais o teto de 500 marcadas. A rota confere
  origem e host antes de aceitar o `POST`.
* **Tetos removidos**: 20.000 colaboradores (Usuários), 500 filiais
  selecionadas, as páginas fixas de mobilizações e diretório, e o `limit(5000)`
  das divergências da prévia de Frota (agora contadas com `count`).

## 3. O que continua limitado, e por quê

Nenhum dos itens abaixo limita dados importados ou exportados:

* **Listas da prévia na tela.** A gaveta mostra uma amostra:
  * os primeiros 300 apontamentos, com os erros primeiro (Fidelização e
    Aderência);
  * as primeiras 300 linhas (Frota e Usuários);
  * as primeiras 500 linhas (Filiais), com o aviso *"A lista abaixo mostra as
    primeiras N linhas…"*.

  Os totais da prévia, a validação e a gravação cobrem o arquivo inteiro.
  Mostrar 50.000 linhas num painel lateral travaria o navegador.
* **Tamanho de uma parte**: entre 1 e 5.000 linhas por chamada
  (`clampLimit`). É o passo do protocolo, não um teto de arquivo.
* **Memória do navegador.** A planilha é lida inteira no navegador de quem
  importa. Arquivos de centenas de milhares de linhas funcionam em computadores
  comuns, mas o limite prático passa a ser a memória dessa máquina, não o HFM.
* **Tempo de uma exportação**: até 60 s por requisição (`maxDuration`). Uma
  exportação de dezenas de milhares de linhas cabe com folga (ver §4). Se um dia
  uma base passar desse ponto, o caminho é gerar o arquivo em segundo plano,
  e isso ainda não foi implementado.

## 4. Validação

**Banco (suíte 19, 9/9 PASS; transação desfeita no fim, nada persiste):**

* **L1–L6** — em cada módulo, validar em partes (1 linha por chamada, o pior
  caso) e validar o arquivo inteiro dão a mesma assinatura e os mesmos totais,
  inclusive nas regras que dependem do arquivo todo.
* **L5–L7** — a gravação em partes produz os mesmos criados, atualizados,
  substituídos e ignorados. Uma gravação interrompida é retomada de
  `processing`.
* **L8** — as guardas do protocolo, conforme §1.1.
* **L9** — um arquivo de 5.001 linhas (o teto antigo era 5.000) é aceito.

A suíte 13b (importação da Fidelização) continua 9/9.

**Desempenho medido (Fidelização, 3.000 linhas com BRs e frotas reais; 2.120
linhas com sobreposição no próprio arquivo, o caso mais pesado; desfeito ao
fim):**

| Fase | Por chamada |
| --- | --- |
| carga de 1.000 linhas | 0,2 – 0,8 s |
| validação de 500 linhas | 1,5 – 2,1 s (constante do início ao fim do lote) |
| fechamento da prévia | 0,13 s |

O custo por parte não cresce com a posição no lote. Por isso o número de linhas
não tem teto: um arquivo maior só leva mais partes.

**Exportação** (`spreadsheetResponse` com 60.000 linhas, relido em seguida):

| Formato | Tamanho | Tempo | Resultado |
| --- | --- | --- | --- |
| XLSX | 1,4 MB | 0,9 s | 60.001 linhas (cabeçalho + 60.000); cabeçalho em negrito e congelado |
| CSV | 2,0 MB | 0,03 s | 60.001 linhas; BOM; `;` e aspas escapados |

**Interface** (`tests/ui/import-batches.spec.ts`, na gaveta real da
Fidelização, com o servidor simulado em `/dev/preview-importacao-lotes`):

* **CSV de 12.000 linhas.** O progresso aparece. O arquivo chega em partes
  contíguas de até 1.000 linhas, sem linha perdida nem repetida. A validação e a
  gravação usam várias chamadas, e o aviso final confirma os 12.000 vínculos.
* **XLSX de 6.001 linhas.** O arquivo é lido no navegador pelo ExcelJS, e a
  planilha "Alocações" é reconhecida.

A suíte Playwright completa passa: 201 testes. Os 8 pulados são os que exigem
credenciais de login, como antes. Typecheck, lint e build de produção também
passam.
