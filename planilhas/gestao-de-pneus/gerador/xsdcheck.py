"""Valida as partes XML do .xlsx contra os XSD ISO/IEC 29500 (transicional) — ignora namespaces de extensão (mc:Ignorable).

Uso: GP_XSD=<pasta dos esquemas> python xsdcheck.py <arquivo.xlsx>
A pasta deve conter ISO-IEC29500-4_2016/ (sml.xsd, dml-chart.xsd, ...) e ecma/fouth-edition/ (opc-*.xsd), como no pacote
de esquemas OOXML publicado pela Ecma. Sem GP_XSD a validação é ignorada.
"""
import sys, zipfile, os
from lxml import etree

SD = os.environ.get('GP_XSD', '')
ISO = os.path.join(SD, 'ISO-IEC29500-4_2016')


def load(p):
    return etree.XMLSchema(etree.parse(p))


def esquemas():
    return {
        'http://schemas.openxmlformats.org/spreadsheetml/2006/main': load(os.path.join(ISO, 'sml.xsd')),
        'http://schemas.openxmlformats.org/drawingml/2006/chart': load(os.path.join(ISO, 'dml-chart.xsd')),
        'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing': load(os.path.join(ISO, 'dml-spreadsheetDrawing.xsd')),
        'http://schemas.openxmlformats.org/package/2006/content-types': load(os.path.join(SD, 'ecma/fouth-edition/opc-contentTypes.xsd')),
        'http://schemas.openxmlformats.org/package/2006/relationships': load(os.path.join(SD, 'ecma/fouth-edition/opc-relationships.xsd')),
        'http://schemas.openxmlformats.org/officeDocument/2006/customXml': load(os.path.join(ISO, 'shared-customXmlDataProperties.xsd')),
    }


MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
def strip_ignorable(root):
    ign = set()
    for el in root.iter():
        v = el.get(f'{{{MC}}}Ignorable')
        if v:
            for pfx in v.split():
                ns = el.nsmap.get(pfx)
                if ns: ign.add(ns)
    for el in list(root.iter()):
        for a in list(el.attrib):
            if a.startswith('{'):
                ns = a[1:].split('}')[0]
                if ns in ign or ns == MC:
                    del el.attrib[a]
    for el in list(root.iter()):
        if isinstance(el.tag, str) and el.tag.startswith('{') and el.tag[1:].split('}')[0] in ign:
            el.getparent().remove(el)
    return root
def main(path):
    if not SD or not os.path.isdir(ISO):
        print('validação XSD ignorada: defina GP_XSD com a pasta dos esquemas OOXML')
        return None
    SCH = esquemas()
    z = zipfile.ZipFile(path)
    bad = 0; n = 0
    for name in z.namelist():
        if not (name.endswith('.xml') or name.endswith('.rels')):
            continue
        data = z.read(name)
        try:
            root = etree.fromstring(data)
        except Exception as e:
            print('XML MALFORMADO', name, e); bad += 1; continue
        ns = root.tag[1:].split('}')[0] if root.tag.startswith('{') else ''
        sch = SCH.get(ns)
        if sch is None:
            continue
        root = strip_ignorable(root)
        n += 1
        if not sch.validate(root):
            bad += 1
            errs = [f'{e.line}: {e.message}' for e in sch.error_log][:6]
            print('INVÁLIDO', name, *errs, sep='\n   ')
    print(f'{n} partes validadas; {bad} com problema')
    return bad


if __name__ == '__main__':
    sys.exit(1 if main(sys.argv[1]) else 0)
