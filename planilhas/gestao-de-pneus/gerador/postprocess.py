"""Pós-processamento do pacote OOXML gerado pelo openpyxl:
  1. grava valores em cache de todas as fórmulas (emulação validada no LibreOffice);
  2. injeta fórmulas de matriz dinâmica (FILTRO/CLASSIFICARPOR/ÚNICO...) com metadados XLDAPR;
  3. acopla a consulta Power Query 'Pneus_Rodopar10' à tabela tbPneus (DataMashup + conexão + queryTable).
"""
import sys, os, io, re, zipfile, struct, base64, uuid, pickle, json, datetime as dt, html
from lxml import etree
from openpyxl.utils.cell import coordinate_from_string, column_index_from_string, get_column_letter
from config import *
import model as M
import fontes

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
RELNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
ODR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'m': MAIN}
Q = lambda t: f'{{{MAIN}}}{t}'
QUERY = 'Pneus_Rodopar10'
CAMINHO_MARCADOR = '{{CAMINHO_ARQUIVO}}'  # substituído no .pq pelo caminho do Rodopar 10 (fontes.caminho_rodopar)

# ---- partes fixas do DataMashup (MS-QDEFF) ----
BOM = b'\xef\xbb\xbf'
XSD_NS = 'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
PACKAGE_XML = (f'<?xml version="1.0" encoding="utf-8"?><Package {XSD_NS}><Version>2.158.928.0</Version>'
               '<MinVersion>2.21.0.0</MinVersion><Culture>pt-BR</Culture></Package>')
CONTENT_TYPES_XML = ('<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="xml" ContentType="text/xml" /><Default Extension="m" ContentType="application/x-ms-m" /></Types>')
PERMISSIONS_XML = (f'<?xml version="1.0" encoding="utf-8"?><PermissionList {XSD_NS}><CanEvaluateFuturePackages>false'
                   '</CanEvaluateFuturePackages><FirewallEnabled>true</FirewallEnabled></PermissionList>')
EMPTY_ZIP = b'PK\x05\x06' + b'\x00' * 18
# PermissionBindings: bloco DPAPI opaco do template público do @microsoft/connected-workbooks (MIT, (c) Microsoft
# Corporation). O Excel não consegue validá-lo em outra máquina e então aplica as permissões padrão — as mesmas de
# PERMISSIONS_XML —, comportamento idêntico ao de arquivos gerados por essa biblioteca.
PERMISSION_BINDINGS = base64.b64decode(
    'AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAAbOqSUq78gUaJQ0xHGPW6/gAAAAACAAAAAAADZgAAwAAAABAAAADNgAaq5FB1iyI7rZsE'
    '/GksAAAAAASAAACgAAAAEAAAAAfvuKZNnN/J5fgfAkNcUPJQAAAAg04IFU13XHotXQOEKUthDN4/cw8bi0Tsz3BflZQ90zh7nHVI'
    'pZ31RohYEY+qA6YWrRE8HMIJD/sVweE4sW2Lw6fdMp+2oxRW1QR+NbMSvhMUAAAA51MD4/KGQznLGggJWdgpaPFUDJs=')
TABLE = 'tbPneus'

def guid():
    return '{' + str(uuid.uuid4()).upper() + '}'

def serial(v):
    d = v - dt.datetime(1899, 12, 30)
    return d.days + d.seconds / 86400 + d.microseconds / 86400e6

def numtxt(x):
    if isinstance(x, bool):
        return '1' if x else '0'
    if isinstance(x, int):
        return str(x)
    r = repr(float(x))
    return r[:-2] if r.endswith('.0') else r

# ------------------------------------------------------------------ células
def set_formula_value(c, val):
    for v in c.findall(Q('v')):
        c.remove(v)
    c.attrib.pop('t', None)
    if isinstance(val, dt.datetime):
        val = serial(val)
    if isinstance(val, bool):
        c.set('t', 'b'); e = etree.SubElement(c, Q('v')); e.text = '1' if val else '0'
    elif isinstance(val, (int, float)):
        e = etree.SubElement(c, Q('v')); e.text = numtxt(val)
    else:
        c.set('t', 'str'); e = etree.SubElement(c, Q('v')); e.text = '' if val is None else str(val)

def set_plain_value(c, val):
    for tag in ('f', 'v', 'is'):
        for e in c.findall(Q(tag)):
            c.remove(e)
    c.attrib.pop('t', None)
    if isinstance(val, dt.datetime):
        val = serial(val)
    if val is None or val == '':
        return
    if isinstance(val, bool):
        c.set('t', 'b'); e = etree.SubElement(c, Q('v')); e.text = '1' if val else '0'
    elif isinstance(val, (int, float)):
        e = etree.SubElement(c, Q('v')); e.text = numtxt(val)
    else:
        c.set('t', 'inlineStr'); isel = etree.SubElement(c, Q('is')); t = etree.SubElement(isel, Q('t')); t.text = str(val)
        if str(val) != str(val).strip():
            t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

class Sheet:
    def __init__(self, xml):
        self.root = etree.fromstring(xml)
        self.sd = self.root.find(Q('sheetData'))
        self.rows = {int(r.get('r')): r for r in self.sd.findall(Q('row'))}
        self.cells = {}
        for r in self.rows.values():
            for c in r.findall(Q('c')):
                self.cells[c.get('r')] = c

    def row(self, n):
        if n in self.rows:
            return self.rows[n]
        new = etree.Element(Q('row')); new.set('r', str(n))
        after = [k for k in self.rows if k < n]
        if after:
            self.rows[max(after)].addnext(new)
        else:
            self.sd.insert(0, new)
        self.rows[n] = new
        return new

    def cell(self, coord):
        if coord in self.cells:
            return self.cells[coord]
        colL, rn = coordinate_from_string(coord)
        ci = column_index_from_string(colL)
        row = self.row(rn)
        new = etree.Element(Q('c')); new.set('r', coord)
        placed = False
        for c in row.findall(Q('c')):
            cc, _ = coordinate_from_string(c.get('r'))
            if column_index_from_string(cc) > ci:
                c.addprevious(new); placed = True; break
        if not placed:
            row.append(new)
        self.cells[coord] = new
        return new

    def xml(self):
        return etree.tostring(self.root, xml_declaration=True, encoding='UTF-8', standalone=True)

# ------------------------------------------------------------------ DataMashup
TYPE_CODE = {'text': 6, 'int': 3, 'date': 9}

def build_mashup(m_code, columns, coltypes, n_rows, steps):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('Config/Package.xml', BOM + PACKAGE_XML.encode('utf-8'))      # cultura pt-BR
        z.writestr('[Content_Types].xml', BOM + CONTENT_TYPES_XML.encode('utf-8'))
        z.writestr('Formulas/Section1.m', m_code.encode('utf-8'))
    pkg = out.getvalue()
    now = dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.0000000Z')
    q = lambda s: html.escape(s, quote=True)
    names_json = json.dumps(columns, ensure_ascii=False)
    types_b64 = base64.b64encode(bytes(TYPE_CODE.get(t, 0) for t in coltypes)).decode()
    ident = [f'Section1/{QUERY}/AutoRemovedColumns1.{{{c},{i}}}' for i, c in enumerate(columns)]
    rel = json.dumps({'columnCount': len(columns), 'keyColumnNames': [], 'queryRelationships': [], 'columnIdentities': ident,
                      'ColumnCount': len(columns), 'KeyColumnNames': [], 'ColumnIdentities': ident, 'RelationshipInfo': []},
                     ensure_ascii=False, separators=(',', ':'))
    entries = [('IsPrivate', 'l0'), ('FillEnabled', 'l1'), ('FillObjectType', 'sTable'), ('FillToDataModelEnabled', 'l0'),
               ('BufferNextRefresh', 'l1'), ('ResultType', 'sTable'), ('NameUpdatedAfterFill', 'l0'),
               ('NavigationStepName', 'sNavegação'), ('FillTarget', f's{TABLE}'), ('FillTargetNameCustomized', 'l1'),
               ('FilledCompleteResultToWorksheet', 'l1'), ('AddedToDataModel', 'l0'), ('FillCount', f'l{n_rows}'),
               ('FillErrorCode', 'sUnknown'), ('FillErrorCount', 'l0'), ('FillLastUpdated', f'd{now}'),
               ('FillColumnTypes', f's{types_b64}'), ('FillColumnNames', f's{names_json}'), ('FillStatus', 'sComplete'),
               ('RelationshipInfoContainer', f's{rel}'), ('QueryID', f's{uuid.uuid4()}')]
    ent_xml = ''.join(f'<Entry Type="{t}" Value="{q(v)}" />' for t, v in entries)
    items = ('<Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath /></ItemLocation><StableEntries /></Item>'
             f'<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/{QUERY}</ItemPath></ItemLocation>'
             f'<StableEntries>{ent_xml}</StableEntries></Item>')
    for s in steps:
        items += (f'<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/{QUERY}/{s}</ItemPath></ItemLocation>'
                  '<StableEntries /></Item>')
    mxml = ('<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Items>' + items + '</Items></LocalPackageMetadataFile>')
    mxml_b = BOM + mxml.encode('utf-8')
    perm = BOM + PERMISSIONS_XML.encode('utf-8')
    meta = struct.pack('<I', 0) + struct.pack('<I', len(mxml_b)) + mxml_b + struct.pack('<I', len(EMPTY_ZIP)) + EMPTY_ZIP
    blob = (struct.pack('<I', 0) + struct.pack('<I', len(pkg)) + pkg + struct.pack('<I', len(perm)) + perm
            + struct.pack('<I', len(meta)) + meta + struct.pack('<I', len(PERMISSION_BINDINGS)) + PERMISSION_BINDINGS)
    b64 = base64.b64encode(blob).decode('ascii')
    xml = '<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">' + b64 + '</DataMashup>'
    return b'\xff\xfe' + xml.encode('utf-16-le')

METADATA_XML = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    'xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1">'
    '<metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" '
    'rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>'
    '<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}">'
    '<xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>'
    '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>')

def m_steps(m_code):
    body = m_code.split('= let', 1)[1].rsplit('\nin', 1)[0]
    return re.findall(r'^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*=', body, re.M)

def process(src, dst, meta_pkl, m_path):
    meta = pickle.load(open(meta_pkl, 'rb'))
    EXPECTED, DYNAMIC = meta['EXPECTED'], meta['DYNAMIC']
    zin = zipfile.ZipFile(src)
    parts = {n: zin.read(n) for n in zin.namelist()}
    order = zin.namelist()
    # mapa de abas
    wb = etree.fromstring(parts['xl/workbook.xml'])
    rels = etree.fromstring(parts['xl/_rels/workbook.xml.rels'])
    rid2t = {r.get('Id'): r.get('Target') for r in rels}
    sheets = []
    for s in wb.find(Q('sheets')):
        tgt = rid2t[s.get(f'{{{ODR}}}id')].lstrip('/')
        if not tgt.startswith('xl/'): tgt = 'xl/' + tgt
        sheets.append((s.get('name'), tgt))
    by_name = dict(sheets)
    # ---------------- 1 + 2: valores em cache e matrizes dinâmicas
    exp_by_sheet = {}
    for (sh, coord), v in EXPECTED.items():
        exp_by_sheet.setdefault(sh, {})[coord] = v
    dyn_by_sheet = {}
    for d in DYNAMIC:
        dyn_by_sheet.setdefault(d['sheet'], []).append(d)
    stats = dict(cached=0, dynamic=0, spilled=0)
    for name, path in sheets:
        if name not in exp_by_sheet and name not in dyn_by_sheet:
            continue
        sh = Sheet(parts[path])
        for coord, v in exp_by_sheet.get(name, {}).items():
            c = sh.cells.get(coord)
            if c is None or c.find(Q('f')) is None:
                raise RuntimeError(f'célula de fórmula ausente {name}!{coord}')
            set_formula_value(c, v)
            stats['cached'] += 1
        for d in dyn_by_sheet.get(name, []):
            vals = d['values'] or [['']]
            colL, r0 = coordinate_from_string(d['coord'])
            c0 = column_index_from_string(colL)
            nr, nc = len(vals), max(len(r) for r in vals)
            ref = f"{d['coord']}:{get_column_letter(c0 + nc - 1)}{r0 + nr - 1}"
            for i, rowv in enumerate(vals):
                for j, v in enumerate(rowv):
                    coord = f'{get_column_letter(c0 + j)}{r0 + i}'
                    c = sh.cell(coord)
                    if i == 0 and j == 0:
                        for e in list(c):
                            c.remove(e)
                        c.attrib.pop('t', None)
                        c.set('cm', '1')
                        f = etree.SubElement(c, Q('f')); f.set('t', 'array'); f.set('ref', ref)
                        f.text = d['formula'][1:]
                        set_formula_value_keep_f(c, v)
                    else:
                        set_plain_value(c, v); stats['spilled'] += 1
            stats['dynamic'] += 1
        parts[path] = sh.xml()
    # metadata.xml (matrizes dinâmicas)
    parts['xl/metadata.xml'] = METADATA_XML.encode('utf-8')
    order.append('xl/metadata.xml')
    add_rel(parts, 'xl/_rels/workbook.xml.rels', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata', 'metadata.xml')
    add_override(parts, '/xl/metadata.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml')
    # ---------------- 3: Power Query
    m_code = consulta_m(m_path)
    cols = M.PQ_COLS
    coltypes = []
    for c in cols:
        if c in M.INT_COLS: coltypes.append('int')
        elif c in M.DATE_COLS: coltypes.append('date')
        elif c in M.NUM_COLS or c in M.DATETIME_COLS or c == 'Atualizado em': coltypes.append('any')
        else: coltypes.append('text')
    base_path = by_name['Base Tratada']
    srels_path = base_path.replace('worksheets/', 'worksheets/_rels/') + '.rels'
    srels = etree.fromstring(parts[srels_path])
    table_path = None
    for r in srels:
        if r.get('Type').endswith('/table'):
            tp = 'xl/' + r.get('Target').replace('../', '') if not r.get('Target').startswith('/') else r.get('Target').lstrip('/')
            t = etree.fromstring(parts[tp])
            if t.get('displayName') == TABLE:
                table_path = tp
    t = etree.fromstring(parts[table_path])
    nrows = int(re.search(r'(\d+)$', t.get('ref').split(':')[1]).group(1)) - int(re.search(r'(\d+)$', t.get('ref').split(':')[0]).group(1))
    t.set('tableType', 'queryTable')
    tcols = t.find(Q('tableColumns'))
    fields = []
    n_bound = 0
    for tc in tcols:
        i = tc.get('id'); nm = tc.get('name')
        tc.set('uniqueName', i); tc.set('queryTableFieldId', i)
        if nm in cols:
            fields.append(f'<queryTableField id="{i}" name="{html.escape(nm, quote=True)}" tableColumnId="{i}"/>'); n_bound += 1
        else:
            fields.append(f'<queryTableField id="{i}" dataBound="0" tableColumnId="{i}"/>')
    # ordem dos atributos de tableColumn: id, uniqueName, name, queryTableFieldId (o Excel tolera qualquer ordem)
    parts[table_path] = etree.tostring(t, xml_declaration=True, encoding='UTF-8', standalone=True)
    unbound = len(fields) - n_bound
    qt = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
          '<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" '
          'xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16" name="DadosExternos_1" connectionId="1" '
          f'xr16:uid="{guid()}" autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" '
          'applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0" adjustColumnWidth="0">'
          f'<queryTableRefresh nextId="{len(fields)+1}" unboundColumnsRight="{unbound}"><queryTableFields count="{len(fields)}">'
          + ''.join(fields) + '</queryTableFields></queryTableRefresh></queryTable>')
    parts['xl/queryTables/queryTable1.xml'] = qt.encode('utf-8'); order.append('xl/queryTables/queryTable1.xml')
    trels = table_path.replace('tables/', 'tables/_rels/') + '.rels'
    parts[trels] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" '
                    'Target="../queryTables/queryTable1.xml"/></Relationships>').encode('utf-8')
    order.append(trels)
    add_override(parts, '/xl/queryTables/queryTable1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml')
    conn = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" '
            'xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16">'
            f'<connection id="1" xr16:uid="{guid()}" keepAlive="1" name="Consulta - {QUERY}" '
            f'description="Conexão com a consulta \'{QUERY}\' na pasta de trabalho." type="5" refreshedVersion="8" background="1" saveData="1">'
            f'<dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location={QUERY};Extended Properties=&quot;&quot;" '
            f'command="SELECT * FROM [{QUERY}]"/></connection></connections>')
    parts['xl/connections.xml'] = conn.encode('utf-8'); order.append('xl/connections.xml')
    add_rel(parts, 'xl/_rels/workbook.xml.rels', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections', 'connections.xml')
    add_override(parts, '/xl/connections.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml')
    mash = build_mashup(m_code, cols, coltypes, nrows, m_steps(m_code))
    parts['customXml/item1.xml'] = mash
    parts['customXml/itemProps1.xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        f'<ds:datastoreItem ds:itemID="{guid()}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">'
        '<ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.microsoft.com/DataMashup"/></ds:schemaRefs></ds:datastoreItem>').encode('utf-8')
    parts['customXml/_rels/item1.xml.rels'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>').encode('utf-8')
    order += ['customXml/item1.xml', 'customXml/itemProps1.xml', 'customXml/_rels/item1.xml.rels']
    add_rel(parts, 'xl/_rels/workbook.xml.rels', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml', '../customXml/item1.xml')
    add_override(parts, '/customXml/itemProps1.xml', 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml')
    # nome definido da tabela de consulta + cálculo completo ao abrir
    wb = etree.fromstring(parts['xl/workbook.xml'])
    dns = wb.find(Q('definedNames'))
    idx = [n for n, _ in sheets].index('Base Tratada')
    first, last = t.get('ref').split(':')
    fc, fr = coordinate_from_string(first); lc, lr = coordinate_from_string(last)
    last_bound = get_column_letter(column_index_from_string(fc) + n_bound - 1)
    dn = etree.SubElement(dns, Q('definedName')); dn.set('name', 'DadosExternos_1'); dn.set('localSheetId', str(idx)); dn.set('hidden', '1')
    dn.text = f"'Base Tratada'!${fc}${fr}:${last_bound}${lr}"
    wp = wb.find(Q('workbookProtection'))
    if wp is not None and not wp.attrib:
        wb.remove(wp)
    calc = wb.find(Q('calcPr'))
    calc.set('fullCalcOnLoad', '1')
    parts['xl/workbook.xml'] = etree.tostring(wb, xml_declaration=True, encoding='UTF-8', standalone=True)
    # grava
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', parts['[Content_Types].xml'])
        for n in order:
            if n == '[Content_Types].xml':
                continue
            z.writestr(n, parts[n])
    return stats

def set_formula_value_keep_f(c, v):
    set_formula_value(c, v)

def add_rel(parts, rels_path, rtype, target):
    r = etree.fromstring(parts[rels_path])
    ids = {e.get('Id') for e in r}
    k = 1
    while f'rId{k}' in ids: k += 1
    e = etree.SubElement(r, f'{{{RELNS}}}Relationship'); e.set('Id', f'rId{k}'); e.set('Type', rtype); e.set('Target', target)
    parts[rels_path] = etree.tostring(r, xml_declaration=True, encoding='UTF-8', standalone=True)

def add_override(parts, part, ctype):
    CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
    r = etree.fromstring(parts['[Content_Types].xml'])
    e = etree.SubElement(r, f'{{{CT}}}Override'); e.set('PartName', part); e.set('ContentType', ctype)
    parts['[Content_Types].xml'] = etree.tostring(r, xml_declaration=True, encoding='UTF-8', standalone=True)

def consulta_m(m_path=F_CONSULTA):
    """Código M da consulta com o caminho do Rodopar 10 gravado na etapa CaminhoArquivo."""
    m_code = open(m_path, encoding='utf-8').read()
    assert m_code.count(CAMINHO_MARCADOR) == 1, 'marcador do caminho ausente na consulta'
    caminho, _ = fontes.caminho_rodopar()
    return m_code.replace(CAMINHO_MARCADOR, caminho.replace('"', '""'))

if __name__ == '__main__':
    src = sys.argv[1]; dst = sys.argv[2]
    st = process(src, dst, os.path.join(OUT_DIR, 'stage1_meta.pkl'), F_CONSULTA)
    print('ok', st)
