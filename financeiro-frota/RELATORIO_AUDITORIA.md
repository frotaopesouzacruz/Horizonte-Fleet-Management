# Relatório de auditoria e implementação — Controle Financeiro Gerencial | Frota

Origem: `Fluxo de caixa.xlsx` (4 abas: Relação de NF's, Fornecedores, Doc's Pagos | Rodopar 108, Doc Há Pagar | Rodopar 1015).
Entrega: `Controle_Financeiro_Gerencial_Frota.xlsx` (16 abas, 268.423 fórmulas, 0 erros de fórmula na verificação).
Data da análise: 09/10/2026. Cópia de segurança do original em `backup/Fluxo_de_caixa_ORIGINAL.xlsx`.

## 1. Diagnóstico da planilha original

### 1.1 Relação de NF's (493 documentos, R$ 2.562.627,16)

- Todos os 493 documentos pertencem a fornecedores cadastrados como **Frota**; nenhum fornecedor sem cadastro; nenhum documento duplicado (chave Documento + Fornecedor + Tipo + Emissão).
- Emissões de 15/12/2025 a 03/10/2026 (6 documentos de dez/2025). Filial única (87).
- O campo **Referência** fica de 0 a 37 dias após a emissão (mediana 3 dias): é a data de registro/entrada da nota, **não** o mês de competência. Não foi possível confirmar que represente competência; por isso **não é usado**.
- As colunas A, C e D eram `VLOOKUP` no cadastro de fornecedores (área, pacote, categoria); S:AD somavam parcelas do 108 e do 1015 por **nome do mês de vencimento, sem ano**; Q era a diferença documento x parcelas (13 documentos com diferença).
- A chave usada para o 108 (`Documento&Fornecedor&Tipo&Emissão`) é suficiente nos dados atuais; a chave para o 1015 (`Documento&Fornecedor&Tipo`) funciona porque não há repetição de chave entre documentos — mas é ambígua por construção (números de recibo reiniciam) e passou a ser monitorada (verificação "Correspondências ambíguas").

### 1.2 Fornecedores (238 fornecedores)

- 73 com Area = Frota (todos com Pacote e Categoria preenchidos); 165 com Area = `-` (outras áreas, sem classificação, por desenho).
- Sem nomes duplicados; CNPJ obtido por `VLOOKUP` na Relação de NF's (mantido).
- 10 pacotes e 19 categorias em uso.

### 1.3 Doc's Pagos | Rodopar 108 (4.549 linhas coladas)

- Relatório **da empresa inteira** (folha, tributos, benefícios, etc.): R$ 13,77 milhões em 3.937 parcelas válidas; apenas **526 parcelas (R$ 2.385.181,48)** pertencem a documentos da Frota.
- 612 linhas estruturais do relatório: 9 `Filial`, 198 `Doc. Pago em : dd/mm/aaaa`, 198 cabeçalhos `Documento | Série | ...`, 198 `Total do Dia :` e 9 linhas em branco/auxiliares. Essas linhas eram contadas pela fórmula de chave (`Ref Pesquisa`) e geravam 197 "duplicatas" aparentes; as 197 duplicatas exatas identificadas eram **somente** esses cabeçalhos — não há parcela real duplicada.
- **A extração foi classificada por documento após a colagem.** Os grupos `Doc. Pago em` (que contêm a data efetiva de pagamento) ficaram separados das suas linhas. Consequência: **não existe data de pagamento validada no arquivo atual.**
- `Data Ref.` **não é data de pagamento**: é igual à emissão em 3.128 das 3.937 parcelas e anterior ao vencimento em 3.764. Foi descartada como data de caixa.
- `Vlr. Total` ≠ `Vlr. Parc.` em 175 parcelas com `Vlr. Desco.` = 0 (ex.: R$ 1.260 → R$ 1.209,60): são **retenções na fonte** (ISS/IR/INSS). Nas parcelas da Frota: R$ 22.715,66 de retenções, R$ 158 de descontos e R$ 6,84 de juros.
- 75 linhas com `Tipo` em minúsculas (`mul`, `im`, `rcb`...) — normalizadas (UPPER/TRIM).
- 76 parcelas (R$ 285.941,53) de fornecedores Frota **sem NF na relação** (ex.: Mercedes-Benz R$ 105.649,56; Avansat R$ 82.208,86). 37 delas (R$ 246.106,53) têm emissão em 2025 (antes do início do controle); 39 (R$ 39.835,00) em 2026. Ficaram em **fila de revisão**, fora do resultado.
- Vencimentos de 02/01/2026 a 20/06/2029 (1 parcela paga com vencimento em 2029 e 1 em dez/2026 — pagamentos antecipados ou datas incorretas; sinalizados na matriz como "venc. após o ano").

### 1.4 Doc Há Pagar | Rodopar 1015 (498 parcelas, R$ 673.683,98)

- Também da empresa inteira: **87 parcelas (R$ 169.311,14)** pertencem a documentos da Frota; 9 (R$ 8.336,45) são de fornecedores Frota sem NF; 402 de outras áreas/não cadastrados.
- O campo `Acumulado` **não é** soma corrida consistente (reinicia por grupo do relatório) e **não é utilizado**.
- Não há emissão nem valor original do documento; o `Vlr. Parcela` pode vir **líquido de retenções** (ex.: doc 10 Maynarte R$ 7.500 → parcela R$ 7.125).
- Vencimentos extraídos somente até 29/12/2026: parcelas de 2027 de documentos em 6x (ex.: Minas Máquinas 40352, 40425, 1964, 1983) não constam, o que explica 4 das 13 divergências.
- Nenhuma duplicidade; 1 parcela (Valdeci Tonim, R$ 0,20) consta no 108 com outro valor (fora do escopo Frota).

### 1.5 Conciliação NF x Rodopar (antes de qualquer alteração)

| Situação | Documentos | Valor |
|---|---:|---:|
| Totalmente pagos (108) | 421 | — |
| Em aberto (1015) | 43 | — |
| Parcialmente pagos | 16 | — |
| Divergência documento x parcelas | 13 | R$ 8.134,54 |
| Sem correspondência | 0 | — |

As 13 divergências: 9 por retenção na fonte (parcela líquida no 1015: Casa da Sprinter 88/90/93/94/97, Maynarte 10, RC Truck 1371, BH Acessórios 256, Via Truck 790) e 4 por parcela de 2027 fora da extração do 1015 (Minas Máquinas). Todas estão listadas na aba de conciliação com o valor da diferença.

## 2. Arquitetura implementada

| Camada | Implementação |
|---|---|
| 1 Dados de origem | As 4 abas originais convertidas em **tabelas estruturadas** (`tblNF`, `tblFornecedores`, `tbl108`, `tbl1015`). Áreas de colagem preservadas nas mesmas colunas. Dados brutos preservados célula a célula (Teste 01). |
| 2 Tratamento/conciliação | **Colunas calculadas dentro das tabelas** (cabeçalhos grafite): registro válido, normalização, chaves N1/N2, ocorrência (duplicidade), linha da NF, nível de conciliação, área, escopo, considerar, pacote/categoria finais, competência, data de caixa, valores bruto/desconto/juros/líquido/retenção, status, faixa de vencimento, alertas. Ao colar novas linhas, a tabela expande e replica as fórmulas (sem capacidade fixa, sem edição de fórmulas). |
| 3 Modelo | Remuneração (entrada), DRE Gerencial, Fluxo de Caixa, Competência x Caixa, Parâmetros (seleções, data de referência, limites, listas). |
| 4 Apresentação | Painel Executivo (filtros, 20 KPIs, 10 destaques automáticos, 8 gráficos), Custos por Pacote, Pagamentos e Obrigações, Análise de Fornecedores, Conciliação e Qualidade, Dados Gráficos. |

Sem macros, sem Power Query, sem vínculos externos, sem caminhos locais. Fórmulas restritas a funções compatíveis (SUMIFS, COUNTIFS, INDEX/MATCH, SUMPRODUCT, IFERROR); funções de texto de data substituídas por `YEAR/MONTH/TEXT(n,"00")` para não depender do idioma do Excel.

## 3. Critérios de apuração

1. **Escopo Frota**: parcela entra no resultado da Frota somente quando conciliada a documento da Relação de NF's (escopo "Frota - NF vinculada"). Fornecedor Frota sem NF → fila de revisão (não considerado). Area `-` → outras áreas. Sem cadastro → excluído e contado.
2. **Chaves**: N1 = Documento|Fornecedor|Tipo|Emissão (108 x NF). N2 = Documento|Fornecedor|Tipo (1015 x NF; e 108 quando N1 falha, com sinalização de emissão divergente). Ambiguidade de N2 sinalizada.
3. **Competência** = `Competência (ajuste manual)` da NF; se vazio, **mês de emissão** (marcado "Estimada"). Custo reconhecido uma única vez pelo **Valor Doc**.
4. **Pagamentos realizados** = parcelas 108 conciliadas; valor líquido = `Vlr. Total`; bruto = `Vlr. Parc.`; retenção = bruto − desconto + juros − total. Mês de caixa = data do grupo `Doc. Pago em` quando a extração está na ordem original (validação automática: todo grupo deve ser seguido do cabeçalho `Documento`); caso contrário, mês de vencimento, com sinalização em todas as abas.
5. **Compromissos** = parcelas 1015 conciliadas, por vencimento. Vencido = vencimento < data de referência (TODAY ou data informada). A ausência de parcela no 1015 nunca é tratada como pagamento.
6. **Duplicidade**: segunda ocorrência da mesma chave + vencimento + valor (+ parcela no 1015) é desconsiderada e listada.
7. **Juros/descontos** reconhecidos no mês de caixa; retenções não alteram o custo.
8. **Remuneração** consolidada por competência; não é entrada de caixa; duplicidade de competência sinalizada (não somada em silêncio: a verificação aponta e a DRE soma as linhas, por regra explícita).
9. Percentuais dependentes de receita → `n/d` sem remuneração; com filtro de custo ativo (pacote/categoria/fornecedor) resultado e margem não são exibidos (a remuneração não é rateada).

## 4. Melhorias realizadas

- Dashboard executivo com os 5 KPIs do adendo em destaque, visão mês/acumulado, filtros, destaques automáticos baseados em limites parametrizáveis (concentração 25%, variação 20%, pacote dominante 50%).
- DRE Gerencial Simplificada por competência com indicadores e participação por pacote; linhas reservadas (despesas administrativas) e notas de limitação.
- Fluxo de caixa realizado x projetado com saldo somente quando houver saldo inicial informado; projeção de 12 meses.
- Aba Competência x Caixa com tabela de acompanhamento, 9 KPIs, matriz competência x vencimento (Total/Pago/Em aberto) e 5 gráficos.
- Conciliação com 24 verificações, conciliação de totais origem x modelo e filas de revisão.
- Normalização de tipos, chaves, datas; identificação das linhas estruturais do relatório 108; detecção de ordem original para data de pagamento.
- Coluna "Mês" do 1015 renomeada para "Mês Venc." (o cabeçalho era uma fórmula que duplicava o nome "Vencimento").

## 5. Limitações dos dados

1. **Data efetiva de pagamento indisponível** na extração atual (classificada). Caixa realizado apresentado por mês de vencimento, sinalizado. Resolve-se colando a próxima extração na ordem original.
2. O 1015 não traz emissão/valor original; parcelas podem vir líquidas de retenção → divergências explicáveis, não mascaradas.
3. Competência estimada pelo mês de emissão para 100% dos documentos (não há campo de competência confiável). Ajuste manual disponível por documento.
4. Não há remuneração histórica no arquivo (receita zerada até preenchimento) nem recebimentos/saldo inicial: fluxo de caixa realizado contém apenas saídas.
5. Não há orçamento/metas: nenhum comparativo Realizado x Orçado foi inventado (a estrutura por pacote x mês permite incluir futuramente).
6. Fila de revisão de R$ 294 mil em parcelas de fornecedores Frota sem NF (maior parte de competência 2025) exige decisão do gestor.

## 6. Campos adicionais recomendados

- Na Relação de NF's: competência real (quando diferente da emissão) e nº de parcelas previstas.
- No Rodopar 108: manter os grupos `Doc. Pago em` (data efetiva) e, se possível, incluir a filial por linha.
- No Rodopar 1015: data de emissão e valor original do documento; extrair sempre todos os vencimentos futuros.
- Cadastro de fornecedores: CNPJ como campo digitado (hoje depende da NF) e marcação de contrato recorrente.

## 7. Testes executados

Testes realizados com LibreOffice (recálculo completo de 268 mil fórmulas) em cópias da planilha com dados injetados; scripts em `scripts/gerar_controle/tests.py` e `tests2.py`.

| Teste | Resultado |
|---|---|
| 01 Integridade: dados brutos das 4 abas comparados célula a célula com o original | OK (0 diferenças; total Valor Doc R$ 2.562.627,16 preservado) |
| 02 Remuneração: R$ 300.000 em jan e R$ 350.000 (−10.000 ajuste) em set/2026 | OK: DRE, Painel e margem (16,4%) atualizados; entrada de caixa permanece 0 |
| 03 Nova despesa: NF TESTE-001 R$ 12.000 (set/2026) | OK: custo de setembro +12.000 (uma única vez), indicadores e gráficos recalculados |
| 04 Parcelamento: 3 parcelas de R$ 4.000 no 1015 | OK: DRE reconhece 12.000 uma vez; obrigações +12.000; projeção por vencimento |
| 05 Pagamento: parcela 1 migra do 1015 para o 108 (R$ 3.960 líquido, juros 10, desconto 50) | OK: pago 4.000 / aberto 8.000; status "Parcialmente pago"; sem custo novo; juros/desconto na DRE |
| 06 Duplicidade: 5 parcelas do 108 recoladas | OK: desconsideradas (526+1 consideradas), auditoria aponta 5 duplicadas (R$ 122.079,90), totais inalterados |
| 07 Ano seguinte: NF e parcela de 2027, remuneração jan/2027 | OK: DRE 2027 (custo 5.000, resultado 5.000, margem 50%); 2026 não contaminado; projeção inclui fev/2027 |
| 08 Conciliação: fornecedor sem cadastro + divergências existentes | OK: 1 documento sem cadastro (R$ 777) fora da DRE e na fila de revisão; 13 divergências listadas |
| 09 Fórmulas e gráficos | OK: 0 erros em 268.423 fórmulas; 8+5+4 gráficos ligados às tabelas calculadas (verificados em PDF) |
| 10 Conciliação com totais de origem | OK: 108 válidas 3.937 / R$ 13.771.578,88 → Frota 526 / R$ 2.385.181,48; 1015 498 / R$ 673.683,98 → Frota 87 / R$ 169.311,14; NF 493 / R$ 2.562.627,16 considerados; diferença parcelas x documentos R$ 8.134,54 explicada (retenções + parcelas 2027 fora do 1015) |
| Extra: data efetiva de pagamento | OK: extração 108 remontada na ordem original → flag = 1, 526 parcelas com data, fluxo de caixa por data de pagamento confere com recomputação independente |

Todos os totais do modelo foram conferidos contra recomputação independente em pandas (`scripts/validar_controle.py`).
