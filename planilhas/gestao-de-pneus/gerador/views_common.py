"""Utilidades compartilhadas pelas abas de visão: contagens emuladas, listas dinâmicas e formatação condicional."""
import unicodedata
from openpyxl.formatting.rule import Rule, FormulaRule
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.worksheet.datavalidation import DataValidation
from xlh import *
from config import *
import model as M

_LOWP = {}
def lowp(ws, rule):
    """Regras genéricas (zebra/borda) com prioridade baixa: regras de alerta prevalecem (Excel e LibreOffice)."""
    _LOWP[ws.title] = _LOWP.get(ws.title, 900) + 1
    rule.priority = _LOWP[ws.title]
    return rule

def coll(v):
    """Chave de ordenação aproximando o agrupamento do Excel (sem acento, sem caixa)."""
    if v is None or v == '':
        return (2, '')
    if isinstance(v, (int, float)):
        return (0, v)
    s = unicodedata.normalize('NFD', str(v))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').lower()
    return (1, s)

def cnt(rows, **cond):
    n = 0
    for r in rows:
        ok = True
        for k, v in cond.items():
            k = k.replace('__', ' ')
            if callable(v):
                if not v(r.get(k)): ok = False; break
            elif r.get(k) != v:
                ok = False; break
        if ok: n += 1
    return n

def sel(rows, **cond):
    out = []
    for r in rows:
        ok = True
        for k, v in cond.items():
            k = k.replace('__', ' ')
            if callable(v):
                if not v(r.get(k)): ok = False; break
            elif r.get(k) != v:
                ok = False; break
        if ok: out.append(r)
    return out

def blankfix(v):
    return '' if v is None else v

def list_formula(cond, cols, sort_keys, empty_msg, table='tbPneus'):
    """Monta FILTRO + CLASSIFICARPOR + INDEX/SEQUÊNCIA/CORRESPX (formato de arquivo com prefixos _xlfn)."""
    names = '{' + ','.join(f'"{c}"' for c in cols) + '}'
    keys = ','.join(f'_xlfn._xlws.FILTER({table}[{k}],_xlpm.m),{o}' for k, o in sort_keys)
    return (f'=IFERROR(_xlfn.LET(_xlpm.m,{cond},'
            f'_xlpm.x,INDEX({table},_xlfn.SEQUENCE(ROWS({table})),_xlfn.XMATCH({names},{table}[#Headers])),'
            f'_xlpm.d,_xlfn._xlws.FILTER(IF(_xlpm.x="","",_xlpm.x),_xlpm.m),'
            f'_xlfn.SORTBY(_xlpm.d,{keys})),"{empty_msg}")')

def list_values(rows, cols, sort_keys, empty_msg):
    if not rows:
        return [[empty_msg]]
    rs = list(rows)
    for k, o in reversed(sort_keys):
        rs = sorted(rs, key=lambda r: coll(r.get(k)), reverse=(o == -1))
    return [[blankfix(r.get(c)) for c in cols] for r in rs]

def list_block(ws, row, c1, headers, widths_fmt, cond, cols, sort_keys, rows_py, empty_msg, max_rows=1500, table='tbPneus',
               cls_col=None, header_h=32):
    """Cabeçalho estático + fórmula de lista dinâmica + formatação condicional para a área potencial do derramamento."""
    c2 = c1 + len(headers) - 1
    for i, h in enumerate(headers):
        put(ws, f'{col(c1+i)}{row}', h)
    table_header_style(ws, row, c1, c2, h=header_h)
    vals = list_values(rows_py, cols, sort_keys, empty_msg)
    formula = list_formula(cond, cols, sort_keys, empty_msg, table)
    dyn(ws, f'{col(c1)}{row+1}', formula, vals)
    # formatos por coluna na área de derramamento
    for i, (fmt, align) in enumerate(widths_fmt):
        for r in range(row + 1, row + 1 + max(len(vals), 1) + 0):
            c = ws.cell(r, c1 + i)
            c.number_format = fmt
            c.alignment = al(align, 'center')
            c.font = font(9)
    rng = f'{col(c1)}{row+1}:{col(c2)}{row+max_rows}'
    anchor = f'${col(c1)}{row+1}'
    # linhas preenchidas: fonte, borda inferior e zebra
    ws.conditional_formatting.add(rng, lowp(ws, FormulaRule(formula=[f'AND({anchor}<>"",MOD(ROW(),2)=0)'], fill=fill(C['surface2']),
                                                   border=Border(bottom=Side(style='thin', color=C['border'])))))
    ws.conditional_formatting.add(rng, lowp(ws, FormulaRule(formula=[f'{anchor}<>""'], border=Border(bottom=Side(style='thin', color=C['border'])))))
    # pré-formata uma área generosa (formatos numéricos e alinhamento) para crescimento da base
    for i, (fmt, align) in enumerate(widths_fmt):
        for r in range(row + 1 + len(vals), row + 1 + min(max_rows, len(vals) + 400)):
            c = ws.cell(r, c1 + i)
            c.number_format = fmt
            c.alignment = al(align, 'center')
            c.font = font(9)
    return vals, rng

def class_cf(ws, rng_col, max_rows=1500):
    """Cores de alerta para a coluna de classificação."""
    rules = [('CRÍTICO', C['danger'], 'FFFFFF', True), ('ENVIAR PARA RESSOLAGEM', C['danger_soft'], C['danger_fg'], True),
             ('ACOMPANHAR', C['warning_soft'], C['warning_fg'], True), ('NORMAL', C['success_soft'], C['success_fg'], False),
             ('INATIVO', C['neutral_soft'], C['neutral_fg'], False), ('SEM AFERIÇÃO', C['neutral_soft'], C['neutral_fg'], True)]
    for txt, bg, fg, b in rules:
        ds = DifferentialStyle(font=Font(name=FONT, bold=b, color=fg), fill=fill(bg))
        ws.conditional_formatting.add(rng_col, Rule(type='cellIs', operator='equal', formula=[f'"{txt}"'], dxf=ds))

def text_cf(ws, rng, mapping):
    for txt, tone in mapping:
        bg, fg = {'danger': (C['danger_soft'], C['danger_fg']), 'warning': (C['warning_soft'], C['warning_fg']),
                  'success': (C['success_soft'], C['success_fg']), 'neutral': (C['neutral_soft'], C['neutral_fg']),
                  'blue': (C['primary_soft'], C['blue_deep'])}[tone]
        ds = DifferentialStyle(font=Font(name=FONT, bold=True, color=fg), fill=fill(bg))
        ws.conditional_formatting.add(rng, Rule(type='cellIs', operator='equal', formula=[f'"{txt}"'], dxf=ds))

def mm_cf(ws, rng, first_cell):
    """Menor milimetragem: vermelho < limite de ressolagem, amarelo < limite de compra, verde acima."""
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'AND(ISNUMBER({first_cell}),{first_cell}<pLimRessolagem)'],
                                                   font=Font(name=FONT, bold=True, color=C['danger_fg']), fill=fill(C['danger_soft'])))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'AND(ISNUMBER({first_cell}),{first_cell}<pLimCompra)'],
                                                   font=Font(name=FONT, bold=True, color=C['warning_fg']), fill=fill(C['warning_soft'])))

def filter_cell(ws, coord_label, coord_val, label, default, dv_formula, name, wb):
    from openpyxl.workbook.defined_name import DefinedName
    put(ws, coord_label, label, f=font(9, True, C['muted']), a=al('right', 'center'))
    put(ws, coord_val, default, f=font(10, True, C['blue_deep']), fl=fill(C['gold_soft']), a=al('center', 'center'), b=BOX)
    dv = DataValidation(type='list', formula1=dv_formula, allow_blank=False, showErrorMessage=True,
                        errorTitle='Filtro', error='Escolha um valor da lista.')
    ws.add_data_validation(dv); dv.add(coord_val)
    from openpyxl.utils.cell import coordinate_from_string
    cl, rw = coordinate_from_string(coord_val)
    wb.defined_names[name] = DefinedName(name, attr_text=f"'{ws.title}'!${cl}${rw}")


def medida_warning(ws, coord, tb):
    """Aviso automático quando surgem medidas não cadastradas ou o resumo não cobre todas as medidas de Parâmetros."""
    f = (f'=IF(SUM(tbPneus[AUD Medida não cadastrada])>0,"⚠ "&SUM(tbPneus[AUD Medida não cadastrada])&" pneu(s) com medida não cadastrada — '
         f'inclua a medida em Parâmetros › Medidas e estenda esta tabela.",IF(ROWS(tbMedidas[Medida])<>ROWS({tb}[Medida]),'
         f'"⚠ Parâmetros tem "&ROWS(tbMedidas[Medida])&" medidas e este resumo "&ROWS({tb}[Medida])&" — estenda a tabela (alça no canto inferior).",""))')
    put(ws, coord, f, f=font(9, True, C['danger']), a=al('left', 'center'), expected='')
