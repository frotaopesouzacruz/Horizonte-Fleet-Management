# Gestão de Frota › Gestão de Pneus

Rota: `/frota/pneus` (ficha do pneu: `/frota/pneus/<tire_id>`) · Menu:
**Gestão de frota → Gestão de Pneus** · Permissão de entrada: `tires.view` ·
Migrations: `supabase/migrations/20261006100000_tires_foundation.sql` …
`20261006104000_tires_services_admin.sql` · Testes de banco:
`supabase/tests/remote/32_tires.sql`.

Documentos irmãos: [`rodopar-import.md`](./rodopar-import.md) (importação
oficial Rodopar 10) e [`tire-inspection-app.md`](./tire-inspection-app.md)
(aplicativo Vistoria de Pneus e conciliação).

A fonte oficial dos pneus é o relatório **Rodopar 10**. Cada importação
confirmada gera uma **fotografia** por data de referência; a tela sempre lê uma
fotografia (a mais recente por padrão, ou outra escolhida no filtro
"Fotografia"). Tudo o que a tela mostra — classe do sulco, prazos, regra de
PSI, severidade, aderência, qualidade — é calculado no banco por
`private.tire_rows`; o navegador só apresenta.

---

## 1. Modelo de dados

| Tabela | Papel |
|---|---|
| `tires` | Identidade do pneu (`id` = `tire_id`, Nº Fogo **texto** único por organização), marca/modelo/dimensão, situação/posição/veículo correntes, presença (`present`/`absent` + `absent_since`). |
| `tire_daily_snapshots` | Fotografia: uma linha por pneu × data de referência, com os valores brutos do Rodopar preservados e os normalizados (situação canônica, sulcos 1–4, menor informado × calculado, PSI, datas, KM, contexto operacional na data, flags de qualidade). |
| `tire_events` | Linha do tempo derivada da comparação entre fotografias (criação, medição, calibragem, posição, frota, vida, situação, ressolagem, descarte, estoque, ausente, reaparecido). Sem custo. |
| `tire_import_batches` / `tire_import_staging` | Lote de importação e área de preparação (nada vai para `tires` antes da confirmação). |
| `tire_parameter_sets` | Parâmetros gerais **com vigência** (prazos, limites, tolerâncias, SLAs). |
| `tire_pressure_rules` | Regras de PSI (mín/ideal/máx) e sulco legal/atenção por tipo de equipamento × dimensão × posição/eixo, com vigência. |
| `tire_positions`, `tire_layouts`, `tire_vehicle_type_layouts`, `tire_vehicle_layouts` | Dicionário de posições (grupo/índice do eixo, lado, rodado, ordem) e layouts por tipo de equipamento ou por veículo. O diagrama de eixos é derivado daqui — nada fixo no código. |
| `tire_inspections`, `tire_inspection_items`, `tire_inspection_status_history` | Vistorias de campo (leitura cega), itens por posição com a referência e as divergências, e o histórico de situações. |
| `tire_repairs` | Consertos por Nº Fogo, com o veículo resolvido na data do serviço. |
| `tire_maintenance_service_kinds` | Quais serviços do catálogo da Gestão de Manutenção são alinhamento, balanceamento, ambos ou serviço de pneu. |
| `tire_audit_events` | Trilha do módulo (importações, decisões, parâmetros, consertos, exportações) com a pessoa autenticada como autora. |

## 2. Regras de cálculo (`private.tire_rows`)

| Regra | Definição |
|---|---|
| Situação | `em_uso`, `estoque`, `ressolagem`, `descartado`, `baixado`, `outro` (da coluna *Situação Pneu*; a *Condição* é só recomendação). |
| Sulco mínimo | O **informado** pelo Rodopar; o **calculado** (menor dos sulcos 1–4) é guardado ao lado e a divergência além da tolerância é sinalizada. |
| Classe do sulco | sem medição → `sem_medicao`; ≤ sulco legal da regra aplicável → `abaixo_legal`; ≤ crítico → `critico`; ≤ atenção → `atencao`; senão `adequado`. |
| Prazo de medição / calibragem | sem data → `sem_registro`; dias desde a data ≤ "em dia até" → `em_dia`; ≤ "próximo até" → `proximo`; acima → `vencido` (dias contados até a data da fotografia/hoje). |
| PSI | sem leitura → `sem_calibragem`; sem regra aplicável → **`sem_parametro` (nunca adequado)**; abaixo do mínimo → `baixa`; acima do máximo → `excesso`; senão `adequada`. Vence a regra mais específica (dimensão > posição > eixo > tipo) vigente na data. **Não existe PSI universal.** |
| Alerta de ressolagem | Alerta **operacional** (não financeiro): condição "RECAPAR" do Rodopar (se o parâmetro mandar usar) e/ou sulco ≤ limite configurado. |
| KM | KM Rodado/KM Real guardados como vieram; KM Real negativo é inconsistência de qualidade e nunca é somado. Não substitui a Gestão de KM. |
| Severidade | Pontuação por pneu em uso (sulco abaixo do legal/crítico/atenção, prazos, PSI fora, divergência de sulco, alerta de ressolagem) → `critica` ≥ 100, `alta` ≥ 50, `media` ≥ 20, `baixa` > 0, `ok`. |

Indicadores (sobre os pneus em uso da fotografia filtrada):

- **Cobertura** = pneus com registro ÷ pneus em uso.
- **Aderência** = (em dia + próximo) ÷ (em dia + próximo + vencido).
- **Pressão adequada** = adequada ÷ (adequada + baixa + excesso) — "sem parâmetro" fica fora e aparece como lacuna.
- **Índice de qualidade** = pneus sem nenhuma inconsistência ÷ total da fotografia.

Valores sem base (divisão por zero, leitura que falhou) aparecem como "—",
nunca como 0.

## 3. Telas (abas pela permissão)

| Aba | Permissão | Conteúdo |
|---|---|---|
| Visão geral | `tires.dashboard.view` | KPIs com destino, distribuições (situação, sulco, prazos, PSI, marca, modelo, dimensão, vida, posição, tipo, operação, local, BR), prioridades, insights determinísticos devolvidos pela rotina e tendência por fotografia. |
| Base geral | `tires.base.view` | Por frota (diagrama de eixos + pneus), por Nº Fogo e fora da frota; ordenação e paginação no servidor; ficha 360° do pneu. |
| Aderência MM | `tires.measurement.view` | Cobertura/aderência de medição, quebras (operação, UF, local, BR, filial, liderança, tipo), ranking, pendências. |
| Aderência calibragem | `tires.calibration.view` | Idem para calibragem + PSI (adequada/baixa/excesso/sem parâmetro) e lacunas de regra. |
| Cronograma | `tires.schedule.view` | Próximas medições/calibragens por frota e agenda (vencidos, hoje, 7 e 15 dias, sem registro). |
| Vistorias recebidas | `tires.view` (decidir: `tires.inspection.review`) | Fila de revisão, gaveta com leitura × referência, transições. |
| Serviços | `tires.services.view` (registrar: `tires.services.manage`) | Consertos por Nº Fogo; alinhamento e balanceamento lidos da Gestão de Manutenção (sem base paralela). |
| Qualidade de dados | `tires.quality.view` | Índice, problemas por código com drill-down, último lote. |
| Histórico | `tires.history.view` / `tires.audit.view` | Eventos dos pneus e trilha de auditoria. |
| Importação Rodopar | `tires.import` (ver: `tires.audit.view`) | Envio, prévia, confirmação e histórico de lotes. |
| Parâmetros | `tires.view` (editar: `tires.parameters.manage`) | Prazos e limites, regras de PSI, posições, layouts, vínculos de layout e serviços da Manutenção — sempre por formulário. |

Filtros globais na URL (`foto`, `operacao`, `uf`, `local`, `br`, `lideranca`,
`filial`, `tipo`, `veiculo`, `situacao`, `marca`, `modelo`, `dimensao`, `vida`,
`posicao`, `sulco`, `medicao`, `calibragem`, `pressao`, `severidade`,
`qualidade`, `ressolagem`, `q`); o banco recebe ids e códigos canônicos.
Exportação XLSX (`tires.export`) em `/frota/pneus/exportar/<tipo>` com os mesmos
filtros, todas as páginas, registrada em `tire_audit_events` antes do download.

## 4. Permissões e perfis

Permissões oficiais (módulo `tires`): `tires.view`, `tires.dashboard.view`,
`tires.base.view`, `tires.history.view`, `tires.measurement.view`,
`tires.calibration.view`, `tires.schedule.view`, `tires.inspection.review`,
`tires.import`, `tires.export`, `tires.parameters.manage`,
`tires.services.view`, `tires.services.manage`, `tires.quality.view`,
`tires.audit.view`, mais `applications.tires.execute` (aplicativo).

Padrões da matriz (ajustáveis em **Administração › Perfis e Permissões**; nada
é concedido pelo nome do perfil): Administrador e Gestor de Frota — todas;
Gestão — leitura, qualidade, exportação e auditoria; Segurança — leitura,
qualidade e exportação; Liderança de Operações — leitura gerencial (visão,
base, histórico, aderências, cronograma, serviços) e o aplicativo; Operacional
— só o aplicativo.

## 5. Segurança

- RLS em todas as tabelas por organização; leitura de pneus/fotografias/eventos
  também pelo escopo de veículo/operação da pessoa
  (`private.tire_vehicle_visible`). O filtro do navegador nunca é a barreira.
- Toda escrita é rotina `security definer` com `private.tire_require` (permissão
  no banco) e trilha em `tire_audit_events` com o nome da pessoa autenticada.
- Paginação no servidor em todas as listas; nada carrega milhares de pneus para
  filtrar no navegador.

## 6. Integrações

| Módulo | Como |
|---|---|
| Cadastro de Frotas | N. Frota do Rodopar → `vehicles` (código de frota ou placa); **nenhum veículo é criado**. Aba **Pneus** na ficha do veículo (`tires_vehicle_summary`, pelo id). |
| Operações, BRs, Fidelização, Lideranças, Filiais | Contexto operacional resolvido na data da fotografia/vistoria e congelado no registro; alimenta filtros e quebras. |
| Tipos de Equipamento | Layout de posições por tipo (`tire_vehicle_type_layouts`) e regras de PSI por tipo; o módulo "Pneus" passa a disponível no catálogo de módulos. |
| Aplicativos | Elegibilidade App × Operação × Tipo para a Vistoria de Pneus. |
| Gestão de Manutenção | Alinhamento/balanceamento lidos das manutenções oficiais pelo mapeamento de serviços; consertos podem citar o serviço e o fornecedor do catálogo da Manutenção. |
| Gestão de KM | Não há substituição: o KM do Rodopar fica só como dado do pneu. |
| Outbox | `tires.snapshot.confirmed`, `tires.inspection.returned`, `tires.inspection.persistent_divergence`. |

## 7. Testes

- Banco: `supabase/tests/remote/32_tires.sql` (duas fotografias sintéticas,
  eventos, ausentes/reaparecidos, regras de PSI, vistorias A–E, conciliação,
  RBAC/RLS, ausência de CPK). Exige base de pneus vazia (roda antes da carga
  real ou num ambiente de teste).
- Interface: `tests/ui/tires.spec.ts` e `tests/ui/tires-app.spec.ts` contra as
  prévias `/dev/preview-pneus` e `/dev/preview-vistoria-pneus`.

## Fora do Escopo Atual

### CPK DE PNEUS

Não implementado nesta etapa: custo por km (CPK), custo por vida, custo
acumulado de recapagens, ROI de pneus, controle financeiro por vida,
comparativo de custo entre 1ª, 2ª e 3ª vidas, custo de ressolagem por vida,
rentabilidade de recapagem e dashboard financeiro. Não existem tabelas, APIs,
rotas nem permissões de CPK, nenhuma planilha de CPK é importada e nenhum valor
de recapagem é solicitado. A vida, o KM e os eventos de ressolagem guardados
hoje são dados operacionais e não devem ser usados como CPK.
