# Controle Financeiro Gerencial | Setor de Frota — Instruções de uso

Arquivo: `Controle_Financeiro_Gerencial_Frota.xlsx` (Excel Desktop, Windows; sem macros, sem Power Query, sem vínculos externos).

A planilha é 100% fórmulas nativas. Ao abrir, o Excel recalcula tudo automaticamente (o arquivo está marcado para recálculo completo na abertura). Salve após a primeira abertura.

## 1. Estrutura das abas

| Camada | Aba | Função |
|---|---|---|
| 4 Apresentação | **Painel Executivo** | Dashboard: filtros (ano, mês, visão, pacote, categoria, fornecedor), KPIs competência x caixa, destaques automáticos, 8 gráficos |
| 3 Modelo | **Remuneração** | Entrada manual da remuneração mensal (receita gerencial). Também: saldo inicial de caixa e recebimentos efetivos (opcionais) |
| 3 Modelo | **DRE Gerencial** | DRE Gerencial Simplificada por competência, jan–dez, total, % e indicadores |
| 3 Modelo | **Fluxo de Caixa** | Realizado (entradas/saídas confirmadas) x projetado (obrigações por vencimento), próximos 12 meses |
| 3 Modelo | **Custos \| Competência x Caixa** | KPIs, tabela mensal (competência, pagos, previstos, saldo em aberto), matriz competência x vencimento, 5 gráficos |
| 4 Análises | **Custos por Pacote** | Custos por pacote x mês, variação, participação, detalhamento por categoria, fornecedor e documento |
| 4 Análises | **Pagamentos e Obrigações** | Aging (vencido, 7/15/30/60 dias), maiores credores, tabela analítica por parcela com filtro de status |
| 4 Análises | **Análise de Fornecedores** | Ranking, participação, concentração, evolução mensal por fornecedor |
| 2 Auditoria | **Conciliação e Qualidade** | 24 verificações, conciliação de totais origem x modelo, três filas de revisão |
| Apoio | **Leia-me**, **Parâmetros**, **Dados Gráficos** | Instruções, listas/limites, base dos gráficos (não editar Dados Gráficos) |
| 1 Origem | **Relação de NF's** | Documentos da Frota (colagem do ERP + 3 colunas de ajuste manual + colunas calculadas) |
| 1 Origem | **Fornecedores** | Cadastro: Área (Frota / -), Pacote, Categoria + métricas calculadas |
| 1 Origem | **Doc's Pagos \| Rodopar 108** | Colagem da extração de documentos pagos + colunas calculadas de tratamento |
| 1 Origem | **Doc Há Pagar \| Rodopar 1015** | Colagem da extração de contas a pagar + colunas calculadas de tratamento |

Convenção de cores: **amarelo com fonte azul = entrada manual**; cinza/branco com fonte preta ou azul-marinho = calculado (não editar). Cabeçalhos cinza-grafite nas abas de origem = colunas de tratamento (calculadas).

## 2. Rotina mensal

### Passo 1 — Atualizar o Rodopar 108 (documentos pagos)

1. Abra a aba `Doc's Pagos | Rodopar 108`.
2. Selecione o conteúdo antigo de **C2 até a última linha da coluna M** e pressione Delete (não exclua linhas; apenas limpe o conteúdo).
3. Cole a nova extração **completa**, a partir de **C2**, **na ordem original do relatório** (não classifique). Mantenha as linhas `Filial`, `Doc. Pago em : dd/mm/aaaa`, o cabeçalho `Documento | Série | ...` e `Total do Dia :` — elas são reconhecidas e ignoradas, e a linha `Doc. Pago em` fornece a **data efetiva de pagamento**.
4. Se a colagem tiver mais linhas do que a tabela, o Excel expande a tabela `tbl108` e preenche as colunas calculadas automaticamente. Se não expandir, use *Design da Tabela > Redimensionar Tabela* até a última linha colada.

Verifique em `Parâmetros` (linha "Data de pagamento validada") se o valor é **1**. Se for 0, a extração foi classificada e o caixa realizado passa a ser apresentado por mês de vencimento (sinalizado no Painel e no Fluxo de Caixa).

### Passo 2 — Atualizar o Rodopar 1015 (contas a pagar)

Mesma rotina na aba `Doc Há Pagar | Rodopar 1015`, colando a partir de **C2**. Extraia **todas** as parcelas em aberto, inclusive vencimentos de meses e anos futuros; parcelas fora do período extraído aparecem como "divergência de conciliação" no documento.

### Passo 3 — Relação de NF's

Acrescente os novos documentos da Frota nas linhas seguintes (colunas **B, E a O**, como já vinha sendo feito). Não digite nas colunas A, C, D e nas colunas cinza. Use as colunas amarelas somente quando necessário:

- **P Pacote (ajuste manual)** / **Q Categoria (ajuste manual)**: quando o documento tiver classificação diferente da padrão do fornecedor.
- **R Competência (ajuste manual)**: `AAAA-MM` (ou uma data do mês) quando a competência do custo for diferente do mês de emissão.

### Passo 4 — Remuneração

Na aba `Remuneração`, informe o valor consolidado do mês na coluna **Remuneração (R$)**. Ajustes, observações e data de atualização são opcionais. A coluna *Verificação* aponta competências duplicadas e meses sem valor. Nunca segregue por pacote.

### Passo 5 — Consultar e reportar

Com o cálculo automático ativo (Fórmulas > Opções de Cálculo > Automático), tudo é recalculado. Se estiver manual, pressione **F9**. Ajuste os filtros do Painel (ano, mês, visão) e, para apresentar, exporte em PDF o `Painel Executivo` e a `DRE Gerencial` (Arquivo > Exportar; áreas de impressão, cabeçalhos e rodapés já configurados).

## 3. Como ler a DRE

- **Receita Gerencial Líquida** = remuneração + ajustes informados (competência).
- **Custos operacionais** = Valor Doc dos documentos da Frota no mês de competência, por pacote (ordem da lista em `Parâmetros`). Cada documento entra uma única vez; parcelas e pagamentos nunca geram custo novo.
- **Resultado operacional** = receita − custos. **Juros pagos** e **descontos obtidos** (Rodopar 108) ajustam o **Resultado Gerencial Consolidado**, reconhecidos no mês de caixa da parcela.
- **Margem gerencial** = resultado / receita líquida; **custo sobre remuneração** = custos / receita líquida. Sem remuneração informada, o indicador mostra `n/d`.
- A DRE tem célula própria de **Ano** (padrão = ano do Painel; pode ser sobrescrita).

## 4. Como conferir compromissos financeiros

- `Pagamentos e Obrigações`: total em aberto, vencido, faixas de vencimento (7/15/30/60 dias), dez maiores credores e a tabela analítica de parcelas (em aberto no 1015 e pagas no 108), filtrável por status em C5.
- `Fluxo de Caixa` seção E e `Dados Gráficos` bloco 5: desembolsos previstos mês a mês nos próximos 12 meses a partir da **data de referência** (hoje, ou a data informada em `Parâmetros`).
- `Custos | Competência x Caixa`: matriz que mostra, para cada competência, em que meses as parcelas vencem/foram pagas, quanto já foi pago e quanto está pendente.

## 5. Como identificar inconsistências

Aba `Conciliação e Qualidade`:

1. Cartões de resumo (documentos íntegros, com pendências, parcelas com alertas, fornecedores com alertas).
2. Tabela de verificações com quantidade, valor e severidade (Alta/Média/Info).
3. Conciliação de totais: linhas e valores das extrações brutas x o que foi considerado, por motivo (Frota com NF, Frota sem NF, outras áreas, não cadastrados, duplicados).
4. Filas de revisão: documentos com alertas, parcelas com alertas e fornecedores com alertas de cadastro.

Além disso, cada linha das abas de origem traz **Status** e **Alertas** (use o AutoFiltro).

Tratamento mais comum:

| Alerta | O que fazer |
|---|---|
| Fornecedor sem cadastro | Incluir na aba `Fornecedores` com Area = Frota (ou `-`), Pacote e Categoria |
| Fornecedor Frota sem NF na relação | Se for custo da Frota, incluir a NF na `Relação de NF's`; se não for, ajustar a Área do fornecedor |
| Divergência de valor | Verificar retenções na fonte (parcela líquida) e parcelas fora do período da extração 1015 |
| Parcela duplicada na extração | Reimportação em duplicidade: já é desconsiderada; limpe e recole a extração completa |
| Consta como pago (108) e em aberto (1015) | Confirmar no Rodopar; status fica "Divergência" até a próxima extração |

## 6. Avançar para o ano seguinte

1. Continue colando as extrações completas do Rodopar (a tabela pode conter vários exercícios) e acrescentando NFs.
2. Na aba `Remuneração`, as linhas de 2027 já existem; para 2028 em diante, digite Ano e Mês nas linhas seguintes (a tabela se expande).
3. Mude o **Ano** no Painel Executivo. As demais abas seguem o Painel por padrão.
4. Novos pacotes/categorias: inclua nas listas de `Parâmetros` (colunas H e J). Novos fornecedores: aba `Fornecedores`.

## 7. Conferência independente (opcional)

`scripts/validar_controle.py` recalcula com Python/pandas os totais da Frota a partir das abas de origem e compara com a planilha (que deve ter sido salva pelo Excel):

```bash
pip install pandas openpyxl
python scripts/validar_controle.py "Controle_Financeiro_Gerencial_Frota.xlsx"
```

`scripts/gerar_controle/` contém o gerador usado para construir a planilha a partir do arquivo original (somente para reconstrução; não é necessário na rotina).
