# Controle de Ressolagem — Horizonte

Gerador da planilha `Controle de Ressolagem - Horizonte.xlsx`. Ela tem as duas visões da aba **Ressolagem** da
planilha *1_Controle de Pneus_OPE Souza Cruz*, alimentadas pela exportação **Rodopar 10**.

> O repositório é público. A planilha gerada e as fontes têm placas, gestores e histórico operacional, por isso
> **não são versionadas** (ver `.gitignore`). O gerador lê as fontes na hora de gerar.

## Abas

| Aba | Conteúdo |
| --- | --- |
| Painel | Pneus em Recapar (no veículo, em estoque, na demanda atual, fora dela, avaliar descarte); situação da demanda atual; evolução das últimas 12 demandas (gráfico); Recapar por medida; histórico por recapadora; histórico completo por demanda |
| Analítico Recapar | "Analítico Pneus com Status Recapar": pneus com Situação MM = Recapar, com Mês Demanda e Status na demanda atual, inspeção, sulcos, localização, frota e sugestão |
| Controle Demanda | Histórico dos lotes (tabela `Controle_Demanda`): N.Fogo, Demanda, Mês, Recapadora, Status e Observação digitados; dados atuais do pneu calculados |
| Como usar | Rotina, regras, legenda e origem dos dados |
| Parâmetros | Regra MM (2,75), margem Baixa MM, prazos de aferição, vida máxima, medidas e limites, status, recapadoras, De Para de centro de custo |
| Frotas | N. Frota → placa, tipo, modelo, operação, local e gestor (fotografia da Base de Fidelização) |
| Base Pneus | Exportação Rodopar 10 colada em A:AH + colunas de regra (Situação MM, Aferição MM, Localização...) |

Usa só funções clássicas (sem FILTRO/matrizes dinâmicas), então funciona em qualquer versão do Excel.

## Gerar

```bash
pip install openpyxl lxml
python gerar.py --rodopar "Rodopar 10.xlsx" --controle "1_Controle de Pneus_OPE Souza Cruz.xlsx"
# opcional: recalcular no LibreOffice e gravar os valores em cache (para pré-visualização sem Excel)
RECALC_PY=/caminho/recalc.py python gerar.py ... --verificar
```

A planilha sai em `saida/`. Para a verificação, o LibreOffice Calc precisa estar instalado (`libreoffice-calc`).

## Conferência da carga de 05/10/2026

58.788 fórmulas, 0 erros. O Analítico tem os mesmos 38 pneus, na mesma ordem e com os mesmos valores do Analítico
original (16 colunas), e as colunas calculadas dos 569 registros do Controle Demanda são iguais às da original.

Ajustes em relação à original: 175/70R14 (sem espaço) tratada como Fiorino; "Recatac" padronizada para "Recatec";
REF com separador (`N.Fogo-Demanda`); duplicidade marcada por N.Fogo + Demanda.
