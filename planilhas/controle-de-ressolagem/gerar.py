"""Gera a planilha "Controle de Ressolagem - Horizonte.xlsx".

Fontes (lidas na hora, nunca versionadas):
  --rodopar   exportação Rodopar 10 (.xlsx)            -> aba Base Pneus
  --controle  1_Controle de Pneus_OPE Souza Cruz.xlsx  -> histórico Controle Demanda (aba Ressolagem),
                                                          De Para e Base de Fidelização (frotas)

Uso:
  python gerar.py --rodopar "Rodopar 10.xlsx" --controle "1_Controle de Pneus_OPE Souza Cruz.xlsx" [--saida pasta]
  python gerar.py ... --verificar     # recalcula no LibreOffice e grava os valores em cache
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import tempfile
import warnings
import zipfile
from collections import Counter
from pathlib import Path

import openpyxl
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

warnings.filterwarnings('ignore')

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
LOGO = RAIZ / 'public' / 'brand' / 'logo-light.png'
NOME = 'Controle de Ressolagem - Horizonte.xlsx'

# ------------------------------------------------------------------ capacidade (linhas com fórmula)
CAP_BASE = 2000        # pneus na Base Pneus
CAP_DEMANDA = 2000     # registros no Controle Demanda
CAP_ANALITICO = 300    # pneus em Recapar listados
CAP_FROTAS = 500
CAP_HIST = 60          # demandas no histórico do Painel

# ------------------------------------------------------------------ parâmetros iniciais
REGRA_MM = 2.75        # Ressolagem!F9 da planilha Controle de Pneus
REGRA_FIORINO = 2.10   # fixo na fórmula "Situação MM" da Base_Pneus para utilização Fiorino
MARGEM_BAIXA = 0.5     # faixa "Baixa MM" = limite até limite + 0,5
PRAZO_EM_DIA = 20      # Aferição MM: até 20 dias = Em Dia
PRAZO_VENCENDO = 25    # 21 a 25 = Prox. ao Vencimento; acima = Vencida
VIDA_MAX = 3           # formatação condicional "Vida Atual >= 3" da aba Ressolagem
STATUS = [
    ('Há Programar', 'Pneu identificado, ainda não programado para envio'),
    ('Há Enviar', 'Programado, aguardando retirada/envio à recapadora'),
    ('Em Ressolagem', 'Na recapadora'),
    ('Realizado', 'Ressolagem concluída e pneu de volta'),
    ('Recusado Recapagem', 'Carcaça recusada pela recapadora'),
    ('Descartar', 'Sem condição de ressolar (vida/carcaça); seguir para descarte'),
]
CORRIGE_RECAPADORA = {'recatac': 'Recatec'}   # grafia minoritária -> forma mais usada

RODOPAR_COLS = ['N.Fogo', 'Filial Pneu', 'Cód\nUnidade', 'Cód\nCusto', 'Data\nCompra', 'Situação Pneu',
                'N.  Frota', 'Filial Frota', 'Marca', 'Modelo Pneu', 'Dimensão', 'Posição',
                'Menor Milimetragem', 'Sulco 1', 'Sulco 2', 'Sulco 3', 'Sulco 4', 'Dt. Medição', 'Calibragem',
                'Dt. Calibragem', 'Km Rodado', 'Km Real', 'Dot', 'N. Vida', 'Condição', 'Classificação',
                'Status', 'Data Cadastro', 'Número De Série', 'Usuário De Inclusão',
                'Usuário Última Alteração', 'Data Última Alteração', 'Desenho', 'Borracha']

# ------------------------------------------------------------------ paleta (design system HFM)
C = dict(blue='1F4B93', blue_deep='163669', cyan='008CCB', gold='F4B223', navy='0B1426',
         text='1F2937', text2='4A5872', muted='5D6B81', border='DFE4EC', border_strong='C5CDDA',
         surface2='F6F8FB', bg='F1F4F8', primary_soft='E8EEF8', accent_soft='E2F3FB',
         gold_soft='FDF3DC', gold_fg='7A5300', input='FFF6D5',
         success='1A8455', success_soft='E2F4EA', success_fg='14623F',
         warning='9D6308', warning_soft='FDF1DA', warning_fg='7A4E05',
         danger='C93636', danger_soft='FCE8E8', danger_fg='8F2323',
         neutral_soft='EEF1F5', neutral_fg='45546B', info_soft='E2F3FB', info_fg='0B5F86')
FONT = 'Arial'


def fill(c):
    return PatternFill('solid', fgColor=c)


def font(size=10, bold=False, color='text', italic=False):
    return Font(name=FONT, size=size, bold=bold, color=C.get(color, color), italic=italic)


THIN = Side(style='thin', color=C['border'])
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
BOTTOM = Border(bottom=THIN)
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)
LEFT = Alignment(horizontal='left', vertical='center', wrap_text=False)
WRAP = Alignment(horizontal='left', vertical='top', wrap_text=True)


# ================================================================== leitura das fontes
def norm(s):
    return ' '.join(str(s or '').split()).lower()


def ler_rodopar(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb['Planilha1'] if 'Planilha1' in wb.sheetnames else wb.worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))
    cab = [norm(c) for c in linhas[0]]
    esperado = [norm(c) for c in RODOPAR_COLS]
    if cab[:len(esperado)] != esperado:
        faltam = [c for c in esperado if c not in cab]
        raise SystemExit(f'Rodopar 10 com colunas diferentes do esperado. Faltando/fora de ordem: {faltam or cab}')
    dados = [list(r[:34]) for r in linhas[1:] if r and r[0] not in (None, '')]
    if len(dados) > CAP_BASE:
        raise SystemExit(f'Rodopar 10 tem {len(dados)} pneus; aumente CAP_BASE ({CAP_BASE}).')
    return dados


def _tabela(ws, nome):
    t = ws.tables[nome]
    a, b = t.ref.split(':')
    c1 = openpyxl.utils.cell.coordinate_from_string(a)
    c2 = openpyxl.utils.cell.coordinate_from_string(b)
    col1 = openpyxl.utils.column_index_from_string(c1[0])
    col2 = openpyxl.utils.column_index_from_string(c2[0])
    rows = list(ws.iter_rows(min_row=c1[1], max_row=c2[1], min_col=col1, max_col=col2, values_only=True))
    return [str(h) for h in rows[0]], rows[1:]


def ler_controle(path, hoje):
    wb = openpyxl.load_workbook(path, data_only=True)

    # --- histórico Controle Demanda (aba Ressolagem, tabela Controle_Demanda)
    cab, rows = _tabela(wb['Ressolagem'], 'Controle_Demanda')
    ix = {h: i for i, h in enumerate(cab)}
    hist, corrigidas = [], Counter()
    for r in rows:
        fogo = r[ix['N.Fogo']]
        if fogo in (None, ''):
            continue
        rec = r[ix['Recapadora']]
        if rec and norm(rec) in CORRIGE_RECAPADORA:
            corrigidas[rec] += 1
            rec = CORRIGE_RECAPADORA[norm(rec)]
        hist.append([fogo, r[ix['Demanda']], r[ix['Mês Demanda']], rec, r[ix['Status']]])

    # --- De Para: Dimensão -> Utilização (primeira ocorrência, como o PROCV da planilha original)
    dp = wb['De Para']
    medidas = {}
    ccusto = {}
    for r in range(7, dp.max_row + 1):
        dim, uso = dp.cell(r, 5).value, dp.cell(r, 7).value
        if dim and uso and dim not in medidas:
            medidas[dim] = uso
        filial, unid, op = dp.cell(r, 13).value, dp.cell(r, 14).value, dp.cell(r, 15).value
        if filial not in (None, '') and unid not in (None, '') and op:
            ccusto.setdefault((filial, unid), op)
    # 175/70R14 (sem espaço) aparece no De Para como "Van"; é a mesma medida da Fiorino
    if '175/70R14' in medidas and medidas.get('175/70 R14') == 'Fiorino':
        medidas['175/70R14'] = 'Fiorino'

    # --- Base de Fidelização: alocação mais recente até hoje para cada frota
    cab, rows = _tabela(wb['Base_Dados_Fidelização'], 'Base_Dados_Fidelização')
    ix = {h: i for i, h in enumerate(cab)}
    frotas = {}
    for r in rows:
        frota, data = r[ix['Frota']], r[ix['Data']]
        if frota in (None, '') or not isinstance(data, dt.datetime):
            continue
        atual = frotas.get(frota)
        hoje_ok = data.date() <= hoje
        chave = (hoje_ok, data if hoje_ok else -data.toordinal())
        if atual is None or chave > atual[0]:
            frotas[frota] = (chave, [frota, r[ix['Placa']], r[ix['Tipo']], r[ix['Modelo']],
                                     r[ix['Tipo Operação']], r[ix['Local de Operação']], r[ix['Gestor']]])
    frotas = sorted((v[1] for v in frotas.values()), key=lambda x: (str(x[2]), str(x[0])))
    return dict(hist=hist, medidas=medidas, ccusto=ccusto, frotas=frotas, corrigidas=corrigidas)


# ================================================================== helpers de layout
def cabecalho(ws, titulo, subtitulo, ultima_col):
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 2.5
    for r in range(1, 5):
        ws.row_dimensions[r].height = 18
    if LOGO.exists():
        img = openpyxl.drawing.image.Image(str(LOGO))
        img.width, img.height = 132, 72
        ws.add_image(img, 'B1')
    ws['D2'] = titulo
    ws['D2'].font = font(18, True, 'blue')
    ws['D3'] = subtitulo
    ws['D3'].font = font(10, False, 'muted')
    for c in range(1, ultima_col + 1):
        ws.cell(5, c).fill = fill(C['gold'])
    ws.row_dimensions[5].height = 4


def secao(ws, cel, texto, ate=None):
    ws[cel] = texto
    ws[cel].font = font(12, True, 'blue_deep')
    if ate:
        r = ws[cel].row
        c1 = ws[cel].column
        for c in range(c1, ate + 1):
            ws.cell(r, c).border = Border(bottom=Side(style='medium', color=C['blue']))


def header_row(ws, row, col1, nomes, cor='blue', altura=30):
    for i, n in enumerate(nomes):
        c = ws.cell(row, col1 + i, n)
        c.font = font(9, True, 'FFFFFF')
        c.fill = fill(C[cor])
        c.alignment = CENTER
        c.border = BOX
    ws.row_dimensions[row].height = altura


def estilo_corpo(ws, r1, r2, c1, c2, fmt=None, center_cols=(), zebra=False):
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            cell = ws.cell(r, c)
            cell.font = font(9)
            cell.border = BOX
            cell.alignment = CENTER if c in center_cols else LEFT
            if fmt and c in fmt:
                cell.number_format = fmt[c]
            if zebra and (r - r1) % 2 == 1:
                cell.fill = fill(C['surface2'])


def cf_status(ws, rng, first):
    regras = [('Realizado', 'success_soft', 'success_fg'), ('Recusado Recapagem', 'warning_soft', 'warning_fg'),
              ('Descartar', 'danger_soft', 'danger_fg'), ('Em Ressolagem', 'info_soft', 'info_fg'),
              ('Há Enviar', 'gold_soft', 'gold_fg'), ('Há Programar', 'primary_soft', 'blue'),
              ('Fora da Demanda', 'neutral_soft', 'neutral_fg')]
    for txt, bg, fg in regras:
        ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=[f'"{txt}"'],
                                                      fill=fill(C[bg]), font=Font(name=FONT, color=C[fg], bold=True)))


def cf_afericao(ws, rng):
    for txt, bg, fg in [('Em Dia', 'success_soft', 'success_fg'), ('Prox. ao Vencimento', 'warning_soft', 'warning_fg'),
                        ('Vencida', 'danger_soft', 'danger_fg')]:
        ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=[f'"{txt}"'],
                                                      fill=fill(C[bg]), font=Font(name=FONT, color=C[fg])))


def nome(wb, n, ref):
    wb.defined_names[n] = DefinedName(n, attr_text=ref)


# ================================================================== abas
BP = "'Base Pneus'"
CD = "'Controle Demanda'"
AN = "'Analítico Recapar'"
B_LAST = CAP_BASE + 1
CD_R1 = 9
CD_LAST = CD_R1 + CAP_DEMANDA - 1
AN_R1 = 9
AN_LAST = AN_R1 + CAP_ANALITICO - 1


def rng(sheet, col, r1, r2):
    return f'{sheet}!${col}${r1}:${col}${r2}'


# colunas calculadas da Base Pneus
BCALC = ['Utilidade', 'Limite MM', 'Situação MM', 'Dias Últ. Insp. MM', 'Aferição MM', 'Centro de Custo',
         'Localização', 'Placa', 'Tipo Frota', 'Local de Operação', 'Seq. Recapar']
BC = {n: L(36 + i) for i, n in enumerate(BCALC)}   # AJ em diante (AI fica vazia como separador)


def aba_base(wb, dados):
    ws = wb.create_sheet('Base Pneus')
    ws.sheet_properties.tabColor = C['muted']
    header_row(ws, 1, 1, RODOPAR_COLS, cor='text2', altura=32)
    header_row(ws, 1, 36, BCALC, cor='blue', altura=32)
    for i, linha in enumerate(dados, start=2):
        for j, v in enumerate(linha, start=1):
            ws.cell(i, j, v)
    fogo_ref = '$A{r}'
    for r in range(2, B_LAST + 1):
        f = {
            'Utilidade': f'=IF($A{r}="","",IFERROR(VLOOKUP($K{r},rMedidas,2,0),"Medida não cadastrada"))',
            'Limite MM': f'=IF($A{r}="","",IFERROR(VLOOKUP($K{r},rMedidas,3,0),pRegraMM))',
            'Situação MM': (f'=IF($A{r}="","",IF(MAX($N{r}:$P{r})=0,"Pneu Novo",'
                            f'IF(OR($F{r}="BAIXADO",$F{r}="DESCARTE",$R{r}=""),"",'
                            f'IF(MIN($N{r}:$P{r})=0,"Aferição Zerada",'
                            f'IF(MIN($N{r}:$P{r})<=$AK{r},"Recapar",'
                            f'IF(ABS($P{r}-$N{r})>=1,"Alinhar Pneu",'
                            f'IF(MIN($N{r}:$P{r})<$AK{r}+pMargemBaixaMM,"Baixa MM","Apropriado")))))))'),
            'Dias Últ. Insp. MM': f'=IF(OR($A{r}="",$R{r}=""),"",TODAY()-INT($R{r}))',
            'Aferição MM': (f'=IF(OR($F{r}="USO",$F{r}="ESTOQUE"),IF($R{r}="","",'
                            f'IF($AM{r}<=pPrazoEmDia,"Em Dia",IF($AM{r}<=pPrazoVencendo,"Prox. ao Vencimento","Vencida"))),"")'),
            'Centro de Custo': f'=IF($A{r}="","",IFERROR(VLOOKUP($B{r}&"-"&$C{r},rCentroCusto,2,0),""))',
            'Localização': f'=IF($A{r}="","","Em "&PROPER($F{r})&IF($AO{r}="","","_"&$AO{r}))',
            'Placa': f'=IF($F{r}<>"USO","",IFERROR(VLOOKUP($G{r},rFrotas,2,0),"Frota "&$G{r}&" sem cadastro"))',
            'Tipo Frota': f'=IF($F{r}<>"USO","",IFERROR(VLOOKUP($G{r},rFrotas,3,0),""))',
            'Local de Operação': f'=IF($F{r}<>"USO","",IFERROR(VLOOKUP($G{r},rFrotas,6,0),""))',
            'Seq. Recapar': f'=IF($AL{r}="Recapar",COUNTIF($AL$2:$AL{r},"Recapar"),"")',
        }
        for n, frm in f.items():
            ws[f'{BC[n]}{r}'] = frm
    fmt = {5: 'dd/mm/yyyy', 18: 'dd/mm/yyyy hh:mm', 20: 'dd/mm/yyyy', 28: 'dd/mm/yyyy hh:mm',
           32: 'dd/mm/yyyy hh:mm', 13: '0.00', 14: '0.00', 15: '0.00', 16: '0.00', 17: '0.00',
           21: '#,##0', 22: '#,##0', 37: '0.00'}
    for r in range(2, B_LAST + 1):
        for c in list(range(1, 35)) + list(range(36, 47)):
            cell = ws.cell(r, c)
            cell.font = font(9, color='text' if c < 35 else 'text2')
            if c in fmt:
                cell.number_format = fmt[c]
            if c >= 36:
                cell.fill = fill(C['surface2'])
    larg = {1: 9, 2: 7, 3: 8, 4: 7, 5: 11, 6: 11, 7: 9, 8: 7, 9: 13, 10: 18, 11: 13, 12: 8, 13: 10,
            18: 15, 32: 15, 28: 15, 30: 16, 31: 16}
    for c in range(1, 47):
        ws.column_dimensions[L(c)].width = larg.get(c, 9 if c < 35 else 14)
    ws.column_dimensions['AI'].width = 2
    ws.column_dimensions[BC['Localização']].width = 26
    ws.column_dimensions[BC['Local de Operação']].width = 16
    ws.column_dimensions[BC['Utilidade']].width = 11
    ws.freeze_panes = 'B2'
    ws.auto_filter.ref = f'A1:{BC["Seq. Recapar"]}{B_LAST}'
    cf_afericao(ws, f'{BC["Aferição MM"]}2:{BC["Aferição MM"]}{B_LAST}')
    ws.conditional_formatting.add(f'{BC["Situação MM"]}2:{BC["Situação MM"]}{B_LAST}',
                                  CellIsRule(operator='equal', formula=['"Recapar"'], fill=fill(C['danger_soft']),
                                             font=Font(name=FONT, color=C['danger_fg'], bold=True)))
    return ws


def aba_parametros(wb, fontes):
    ws = wb.create_sheet('Parâmetros')
    ws.sheet_properties.tabColor = C['gold']
    cabecalho(ws, 'Parâmetros', 'Células amarelas são editáveis. As fórmulas de todas as abas leem daqui.', 14)
    secao(ws, 'B7', 'Regras de ressolagem', 4)
    linhas = [
        ('pRegraMM', 'Regra MM para ressolagem (mm): menor sulco ≤ este valor = Recapar', REGRA_MM, '0.00',
         'Da aba Ressolagem (F9) da planilha Controle de Pneus'),
        ('pMargemBaixaMM', 'Margem "Baixa MM" (mm acima do limite)', MARGEM_BAIXA, '0.00',
         'Da fórmula Situação MM da Base_Pneus (limite + 0,5)'),
        ('pPrazoEmDia', 'Aferição "Em Dia" até (dias desde a última medição)', PRAZO_EM_DIA, '0',
         'Da fórmula Aferição MM da Base_Pneus'),
        ('pPrazoVencendo', 'Aferição "Prox. ao Vencimento" até (dias)', PRAZO_VENCENDO, '0',
         'Acima deste prazo = Vencida'),
        ('pVidaMax', 'Vida máxima para ressolagem (N. Vida ≥ valor = avaliar descarte)', VIDA_MAX, '0',
         'Da formatação "Vida Atual ≥ 3" da aba Ressolagem'),
    ]
    for i, (n, desc, v, f, origem) in enumerate(linhas):
        r = 8 + i
        ws.cell(r, 2, desc).font = font(10)
        c = ws.cell(r, 3, v)
        c.font = font(10, True, '0000FF')
        c.fill = fill(C['input'])
        c.number_format = f
        c.alignment = CENTER
        c.border = BOX
        ws.cell(r, 4, origem).font = font(8, italic=True, color='muted')
        nome(wb, n, f"'Parâmetros'!$C${r}")

    r0 = 15
    secao(ws, f'B{r0}', 'Medidas', 4)
    header_row(ws, r0 + 1, 2, ['Medida (Dimensão)', 'Utilidade', 'Limite MM ressolagem'])
    med = sorted(fontes['medidas'].items(), key=lambda x: (x[1], x[0]))
    for i in range(20):
        r = r0 + 2 + i
        if i < len(med):
            dim, uso = med[i]
            ws.cell(r, 2, dim)
            ws.cell(r, 3, uso)
            ws.cell(r, 4, REGRA_FIORINO if uso == 'Fiorino' else '=pRegraMM')
        for c in (2, 3, 4):
            cell = ws.cell(r, c)
            cell.border = BOX
            cell.fill = fill(C['input'])
            cell.font = font(9, color='0000FF' if not (c == 4 and str(cell.value).startswith('=')) else 'text')
            cell.alignment = CENTER if c > 2 else LEFT
        ws.cell(r, 4).number_format = '0.00'
    nome(wb, 'rMedidas', f"'Parâmetros'!$B${r0 + 2}:$D${r0 + 21}")
    ws.cell(r0 + 22, 2, 'Fiorino: 2,10 mm (fixo na planilha original). Demais medidas seguem a regra MM acima. '
            '175/70R14 (sem espaço) foi classificada como Fiorino.').font = font(8, italic=True, color='muted')

    # Status
    secao(ws, f'F{r0}', 'Status da demanda', 8)
    header_row(ws, r0 + 1, 6, ['Status', 'Significado'])
    for i in range(10):
        r = r0 + 2 + i
        if i < len(STATUS):
            ws.cell(r, 6, STATUS[i][0])
            ws.cell(r, 7, STATUS[i][1])
        for c in (6, 7):
            ws.cell(r, c).border = BOX
            ws.cell(r, c).font = font(9, color='0000FF')
            ws.cell(r, c).fill = fill(C['input'])
    nome(wb, 'rStatus', f"'Parâmetros'!$F${r0 + 2}:$F${r0 + 11}")
    cf_status(ws, f'F{r0 + 2}:F{r0 + 11}', None)

    # Recapadoras
    recs = Counter(h[3] for h in fontes['hist'] if h[3])
    secao(ws, f'I{r0}', 'Recapadoras', 9)
    header_row(ws, r0 + 1, 9, ['Recapadora'])
    for i in range(10):
        r = r0 + 2 + i
        if i < len(recs):
            ws.cell(r, 9, recs.most_common()[i][0])
        ws.cell(r, 9).border = BOX
        ws.cell(r, 9).font = font(9, color='0000FF')
        ws.cell(r, 9).fill = fill(C['input'])
    nome(wb, 'rRecapadoras', f"'Parâmetros'!$I${r0 + 2}:$I${r0 + 11}")

    # Centro de custo
    secao(ws, f'K{r0}', 'De Para: Filial + Unidade → Centro de Custo', 14)
    header_row(ws, r0 + 1, 11, ['Filial Pneu', 'Cód. Unidade', 'Chave', 'Centro de Custo'])
    cc = sorted(fontes['ccusto'].items(), key=lambda x: str(x[0]))
    for i in range(15):
        r = r0 + 2 + i
        if i < len(cc):
            (fil, uni), op = cc[i]
            ws.cell(r, 11, int(fil) if str(fil).isdigit() else fil)
            ws.cell(r, 12, int(uni) if str(uni).isdigit() else uni)
            ws.cell(r, 14, op)
        ws.cell(r, 13, f'=IF(K{r}="","",K{r}&"-"&L{r})')
        for c in (11, 12, 13, 14):
            cell = ws.cell(r, c)
            cell.border = BOX
            cell.font = font(9, color='text' if c == 13 else '0000FF')
            if c != 13:
                cell.fill = fill(C['input'])
            cell.alignment = CENTER if c < 14 else LEFT
    nome(wb, 'rCentroCusto', f"'Parâmetros'!$M${r0 + 2}:$N${r0 + 16}")

    for c, w in {2: 58, 3: 14, 4: 20, 5: 3, 6: 20, 7: 52, 8: 3, 9: 20, 10: 3, 11: 11, 12: 12, 13: 9, 14: 24}.items():
        ws.column_dimensions[L(c)].width = w
    return ws


def aba_frotas(wb, fontes, hoje):
    ws = wb.create_sheet('Frotas')
    ws.sheet_properties.tabColor = C['muted']
    cabecalho(ws, 'Frotas', f'Fotografia da Base de Fidelização em {hoje:%d/%m/%Y}. Atualize quando houver troca '
                            'de veículo, placa ou local de operação.', 8)
    cols = ['Frota', 'Placa', 'Tipo Frota', 'Modelo', 'Tipo Operação', 'Local de Operação', 'Gestor']
    header_row(ws, 7, 2, cols)
    for i in range(CAP_FROTAS):
        r = 8 + i
        if i < len(fontes['frotas']):
            for j, v in enumerate(fontes['frotas'][i]):
                ws.cell(r, 2 + j, v)
    estilo_corpo(ws, 8, 7 + max(len(fontes['frotas']), 1), 2, 8, center_cols=(2, 3))
    for c, w in zip('BCDEFGH', [10, 11, 13, 14, 18, 20, 30]):
        ws.column_dimensions[c].width = w
    nome(wb, 'rFrotas', f"'Frotas'!$B$8:$H${7 + CAP_FROTAS}")
    ws.freeze_panes = 'B8'
    ws.auto_filter.ref = f'B7:H{7 + max(len(fontes["frotas"]), 1)}'
    return ws


CDCOLS = ['REF', 'N.Fogo', 'Demanda', 'Mês Demanda', 'Recapadora', 'Status', 'Observação',
          'Modelo Pneu', 'Utilidade', 'Vida Atual', 'M1', 'M2', 'M3', 'M4', 'Situação MM', 'Aferição MM',
          'Localização', 'Frota', 'Posição', 'Local de Operação', 'Linha Base']
CDC = {n: L(2 + i) for i, n in enumerate(CDCOLS)}   # B..V
CD_INPUT = ['N.Fogo', 'Demanda', 'Mês Demanda', 'Recapadora', 'Status', 'Observação']


def aba_controle(wb, fontes):
    ws = wb.create_sheet('Controle Demanda')
    ws.sheet_properties.tabColor = C['cyan']
    last_col = 2 + len(CDCOLS) - 1
    cabecalho(ws, 'Controle Demanda', 'Histórico dos lotes de ressolagem. Lance cada pneu na próxima linha vazia.',
              last_col)
    ws['B6'] = ('Digite nas colunas de cabeçalho azul-claro (N.Fogo, Demanda, Mês Demanda, Recapadora, Status, '
                'Observação). As colunas cinza buscam os dados atuais do pneu na Base Pneus.')
    ws['B6'].font = font(9, italic=True, color='muted')
    ws['B7'] = 'N.Fogo repetido na mesma demanda fica em vermelho.'
    ws['B7'].font = font(9, italic=True, color='muted')

    for i, n in enumerate(CDCOLS):
        c = ws.cell(8, 2 + i, n)
        inp = n in CD_INPUT
        c.font = font(9, True, 'blue_deep' if inp else 'FFFFFF')
        c.fill = fill(C['accent_soft'] if inp else C['text2'])
        c.alignment = CENTER
        c.border = BOX
    ws.row_dimensions[8].height = 30

    BPA = f'{BP}!$A$2:$A${B_LAST}'

    def bcol(col):
        return f'{BP}!${col}$2:${col}${B_LAST}'

    hist = fontes['hist']
    for i in range(CAP_DEMANDA):
        r = CD_R1 + i
        if i < len(hist):
            fogo, dem, mes, rec, st = hist[i]
            ws[f'{CDC["N.Fogo"]}{r}'] = fogo
            ws[f'{CDC["Demanda"]}{r}'] = dem
            ws[f'{CDC["Mês Demanda"]}{r}'] = mes
            ws[f'{CDC["Recapadora"]}{r}'] = rec
            ws[f'{CDC["Status"]}{r}'] = st
        fo, lb = f'${CDC["N.Fogo"]}{r}', f'${CDC["Linha Base"]}{r}'

        def by(col, vazio='""'):
            return f'=IF({lb}="",{vazio},INDEX({bcol(col)},{lb}))'
        ws[f'{CDC["REF"]}{r}'] = f'=IF({fo}="","",{fo}&"-"&${CDC["Demanda"]}{r})'
        ws[f'{CDC["Linha Base"]}{r}'] = f'=IF({fo}="","",IFERROR(MATCH({fo},{BPA},0),""))'
        ws[f'{CDC["Modelo Pneu"]}{r}'] = f'=IF({fo}="","",IF({lb}="","Não encontrado na base",INDEX({bcol("K")},{lb})))'
        ws[f'{CDC["Utilidade"]}{r}'] = by(BC['Utilidade'])
        ws[f'{CDC["Vida Atual"]}{r}'] = by('X')
        for m, col in zip(['M1', 'M2', 'M3', 'M4'], 'NOPQ'):
            ws[f'{CDC[m]}{r}'] = by(col)
        ws[f'{CDC["Situação MM"]}{r}'] = by(BC['Situação MM'])
        ws[f'{CDC["Aferição MM"]}{r}'] = by(BC['Aferição MM'])
        ws[f'{CDC["Localização"]}{r}'] = by(BC['Localização'])
        ws[f'{CDC["Frota"]}{r}'] = by(BC['Placa'])
        ws[f'{CDC["Posição"]}{r}'] = f'=IF({lb}="","",IF(INDEX({bcol("F")},{lb})="USO",INDEX({bcol("L")},{lb}),""))'
        ws[f'{CDC["Local de Operação"]}{r}'] = by(BC['Local de Operação'])

    center = {openpyxl.utils.column_index_from_string(CDC[n]) for n in
              ['N.Fogo', 'Demanda', 'Vida Atual', 'M1', 'M2', 'M3', 'M4', 'Posição', 'Linha Base']}
    fmt = {openpyxl.utils.column_index_from_string(CDC[m]): '0.00' for m in ['M1', 'M2', 'M3', 'M4']}
    for r in range(CD_R1, CD_LAST + 1):
        for i, n in enumerate(CDCOLS):
            c = ws.cell(r, 2 + i)
            c.font = font(9, color='0000FF' if n in CD_INPUT else 'text')
            c.alignment = CENTER if (2 + i) in center else LEFT
            if (2 + i) in fmt:
                c.number_format = fmt[2 + i]
            if n == 'REF':
                c.font = font(8, color='muted')

    tab = Table(displayName='Controle_Demanda', ref=f'B8:{CDC["Linha Base"]}{CD_LAST}')
    tab.tableStyleInfo = TableStyleInfo(name='TableStyleLight1', showRowStripes=True)
    ws.add_table(tab)

    dv = DataValidation(type='list', formula1='rStatus', allow_blank=True, showErrorMessage=True,
                        errorTitle='Status', error='Escolha um status da lista (aba Parâmetros).')
    dv.add(f'{CDC["Status"]}{CD_R1}:{CDC["Status"]}{CD_LAST}')
    dv2 = DataValidation(type='list', formula1='rRecapadoras', allow_blank=True, showErrorMessage=True,
                         errorStyle='warning', errorTitle='Recapadora',
                         error='Recapadora fora da lista da aba Parâmetros. Confirme a grafia.')
    dv2.add(f'{CDC["Recapadora"]}{CD_R1}:{CDC["Recapadora"]}{CD_LAST}')
    dv3 = DataValidation(type='whole', operator='greaterThanOrEqual', formula1='1', allow_blank=True,
                         showErrorMessage=True, errorTitle='Demanda', error='Informe o número da demanda (1, 2, 3...).')
    dv3.add(f'{CDC["Demanda"]}{CD_R1}:{CDC["Demanda"]}{CD_LAST}')
    for d in (dv, dv2, dv3):
        ws.add_data_validation(d)

    cf_status(ws, f'{CDC["Status"]}{CD_R1}:{CDC["Status"]}{CD_LAST}', None)
    cf_afericao(ws, f'{CDC["Aferição MM"]}{CD_R1}:{CDC["Aferição MM"]}{CD_LAST}')
    f, d = CDC['N.Fogo'], CDC['Demanda']
    ws.conditional_formatting.add(
        f'{f}{CD_R1}:{f}{CD_LAST}',
        FormulaRule(formula=[f'AND(${f}{CD_R1}<>"",COUNTIFS(${f}${CD_R1}:${f}${CD_LAST},${f}{CD_R1},'
                             f'${d}${CD_R1}:${d}${CD_LAST},${d}{CD_R1})>1)'],
                    fill=fill(C['danger_soft']), font=Font(name=FONT, color=C['danger_fg'], bold=True)))
    v = CDC['Vida Atual']
    ws.conditional_formatting.add(f'{v}{CD_R1}:{v}{CD_LAST}',
                                  FormulaRule(formula=[f'AND(ISNUMBER(${v}{CD_R1}),${v}{CD_R1}>=pVidaMax)'],
                                              font=Font(name=FONT, color=C['danger'], bold=True)))
    s = CDC['Situação MM']
    ws.conditional_formatting.add(f'{s}{CD_R1}:{s}{CD_LAST}',
                                  CellIsRule(operator='equal', formula=['"Recapar"'],
                                             font=Font(name=FONT, color=C['danger_fg'], bold=True)))
    ws.conditional_formatting.add(f'{s}{CD_R1}:{s}{CD_LAST}',
                                  CellIsRule(operator='equal', formula=['"Apropriado"'],
                                             font=Font(name=FONT, color=C['success_fg'])))
    loc = CDC['Localização']
    for txt, cor in [('Em Uso', 'success_fg'), ('Descarte', 'danger_fg'), ('Baixado', 'danger_fg')]:
        ws.conditional_formatting.add(f'{loc}{CD_R1}:{loc}{CD_LAST}',
                                      FormulaRule(formula=[f'ISNUMBER(SEARCH("{txt}",{loc}{CD_R1}))'],
                                                  font=Font(name=FONT, color=C[cor])))

    larg = {'REF': 9, 'N.Fogo': 9, 'Demanda': 9, 'Mês Demanda': 15, 'Recapadora': 17, 'Status': 19,
            'Observação': 26, 'Modelo Pneu': 13, 'Utilidade': 10, 'Vida Atual': 7, 'M1': 7, 'M2': 7, 'M3': 7,
            'M4': 7, 'Situação MM': 13, 'Aferição MM': 17, 'Localização': 26, 'Frota': 11, 'Posição': 8,
            'Local de Operação': 16, 'Linha Base': 7}
    for n, w in larg.items():
        ws.column_dimensions[CDC[n]].width = w
    ws.column_dimensions[CDC['Linha Base']].hidden = True
    ws.freeze_panes = f'{CDC["Demanda"]}{CD_R1}'
    return ws


ANCOLS = ['N.Fogo', 'Modelo Pneu', 'Utilidade', 'Mês Demanda', 'Status', 'Vida Atual', 'Inspeção',
          'M1', 'M2', 'M3', 'M4', 'Localização', 'Frota', 'Tipo Frota', 'Local de Operação', 'Posição',
          'Vezes no Histórico', 'Último Registro no Histórico', 'Sugestão']
ANC = {n: L(2 + i) for i, n in enumerate(ANCOLS)}   # B..T
AN_HELP = 'V'   # linha do pneu na Base Pneus (oculta)


def aba_analitico(wb):
    ws = wb.create_sheet('Analítico Recapar')
    ws.sheet_properties.tabColor = C['danger']
    last_col = 2 + len(ANCOLS) - 1
    cabecalho(ws, 'Analítico Pneus com Status Recapar',
              'Pneus da Base Pneus com Situação MM = Recapar, cruzados com a demanda atual do Controle Demanda.',
              last_col)
    labels = [('B6', 'Pneus em Recapar'), ('E6', 'Demanda atual'), ('H6', 'Na demanda atual'),
              ('K6', 'Fora da demanda')]
    for cel, t in labels:
        ws[cel] = t
        ws[cel].font = font(8, True, 'muted')
    ws['B7'] = f'=COUNTIF({rng(BP, BC["Situação MM"], 2, B_LAST)},"Recapar")'
    ws['E7'] = f'=IFERROR("Nº "&MAX({rng(CD, CDC["Demanda"], CD_R1, CD_LAST)})&" · "&INDEX({rng(CD, CDC["Mês Demanda"], CD_R1, CD_LAST)},MATCH(MAX({rng(CD, CDC["Demanda"], CD_R1, CD_LAST)}),{rng(CD, CDC["Demanda"], CD_R1, CD_LAST)},0)),"—")'
    st = f'${ANC["Status"]}${AN_R1}:${ANC["Status"]}${AN_LAST}'
    fg = f'${ANC["N.Fogo"]}${AN_R1}:${ANC["N.Fogo"]}${AN_LAST}'
    ws['H7'] = f'=COUNTIFS({fg},">0",{st},"<>Fora da Demanda")'
    ws['K7'] = f'=COUNTIF({st},"Fora da Demanda")'
    for cel in ('B7', 'E7', 'H7', 'K7'):
        ws[cel].font = font(14, True, 'blue')
    ws['N7'] = (f'=IF(B7>{CAP_ANALITICO},"Atenção: há mais pneus em Recapar do que as {CAP_ANALITICO} linhas da lista","")')
    ws['N7'].font = font(9, True, 'danger')

    header_row(ws, 8, 2, ANCOLS, cor='blue', altura=32)
    seq = rng(BP, BC['Seq. Recapar'], 2, B_LAST)
    CDf = rng(CD, CDC['N.Fogo'], CD_R1, CD_LAST)
    CDd = rng(CD, CDC['Demanda'], CD_R1, CD_LAST)
    CDref = rng(CD, CDC['REF'], CD_R1, CD_LAST)
    CDm = rng(CD, CDC['Mês Demanda'], CD_R1, CD_LAST)
    CDs = rng(CD, CDC['Status'], CD_R1, CD_LAST)
    dem_atual = f'MAX({CDd})'

    def bcol(col):
        return f'{BP}!${col}$2:${col}${B_LAST}'

    for i in range(CAP_ANALITICO):
        r = AN_R1 + i
        k = i + 1
        h = f'${AN_HELP}{r}'
        fo = f'${ANC["N.Fogo"]}{r}'
        ws[f'{AN_HELP}{r}'] = f'=IFERROR(MATCH({k},{seq},0),"")'

        def by(col):
            return f'=IF({h}="","",INDEX({bcol(col)},{h}))'
        ws[f'{ANC["N.Fogo"]}{r}'] = by('A')
        ws[f'{ANC["Modelo Pneu"]}{r}'] = by('K')
        ws[f'{ANC["Utilidade"]}{r}'] = by(BC['Utilidade'])
        na_atual = f'COUNTIFS({CDf},{fo},{CDd},{dem_atual})>0'
        ref_atual = f'MATCH({fo}&"-"&{dem_atual},{CDref},0)'
        ws[f'{ANC["Mês Demanda"]}{r}'] = (f'=IF({fo}="","",IF({na_atual},INDEX({CDm},{ref_atual}),'
                                          f'"Fora da Demanda"))')
        ws[f'{ANC["Status"]}{r}'] = (f'=IF({fo}="","",IF({na_atual},IF(INDEX({CDs},{ref_atual})="","Sem status",'
                                     f'INDEX({CDs},{ref_atual})),"Fora da Demanda"))')
        ws[f'{ANC["Vida Atual"]}{r}'] = by('X')
        ws[f'{ANC["Inspeção"]}{r}'] = (f'=IF({h}="","",IF(INDEX({bcol(BC["Aferição MM"])},{h})="",'
                                       f'"Em "&PROPER(INDEX({bcol("F")},{h})),INDEX({bcol(BC["Aferição MM"])},{h})))')
        for m, col in zip(['M1', 'M2', 'M3', 'M4'], 'NOPQ'):
            ws[f'{ANC[m]}{r}'] = by(col)
        ws[f'{ANC["Localização"]}{r}'] = by(BC['Localização'])
        ws[f'{ANC["Frota"]}{r}'] = by(BC['Placa'])
        ws[f'{ANC["Tipo Frota"]}{r}'] = by(BC['Tipo Frota'])
        ws[f'{ANC["Local de Operação"]}{r}'] = by(BC['Local de Operação'])
        ws[f'{ANC["Posição"]}{r}'] = f'=IF({h}="","",IF(INDEX({bcol("F")},{h})="USO",INDEX({bcol("L")},{h}),""))'
        ws[f'{ANC["Vezes no Histórico"]}{r}'] = f'=IF({fo}="","",COUNTIF({CDf},{fo}))'
        ult = f'_xlfn.MAXIFS({CDd},{CDf},{fo})'
        ws[f'{ANC["Último Registro no Histórico"]}{r}'] = (
            f'=IF({fo}="","",IF(COUNTIF({CDf},{fo})=0,"—","Nº "&{ult}&" · "&INDEX({CDm},MATCH({fo}&"-"&{ult},{CDref},0))'
            f'&IF(INDEX({CDs},MATCH({fo}&"-"&{ult},{CDref},0))="",""," · "&INDEX({CDs},MATCH({fo}&"-"&{ult},{CDref},0)))))')
        vida = f'${ANC["Vida Atual"]}{r}'
        stc = f'${ANC["Status"]}{r}'
        ws[f'{ANC["Sugestão"]}{r}'] = (
            f'=IF({fo}="","",IF(AND(ISNUMBER({vida}),{vida}>=pVidaMax),"Avaliar descarte (vida "&{vida}&")",'
            f'IF({stc}="Fora da Demanda","Incluir na próxima demanda","Acompanhar na demanda")))')

    center = {openpyxl.utils.column_index_from_string(ANC[n]) for n in
              ['N.Fogo', 'Vida Atual', 'M1', 'M2', 'M3', 'M4', 'Posição', 'Vezes no Histórico', 'Utilidade']}
    fmt = {openpyxl.utils.column_index_from_string(ANC[m]): '0.00' for m in ['M1', 'M2', 'M3', 'M4']}
    estilo_corpo(ws, AN_R1, AN_LAST, 2, last_col, fmt=fmt, center_cols=center)
    ws.column_dimensions[AN_HELP].hidden = True

    cf_status(ws, f'{ANC["Status"]}{AN_R1}:{ANC["Status"]}{AN_LAST}', None)
    cf_afericao(ws, f'{ANC["Inspeção"]}{AN_R1}:{ANC["Inspeção"]}{AN_LAST}')
    v = ANC['Vida Atual']
    ws.conditional_formatting.add(f'{v}{AN_R1}:{v}{AN_LAST}',
                                  FormulaRule(formula=[f'AND(ISNUMBER(${v}{AN_R1}),${v}{AN_R1}>=pVidaMax)'],
                                              fill=fill(C['danger_soft']), font=Font(name=FONT, color=C['danger_fg'], bold=True)))
    m1, m4 = ANC['M1'], ANC['M4']
    ws.conditional_formatting.add(
        f'{m1}{AN_R1}:{m4}{AN_LAST}',
        FormulaRule(formula=[f'AND(ISNUMBER({m1}{AN_R1}),{m1}{AN_R1}<=IFERROR(VLOOKUP(${ANC["Modelo Pneu"]}{AN_R1},rMedidas,3,0),pRegraMM))'],
                    font=Font(name=FONT, color=C['danger'], bold=True)))
    sg = ANC['Sugestão']
    ws.conditional_formatting.add(f'{sg}{AN_R1}:{sg}{AN_LAST}',
                                  FormulaRule(formula=[f'LEFT({sg}{AN_R1},7)="Avaliar"'],
                                              font=Font(name=FONT, color=C['danger_fg'], bold=True)))
    ws.conditional_formatting.add(f'{sg}{AN_R1}:{sg}{AN_LAST}',
                                  FormulaRule(formula=[f'LEFT({sg}{AN_R1},7)="Incluir"'],
                                              font=Font(name=FONT, color=C['gold_fg'], bold=True)))
    ws.conditional_formatting.add(f'B{AN_R1}:{L(last_col)}{AN_LAST}',
                                  FormulaRule(formula=[f'AND($B{AN_R1}<>"",MOD(ROW(),2)=0)'], fill=fill(C['surface2'])))
    larg = {'N.Fogo': 9, 'Modelo Pneu': 13, 'Utilidade': 10, 'Mês Demanda': 15, 'Status': 18, 'Vida Atual': 7,
            'Inspeção': 17, 'M1': 7, 'M2': 7, 'M3': 7, 'M4': 7, 'Localização': 26, 'Frota': 11, 'Tipo Frota': 11,
            'Local de Operação': 16, 'Posição': 8, 'Vezes no Histórico': 10, 'Último Registro no Histórico': 34,
            'Sugestão': 25}
    for n, w in larg.items():
        ws.column_dimensions[ANC[n]].width = w
    ws.freeze_panes = f'C{AN_R1}'
    ws.auto_filter.ref = f'B8:{L(last_col)}{AN_LAST}'
    return ws


def aba_painel(wb):
    ws = wb.create_sheet('Painel', 0)
    ws.sheet_properties.tabColor = C['blue']
    cabecalho(ws, 'Controle de Ressolagem', 'Operações Souza Cruz · Gestão de Pneus Horizonte', 17)
    for c in range(2, 18):
        ws.column_dimensions[L(c)].width = 12.5
    ws.column_dimensions['C'].width = 15

    SIT = rng(BP, BC['Situação MM'], 2, B_LAST)
    SITP = rng(BP, 'F', 2, B_LAST)
    VIDA = rng(BP, 'X', 2, B_LAST)
    CDf = rng(CD, CDC['N.Fogo'], CD_R1, CD_LAST)
    CDd = rng(CD, CDC['Demanda'], CD_R1, CD_LAST)
    CDm = rng(CD, CDC['Mês Demanda'], CD_R1, CD_LAST)
    CDs = rng(CD, CDC['Status'], CD_R1, CD_LAST)
    CDr = rng(CD, CDC['Recapadora'], CD_R1, CD_LAST)
    ANs = rng(AN, ANC['Status'], AN_R1, AN_LAST)
    ANf = rng(AN, ANC['N.Fogo'], AN_R1, AN_LAST)
    ANm = rng(AN, ANC['Modelo Pneu'], AN_R1, AN_LAST)

    # faixa de informações
    info = [('B6', 'Base Rodopar 10 (última alteração):'),
            ('G6', 'Hoje:'), ('J6', 'Regra MM:'), ('M6', 'Vida máx.:')]
    for cel, t in info:
        ws[cel] = t
        ws[cel].font = font(9, True, 'muted')
    ws['E6'] = f'=MAX({rng(BP, "AF", 2, B_LAST)},{rng(BP, "R", 2, B_LAST)})'
    ws['E6'].number_format = 'dd/mm/yyyy hh:mm'
    ws['H6'] = '=TODAY()'
    ws['H6'].number_format = 'dd/mm/yyyy'
    ws['K6'] = '=pRegraMM'
    ws['K6'].number_format = '0.00" mm"'
    ws['N6'] = '=pVidaMax'
    ws['N6'].number_format = '0" vidas"'
    for cel in ('E6', 'H6', 'K6', 'N6'):
        ws[cel].font = font(9, True, 'text')
        ws[cel].alignment = Alignment(horizontal='left')

    # KPIs
    kpis = [
        ('Pneus em Recapar', f'=COUNTIF({SIT},"Recapar")', 'Situação MM = Recapar', 'blue'),
        ('No veículo (uso)', f'=COUNTIFS({SIT},"Recapar",{SITP},"USO")', 'precisam ser retirados', 'blue'),
        ('Em estoque', f'=COUNTIFS({SIT},"Recapar",{SITP},"ESTOQUE")', 'prontos para envio', 'blue'),
        ('Na demanda atual', f'=COUNTIFS({ANf},">0",{ANs},"<>Fora da Demanda")', 'já lançados no lote', 'success'),
        ('Fora da demanda', f'=COUNTIF({ANs},"Fora da Demanda")', 'incluir na próxima', 'warning'),
        ('Avaliar descarte', f'=COUNTIFS({SIT},"Recapar",{VIDA},">="&pVidaMax)', 'vida ≥ máxima', 'danger'),
    ]
    for i, (t, f, sub, cor) in enumerate(kpis):
        col1, col2 = L(2 + i * 2), L(3 + i * 2)
        ws.merge_cells(f'{col1}8:{col2}8')
        ws.merge_cells(f'{col1}9:{col2}9')
        ws.merge_cells(f'{col1}10:{col2}10')
        ws[f'{col1}8'] = t
        ws[f'{col1}8'].font = font(9, True, 'muted')
        ws[f'{col1}9'] = f
        ws[f'{col1}9'].font = font(22, True, cor)
        ws[f'{col1}10'] = sub
        ws[f'{col1}10'].font = font(8, color='muted')
        sep = Side(style='thick', color='FFFFFF')
        for r in (8, 9, 10):
            for c in (col1, col2):
                ws[f'{c}{r}'].fill = fill(C['surface2'])
                ws[f'{c}{r}'].alignment = Alignment(horizontal='left', vertical='center', indent=1)
            ws[f'{col1}{r}'].border = Border(left=sep, top=Side(style='thick', color=C[cor]) if r == 8 else None)
        ws[f'{col2}8'].border = Border(right=sep, top=Side(style='thick', color=C[cor]))
        for r in (9, 10):
            ws[f'{col2}{r}'].border = Border(right=sep)
    ws.row_dimensions[9].height = 30

    # demanda atual
    secao(ws, 'B12', 'Demanda atual', 12)
    cols = ['Demanda', 'Mês', 'Pneus'] + [s for s, _ in STATUS] + ['Sem status']
    header_row(ws, 13, 2, cols, altura=30)
    ws['B14'] = f'=IF(COUNT({CDd})=0,"",MAX({CDd}))'
    ws['C14'] = f'=IFERROR(INDEX({CDm},MATCH(B14,{CDd},0)),"")'
    ws['D14'] = f'=IF(B14="",0,COUNTIF({CDd},B14))'
    for j, (s, _) in enumerate(STATUS):
        ws.cell(14, 5 + j, f'=IF($B$14="",0,COUNTIFS({CDd},$B$14,{CDs},"{s}"))')
    ws.cell(14, 5 + len(STATUS), f'=IF($B$14="",0,COUNTIFS({CDd},$B$14,{CDs},""))')
    estilo_corpo(ws, 14, 14, 2, 1 + len(cols), center_cols=set(range(2, 2 + len(cols))))
    for c in range(2, 2 + len(cols)):
        ws.cell(14, c).font = font(11, True)
    ws.row_dimensions[14].height = 22

    hist_cols = ['Demanda', 'Mês', 'Pneus', 'Realizado', 'Recusado', 'Descartar', 'Em andamento', '% Realizado']

    def linha_hist(r, dem_formula):
        ws[f'B{r}'] = dem_formula
        ws[f'C{r}'] = f'=IF(B{r}="","",IFERROR(INDEX({CDm},MATCH(B{r},{CDd},0)),""))'
        ws[f'D{r}'] = f'=IF(B{r}="","",COUNTIF({CDd},B{r}))'
        ws[f'E{r}'] = f'=IF(B{r}="","",COUNTIFS({CDd},B{r},{CDs},"Realizado"))'
        ws[f'F{r}'] = f'=IF(B{r}="","",COUNTIFS({CDd},B{r},{CDs},"Recusado Recapagem"))'
        ws[f'G{r}'] = f'=IF(B{r}="","",COUNTIFS({CDd},B{r},{CDs},"Descartar"))'
        ws[f'H{r}'] = f'=IF(B{r}="","",D{r}-E{r}-F{r}-G{r})'
        ws[f'I{r}'] = f'=IF(OR(B{r}="",D{r}=0),"",E{r}/D{r})'
        ws[f'I{r}'].number_format = '0%'

    # evolução (últimas 12, ordem cronológica) + gráfico
    secao(ws, 'B16', 'Evolução das últimas 12 demandas', 17)
    header_row(ws, 17, 2, hist_cols, altura=30)
    for i in range(12):
        r = 18 + i
        linha_hist(r, f'=IF($B$14="","",IF($B$14-{11 - i}>=1,$B$14-{11 - i},""))')
    estilo_corpo(ws, 18, 29, 2, 9, fmt={9: '0%'}, center_cols=set(range(2, 10)), zebra=True)

    ch = BarChart()
    ch.type = 'col'
    ch.grouping = 'stacked'
    ch.overlap = 100
    ch.title = 'Pneus por demanda e resultado'
    ch.y_axis.title = 'Pneus'
    ch.y_axis.majorGridlines = None
    ch.height, ch.width = 7.6, 17.5
    data = Reference(ws, min_col=5, max_col=8, min_row=17, max_row=29)
    cats = Reference(ws, min_col=3, min_row=18, max_row=29)
    ch.add_data(data, titles_from_data=True)
    ch.set_categories(cats)
    for s, cor in zip(ch.series, [C['success'], C['gold'], C['danger'], C['blue']]):
        s.graphicalProperties.solidFill = cor
        s.graphicalProperties.line.solidFill = cor
    ch.legend.position = 'b'
    ch.x_axis.delete = False
    ch.y_axis.delete = False
    ws.add_chart(ch, 'K17')

    # por medida
    secao(ws, 'B32', 'Pneus em Recapar por medida', 9)
    header_row(ws, 33, 2, ['Medida', 'Utilidade', 'Limite MM', 'Em Recapar', 'No veículo', 'Em estoque',
                           'Na demanda atual', 'Fora da demanda'], altura=30)
    for i in range(12):
        r = 34 + i
        p = 17 + i   # linha em Parâmetros!rMedidas
        ws[f'B{r}'] = f"=IF('Parâmetros'!$B${p}=\"\",\"\",'Parâmetros'!$B${p})"
        ws[f'C{r}'] = f"=IF(B{r}=\"\",\"\",'Parâmetros'!$C${p})"
        ws[f'D{r}'] = f"=IF(B{r}=\"\",\"\",'Parâmetros'!$D${p})"
        ws[f'E{r}'] = f'=IF(B{r}="","",COUNTIFS({rng(BP, "K", 2, B_LAST)},B{r},{SIT},"Recapar"))'
        ws[f'F{r}'] = f'=IF(B{r}="","",COUNTIFS({rng(BP, "K", 2, B_LAST)},B{r},{SIT},"Recapar",{SITP},"USO"))'
        ws[f'G{r}'] = f'=IF(B{r}="","",COUNTIFS({rng(BP, "K", 2, B_LAST)},B{r},{SIT},"Recapar",{SITP},"ESTOQUE"))'
        ws[f'H{r}'] = f'=IF(B{r}="","",COUNTIFS({ANm},B{r},{ANs},"<>Fora da Demanda"))'
        ws[f'I{r}'] = f'=IF(B{r}="","",COUNTIFS({ANm},B{r},{ANs},"Fora da Demanda"))'
    estilo_corpo(ws, 34, 45, 2, 9, fmt={4: '0.00'}, center_cols=set(range(3, 10)), zebra=True)

    # por recapadora
    secao(ws, 'K32', 'Histórico por recapadora', 17)
    header_row(ws, 33, 11, ['Recapadora', '', 'Registros', 'Realizado', 'Recusado', 'Descartar', '% Realizado'],
               altura=30)
    n_rec = "COUNTA(rRecapadoras)"
    for i in range(11):
        r = 34 + i
        k = i + 1
        ws[f'K{r}'] = (f'=IF({k}<={n_rec},INDEX(rRecapadoras,{k}),'
                       f'IF({k}={n_rec}+1,"Não informada",""))')
        crit = f'IF(K{r}="Não informada","",K{r})'
        cnt = f'COUNTIFS({CDf},">0",{CDr},{crit}'
        ws[f'M{r}'] = f'=IF(K{r}="","",{cnt}))'
        ws[f'N{r}'] = f'=IF(K{r}="","",{cnt},{CDs},"Realizado"))'
        ws[f'O{r}'] = f'=IF(K{r}="","",{cnt},{CDs},"Recusado Recapagem"))'
        ws[f'P{r}'] = f'=IF(K{r}="","",{cnt},{CDs},"Descartar"))'
        ws[f'Q{r}'] = f'=IF(OR(K{r}="",M{r}=0),"",N{r}/M{r})'
        ws.merge_cells(f'K{r}:L{r}')
    ws.merge_cells('K33:L33')
    estilo_corpo(ws, 34, 44, 11, 17, fmt={17: '0%'}, center_cols=set(range(13, 18)), zebra=True)

    # histórico completo
    r0 = 48
    secao(ws, f'B{r0}', 'Histórico completo por demanda (mais recente primeiro)', 9)
    header_row(ws, r0 + 1, 2, hist_cols, altura=30)
    for i in range(CAP_HIST):
        r = r0 + 2 + i
        linha_hist(r, f'=IF($B$14="","",IF($B$14-{i}>=1,$B$14-{i},""))')
    estilo_corpo(ws, r0 + 2, r0 + 1 + CAP_HIST, 2, 9, fmt={9: '0%'}, center_cols=set(range(2, 10)), zebra=True)
    tot = r0 + 2 + CAP_HIST
    ws[f'B{tot}'] = 'Total'
    for c in 'DEFGH':
        ws[f'{c}{tot}'] = f'=SUM({c}{r0 + 2}:{c}{tot - 1})'
    ws[f'I{tot}'] = f'=IF(D{tot}=0,"",E{tot}/D{tot})'
    ws[f'I{tot}'].number_format = '0%'
    for c in 'BCDEFGHI':
        ws[f'{c}{tot}'].font = font(9, True)
        ws[f'{c}{tot}'].fill = fill(C['primary_soft'])
        ws[f'{c}{tot}'].border = BOX
        ws[f'{c}{tot}'].alignment = CENTER
    ws.freeze_panes = 'A6'
    return ws


def aba_como_usar(wb, fontes, hoje, n_base):
    ws = wb.create_sheet('Como usar')
    ws.sheet_properties.tabColor = C['success']
    cabecalho(ws, 'Como usar', 'Rotina de atualização, regras e origem dos dados', 4)
    ws.column_dimensions['B'].width = 4
    ws.column_dimensions['C'].width = 118
    blocos = [
        ('Rotina', [
            ('1', 'Atualizar a base: exporte o relatório Rodopar 10, vá na aba Base Pneus, apague as linhas antigas '
                  '(A2 até a coluna AH) e cole a exportação a partir da célula A2, com as 34 colunas na mesma ordem do '
                  'Rodopar. As colunas azuis à direita (AJ em diante) recalculam sozinhas. Capacidade: '
                  f'{CAP_BASE} pneus.'),
            ('2', 'Montar a demanda: na aba Analítico Recapar, filtre Status = "Fora da Demanda". Lance cada N.Fogo na '
                  'próxima linha vazia da aba Controle Demanda com o número da nova demanda (último nº + 1), o Mês '
                  'Demanda no padrão Mês_Ano (ex.: Novembro_2026) e o Status inicial (Há Programar ou Há Enviar).'),
            ('3', 'Acompanhar o lote: atualize o Status de cada pneu conforme avança: Há Programar ▸ Há Enviar ▸ Em '
                  'Ressolagem ▸ Realizado, Recusado Recapagem ou Descartar. Informe a Recapadora.'),
            ('4', 'Conferir: o Painel mostra os pneus em Recapar, a situação da demanda atual, a evolução das últimas '
                  '12 demandas e o resultado por medida e por recapadora.'),
        ]),
        ('Regras', [
            ('•', 'Situação MM (aba Base Pneus) é a mesma regra da planilha Controle de Pneus: considera o menor valor '
                  'entre Sulco 1, Sulco 2 e Sulco 3. Pneu Novo quando os sulcos estão zerados/vazios; vazio para '
                  'BAIXADO, DESCARTE ou sem data de medição; Aferição Zerada se algum sulco = 0; Recapar se o menor '
                  'sulco ≤ limite da medida; Alinhar Pneu se |Sulco 3 − Sulco 1| ≥ 1; Baixa MM até limite + margem; '
                  'senão Apropriado.'),
            ('•', 'Limite da medida: Fiorino 2,10 mm; demais medidas seguem a Regra MM (2,75 mm). Tudo editável na aba '
                  'Parâmetros.'),
            ('•', 'Status e Mês Demanda do Analítico se referem à demanda atual (maior número no Controle Demanda), '
                  'como na planilha original. Pneu em Recapar que não está na demanda atual aparece como "Fora da '
                  'Demanda". A coluna Último Registro no Histórico mostra a última vez que o pneu entrou em uma demanda.'),
            ('•', 'Sugestão: "Avaliar descarte" quando N. Vida ≥ vida máxima (3); "Incluir na próxima demanda" quando '
                  'está fora da demanda atual; senão "Acompanhar na demanda".'),
            ('•', 'Aferição MM / Inspeção: Em Dia até 20 dias desde a última medição, Prox. ao Vencimento até 25, '
                  'depois Vencida (só para pneus em USO ou ESTOQUE). Usa a data de hoje.'),
            ('•', 'As colunas calculadas do Controle Demanda mostram os dados atuais do pneu na Base Pneus (não os '
                  'dados da época do lote), como na planilha original.'),
        ]),
        ('Legenda', [
            ('■', 'Célula amarela com texto azul: parâmetro editável (aba Parâmetros).'),
            ('■', 'Cabeçalho azul-claro no Controle Demanda: coluna de digitação. Cabeçalho cinza: calculada.'),
            ('■', 'N.Fogo em vermelho no Controle Demanda: o mesmo pneu foi lançado duas vezes na mesma demanda.'),
        ]),
        ('Origem desta versão', [
            ('•', f'Base Pneus: Rodopar 10 enviado em {hoje:%d/%m/%Y} ({n_base} pneus).'),
            ('•', f'Controle Demanda: {len(fontes["hist"])} registros da tabela Controle_Demanda (aba Ressolagem) da '
                  'planilha 1_Controle de Pneus_OPE Souza Cruz.'),
            ('•', 'Medidas e Centro de Custo: aba De Para da mesma planilha. Frotas: Base de Fidelização (alocação '
                  f'vigente em {hoje:%d/%m/%Y}).'),
            ('•', 'Ajustes em relação à planilha original: a medida 175/70R14 (sem espaço) passou a ser tratada como '
                  'Fiorino; a recapadora "Recatac" foi padronizada para "Recatec" '
                  f'({sum(fontes["corrigidas"].values())} registros); a REF agora usa separador (N.Fogo-Demanda) para '
                  'não confundir, por exemplo, 6691+31 com 66913+1; a marcação de duplicidade passou a considerar '
                  'N.Fogo + Demanda (o mesmo pneu pode voltar em outra demanda).'),
            ('•', 'Funciona em qualquer Excel (não usa FILTRO nem matrizes dinâmicas).'),
        ]),
    ]
    r = 7
    for titulo, itens in blocos:
        secao(ws, f'B{r}', titulo, 3)
        r += 1
        for marca, texto in itens:
            ws[f'B{r}'] = marca
            ws[f'B{r}'].font = font(10, True, 'blue')
            ws[f'B{r}'].alignment = Alignment(horizontal='center', vertical='top')
            ws[f'C{r}'] = texto
            ws[f'C{r}'].font = font(10)
            ws[f'C{r}'].alignment = WRAP
            ws.row_dimensions[r].height = 15 * max(1, -(-len(texto) // 125))
            r += 1
        r += 1
    return ws


# ================================================================== geração
def gerar(rodopar, controle, saida, hoje):
    dados = ler_rodopar(rodopar)
    fontes = ler_controle(controle, hoje)
    if len(fontes['hist']) > CAP_DEMANDA:
        raise SystemExit('Histórico maior que CAP_DEMANDA.')
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    aba_analitico(wb)
    aba_controle(wb, fontes)
    aba_como_usar(wb, fontes, hoje, len(dados))
    aba_parametros(wb, fontes)
    aba_frotas(wb, fontes, hoje)
    aba_base(wb, dados)
    aba_painel(wb)
    wb.active = 0
    for ws in wb.worksheets:
        ws.sheet_view.zoomScale = 90
        ws.page_setup.orientation = 'landscape'
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    wb.calculation.fullCalcOnLoad = True
    saida.mkdir(parents=True, exist_ok=True)
    out = saida / NOME
    wb.save(out)
    return out, fontes, dados


# ------------------------------------------------------------------ valores em cache
def recalcular_lo(src):
    """Recalcula uma cópia no LibreOffice e devolve o caminho da cópia recalculada."""
    tmp = Path(tempfile.mkdtemp())
    cp = tmp / 'recalc.xlsx'
    shutil.copy(src, cp)
    script = os.environ.get('RECALC_PY')
    if not script:
        raise SystemExit('Defina RECALC_PY com o caminho do recalc.py (LibreOffice).')
    res = subprocess.run([sys.executable, script, str(cp), '300'], capture_output=True, text=True)
    print(res.stdout.strip()[-2000:])
    return cp


def gravar_cache(out, recalc):
    """Injeta no arquivo gerado (openpyxl) os valores calculados pelo LibreOffice, mantendo as fórmulas."""
    from lxml import etree
    vals = openpyxl.load_workbook(recalc, data_only=True)
    wbf = openpyxl.load_workbook(out)
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    # mapa nome da aba -> arquivo xml
    with zipfile.ZipFile(out) as z:
        wbxml = etree.fromstring(z.read('xl/workbook.xml'))
        rels = etree.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rid = {r.get('Id'): r.get('Target') for r in rels}
        alvo = {}
        for s in wbxml.find('m:sheets', ns):
            t = rid[s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            alvo['xl/' + t.lstrip('/').replace('xl/', '')] = s.get('name')
        partes = {n: z.read(n) for n in z.namelist()}
    for parte, aba in alvo.items():
        if aba not in vals.sheetnames:
            continue
        wsv = vals[aba]
        root = etree.fromstring(partes[parte])
        for c in root.iter('{%s}c' % ns['m']):
            f = c.find('m:f', ns)
            if f is None:
                continue
            v = wsv[c.get('r')].value
            for old in c.findall('m:v', ns):
                c.remove(old)
            if v is None:
                v = ''
            ve = etree.SubElement(c, '{%s}v' % ns['m'])
            if isinstance(v, bool):
                c.set('t', 'b')
                ve.text = '1' if v else '0'
            elif isinstance(v, (int, float)):
                c.attrib.pop('t', None)
                ve.text = repr(float(v)) if isinstance(v, float) else str(v)
            elif isinstance(v, dt.datetime):
                c.attrib.pop('t', None)
                ve.text = str((v - dt.datetime(1899, 12, 30)).total_seconds() / 86400)
            elif isinstance(v, str) and v.startswith('#'):
                c.set('t', 'e')
                ve.text = v
            else:
                c.set('t', 'str')
                ve.text = str(v)
        partes[parte] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    # mantém o recálculo completo ao abrir (TODAY muda todo dia)
    tmp = out.with_suffix('.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, b in partes.items():
            z.writestr(n, b)
    tmp.replace(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--rodopar', required=True)
    ap.add_argument('--controle', required=True)
    ap.add_argument('--saida', default=str(AQUI / 'saida'))
    ap.add_argument('--hoje', help='data de referência AAAA-MM-DD (padrão: hoje)')
    ap.add_argument('--verificar', action='store_true', help='recalcula no LibreOffice e grava valores em cache')
    a = ap.parse_args()
    hoje = dt.date.fromisoformat(a.hoje) if a.hoje else dt.date.today()
    out, fontes, dados = gerar(a.rodopar, a.controle, Path(a.saida), hoje)
    print(f'Gerado: {out}  ({len(dados)} pneus, {len(fontes["hist"])} registros de demanda, '
          f'{len(fontes["frotas"])} frotas)')
    if a.verificar:
        rc = recalcular_lo(out)
        gravar_cache(out, rc)
        print('Valores em cache gravados.')


if __name__ == '__main__':
    main()
