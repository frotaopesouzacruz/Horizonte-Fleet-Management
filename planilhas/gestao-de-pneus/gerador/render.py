"""Renderiza abas selecionadas em PNG (LibreOffice → PDF → pdftoppm) para conferência visual.

Uso: python render.py <arquivo.xlsx> <rótulo> "<Aba 1>,<Aba 2>" [máx. páginas]
A cópia renderizada oculta as demais abas, não recalcula ao abrir e remove as fórmulas de matriz dinâmica
(o LibreOffice não as reproduz como o Excel); os valores em cache gravados pelo gerador são mantidos.
"""
import sys, os, zipfile, re, subprocess
from config import OUT_DIR
from recalc_lo import converter


def render(src, keep, tag, max_pages=6):
    tmpd = os.path.join(OUT_DIR, 'render_' + tag)
    os.makedirs(tmpd, exist_ok=True)
    copy = os.path.join(tmpd, 'origem', f'{tag}.xlsx')
    os.makedirs(os.path.dirname(copy), exist_ok=True)
    zin = zipfile.ZipFile(src)
    with zipfile.ZipFile(copy, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in zin.namelist():
            d = zin.read(n)
            if n == 'xl/workbook.xml':
                s = d.decode('utf-8')
                names = re.findall(r'<sheet [^>]*name="([^"]+)"', s)

                def fix(m):
                    t = re.sub(r'\sstate="[^"]*"', '', m.group(0))
                    return t if m.group(1) in keep else t.replace('<sheet ', '<sheet state="hidden" ', 1)
                s = re.sub(r'<sheet [^>]*name="([^"]+)"[^>]*/>', fix, s)
                first = names.index(keep[0])
                s = re.sub(r'activeTab="\d+"', f'activeTab="{first}"', s)
                if 'activeTab=' not in s:
                    s = s.replace('<workbookView ', f'<workbookView activeTab="{first}" ', 1)
                d = s.replace('fullCalcOnLoad="1"', 'fullCalcOnLoad="0"').encode('utf-8')
            if n.startswith('xl/worksheets/sheet') and n.endswith('.xml'):
                t = re.sub(r'<f t="array"[^>]*>.*?</f>', '', d.decode('utf-8'), flags=re.S)
                d = t.replace(' cm="1"', '').encode('utf-8')
            z.writestr(n, d)
    pdf = converter(copy, tmpd, 'pdf')
    subprocess.run(['pdftoppm', '-png', '-r', '110', '-l', str(max_pages), pdf, os.path.join(tmpd, tag + '_p')], check=True)
    outs = sorted(os.path.join(tmpd, f) for f in os.listdir(tmpd) if f.startswith(tag + '_p') and f.endswith('.png'))
    print(tag, '->', outs)
    return outs


if __name__ == '__main__':
    src, tag, keep = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
    render(src, keep, tag, int(sys.argv[4]) if len(sys.argv) > 4 else 6)
