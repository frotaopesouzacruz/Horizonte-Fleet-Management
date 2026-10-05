"""Gera "Gestão de Pneus - Horizonte.xlsx" a partir das planilhas de origem.

Uso:
    python gerar.py              # gera o arquivo em <saída>/
    python gerar.py --verificar  # gera e verifica (LibreOffice + XSD opcional + consulta M + abertura)

Etapas: build.py (openpyxl: abas, tabelas, fórmulas, valores esperados) → postprocess.py (valores em cache,
matrizes dinâmicas, consulta Power Query) → verificações.
"""
import argparse, os, pickle, sys
import config, build, postprocess, fontes, xlh


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--verificar', action='store_true',
                    help='recalcula no LibreOffice e compara cada fórmula com a emulação; valida XSD se GP_XSD estiver definido')
    args = ap.parse_args()

    for chave in fontes.PADROES:
        print(f'fonte {chave:<10} {os.path.basename(fontes.arquivo(chave))}')
    caminho, origem = fontes.caminho_rodopar()
    print(f'caminho do Rodopar 10 na consulta ({origem}): {caminho}')

    stage1 = os.path.join(config.OUT_DIR, 'stage1.xlsx')
    meta_pkl = os.path.join(config.OUT_DIR, 'stage1_meta.pkl')
    _, rows, _, meta = build.main(stage1)
    with open(meta_pkl, 'wb') as fh:
        pickle.dump(dict(EXPECTED=xlh.EXPECTED, DYNAMIC=xlh.DYNAMIC, TABLE_CALC=xlh.TABLE_CALC), fh)
    final = os.path.join(config.OUT_DIR, config.NOME_ARQUIVO)
    stats = postprocess.process(stage1, final, meta_pkl, config.F_CONSULTA)
    m_final = postprocess.consulta_m()
    with open(os.path.join(config.OUT_DIR, 'Pneus_Rodopar10.pq'), 'w', encoding='utf-8') as fh:
        fh.write(m_final)
    print(f'{len(rows)} pneus · {meta["n_formulas"]} fórmulas · {meta["n_dynamic"]} matrizes dinâmicas · {stats}')
    print('gerado:', final)

    if not args.verificar:
        return 0
    import openpyxl, verify, xsdcheck
    _, erros, divergencias = verify.main(stage1)
    xsd = xsdcheck.main(final)
    openpyxl.load_workbook(final)  # o arquivo final precisa abrir sem erro
    consulta_ok = fontes._consultas_m(final) == m_final
    print('consulta Power Query gravada no arquivo:', 'OK' if consulta_ok else 'DIVERGENTE')
    falhou = bool(erros or divergencias or xsd or not consulta_ok)
    print('VERIFICAÇÃO:', 'FALHOU' if falhou else 'OK')
    return 1 if falhou else 0


if __name__ == '__main__':
    sys.exit(main())
