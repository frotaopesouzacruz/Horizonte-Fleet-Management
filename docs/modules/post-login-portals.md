# Pós-login › Início de cada perfil (Operacional e Liderança de Operações)

Rota: `/inicio` (a casa de todo login) · Telas novas: `/inicio` e
`/aplicativos/check-list-frota/meus-checklists` · Migration:
`supabase/migrations/20261013140000_portals_post_login.sql` · Teste de banco:
`supabase/tests/remote/35_portals_post_login.sql` · Testes de interface:
`tests/ui/portal-home.spec.ts` · Prévia sem sessão:
`/dev/preview-inicio?perfil=operacional|lideranca&cenario=…`.

Referência: a vistoria do HFC (Lovable, somente leitura) de 13/10/2026 — "Meu
resumo" do Operacional, "Portal da Liderança", menus por perfil e o
redirecionamento silencioso de quem abre tela fora da alçada.

---

## 1. Duas camadas que não se confundem

| Camada | Decide | Onde |
|---|---|---|
| **Permissão** (RBAC + RLS) | o **dado**: o que cada rotina devolve e a RLS deixa ler | banco, como sempre |
| **Portal** | a **casa** e o **conjunto de telas** do perfil | `current_user_portal` (banco) + `src/lib/auth/portal.ts` |

Por que duas: o Operacional **precisa** de `operations.view` e `vehicles.view`
para o Check List listar operações e placas (as rotinas do app são
`security invoker` e passam pela RLS). Nem por isso Operações ou Cadastro de
frotas são telas dele. O portal recorta as telas sem tirar permissão de
ninguém — **nenhuma permissão foi alterada** nesta entrega.

## 2. Qual portal a conta recebe

`public.current_user_portal(org)` (leve; roda a cada requisição, ao lado de
`current_user_permissions`) lê os **perfis do vínculo ativo** (`roles.code`):

| Perfis da conta | Portal | Casa |
|---|---|---|
| só Operacional | `operational` | **Meu resumo** (`/inicio`) |
| Liderança de Operações (com ou sem Operacional) | `leadership` | **Portal da Liderança** (`/inicio`) |
| qualquer outro perfil, administrador da plataforma ou nenhum perfil | `management` | Dashboard (`/inicio` → `/dashboard`) |

Um perfil a mais nunca tira telas: Liderança + Gestor de Frota recebe a
navegação completa. Se a consulta do portal falhar, a conta fica com a
navegação de sempre (filtrada por permissão) — o dado continua protegido pela
RLS; perde-se só o recorte de telas até a próxima requisição.

A mesma rotina devolve a **matrícula** do colaborador: no cabeçalho, quem entra
por matrícula vê "Matrícula 140349 · Operacional" em vez do endereço técnico
`…@horizonte-logistica.invalid`.

## 3. Telas de cada portal (a trava)

Fonte única: `PORTAL_ROUTES` em `src/lib/auth/portal.ts` (por prefixo de
caminho; `/inicio-falso` não "pertence" a `/inicio`). O menu e a trava leem a
mesma lista.

| Portal | Telas |
|---|---|
| Operacional | `/inicio` · os 3 aplicativos (Check List de Frota — inclusive *Meus checklists* —, Vistoria MTSR, Vistoria de Pneus) · `/checklist/aderencia/minha-situacao` · `/checklist/planos-acao/meus-apontamentos` |
| Liderança de Operações | `/inicio` · os 3 aplicativos · Aderência · Planos de ação · Fidelização · BRs · KM Rodado · Gestão de Pneus · Manutenção · Gestão de MTSR |
| ambos | `/sem-permissao`, `/sem-organizacao` |

Fora do portal da Liderança, de propósito (no HFC também não são telas da
liderança): Colaboradores e usuários, Perfis e permissões, Operações, Filiais,
Tipos de equipamento, Cadastro de frotas e Planejamento de lideranças. Para dar
uma dessas telas a um líder, atribua-lhe também o perfil correspondente (por
exemplo, Gestor de Frota): a conta passa ao portal `management`.

**Como a trava funciona.** O middleware encaminha o caminho pedido no cabeçalho
`x-hfm-pathname`, **sempre sobrescrito** com o caminho real (um valor mandado
pelo cliente nunca chega à página — há teste para isso). `requireSession()`
(chamada por toda página, direto ou via `requireOrganization`, inclusive na
navegação do lado do cliente) compara o caminho com o portal e, fora dele,
redireciona em silêncio para `/inicio`, como o HFC. As 8 rotas de exportação
que leem a sessão diretamente fazem a mesma conferência e respondem 403
("Esta exportação não faz parte do seu acesso.") — um líder não baixa, pelo
endereço, a lista de usuários ou o planejamento de lideranças.

## 4. Meu resumo (Operacional)

Na ordem do HFC: saudação ("Olá, {primeiro nome}" e, abaixo, nome completo,
matrícula, cargo e operação) › **Abrir o App de Checklist** › atalhos (Meus
checklists realizados, Meus apontamentos, Minha situação, Vistoria de Pneus,
Vistoria MTSR) › **Meus números** › **Quanto do que apontei já foi resolvido** ›
**Meu calendário de checklists**.

`public.my_operational_home(org, ano, mês)` (exige
`applications.checklist_fleet.view_own`):

* checklists **enviados** do colaborador da conta — a mesma regra de
  `checklist_my_executions`, que alimenta "Meus checklists": o número do início
  e a lista nunca discordam (total, do mês, últimos 30 dias, último);
* os checklists do mês para o calendário (até 400);
* apontamentos (só com `action_plans.view_own` ou `view`): a mesma regra e a
  mesma janela de **90 dias** de "Meus apontamentos" — aguardando reparo
  (`pending`, `in_maintenance`, `needs_action`), resolvidos (`resolved`,
  `resolved_without_maintenance`) e encerrados sem reparo/sem procedência.

### O calendário (e a falha do HFC que ele não repete)

No HFC, **todo dia passado sem checklist da pessoa fica vermelho** — folga, fim
de semana, veículo em manutenção ou dia em que ela nem estava escalada. No HFM
cada quadrante (Saída / Retorno) nasce de uma de duas fontes, e de nenhuma
outra (`src/lib/portal/calendar.ts`):

1. a **obrigação oficial** da Aderência (`adherence_my_situation`): a BR em que a
   pessoa é motorista titular fidelizada, com o status oficial — realizado, não
   realizado, pendente hoje (dia vigente), aguardando retorno (no prazo),
   previsto, ou **dispensado** por expurgo (manutenção, sem rota, em viagem,
   reserva, frota não ativa);
2. o **checklist enviado** pela própria pessoa naquele dia, mesmo sem
   obrigação (aparece como realizado).

Dia sem nenhuma das duas fica **neutro**. Se as obrigações não carregarem, a
tela diz isso e nenhum dia vira "não realizado". O dia operacional vem do
servidor, no fuso da organização (o HFC usa o relógio do navegador). Tocar um
dia abre o detalhe: obrigações (BR, operação, cidade, prazo) e checklists (placa,
horário, apontamentos) com **Ver checklist**, que abre o checklist completo.
No celular a grade cabe na largura (quadradinhos S/R), sem rolagem lateral.

## 5. Portal da Liderança

`public.my_leadership_home(org)` (exige `adherence.view` ou
`applications.checklist_fleet.view_details`) devolve as duas metades da alçada:

* o que a conta **enxerga** — as operações liberadas no vínculo
  (`membership_operation_scopes`, ou todas com `operations.access_all`). É o que
  a RLS aplica em todos os módulos;
* pelo que a pessoa **responde** — as responsabilidades vigentes do
  Planejamento de lideranças (`leadership_assignments`);
* a **equipe direta** (gestor imediato vigente no cadastro), com checklists de
  hoje e da semana (segunda até hoje), quem está sem checklist e o último.

Recorte: com responsabilidades vigentes, o portal abre em **Minha liderança**
(filtro `leader_employee_id` / `leader_ids`, o mesmo `?lideranca=` dos módulos,
que os links levam junto); "Operações liberadas" mostra tudo o que a conta
enxerga.

Blocos, cada um pela **rotina oficial do módulo** (nenhum número recalculado):
Minha operação hoje e Semana até hoje (`adherence_summary`, saída e retorno,
com expurgos — o HFC usa uma conta paralela sobre os checklists da equipe e
em UTC), **Prioridades** (pneu crítico, MTSR vencida, checklist sem envio hoje e
na semana, medição/calibragem vencida e próxima, planos vencidos, equipe sem
checklist, vistorias aguardando validação), Gestão de Pneus da minha frota
(`tires_overview`), Segurança (`mtsr_dashboard`), Planos de ação
(`action_plan_dashboard`, 90 dias), Minha equipe, Navegação da liderança e
Aplicativos. Bloco sem permissão não aparece; bloco que falha mostra o motivo
no lugar dos números e as Prioridades avisam que podem estar incompletas — sem
operação liberada, o portal diz isso em vez de "operação sob controle".

## 6. O que mais mudou

* Login, `/`, "definir senha" e o link de recuperação levam ao **Início**
  (`/inicio`); quem não tem portal segue dele para o Dashboard.
* Menu: o Operacional vê **Meu resumo / Minha rotina / Aplicativos**; a
  Liderança, **Portal da Liderança / Minha operação / Aplicativos**; o
  subtítulo da marca acompanha ("Menu operacional", "Portal da liderança").
* Cabeçalho dos portais sem o seletor de unidade e sem a busca global (ainda
  reservas da gestão).
* "Sem permissão" ganhou **Voltar ao início**.
* Perfis e permissões: `view_own` deixou de depender de `view` (banco e tela).

## 7. Produção (13/10/2026)

Migration aplicada (`portals_post_login`) e teste 35 executado em produção com
rollback: **29 verificações, nada gravado**. Hoje só há **uma** conta com acesso
(o Administrador): os portais passam a valer quando o Operacional e a Liderança
receberem conta (Colaboradores e usuários › Conceder acesso ao HFM). Antes de
liberar líderes, defina as **operações do acesso** de cada um — sem elas a RLS
devolve tudo vazio e o portal avisa. A fidelização de motoristas ainda está
vazia: até lá o calendário do Operacional mostra os checklists enviados, sem
dias obrigatórios a cobrar.
