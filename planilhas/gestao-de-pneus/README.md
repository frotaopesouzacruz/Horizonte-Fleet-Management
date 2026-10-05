# Gestão de Pneus — Horizonte

Ferramenta em Excel para **planejamento de ressolagem, compra e estoque de pneus** das Operações Souza Cruz,
alimentada pela exportação oficial **Rodopar 10** via Power Query. Esta pasta guarda o **gerador** da planilha
`Gestão de Pneus - Horizonte.xlsx`: os scripts, a consulta M e esta documentação.

> **Dados fora do repositório.** O repositório é público. A planilha gerada e as planilhas de origem contêm
> placas, usuários do Rodopar, gestores e preços de compra, por isso **não são versionadas** (ver `.gitignore`).
> O gerador lê esses arquivos de uma pasta local na hora de gerar.

## A planilha

| Aba | Para que serve |
| --- | --- |
| Início | Situação dos dados (última atualização, registros, qualidade da base), passo a passo de atualização, navegação, regras vigentes e legenda |
| Dashboard | Indicadores de frota, planejamento (ressolagem, compra, estoque, necessidade, investimento) e controle; gráficos por medida e por faixa de milimetragem; ranking de medidas e de veículos |
| Compra | Demanda projetada × estoque disponível × necessidade líquida por medida e por utilização; lista nominal filtrável |
| Ressolagem | Demanda por medida, destino sugerido (ressolar ou descartar por limite de vida), prioridade e lista nominal filtrável |
| Fluxo Ressolagem | Controle dos lotes: Identificado ▸ Retirado do veículo ▸ Enviado ao fornecedor ▸ Em análise ▸ Aprovado/Reprovado ▸ Ressolado ▸ Retornado ao estoque ▸ Aplicado |
| Estoque | Estoque por medida e condição: total, novos, ressolados, utilizável, comprometido e cobertura da compra |
| Análises | Visões por faixa de milimetragem, situação, vida, eixo, classificação, aferição, operação, local, fabricante/modelo e veículo |
| Auditoria | "Qualidade da base": 17 verificações de cadastro com severidade, ocorrências, como corrigir e lista filtrável |
| Parâmetros | Limites das regras (células amarelas), medidas, situações e De-Para de centros de custo |
| Frotas | Vínculo N. Frota → placa, tipo, base de operação e gestor |
| Base Tratada | Resultado da consulta Power Query + colunas de regra por pneu (memória de cálculo de todos os números) |
| Documentação | Fonte, arquitetura, regras, dicionário de colunas, reconciliação com a planilha anterior, testes ao vivo, manutenção e limitações |

### Regras de negócio

Todos os limites ficam na aba **Parâmetros** (nomes definidos `pLimRessolagem`, `pLimCompra`, `pVidaCompra`...);
nenhuma regra fica escrita dentro das fórmulas.

| Regra | Definição |
| --- | --- |
| Demanda de ressolagem | `Menor Milimetragem < 2,75` **e** Situação Pneu ≠ BAIXADO e ≠ DESCARTE (estritamente menor: 2,75 não entra) |
| Demanda projetada de compra | `Menor Milimetragem < 4,00` **e** `N. Vida = 1` **e** Situação Pneu ≠ BAIXADO e ≠ DESCARTE (4,00 não entra) |
| Estoque disponível (cobertura) | Situação ESTOQUE, `N. Vida = 1` e `Menor Milimetragem ≥ 4,00` |
| Necessidade líquida | Por medida: `máximo(0; demanda projetada − estoque disponível)`; investimento = necessidade × custo de referência |
| Classificação de desgaste | CRÍTICO (em uso e < 1,6 mm, CONTRAN 558/1980) · ENVIAR PARA RESSOLAGEM · ACOMPANHAR (< 4,00) · NORMAL · INATIVO · SEM AFERIÇÃO |
| Destino sugerido | Na demanda de ressolagem: DESCARTAR (LIMITE DE VIDA) quando `N. Vida ≥ vida máxima da medida`; senão RESSOLAR |

As comparações de texto ignoram maiúsculas/minúsculas e espaços; medidas como `175/70R14` são padronizadas para
`175/70 R14` antes das regras.

### Atualização no dia a dia

1. Exportar o relatório Rodopar 10 e salvar como `Rodopar 10.xlsx` no local configurado.
2. Abrir `Gestão de Pneus - Horizonte.xlsx` e clicar em **Dados ▸ Atualizar Tudo** (Ctrl+Alt+F5).
3. Base tratada, planejamentos, auditoria e dashboard são recalculados.

Na primeira vez, confira o local do arquivo em *Dados ▸ Obter Dados ▸ Iniciar Editor do Power Query ▸ consulta
`Pneus_Rodopar10` ▸ etapa `CaminhoArquivo`* (aceita caminho local ou link do SharePoint).

### Arquitetura

```
Rodopar 10 (xlsx exportado)
  └─ Power Query "Pneus_Rodopar10": seleciona as 34 colunas pelo nome, normaliza cabeçalhos, textos,
     números com vírgula, datas e medidas; remove linhas vazias; registra o tratamento aplicado
       └─ tbPneus (aba Base Tratada): colunas calculadas com as regras, lendo Parâmetros/Frotas/Fluxo
            ├─ resumos por medida, utilização e faixa (CONT.SES/SOMASES)
            ├─ listas nominais filtráveis (FILTRO/CLASSIFICARPOR/ÚNICO — Excel 365/2021)
            └─ Dashboard, Auditoria e Análises
```

## Gerar a planilha

Requisitos: Python 3.10+ e `pip install -r requirements.txt`. Para `--verificar`, LibreOffice instalado.

1. Coloque as planilhas de origem em `planilhas/gestao-de-pneus/fontes/` (ou aponte `GP_FONTES` para a pasta).
   Os arquivos são encontrados pelo nome (sem diferenciar maiúsculas/minúsculas; havendo mais de um, vale o mais recente):

   | Fonte | Padrão do nome | O que é lido |
   | --- | --- | --- |
   | Rodopar 10 | `*rodopar*10*.xlsx` | Carga inicial da base (aba `Planilha1` ou a primeira) |
   | Controle de Pneus | `*controle*pneus*.xlsx` | Histórico de lotes (aba Ressolagem), De Para Filial/Unidade → Operação, alocação de frotas (Base de Fidelização), local do SharePoint |
   | Demanda de Recapagem | `*demanda*recapagem*.xlsx` | Observações do último lote |
   | Gestão de CPK | `*cpk*.xlsx` | Cadastro de frotas, compras (Rodopar 978) e custos de reforma (Análise CPK) |

2. Gere:

   ```bash
   cd planilhas/gestao-de-pneus/gerador
   python gerar.py --verificar
   ```

   A planilha sai em `planilhas/gestao-de-pneus/saida/` (ou em `GP_SAIDA`), junto com a consulta M final
   (`Pneus_Rodopar10.pq`).

Variáveis de ambiente opcionais: `GP_FONTES`, `GP_SAIDA`, `GP_LOGO` (padrão: `public/brand/logo-light.png`),
`GP_CARGA` (data/hora da carga inicial, padrão: agora no horário de Brasília), `GP_CAMINHO_RODOPAR` (caminho gravado
na consulta) e `GP_XSD` (pasta dos esquemas OOXML para a validação XSD).

### O que vem das fontes (nada fica fixo no código)

- **Custo do pneu novo**: preço médio da compra mais recente da medida no Rodopar 978; compras com data posterior à
  carga são ignoradas (erro de digitação).
- **Custo da ressolagem**: valor mais frequente de "Custo Reforma" (2ª a 4ª vida) da medida na Análise CPK.
- **De-Para de operações**: aba De Para da planilha Controle de Pneus.
- **Alocação de frotas**: data mais recente até o dia da carga na Base de Fidelização (a base vem preenchida para o mês).
- **Recapadoras sugeridas**: nomes usados nos lotes; variações de grafia ficam com a forma mais usada.
- **Caminho do Rodopar 10**: `GP_CAMINHO_RODOPAR`; sem ela, `Rodopar 10.xlsx` na mesma pasta do SharePoint em que a
  planilha Controle de Pneus se publica (lido das consultas dela); sem isso, um caminho local de exemplo.

Regras e limites (2,75 mm, 4,00 mm, vida 1, vida máxima por medida etc.) ficam em `gerador/config.py` e são
editáveis na aba Parâmetros da planilha.

### Verificações

- **Fórmulas**: o gerador emula em Python o Power Query e cada fórmula, grava os resultados como valores em cache e,
  com `--verificar`, recalcula uma cópia no LibreOffice e compara célula a célula (carga de 05/10/2026: 31.159
  fórmulas, 0 erros, 0 divergências).
- **Estrutura**: com `GP_XSD`, cada parte XML é validada contra os esquemas ISO/IEC 29500.
- **Consulta M**: sintaxe validada com o parser oficial (`verificar_m.js`, ver cabeçalho do arquivo).
- **Testes ao vivo**: a aba Documentação traz 10 casos reais (inclusive as fronteiras 2,75 e 4,00) que mostram ✔/✖
  com os dados atuais.
- **Conferência visual**: `python render.py <arquivo> <rótulo> "<Aba>"` gera PNG das abas.

## Limitações

- Requer Excel 365 ou 2021+ para as listas nominais (matrizes dinâmicas); resumos e indicadores funcionam em versões anteriores.
- O LibreOffice não reproduz as matrizes dinâmicas como o Excel: a verificação cobre as fórmulas clássicas, e as
  listas dinâmicas são gravadas com os valores calculados pelo gerador.
- Frotas é uma fotografia da alocação; o fluxo de ressolagem é registrado manualmente; custos são estimativas de
  referência; a vida máxima de Caminhão (3) vem da "Vida Prev." do Rodopar 978 e precisa ser validada.
- A seção "Reconciliação" da Documentação descreve a comparação com a planilha anterior feita na carga inicial.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `gerador/gerar.py` | Ponto de entrada: gera, pós-processa e (opcional) verifica |
| `gerador/config.py` | Caminhos, parâmetros das regras, medidas, situações, fluxo e paleta |
| `gerador/fontes.py` | Localiza as fontes e deriva custos, De-Para, alocação, recapadoras e caminho |
| `gerador/model.py` | Emulação do Power Query e das fórmulas (valores esperados) |
| `gerador/build*.py`, `xlh.py`, `views_common.py` | Construção das abas (openpyxl) |
| `gerador/postprocess.py` | Valores em cache, matrizes dinâmicas e consulta Power Query (DataMashup) |
| `gerador/Pneus_Rodopar10.pq` | Consulta M (o caminho entra no lugar de `{{CAMINHO_ARQUIVO}}`) |
| `gerador/verify.py`, `recalc_lo.py`, `xsdcheck.py`, `verificar_m.js`, `render.py` | Verificações |

## Créditos

O bloco *PermissionBindings* do pacote Power Query vem do template público da biblioteca
[`@microsoft/connected-workbooks`](https://github.com/microsoft/connected-workbooks)
(licença MIT, © Microsoft Corporation).
