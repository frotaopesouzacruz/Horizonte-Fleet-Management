"""Recalcula uma pasta de trabalho no LibreOffice (sem interface) e grava a cópia recalculada.

Usa um perfil temporário configurado para "recalcular sempre" ao abrir arquivos OOXML e converte xlsx → xlsx;
o arquivo de origem não é alterado.
"""
import os, pathlib, shutil, subprocess, sys, tempfile

PERFIL_XCU = '''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
  <item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
'''
CANDIDATOS = ['soffice', 'libreoffice', r'C:\Program Files\LibreOffice\program\soffice.exe',
              '/Applications/LibreOffice.app/Contents/MacOS/soffice']


def soffice():
    for c in CANDIDATOS:
        p = shutil.which(c) or (c if os.path.isfile(c) else None)
        if p:
            return p
    raise SystemExit('LibreOffice (soffice) não encontrado — instale-o para verificar as fórmulas')


def converter(src, pasta_destino, filtro, recalcular_ao_abrir=False, timeout=900):
    """Converte src com o LibreOffice para pasta_destino (filtro ex.: 'pdf'). Devolve o caminho gerado."""
    src, pasta_destino = os.path.abspath(src), os.path.abspath(pasta_destino)
    if os.path.dirname(src) == pasta_destino:
        raise ValueError('pasta_destino deve ser diferente da pasta do arquivo de origem')
    os.makedirs(pasta_destino, exist_ok=True)
    ext = filtro.split(':', 1)[0]
    destino = os.path.join(pasta_destino, os.path.splitext(os.path.basename(src))[0] + '.' + ext)
    if os.path.exists(destino):
        os.remove(destino)
    with tempfile.TemporaryDirectory(prefix='lo_perfil_') as perfil:
        user = pathlib.Path(perfil, 'user')
        user.mkdir(parents=True)
        if recalcular_ao_abrir:
            (user / 'registrymodifications.xcu').write_text(PERFIL_XCU, encoding='utf-8')
        env = dict(os.environ, SAL_USE_VCLPLUGIN='svp')
        cmd = [soffice(), f'-env:UserInstallation={pathlib.Path(perfil).as_uri()}', '--headless', '--norestore',
               '--convert-to', filtro, '--outdir', pasta_destino, src]
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout)
    if not os.path.exists(destino):
        raise RuntimeError(f'LibreOffice não gerou {destino}:\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}')
    return destino


def recalcular(src, pasta_destino, timeout=900):
    """Cópia recalculada (mesmo nome de arquivo, dentro de pasta_destino)."""
    return converter(src, pasta_destino, 'xlsx:Calc MS Excel 2007 XML', recalcular_ao_abrir=True, timeout=timeout)


if __name__ == '__main__':
    print(recalcular(sys.argv[1], sys.argv[2]))
