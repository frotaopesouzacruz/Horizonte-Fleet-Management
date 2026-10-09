# Gerador da planilha (uso técnico)

Reconstrói `Controle_Financeiro_Gerencial_Frota.xlsx` a partir do arquivo original `Fluxo de caixa.xlsx`.
Não é necessário na rotina mensal: a planilha entregue já contém todas as fórmulas e se atualiza sozinha.

```bash
pip install openpyxl pandas
cd scripts/gerar_controle
PYTHONPATH=. python main.py "../../backup/Fluxo_de_caixa_ORIGINAL.xlsx" "../../Controle_Financeiro_Gerencial_Frota.xlsx"
```

`tests.py` e `tests2.py` executam os testes de validação (seção 12 do projeto); exigem LibreOffice e o script `recalc.py`
usado para recálculo em lote (os caminhos estão no topo de `tests_lib.py`).
