# Experiência pós-login por perfil (Role-based Home)

Rota: `/inicio` (a casa de todo login) · Telas novas: `/aplicativos` (índice
dos apps) e `/perfil` · Migration:
`supabase/migrations/20261013190000_role_based_home.sql` · Teste de banco:
`supabase/tests/remote/38_role_based_home.sql` · Testes de interface:
`tests/ui/portal-home.spec.ts` · Prévia sem sessão:
`/dev/preview-inicio?perfil=operacional|lideranca&cenario=…&modo=compacto&escopo=operacoes`.

Princípio: **complexidade no back-end, simplicidade para o usuário.** A Home
do Operacional responde "o que preciso fazer agora?"; a da Liderança, "o que
exige minha atenção agora?". Nenhuma das duas tenta mostrar tudo: resumo,
prioridades, drill-down, ações rápidas, insights e navegação contextual. O
HFC (Lovable) foi a referência de intenção, não de layout — a sobrecarga de
KPIs e cards do HFC é justamente o que esta entrega corrige. A camada
anterior (portal, trava de telas, rotinas do Início) está em
`docs/modules/post-login-portals.md`; este documento descreve o que mudou por
cima dela.

---

## 1. Perfis

| Perfil (roles do vínculo) | Portal (`current_user_portal`) | Home | Pergunta |
|---|---|---|---|
| só Operacional | `operational` | **Operational Home** | O que preciso fazer agora? |
| Liderança de Operações (com ou sem Operacional) | `leadership` | **Leadership Home** | O que exige minha atenção agora? |
| qualquer outro perfil, administrador da plataforma ou nenhum perfil | `management` | Dashboard da gestão (`/inicio` → `/dashboard`) | — |

O perfil nunca é lido de parâmetro, nome de perfil ou cabeçalho: o portal vem
do banco pelos perfis do vínculo ativo; as permissões, da matriz RBAC. Um
Administrador não cai em nenhuma das duas homes (teste "Admin não é
roteado para a home do Operacional"). Nenhuma permissão foi alterada.

## 2. Home Resolver

`src/lib/home/resolver.ts` — puro (sem servidor), usado pela rota real, pela
prévia, pela central de notificações e pelos testes:

```ts
resolveHome({ portal, permissions, isPlatformAdmin })
  → { kind: "operational" | "leadership" | "management", can: HomeCapabilities }
```

`kind` é o portal do banco; `can` são as **capabilities** (seção 7). A rota
`/inicio` chama o resolver uma vez e passa `can` para a view: a tela nunca
decide por conta própria o que mostrar, e os menus, os widgets e o sino leem
a mesma matriz.

## 3. Operational Home

`src/app/(app)/inicio/operational-home.tsx` (mobile-first; a mesma tela no
desktop, em até 5xl). Ordem fixa, do que exige a pessoa para o contexto:

| # | Bloco | Conteúdo | Fonte |
|---|---|---|---|
| 1 | Saudação compacta | "Olá, {primeiro nome}" · dia da semana e data · operação · unidade · matrícula | `my_operational_home` |
| 2 | **Ações do dia** | obrigações de hoje (saída/retorno da BR em que é titular, com o status oficial do Motor de Aderência) e vistorias devolvidas ao campo; cada linha com estado, rótulo, ícone e botão **Iniciar / Fazer retorno / Refazer** | `today_actions`, `pending` |
| 3 | **Pendências** | só o que depende da pessoa: vencidos e devolvidos. Vazio: "Nenhuma pendência. Tudo em dia." | derivado de 2 |
| 4 | **Meus aplicativos** | grade 2 por linha (celular) / 3–4 (desktop) só com os apps autorizados **e** habilitados na operação; "Ver todos" → `/aplicativos` | `apps` × capability |
| 5 | **Meu veículo** | placa, frota, tipo, modelo, situação, BR, operação/cidade, último checklist, KM atual (hodômetro oficial), apontamentos em aberto, manutenção aberta/agendada | `vehicle` |
| 6 | **Histórico recente** | últimas 5 atividades (checklists, vistorias MTSR e de pneus) com status; "Ver histórico" | `recent` |
| 7 | Meus números | checklists realizados, aguardando reparo, já resolvidos | `checklists`, `reports` |
| 8 | Resolução | quanto do que apontou já foi resolvido (90 dias) | `reports` |
| 9 | Meu calendário de checklists | o calendário já existente (saída/retorno por dia, só falta o que era obrigação) | `adherence_my_situation` |

**Estados** (`src/lib/portal/home-status.ts`): PENDENTE, EM ANDAMENTO,
CONCLUÍDO, RETORNADO, VENCIDO e DISPENSADO (expurgo), cada um com rótulo e
ícone — a cor nunca é a única informação. Regras: expurgo → dispensado;
feito → concluído; `RETORNO_PENDENTE` com a saída feita → em andamento (CTA
"Fazer retorno"); `NAO_FEZ_CHECKLIST` com prazo vencido → vencido, senão
pendente (CTA "Iniciar"); vistoria MTSR `retornada` / Pneus
`retornar_divergencia` da própria pessoa → retornado (CTA "Refazer"). A
ordem é a do que exige a pessoa: vencido › retornado › pendente › em
andamento › concluído › dispensado. Sem permissão de executar o app, a ação
aparece sem botão.

**Estados vazios e de erro.** Sem obrigação hoje: "Tudo em dia" (com o
atalho para o Check List). Sem fidelização: "Sem veículo fidelizado hoje".
Sem `adherence.view_own`: a tela diz que a conta não consulta as obrigações
do dia. Rotina que falha: o erro no lugar dos números, com "Tentar novamente"
— nunca zero. O catálogo de apps que não carrega não esconde app nenhum: vale
a permissão sozinha (e nunca um app a mais).

## 4. Leadership Home

`src/app/(app)/inicio/leadership-home.tsx` + `leadership-secondary.tsx`, em
quatro camadas (NÍVEL 1 ação › 2 resumo › 3 tendências › 4 detalhes):

| Nível | Bloco | Conteúdo |
|---|---|---|
| 1 | Cabeçalho | "Portal da Liderança · Olá, {nome}. O que exige a sua atenção agora." · hoje, semana desde, matrícula · **recorte** (Minha liderança / Operações liberadas) · **modo** (Padrão / Compacto) |
| 1 | Escopo e contagens | operações liberadas · veículos ativos (frota) · colaboradores (equipe direta) · pendências críticas |
| 1 | **Prioridades** | cartões críticos › altos › médios, cada um um link para o módulo já filtrado (seção 5) |
| 2 | **Aderência do dia** | saída hoje (× ontem em p.p., meta) · retorno hoje (× ontem) · sem checklist ainda · semana até hoje; quem da equipe está sem checklist na semana |
| 2 | Resumo operacional | frotas ativas · checklist OK hoje · pneus críticos (frotas) · MTSR vencidas |
| 2 | **Pendências da equipe** | por categoria: Checklist, Pneus, MTSR, Planos de ação (total, críticas, partes), cada cartão abre o módulo filtrado |
| 2 | **Insights** | 2–3 fatos derivados dos números (aderência × ontem × meta; categoria que concentra pendências; equipe sem checklist) — nunca inventados; sem base, a lista diz isso |
| 3 | Manutenção | em manutenção, corretivas em aberto, fora do prazo, preventivas a tratar |
| 3 | Alertas preditivos | críticos/vencidos, a programar, cobertura, clusters críticos |
| 3 | KM rodado | KM no mês, frotas sem KM no dia, desatualizadas |
| 3 | Tendência da aderência | 1 gráfico (saída, mês a mês, com a meta) — o único gráfico principal da Home |
| 4 | Gestão de Pneus da minha frota · Segurança (MTSR) · Planos de ação | KPIs compactos do módulo, com "Abrir …" filtrado |
| 4 | Meu time | equipe direta com checklists de hoje e da semana |
| 4 | Atalhos · Aplicativos operacionais | só os módulos/apps que a capability libera |

**Modo compacto** (`?modo=compacto`): só os níveis 1 e 2 (a equipe vira uma
linha: "2 de 6 da equipe sem checklist na semana."). O modo e o recorte
convivem na URL, então o link é compartilhável.

Nenhum número é recalculado na tela: cada bloco vem da **rotina oficial do
seu módulo**, sob a sessão da própria pessoa (RLS):

| Bloco | Rotina | Permissão (capability) |
|---|---|---|
| Aderência hoje / ontem / semana (saída e retorno) | `adherence_summary` | `adherence.view` |
| Tendência mensal | `adherence_monthly` | `adherence.view` |
| Frota | `vehicle_summary` | `vehicles.view` |
| Pneus | `tires_overview` | `tires.view` + `tires.dashboard.view` |
| MTSR | `mtsr_dashboard` | `mtsr.view` + `mtsr.dashboard.view` |
| Planos de ação | `action_plan_dashboard` (90 dias) | `action_plans.view` + `view_dashboard` |
| Manutenção · Preditiva | `maintenance_dashboard` · `maintenance_predictive_overview` | `maintenance.view` + `view_dashboard` |
| KM | `km_overview` (competência atual) | `km.view` + `km.view_dashboard` |
| Escopo, responsabilidades, equipe | `my_leadership_home` | `adherence.view` ou `applications.checklist_fleet.view_details` |

## 5. Prioridades

`buildPriorities(blocks, team, query)` em `src/lib/portal/leadership.ts`
(puro; prévia e rota usam a mesma função). Cada prioridade tem severidade
(**Crítico / Alto / Médio**, com rótulo e barra), fonte, título, descrição e
**drill-down** para o módulo já com o recorte da pessoa (`?lideranca=…` na
"Minha liderança"). Geradas só das regras oficiais:

* Pneus — frotas com pneu crítico (crítico), medição/calibragem vencida
  (alto), medição/calibragem próxima (médio);
* MTSR — vistoria vencida (crítico), não conformes (alto), vistorias
  aguardando validação (médio);
* Aderência — obrigações sem checklist hoje (alto) e na semana (médio);
* Planos de ação — planos vencidos (alto), críticos (médio);
* Equipe — colaboradores sem checklist na semana (alto/médio).

Ordem: críticas primeiro. Fonte que falhou: a lista avisa que pode estar
incompleta (nunca "tudo em dia" sem base). Sem operação liberada: "Sem
operações liberadas na sua conta, não há o que priorizar ainda."

## 6. Widgets (inventário)

Foram criados **poucos componentes, reutilizados**: `HomeSection` (título,
contexto, ação), `ActionRow` (ação do dia), `VehicleCard`, `AppTile`/`AppGrid`,
`PriorityCard`, `CategoryCard`, `BlockError`, `LeadershipSecondarySkeleton`,
`BottomNav`, `NotificationCenter`. Todos sobre o HFM Premium Design System
(`KpiCard`, `StatusBadge`, `Card`, `InsightCard`, `EmptyState`, `ErrorState`,
`SkeletonCard`, `TrendChart`, `SegmentedControl`, `PageHeader`) e só com cores
semânticas (tokens `success/warning/danger/info/progress/pending`) — nenhum
HEX solto.

Classificação de cada informação (fase 4 do plano): **ação** (ações do dia,
prioridades, CTAs), **prioridade** (prioridades, pendências por categoria),
**indicador** (KPIs com meta/comparativo), **contexto** (escopo, veículo,
saudação) e **detalhe** (nível 4, histórico, time). O que era só "número por
número" no HFC não entrou.

## 7. Capabilities

`homeCapabilities()` — cada chave é uma permissão real da matriz:

| Capability | Permissão |
|---|---|
| `apps` | `applications.view` |
| `checklistExecute` · `mtsrExecute` · `tiresExecute` | `applications.checklist_fleet.execute` · `applications.mtsr.execute` · `applications.tires.execute` |
| `ownChecklists` · `ownReports` · `ownSituation` | `applications.checklist_fleet.view_own` · `action_plans.view_own` (ou `view`) · `adherence.view_own` |
| `adherence` · `fidelization` · `leadership` · `fleet` | `adherence.view` · `fidelization.view` · `leadership.view` · `vehicles.view` |
| `actionPlans` · `km` · `tires` · `maintenance` · `mtsr` | permissão de ver o módulo **e** a do seu painel |

Aplicativos: um azulejo só aparece quando a pessoa tem a permissão de
**executar** o app **e** o app está **habilitado para a operação do vínculo**
(Gerenciador de Aplicativos, `private.app_operation_enabled`). `my_apps(org)`
devolve o catálogo com `enabled`; `visibleApps(apps, can)` cruza as duas
coisas. Tipo de equipamento/app não habilitado não aparece (teste
"equipamento não habilitado é ocultado").

## 8. Escopos

* **Operacional**: só o que é da própria pessoa. `my_operational_home` resolve
  o colaborador pela sessão; obrigações, veículo, pendências e histórico são
  dela (RLS + `employee_id`). Não há filtro de operação a escolher.
* **Liderança**: dois recortes, trocados no cabeçalho —
  * **Minha liderança** (padrão quando há responsabilidade vigente): as
    rotinas recebem `leader_employee_id` / `leader_ids` (o mesmo
    `?lideranca=` dos módulos; os drill-downs levam o filtro junto). Rotinas
    sem filtro de líder (frota, preditiva) recebem a **operação**, quando a
    liderança responde por uma só;
  * **Operações liberadas**: só a RLS (tudo o que a conta enxerga em
    `membership_operation_scopes`).

  Dados de outras operações nunca chegam ao navegador: o recorte é do
  servidor, não um filtro de tela. Sem operação liberada, a Home avisa em vez
  de mostrar zeros.

## 9. Menus

Fonte única: `src/components/layout/navigation.ts` (+ `PORTAL_ROUTES` em
`src/lib/auth/portal.ts`, a trava de telas; menu e trava leem a mesma lista).

| Portal | Menu |
|---|---|
| Operacional | **Início** · **Aplicativos** (Todos os aplicativos, Check List de Frota, Vistoria MTSR, Vistoria de Pneus) · **Histórico** (Meus checklists, Meus apontamentos, Minha situação) · **Conta** (Perfil). No celular, **navegação inferior** fixa: Início / Aplicativos / Histórico / Perfil. Nenhuma tela administrativa. |
| Liderança | **Início** · **Gestão da operação** (Aderência, Planos de ação, Fidelização, BRs, Lideranças) · **Frota** (Cadastro de frotas, Gestão de KM Rodado, Gestão de Pneus, Manutenção) · **Segurança** (Gestão de MTSR) · **Aplicativos**. Grupos em **acordeão**: um aberto por vez, o da tela atual por padrão. |

Novas telas de ambos os portais: `/aplicativos` (índice) e `/perfil`
(identificação, forma de entrada — e-mail ou matrícula —, alterar senha,
sair). A Liderança passou a ter **Lideranças** (`leadership.view`) e
**Cadastro de frotas** (`vehicles.view`), como o menu pedido; continuam fora
Colaboradores e usuários, Fornecedores, Perfis e permissões, Operações,
Filiais e Tipos de equipamento (um líder que precise delas recebe também o
perfil correspondente e passa ao portal da gestão).

**Sino (Central de Notificações).** `loadMyNotifications()` (server action)
lê só quando a pessoa abre o sino e **deriva** do que a Home já sabe — nunca
inventa: Operacional, as ações de hoje em aberto (vencida/devolvida =
**Alerta**, pendente = **Ação**) e a manutenção agendada do veículo
(**Informação**); Liderança, as prioridades (crítico = Alerta, alto = Ação,
médio = Informação). O contador mostra só o que pede ação.

## 10. Responsividade

* Operacional **mobile-first**: 375, 390 e 430 px sem rolagem lateral;
  azulejos 2 por linha; alvo de toque ≥ 44 px (azulejos de 96 px, navegação
  inferior de 56 px + `safe-area-inset-bottom`); o conteúdo recebe o
  `padding-bottom` da barra. No desktop (≥ lg) a sidebar assume e a barra
  some.
* Liderança: 1366×768, 1440×900 e 1920×1080 sem rolagem lateral, prioridades
  acima da dobra; KPIs em 2/4 colunas; no celular tudo empilha (grades
  `grid-cols-2` → `xl:grid-cols-4`).
* Sem tabelas na Home: listas curtas (até 5 atividades, até 200 colaboradores
  da equipe), cartões e KPIs.

## 11. Performance

* **Consultas agregadas no servidor.** Operacional: **1** RPC para toda a
  primeira pintura (`my_operational_home` v2 — ações, veículo, pendências,
  recentes, apps, números) + `adherence_my_situation` para o calendário.
  Liderança: `my_leadership_home` + as rotinas oficiais em **paralelo**
  (`Promise.all`), cada uma só se a capability libera (bloco sem permissão
  não é consultado).
* **Carregamento tardio dos secundários.** Manutenção, preditiva, KM e
  tendência (nível 3) chegam depois da primeira pintura por **Suspense** com
  um componente de servidor (`leadership-secondary-loader.tsx`), com
  esqueleto específico por bloco — nunca um spinner gigante. No modo compacto
  nem são consultados.
* **Falha isolada por widget.** `settle()` transforma cada rotina em
  `ok/erro`; o bloco que falha mostra o motivo e "Tentar novamente"
  (`router.refresh()`), os demais seguem.
* Nada de "20 queries no cliente": nenhuma lista é filtrada no navegador; o
  recorte é do banco. O sino só lê ao abrir.
* Telemetria/analytics: não há infraestrutura de eventos de interface no HFM;
  não foi criada (ver §14).

## 12. Acessibilidade

* Cada seção é um `<section aria-labelledby>` com título; listas com
  `aria-label` ("Ações de hoje", "Pendências", "Aplicativos", "Atividades
  recentes", "Colaboradores da equipe", "Notificações").
* Estados **sempre** com rótulo + ícone (StatusBadge `withIcon`); severidade
  das prioridades com texto; gráfico com `aria-label` e tooltip.
* Navegação inferior com `aria-current="page"`; sino com rótulo que inclui a
  contagem ("Notificações (2 que pedem ação)"); foco visível (`hfm-focus-ring`)
  em todos os links/cartões; `aria-busy` durante navegação; `role="status"` /
  `role="alert"` nas respostas do sino.
* Light e dark validados com axe (WCAG 2.1 A/AA) em Operacional, Liderança e
  Liderança compacta — zero violações nos testes.

## 13. Verificação

* **Banco**: `38_role_based_home.sql` em produção com rollback (H1–H7: ações
  do dia só com `adherence.view_own`; veículo fidelizado; pendências só da
  própria pessoa; recentes; apps por operação; `my_apps` exige
  `applications.view`; contrato antigo preservado).
* **Interface** (`tests/ui/portal-home.spec.ts`): regras puras (trava de
  telas por portal; resolver: Operacional → Operational Home, Liderança →
  Leadership Home, Admin fora das duas; apps não autorizados/não habilitados
  ocultos; estados das ações; prioridades, categorias e insights; calendário)
  e telas (menus de cada perfil, acordeão, Home do Operacional completa e nos
  cenários sem fidelização / novo / erro, Home da Liderança nos 4 níveis,
  modo compacto, recorte com drill-down filtrado, sem escopo, erros parciais,
  sino) + responsividade (375/390/430 com navegação inferior; 1366×768,
  1440×900, 1920×1080) + axe light/dark.
* `tsc`, `eslint`, `next build` aprovados.

## 14. Critérios de aceite

| CA | Como foi atendido |
|---|---|
| CA01 | HFC vistoriado no Lovable (somente leitura) nas fases 1–2; intenção copiada, sobrecarga não. |
| CA02 · CA03 | Operational Home e Leadership Home (seções 3 e 4). |
| CA04 | `resolveHome` + `homeCapabilities` (seções 2 e 7). |
| CA05 · CA12 | Operacional: 6 blocos de ação/contexto, mobile-first, navegação inferior. |
| CA06 · CA07 · CA08 | Liderança em 4 níveis; 4 contagens + 4 KPIs de aderência + resumo; prioridades logo abaixo do cabeçalho. |
| CA09 | Iniciar / Fazer retorno / Refazer; "Abrir …" em cada bloco; atalhos. |
| CA10 · CA15 | Azulejo só com permissão de executar **e** app habilitado na operação. |
| CA11 · CA16 | Recorte no servidor (RLS, `leader_ids`, operação); sem dado de outra operação no cliente. |
| CA13 · CA26 | 1366×768, 1440×900, 1920×1080, 375/390/430 nos testes. |
| CA14 | Menus por portal, acordeão na Liderança, navegação inferior no Operacional. |
| CA17 · CA18 | Prioridades, categorias, KPIs e insights são links para o módulo filtrado. |
| CA19 | Sem tabelas na Home. |
| CA20 · CA21 · CA22 | Esqueletos por bloco (Suspense), "Tudo em dia"/"Sem veículo"/"Ainda sem base", erro por widget com "Tentar novamente". |
| CA23 · CA24 · CA25 | Só componentes e tokens do HFM Premium Design; axe em light e dark. |
| CA27 | Seção 12. |
| CA28 · CA29 | Nenhuma permissão alterada; rotinas `security invoker` sob a RLS; `my_operational_home` v2 mantém as mesmas permissões. |
| CA30 | Suíte Playwright dos módulos (Manutenção, Usuários, Fornecedores) e o calendário anterior continuam passando. |
| CA31 · CA32 · CA33 | `tsc`, Playwright e `next build` aprovados. |

## 15. O que ficou de fora (de propósito)

* **Comunicados**: o HFM não tem fonte de comunicados (tabela/RPC); criar
  uma só para a Home seria inventar conteúdo. Entra quando houver o módulo.
* **Telemetria de interface** e **favoritos/atalhos personalizados**: sem
  infraestrutura de eventos/preferências de usuário; não foram simulados.
* **KM** aparece só na Liderança (nível 3); no Operacional, só o hodômetro do
  próprio veículo — a regra "KM só se for útil".
* **CPK de pneus**: fora desta etapa, como combinado.
