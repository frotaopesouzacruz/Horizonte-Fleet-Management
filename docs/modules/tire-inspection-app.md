# Aplicativos › Vistoria de Pneus

Rota: `/aplicativos/vistoria-pneus` · Menu: **Aplicativos → Vistoria de Pneus** ·
Permissão de entrada: `applications.view` · Permissão para executar:
`applications.tires.execute` (o `tires.inspection.submit` do requisito, no mesmo
padrão dos demais aplicativos do HFM) · Rotinas:
`supabase/migrations/20261006103000_tires_inspections.sql`.

O aplicativo de campo da Gestão de Pneus (`/frota/pneus`, documentada em
[`tire-management.md`](./tire-management.md)). Quem está ao lado do veículo
mede cada posição — Nº Fogo lido, sulcos 1–4 e PSI — e envia. O envio recebe um
**protocolo** e vai para **revisão**. **A vistoria nunca altera a base
oficial do Rodopar**: ela é revisada, lançada no Rodopar pela equipe e
conciliada automaticamente na próxima sincronização.

---

## 1. Leitura cega

Antes e durante a medição o vistoriador vê **somente as posições do veículo**
(código, rótulo, eixo, lado e rodado — o diagrama de eixos). Nenhuma rotina do
aplicativo devolve Nº Fogo esperado, sulcos, PSI, datas, marca ou status da
base oficial (`tire_inspection_positions`). A comparação é feita **no
servidor**, no envio, e o resultado não é mostrado ao vistoriador; depois da
revisão ele vê apenas a situação e a nota do revisor.

## 2. Fluxo

| Etapa | O que acontece |
|---|---|
| Início | Contexto (`tire_inspection_context`): aplicativo ativo, vistoriador, limites técnicos vigentes, existência de dados oficiais, contadores de vistorias pendentes e retornadas. |
| Frota | `tire_inspection_vehicles(search)`: frotas **ativas**, no escopo da pessoa, com operação vigente e operação/tipo habilitados para o aplicativo (elegibilidade App × Operação × Tipo). A busca é no servidor. Frota com vistoria retornada aparece destacada. |
| Medição | Diagrama de eixos montado do **dicionário de posições** (grupo/índice do eixo, lado, rodado, ordem) e do layout do veículo (próprio → do tipo → inferido dos dados Rodopar) — o MESMO croqui da Base Geral (`src/components/tires`), em modo de leitura cega — sem desenho fixo por tipo. Por posição: Nº Fogo lido (texto), sulcos 1–4 (mm, aceita vírgula), PSI, observação. Rascunho automático no aparelho. |
| Revisão | Posições medidas × não medidas (medição incompleta é permitida e vira `MEDICAO_INCOMPLETA`), observação geral (≤ 1.000). |
| Envio | `tire_inspection_submit`: idempotente pela chave `client_submission_id` gerada no aparelho (reenvio após falha de rede devolve o mesmo protocolo). Protocolo `PNEU-AAAA-NNNNNN`. |
| Minhas vistorias | `tire_my_inspections` / `tire_my_inspection_detail`: situação, nota do revisor e as próprias leituras. Vistoria retornada → "Refazer medição" (nova vistoria com `parent_inspection_id`; a anterior vira `substituida`). |

Validações no servidor (o aplicativo repete só para orientar): data da vistoria
não futura e no máximo 30 dias atrás; posição pertence ao veículo (senão o envio é recusado); Nº Fogo `^[0-9A-Z][0-9A-Z./_-]{0,29}$` (nunca
número); sulco de 0 ao máximo técnico; PSI de 0 ao máximo técnico; observação
por posição ≤ 500.

## 3. Comparação no servidor

Contra a base oficial (Rodopar) mais recente, posição a posição, com as tolerâncias
vigentes (`inspection_tread_tolerance_mm`, `inspection_psi_tolerance` — em
Parâmetros, nunca no código):

| Divergência | Quando |
|---|---|
| `SEM_REFERENCIA` | A base oficial não tem pneu em uso nessa posição. |
| `PNEU_DIFERENTE` | Nº Fogo lido ≠ Nº Fogo da base oficial. |
| `SULCO_DIVERGENTE` | Algum sulco lido difere do oficial além da tolerância. |
| `PSI_DIVERGENTE` | PSI lido difere do oficial além da tolerância. |
| `POSICAO_NAO_ENCONTRADA` | O Nº Fogo lido está, na base oficial, em outra posição/veículo. |
| `MEDICAO_INCOMPLETA` | Posição sem leitura, ou leitura sem Nº Fogo, algum sulco ou PSI. |

## 4. Revisão (Gestão de Pneus › Vistorias recebidas)

Permissão `tires.inspection.review`. Situações e transições
(`tire_inspection_transition`):

```
pendente_revisao ──► pendente_rodopar ──► sincronizado_rodopar
       │                    │   (automática na importação, ou manual com motivo)
       ▼                    ▼
retornar_divergencia ◄──────┘        (motivo obrigatório; alerta à liderança)
       │
       └──► pendente_revisao (reabrir)        substituida = refeita pelo vistoriador
```

- Retornar exige motivo (≥ 5 caracteres) e publica
  `tires.inspection.returned` em `outbox_events` (alerta à liderança da
  operação).
- Confirmar o lançamento manualmente exige motivo; o caminho normal é a
  conciliação automática.

## 5. Conciliação com o Rodopar

Na confirmação de cada sincronização/importação (`private.tire_reconcile_inspections`), as
vistorias `pendente_rodopar` são comparadas, item a item, com os novos
dados oficiais:

- todos os itens medidos batem (Nº Fogo, sulcos e PSI dentro da tolerância) →
  `sincronizado_rodopar` automaticamente (histórico com origem *import*);
- o Rodopar já tem medição/calibragem com data igual ou posterior à vistoria e
  os valores continuam diferentes, ou o Nº Fogo continua diferente →
  **divergência persistente** (`tires.inspection.persistent_divergence` no
  outbox, alerta à liderança);
- ainda não lançado (datas da base oficial anteriores à vistoria) → segue
  pendente.

Cada item guarda `sync_status` (pending, synced, persistent, not_applicable),
a linha de dados que o conciliou e a nota.

## 6. Segurança

RLS por organização e escopo de veículo/operação em todas as tabelas
(`tire_inspections`, `tire_inspection_items`, `tire_inspection_status_history`);
o vistoriador lê só as próprias vistorias no aplicativo; todas as escritas são
rotinas `security definer` que conferem a permissão no banco
(`private.tire_require`). Autor das ações = pessoa autenticada (nunca
"Sistema" genérico).

## Fora do Escopo Atual

### CPK DE PNEUS

A vistoria registra apenas leituras operacionais (Nº Fogo, sulcos, PSI,
observações). Custo por km, custo por vida, valores de recapagem/ressolagem e
qualquer indicador financeiro de pneus não fazem parte desta etapa — nem no
aplicativo, nem na revisão, nem na conciliação.
