"""Recalcula uma cópia no LibreOffice e compara cada fórmula com o valor esperado (emulação Python).

Uso: python verify.py [arquivo da etapa 1]   (padrão: <saída>/stage1.xlsx)
Sai com código 1 se houver erro de fórmula ou divergência.
"""
import sys, os, pickle, datetime as dt, re, collections
import openpyxl
from config import OUT_DIR
from recalc_lo import recalcular

ERROS = ('#NAME?', '#VALUE!', '#REF!', '#DIV/0!', '#N/A', '#NUM!', '#NULL!', 'Err:')


def norm(v):
    if isinstance(v, dt.datetime):
        return round((v - dt.datetime(1899, 12, 30)).total_seconds() / 86400, 6)
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return round(float(v), 6)
    if v is None:
        return ''
    if isinstance(v, str):
        return v.replace('.', ',')  # LibreOffice (en-US) × Excel pt-BR em FIXED()
    return v


def main(src):
    recalc = recalcular(src, os.path.join(OUT_DIR, 'verificacao'))
    meta = pickle.load(open(os.path.join(OUT_DIR, 'stage1_meta.pkl'), 'rb'))
    wb = openpyxl.load_workbook(recalc, data_only=True)
    bad = collections.defaultdict(list)
    n = erros = 0
    for (sh, coord), exp in meta['EXPECTED'].items():
        got = wb[sh][coord].value
        n += 1
        if isinstance(got, str) and got.startswith(ERROS):
            erros += 1
        if exp is None:
            bad[(sh, coord)].append((coord, got, 'SEM VALOR ESPERADO'))
            continue
        a, b = norm(got), norm(exp)
        if isinstance(a, float) and isinstance(b, float) and abs(a - b) <= 1e-6 * max(1, abs(b)):
            continue
        if a == b:
            continue
        bad[(sh, re.sub(r'\d', '', coord))].append((coord, got, exp))
    print(f'{n} fórmulas recalculadas no LibreOffice; {erros} com erro; {sum(map(len, bad.values()))} divergências '
          f'em {len(bad)} grupos')
    for k, v in sorted(bad.items(), key=lambda kv: -len(kv[1]))[:60]:
        print(k, len(v), v[:3])
    return n, erros, bad


if __name__ == '__main__':
    n, erros, bad = main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT_DIR, 'stage1.xlsx'))
    sys.exit(1 if (erros or bad) else 0)
