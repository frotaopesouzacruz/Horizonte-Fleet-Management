"""Configuração central do gerador da planilha Gestão de Pneus - Horizonte.

Aqui ficam apenas regras, parâmetros e identidade visual. Nenhum dado operacional fica no
código: custos de referência, De-Para de operações, cadastro de frotas, histórico de lotes e o
caminho do Rodopar 10 são lidos das planilhas de origem na hora da geração (ver fontes.py).

Variáveis de ambiente (todas opcionais):
  GP_FONTES           pasta com as planilhas de origem            (padrão: ../fontes)
  GP_SAIDA            pasta de saída                              (padrão: ../saida)
  GP_LOGO             imagem do logo                              (padrão: public/brand/logo-light.png do repositório)
  GP_CARGA            data/hora da carga inicial, ISO 8601        (padrão: agora, horário de Brasília)
  GP_CAMINHO_RODOPAR  caminho ou link do Rodopar 10 gravado na consulta Power Query
                      (padrão: mesma pasta da planilha Controle de Pneus no SharePoint; ver fontes.py)
"""
import os, datetime as dt

GERADOR = os.path.dirname(os.path.abspath(__file__))
PROJETO = os.path.dirname(GERADOR)
REPO = os.path.dirname(os.path.dirname(PROJETO))
FONTES = os.path.abspath(os.environ.get('GP_FONTES') or os.path.join(PROJETO, 'fontes'))
OUT_DIR = os.path.abspath(os.environ.get('GP_SAIDA') or os.path.join(PROJETO, 'saida'))
os.makedirs(OUT_DIR, exist_ok=True)
F_LOGO = os.environ.get('GP_LOGO') or os.path.join(REPO, 'public', 'brand', 'logo-light.png')
NOME_ARQUIVO = 'Gestão de Pneus - Horizonte.xlsx'
F_CONSULTA = os.path.join(GERADOR, 'Pneus_Rodopar10.pq')


def _agora_brasilia():
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo('America/Sao_Paulo')).replace(tzinfo=None)
    except Exception:  # sem base de fusos instalada: UTC-3 (Brasília não adota horário de verão desde 2019)
        return dt.datetime.utcnow() - dt.timedelta(hours=3)


# Data/hora da carga inicial (horário de Brasília) — vira o "Atualizado em" dos dados pré-carregados
CARGA_INICIAL = (dt.datetime.fromisoformat(os.environ['GP_CARGA']) if os.environ.get('GP_CARGA')
                 else _agora_brasilia()).replace(second=0, microsecond=0)

# ---------------------------------------------------------------- parâmetros
PARAMS = [
    # nome, rótulo, valor, unidade, regra/uso, origem, tipo
    ('pLimRessolagem', 'Limite de ressolagem', 2.75, 'mm',
     'Menor Milimetragem < valor (estritamente menor) e Situação ≠ Baixado/Descarte → DEMANDA DE RESSOLAGEM',
     'Regra definida pela gestão de frota', 'dec'),
    ('pLimCompra', 'Limite de planejamento de compra', 4.00, 'mm',
     'Menor Milimetragem < valor (estritamente menor) + N. Vida = vida considerada + Situação ≠ Baixado/Descarte → DEMANDA PROJETADA DE COMPRA',
     'Regra definida pela gestão de frota', 'dec'),
    ('pVidaCompra', 'Vida considerada para compra', 1, 'vida',
     'N. Vida igual a este valor entra na demanda de compra e na cobertura de estoque',
     'Regra definida pela gestão de frota', 'int'),
    ('pIncluirEstoque', 'Incluir pneus em ESTOQUE na demanda de compra', 'SIM', 'SIM/NÃO',
     'SIM = regra literal (todas as situações exceto Baixado/Descarte). NÃO = somente pneus aplicados (USO), como na lista manual anterior',
     'Regra definida (SIM). Ver Documentação › Reconciliação', 'sn'),
    ('pLimCritico', 'Limite crítico (TWI legal)', 1.60, 'mm',
     'Pneu em USO com Menor Milimetragem < valor → classificação CRÍTICO (retirada imediata)',
     'Resolução CONTRAN nº 558/1980 (profundidade mínima legal de 1,6 mm)', 'dec'),
    ('pLimFaixa', 'Limite da faixa de atenção', 5.00, 'mm',
     'Separa as faixas de análise "4,00 a < 5,00 mm" e "≥ 5,00 mm"',
     'Faixas sugeridas no escopo do projeto', 'dec'),
    ('pAfAviso', 'Aferição — aviso de vencimento', 20, 'dias',
     'Dias desde a última medição > valor → "Próx. do vencimento"',
     'Critério da planilha anterior (coluna Aferição MM)', 'int'),
    ('pAfPrazo', 'Aferição — prazo máximo', 25, 'dias',
     'Dias desde a última medição > valor → "Vencida" (milimetragem desatualizada)',
     'Critério da planilha anterior (coluna Aferição MM)', 'int'),
    ('pMMMax', 'Milimetragem máxima plausível', 25, 'mm',
     'Auditoria: sulco ou Menor Milimetragem acima do valor (ou ≤ 0) é tratado como valor inválido',
     'Critério técnico (pneu novo de caminhão = 17,2 mm)', 'dec'),
    ('pVarSulcos', 'Variação máxima entre sulcos', 3.00, 'mm',
     'Auditoria: maior sulco − menor sulco > valor → possível erro de aferição ou desgaste irregular',
     'Critério técnico de auditoria', 'dec'),
]
P = {p[0]: p[2] for p in PARAMS}

# ---------------------------------------------------------------- medidas (regras)
# Medida, Utilização, Vida máxima, Limite de ressolagem específico (None = limite geral), observação da regra.
# Custos de referência NÃO ficam aqui: são calculados das fontes em fontes.medidas().
MEDIDAS_REGRAS = [
    ('225/75 R16', 'Van', 3, None, ''),
    ('205/75 R16', 'Van', 3, None, ''),
    ('225/65 R16', 'Van', 3, None, ''),
    ('175/70 R14', 'Fiorino', 1, None, ''),
    ('275/80 R22.5', 'Caminhão', 3, None, 'Vida máxima = Vida Prev. do Rodopar 978 (validar com a operação).'),
]

SITUACOES = [
    ('USO', 'Aplicado em veículo', 'NÃO'),
    ('ESTOQUE', 'Em estoque', 'NÃO'),
    ('BAIXADO', 'Baixado no Rodopar', 'SIM'),
    ('DESCARTE', 'Descartado', 'SIM'),
]

FLUXO_STATUS = [  # Etapa, Status, Situação, Descrição, Equivalência anterior
    (1, 'Identificado', 'Aberto', 'Pneu identificado na demanda e incluído no lote de ressolagem', 'Há Programar / Há Enviar'),
    (2, 'Retirado do veículo', 'Aberto', 'Pneu retirado do veículo, aguardando envio ao fornecedor', '—'),
    (3, 'Enviado ao fornecedor', 'Aberto', 'Pneu entregue à reformadora', 'Em Ressolagem'),
    (4, 'Em análise', 'Aberto', 'Carcaça em exame inicial na reformadora', '—'),
    (5, 'Aprovado', 'Aberto', 'Carcaça aprovada, ressolagem em execução', '—'),
    (6, 'Reprovado', 'Encerrado', 'Carcaça recusada pela reformadora — seguir para baixa/descarte', 'Recusado Recapagem'),
    (7, 'Ressolado', 'Encerrado', 'Ressolagem concluída pela reformadora', 'Realizado'),
    (8, 'Retornado ao estoque', 'Encerrado', 'Pneu ressolado recebido no estoque', '—'),
    (9, 'Aplicado', 'Encerrado', 'Pneu ressolado montado em veículo', '—'),
    (10, 'Descartar', 'Encerrado', 'Pneu não segue para ressolagem (limite de vida ou dano) — seguir para descarte', 'Descartar'),
]
STATUS_MAP_ANTIGO = {'Realizado': 'Ressolado', 'Recusado Recapagem': 'Reprovado', 'Descartar': 'Descartar',
                     'Há Enviar': 'Identificado', 'Há Programar': 'Identificado', 'Em Ressolagem': 'Enviado ao fornecedor'}
# Recapadoras sugeridas na lista do Fluxo de Ressolagem: lidas do histórico de lotes (fontes.recapadoras()).

# ---------------------------------------------------------------- paleta (tokens do design system HFM)
C = dict(
    blue='1F4B93', blue_deep='163669', cyan='008CCB', gold='F4B223', navy='0B1426',
    text='1F2937', text2='4A5872', muted='5D6B81', border='DFE4EC', border_strong='C5CDDA',
    surface='FFFFFF', surface2='F6F8FB', bg='F1F4F8', tertiary='ECEFF5',
    primary_soft='E8EEF8', accent_soft='E2F3FB', gold_soft='FDF3DC', gold_soft_fg='7A5300',
    success='1A8455', success_soft='E2F4EA', success_fg='14623F',
    warning='9D6308', warning_soft='FDF1DA', warning_fg='7A4E05',
    danger='C93636', danger_soft='FCE8E8', danger_fg='8F2323',
    neutral='5F6E85', neutral_soft='EEF1F5', neutral_fg='45546B',
)
FONT = 'Arial'
