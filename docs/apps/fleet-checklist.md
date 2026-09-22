# Check List de Frota

Rota: `/aplicativos/check-list-frota` · Permissão de entrada: `applications.view`
Versão inicial: **1.0**, publicada · Origem funcional: versão 1.1 do HFC

Aplicativo de inspeção operacional da frota, na saída e no retorno de rota.
Prioridade absoluta para o smartphone: quem responde está em pé, ao lado do
veículo, muitas vezes de luva e sob sol.

---

## 1. Sem anexo, por decisão

> O Check List de Frota **não** possui upload de fotografia, abertura de câmera,
> galeria, anexo de vídeo, anexo de documento, upload de arquivo, campo de
> evidência obrigatória nem validação condicionada a imagem.

Não é uma funcionalidade que ficou para depois: é uma restrição da etapa (§26), e
está garantida em três camadas que não dependem de ninguém lembrar dela.

1. **Nenhuma coluna existe.** As tabelas do checklist não têm `photo_url`,
   `attachment_id` nem equivalente — e `operational_apps.allows_attachments` é
   `false` para este aplicativo.
2. **O teste de banco confirma por catálogo** (`A16`): consulta
   `information_schema.columns` procurando qualquer nome com `photo|foto|attach|
   anexo|file|arquivo|image|imagem|media|evidenc|storage|upload`. Zero.
3. **O teste de navegador confirma na tela**: percorre os quatro clusters da
   amostra, aciona todos os campos condicionais, e então verifica que não existe
   `input[type=file]`, atributo `capture`, `accept` de imagem/vídeo, nem sequer
   um texto pedindo foto.

A inconformidade se registra por **resposta, campo condicional e observação
textual**. Nada mais.

---

## 2. A configuração inicial

| | |
|---|---|
| Clusters | 9 |
| Perguntas | 34 |
| Campos condicionais | 7 |
| Perguntas invertidas | 2 |
| Perguntas críticas | 9 |
| Regras de aplicabilidade (`include`) | 5 |
| Regras de orientação (`guidance`) | 2 |
| Textos duplicados | 0 |

| # | Cluster | Perguntas |
|---|---|---|
| 1 | 5S | 2 |
| 2 | Funilaria | 1 |
| 3 | Extintor | 2 |
| 4 | Implementos / Carroceria | 6 |
| 5 | Itens de Segurança | 7 |
| 6 | Luzes e Sinalização | 4 |
| 7 | Mecânica | 6 |
| 8 | Pneus | 3 |
| 9 | Qualidade | 3 |

O seed é versionado (`…_checklist_fleet_seed_v1.sql`), roda por organização, é
idempotente e **não escreve nenhum id à mão**: tipos de equipamento e operações
são resolvidos por código. Um seed com uuid colado funciona uma vez, no banco
onde foi escrito, e falha em qualquer outro.

---

## 3. A conformidade é por pergunta

Esta é a regra que uma implementação apressada erra.

| Pergunta | Resposta conforme |
|---|---|
| "Possui alguma avaria?" | **NÃO** |
| "A frota apresenta algum problema mecânico?" | **NÃO** |
| as outras 32 | SIM |

Uma regra global "SIM = conforme" aprovaria um veículo avariado. Por isso
`conforming_answer` é coluna **da pergunta**, e o executor, o banco e os testes
leem essa coluna — nunca uma convenção.

O teste `A8/A9` cobre exatamente isso: respondendo SIM em tudo, as duas
invertidas ficam inconformes e **nenhuma** das 32 positivas é classificada
errado.

---

## 4. Os 7 campos condicionais

| Pergunta | Gatilho | Campo | Tipo |
|---|---|---|---|
| Possui alguma avaria? | SIM | Descreva a avaria identificada | texto |
| As prateleiras estão em boas condições? | NÃO | Onde está a inconformidade? | escolha única |
| As luzes de freio estão funcionando? | NÃO | Qual lado apresenta falha? | escolha única |
| Os faróis estão funcionando? | NÃO | Qual item apresenta falha? | múltipla |
| As setas estão funcionando? | NÃO | Qual seta apresenta falha? | múltipla |
| As luzes de ré estão funcionando? | NÃO | Qual lado apresenta falha? | escolha única |
| A frota apresenta algum problema mecânico? | SIM | Descreva o problema mecânico | texto |

Todos são obrigatórios quando acionados — validado **no servidor**, não só na
tela. E **trocar a resposta que acionou o campo descarta o valor anterior**:
manter "farol esquerdo" depois de responder SIM guardaria um defeito que a
pessoa acabou de dizer que não existe.

Um seletor com menos de duas opções é recusado por constraint: seria um campo
obrigatório impossível de preencher, travando o envio sem saída para o motorista.

---

## 5. Aplicabilidade por equipamento

| Pergunta | Aplica-se a |
|---|---|
| Plataforma hidráulica elevatória | Caminhão |
| Controle auxiliar (mão amiga) | Caminhão |
| Prateleiras | Van |
| Nível de ARLA | Van e Caminhão |

Por **id**, não por texto. As demais valem para todo equipamento, e o
administrador ajusta pela matriz de aplicabilidade.

### A orientação de Merchandising

Câmera e sirene de ré continuam sendo perguntadas em **toda** operação. Em
Merchandising, a pergunta traz um texto orientativo — os veículos podem não sair
de fábrica com o equipamento, e a regra operacional aprovada diz como responder.

Orientação não é restrição: o modo `guidance` carrega o texto e não entra no
cálculo de aplicabilidade. Verificado nos dois sentidos (`A5`/`A6`): a orientação
aparece nas duas perguntas em Merchandising e **não vaza** para Last Mille MG,
onde a pergunta segue valendo normalmente.

---

## 6. O fluxo de execução

O executor segue a sequência do aplicativo de referência (Horizonte Fleet
Command), inspecionado no Lovable antes do refinamento — ver §14:

```
INÍCIO (identificação) → TIPO (saída/retorno) → OPERAÇÃO
      → TIPO DE EQUIPAMENTO → FROTA / PLACA
      → CLUSTERS → PERGUNTAS DE UM CLUSTER (…) → PRÉ-RESUMO → ENVIO → CONFIRMAÇÃO
```

**Cada seleção filtra a seguinte NO SERVIDOR.** A tela só conhece o resultado:

* **Operação**: `checklist_fleet_context` lista só operações ativas,
  habilitadas para o aplicativo NA DATA e dentro do escopo de quem pergunta.
* **Tipo de equipamento**: `checklist_equipment_options(org, operação)` lista
  só tipos habilitados para o aplicativo E com pelo menos um veículo elegível
  na operação. Frota Leve ADM, desabilitada, não aparece.
* **Frota / placa**: `checklist_vehicle_options(org, operação, tipo, busca,
  data)` lista só veículos ativos do tipo, vinculados à operação na data
  (fidelização de BR primário ou alocação operacional), elegíveis e no escopo.
  O previsto pela fidelização vem marcado e primeiro.
* **Trocar a operação descarta tipo e placa (§32); trocar o tipo descarta a
  placa (§35).** Sem frota elegível a tela diz exatamente: "Nenhuma frota
  disponível para a operação e o tipo de equipamento selecionados." — e não
  preenche com outra operação.
* **Antes das perguntas** (§38) `checklist_fleet_form` confere a combinação de
  novo; **no envio** `submit_checklist_execution` confere outra vez. Uma
  requisição alterada com veículo fora da lista é recusada nos dois pontos.

**Quem executa vem da sessão** (§31). A matrícula nunca vem do payload.

**O cronômetro começa no "Iniciar"** e aparece na barra fixa de todas as telas,
como no aplicativo de referência. Ele informa; quem valida o tempo é o servidor.

**Clusters, depois perguntas.** A tela de clusters mostra, para cada um, o
andamento (respondidas, ✓ conformes, ⚠ inconformes) e a situação (não
iniciado, em andamento, concluído, inconformidade). Um toque abre as perguntas
do cluster — SIM e NÃO em dois botões de 56 px —, e "Avançar" leva ao próximo.
"Finalizar e revisar" só libera sem pendência. O pré-resumo traz usuário,
matrícula, tipo, operação, equipamento, placa, BR, início, duração, os três
KPIs e o resumo por cluster; a confirmação traz a saudação, a duração, os KPIs
e a data/hora.

**O rascunho fica no aparelho** (§40), gravado a cada alteração. Mas a tela
nunca diz "enviado" por causa disso: enviado é o que o servidor confirmou.

**O formulário aberto continua na sua versão** (§48): o envio informa a
versão em que abriu; se uma versão nova foi publicada no meio, o servidor
aceita a antiga desde que o checklist tenha começado antes da publicação.

---

## 7. O envio

Uma transação grava cabeçalho, respostas, resumo por cluster e o evento de
conciliação. Se qualquer parte falhar, nenhuma existe.

### Idempotência

A chave nasce **no cliente, antes do envio**, e acompanha todas as tentativas.
Duplo toque, retry e queda de rede reenviam a mesma chave, e o índice único a
transforma na devolução do primeiro resultado em vez de um segundo checklist.

### Validação no servidor

* elegibilidade da combinação aplicativo × operação × tipo × veículo (§23);
* perguntas obrigatórias aplicáveis, todas respondidas;
* campos condicionais obrigatórios, preenchidos quando acionados;
* tempo mínimo configurável (60 s por padrão) — abaixo dele o envio é recusado.

O **máximo** (600 s) é registrado, não recusado: rejeitar um checklist lento
destruiria o trabalho de quem foi interrompido no meio.

### O contexto é congelado

A execução guarda placa, código de frota, tipo de equipamento, BR, cidade e
liderança **como estavam no dia**. Substituir o veículo de um BR não reescreve
o que foi inspecionado em março (§34, §47).

### Selagem

Um checklist enviado não se edita. O banco recusa alteração de execução e de
respostas enviadas; a correção administrativa terá rotina própria, autorizada e
auditável, que abrirá o portão `hfm.checklist_correction`.

---

## 8. Integração com a Aderência

O lado produtor (o evento no outbox) e o lado consumidor (Etapa 11) existem e
estão testados juntos: `docs/modules/checklist-adherence.md`.

* o evento `checklist.execution.submitted` nasce **na mesma transação** da
  execução e é conciliado pelo gatilho do outbox: a obrigação de saída do
  veículo no dia passa a `FEZ_CHECKLIST`; a de retorno não é tocada (§56);
* execução sem obrigação compatível vira inconsistência, nunca obrigação;
* **a Aderência respeita os vínculos** (§44–§46): `private.adherence_expected`
  só espera checklist de veículo cuja operação E cujo tipo de equipamento
  estejam habilitados para o aplicativo NA DATA. Nada do passado é apagado — a
  geração é por período, e obrigação com execução conciliada ou solicitação em
  curso nunca é aposentada. A regra explícita "Frota Leve ADM: sem obrigação"
  da Etapa 11 continua valendo por cima.

---

## 9. Segurança

| | |
|---|---|
| Identidade | resolvida da sessão, nunca do payload |
| Elegibilidade | `private.app_vehicle_eligible` no contexto, nos tipos, nas placas, no formulário e no envio |
| Escopo de operação | `private.can_access_operation` |
| Escopo de veículo | `private.vehicle_in_scope` |
| Multi-tenant | RLS em todas as tabelas; nenhuma policy de escrita; vínculo de aplicativo, operação e tipo só dentro da organização (tipos globais compartilhados) |
| Escrita | só por rotina transacional `security definer` com permissão conferida no servidor |
| Leitura | rotinas `security invoker` — a RLS decide |
| Auditoria | versão, cluster, pergunta, condicional, regra, execução, vínculo × operação e vínculo × tipo (valor anterior e novo) |

O operacional vê o que fez — comparado pelo colaborador da sessão. Quem tem
`view_details` vê o escopo operacional autorizado. Ninguém atravessa organização.

---

## 10. Validação executada

Todas as suítes são transacionais (terminam em `ROLLBACK_TESTES`) e rodaram
contra o projeto de desenvolvimento em 22/09/2026, depois do refinamento.

| Suíte | Resultado | O que protege |
|---|---|---|
| `supabase/tests/remote/12_checklist_fleet.sql` | 15/15 PASS | aplicabilidade por vínculo (Van em Last Mille MG, Caminhão em Redespacho - MG), **Frota Leve ADM recusada no formulário**, orientação pela prévia, envio, invertidas, idempotência, outbox, recusas, tempo mínimo, imutabilidade, nenhuma coluna de anexo |
| `supabase/tests/remote/12b_checklist_versioning.sql` | 16/16 PASS | versão de trabalho copia 9/34/7/7, rascunho único, identidade preservada e nova identidade, condicional ≥ 2 opções e um por pergunta, regra com alvo inexistente/repetida, validação, prévia = executor, publicação arquiva a anterior, imutabilidade pela rotina e pelo gatilho, §48, **usuário sem `configure` recusado (42501)**, descarte, auditoria, Meus Checklists e escopo |
| `supabase/tests/remote/12c_application_links.sql` | 9/9 PASS | §51 só as 4 operações; §52 ADM fora dos tipos e das placas, formulário e envio recusados; §53 vans e caminhões filtrados; §54 habilitar/desabilitar com auditoria; §55 app novo sem vínculo até vincular; §56 saída conciliada, retorno intacto, ADM sem obrigação; §57 manipulação de ids recusada **e usuário sem permissão recusado nos dois vínculos**; §58 9/34/7/2 intactos |

**Como o "usuário sem permissão" é testado sem inventar conta.** O banco de
desenvolvimento só tem o administrador (que também é platform admin). As
suítes 12b (V9) e 12c (L7) rebaixam o próprio ator dentro de um sub-bloco
PL/pgSQL que termina numa exceção proposital: o platform admin é revogado e a
permissão específica é retirada do papel (com a mesma flag `hfm.access_change`
que as rotinas oficiais de acesso usam), a rotina é chamada e precisa devolver
`42501`, e a exceção desfaz o rebaixamento ali mesmo — o bloco seguinte confere
que o administrador voltou. Nada persiste; a transação inteira ainda termina em
`ROLLBACK_TESTES`.

Navegador (Playwright, contra o build de produção com as prévias
`/dev/preview-*` habilitadas, 22/09/2026): **92 testes passaram, 0 falharam,
8 pulados** — os 8 pulados são os testes de sessão autenticada da suíte
antiga (`a11y`, `app`), que só rodam com credenciais de teste no ambiente.
Desta etapa: executor (`checklist.spec.ts`, 8), fluxo de seleção
(`checklist-flow.spec.ts`, 7: sequência tipo → operação → equipamento → placa,
CA15, CA16, mensagem de frota vazia, tipos vazios, histórico, alvos de toque e
sem rolagem horizontal no telefone), editor administrativo
(`checklist-admin.spec.ts`, 6: rascunho com clusters/perguntas/conforme por
pergunta, nenhuma configuração de anexo em aba alguma, §47 identidade,
condicional com < 2 opções recusado com a mensagem do servidor, publicação com
impedimento → resolvido → imutável, telefone) e histórico
(`checklist-history.spec.ts`, 6: lista, filtros, detalhe, aba de
inconformidades, condicionais e observações, só leitura). `npx tsc --noEmit`,
`eslint .` e `next build` limpos.

---

## 11. Migrations

| Arquivo | O que faz |
|---|---|
| `…_applications_foundation.sql` | amplia `operational_apps`; versões, clusters, perguntas, condicionais, regras |
| `…_applications_guards_rbac_rls.sql` | imutabilidade, auditoria, 9 permissões, matriz, RLS |
| `…_checklist_executions.sql` | execuções, respostas, resumo por cluster |
| `…_checklist_fleet_rpcs.sql` | ator, aplicabilidade, formulário; limites de tempo |
| `…_checklist_fleet_submit.sql` | envio transacional, idempotente, com outbox |
| `…_checklist_executions_rls.sql` | RLS das execuções e selagem do enviado |
| `…_checklist_rules_guidance_mode.sql` | o modo `guidance` |
| `…_checklist_fleet_read_rpcs.sql` | contexto, veículos, histórico, detalhe |
| `…_checklist_fleet_seed_v1.sql` | a versão 1.0 |
| `…_checklist_admin_rpcs.sql` | editor: versão de trabalho, clusters, perguntas, condicionais, regras, validação (§46), publicação, prévia pelo construtor do executor, auditoria de cluster |
| `…_checklist_submit_version_binding.sql` | §48 no envio; Meus Checklists só do colaborador; histórico do escopo |
| `…_application_links.sql` | vínculos App × Operação e App × Tipo (vigência, permissões, leitura única, gravação, histórico), elegibilidade, contexto/tipos/placas/formulário pela elegibilidade, estado inicial aprovado |
| `…_checklist_eligibility_submit_adherence.sql` | elegibilidade no envio; Aderência respeita os vínculos |
| `…_checklist_execution_detail_employee_code.sql` | o detalhe da execução devolve a matrícula (§60) |

---

## 12. Pendências reais

* **Plano de Ação** (§61): `generates_action_plan` está preservado em todas as
  34 perguntas e a consulta por inconformidade tem índice próprio. O módulo em
  si não existe no HFM e não foi criado aqui.
* **Correção administrativa de execução enviada** (§60): o portão
  `hfm.checklist_correction` existe; a rotina e a tela não.
* **Vínculo por subcategoria** (§19, §21 "quando necessário"): não criado. Os
  19 subcategorias herdam o comportamento do tipo; se um dia uma subcategoria
  precisar de comportamento próprio, o vínculo nasce sobre
  `vehicle_subcategories`, com a mesma leitura única.
* **Vigência na validação da publicação**: `validate_checklist_version` conta
  operações habilitadas por `is_enabled`, sem olhar a vigência do vínculo.
* **Ledger vs. arquivos**: as migrations aplicadas pelo MCP carregam versão
  própria no ledger; os arquivos do repositório usam `20260922…`. Divergência
  conhecida desde a Etapa 11.

---

## 13. Refinamento: vínculos e elegibilidade (§8–§27)

**Nenhuma tabela nova.** Duas estruturas que já existiam viraram a fonte
única de disponibilidade de QUALQUER aplicativo:

| Vínculo | Tabela | Origem | O que ganhou |
|---|---|---|---|
| Aplicativo × Operação | `checklist_app_operations` | Etapa 12 | `effective_from`, `effective_to`, `updated_at/by`, auditoria |
| Aplicativo × Tipo de equipamento | `vehicle_type_apps` | Etapa 07 | `is_enabled`, `effective_from`, `effective_to`, `updated_at/by` |

O prefixo `checklist_` da primeira é histórico: a FK é para `operational_apps`
e a estrutura serve a qualquer aplicativo. Renomear quebraria rotinas sem ganho.

**Sem linha = não habilitado** (§13, §20). Operação ou tipo recém-cadastrado
não aparece em aplicativo algum até alguém autorizar. O estado inicial aprovado
foi gravado de forma explícita — linhas com `is_enabled = false` para o que fica
de fora, e não ausência de linha —, por isso a tela mostra a decisão:

| | Habilitado | Desabilitado |
|---|---|---|
| Operações | Last Mille MG, Merchandising, Redespacho - MG, Redespacho - Belém/Pa | Frota, Gente, Gestão, Segurança |
| Tipos | Van, Caminhão, Frota Leve OPE, Motocicleta, Outros | **Frota Leve ADM** (código `car`) |

Nomes e ids são os oficiais do cadastro; "Redespacho Belém do Pará" do
pedido é o registro "Redespacho - Belém/Pa".

**Três telas, uma fonte.** `application_links_overview` alimenta a seção
"Aplicativos habilitados" em Organização → Operações → operação, a aba
"Aplicativos" em Gestão de frota → Tipos de equipamento e as abas "Operações"
e "Tipos de equipamento" do Gerenciador do Check List. As três gravam por
`set_application_operation_link` / `set_application_vehicle_type_link`
(permissões `applications.manage_operation_links` e
`applications.manage_equipment_links`; `applications.manage_eligibility` para a
leitura consolidada) e mostram o histórico oficial de auditoria por
`application_link_history`. A aba do tipo grava na hora, não no "Salvar" do
tipo — a rotina de salvar tipo não recebe mais a lista de aplicativos.

**A regra principal (§23), numa rotina só:** `private.app_vehicle_eligible(org,
app, veículo, operação, data)` = aplicativo ativo + operação ativa e habilitada
na data + tipo habilitado na data (+ operação permitida ao tipo, quando o tipo
restringe operações) + veículo ativo e vinculado à operação na data. Contexto,
tipos, placas, formulário, envio e Aderência chamam a mesma rotina.

**Disponibilidade × aplicabilidade × obrigação** (§41, §46) são três coisas:
o vínculo diz se o tipo USA o aplicativo; as regras de aplicabilidade dizem
QUAIS perguntas cada tipo responde; a Aderência diz quem DEVIA fazer. Uma
mudança de vínculo altera a disponibilidade futura e a geração futura de
obrigações; não apaga execução, obrigação ou auditoria.

---

## 14. Mapeamento do HFC (inspeção no Lovable)

Projeto "Horizonte Fleet Command" (Lovable, workspace "Gestão de Frota |
Operações Souza Cruz"), inspecionado pelo código-fonte em 22/09/2026, sem
qualquer alteração. **Inspecionado:** `src/routes/app.checklist-frota.tsx`
(executor: início com saudação/nome/matrícula, tipo, operação, equipamento,
placa, clusters com progresso e situação, perguntas com SIM/NÃO e condicionais,
pré-resumo, sucesso), `src/routes/app.aplicativos.$appId.tsx` (gerenciador:
dados gerais, clusters com reordenação, perguntas por cluster, condicionais,
matriz de regras por equipamento/subcategoria, pré-visualização como usuário,
histórico de versões major.minor), `src/lib/checklist-frota-api.ts` (regras de
listagem: operações ativas, tipos por `equipment_type_operations`, placas por
fidelização vigente na operação e tipo), `src/components/operations/operation-form.tsx`
(vínculo operação ↔ app: um campo `app_id` na operação), `src/lib/equipment-api.ts`
(`equipment_type_apps`, `equipment_type_operations`), histórico e detalhe
(`historico-checklists.tsx`, `checklist-detail-dialog.tsx`, `checklist-detail.ts`)
e a sidebar.

**Não inspecionado:** a renderização ao vivo (telas em telefone e computador,
transições, estados visuais) — só o código e uma captura do painel; o banco do
HFC (dados e migrations SQL) — o esquema foi lido pela camada de API. Nada
disso foi inventado: onde o código não dizia, o HFM seguiu a especificação.

**Diferenças que o HFM corrige, de propósito:** o HFC lista TODAS as operações
ativas no app (o vínculo operação ↔ app não filtrava o executor) e filtra tipos
por `equipment_type_operations` sem olhar `equipment_type_apps`; no HFM as duas
autorizações são exigidas em interseção e validadas no servidor. O HFC bloqueia
o envio acima de 10 minutos; o HFM registra e não bloqueia (§39 aprovado). O HFC
resolve fidelização por nome de operação numa janela de 31 dias; o HFM usa o BR
primário vigente por id. O HFC exigia ao menos um app e uma operação para
cadastrar um tipo; no HFM o tipo nasce sem vínculo e continua válido (§20).

---

## 15. Editor administrativo (§45–§47)

Rota `/aplicativos/check-list-frota/configuracao` (botão "Configurar" na tela
do aplicativo, só para quem tem `applications.checklist_fleet.configure`). O
cabeçalho mostra a versão selecionada (`?versao=`) com a situação — Rascunho,
Publicada, Arquivada — e as ações que a situação permite: um rascunho pode ser
descartado (`create_version`) ou publicado (`publish`); uma publicada é
somente leitura e oferece "Nova versão de trabalho" ou "Abrir rascunho". As
abas seguem o gerenciador do HFC (§14), com a identidade do HFM:

| Aba | O que faz | Rotinas |
|---|---|---|
| Dados gerais | observações, tempo mínimo/máximo, KPIs da versão e a nota permanente "sem anexo" (§26) | `update_checklist_version` |
| Clusters | tabela com chave derivada, reordenação ▲▼, criar/editar/excluir com confirmação | `save/delete/reorder_checklist_cluster(s)` |
| Perguntas | agrupadas por cluster; badges "Conforme: SIM/NÃO", crítica, condicional, regras; gaveta de edição | `save/delete/reorder_checklist_question(s)` |
| Operações · Tipos de equipamento | o MESMO `ApplicationLinksPanel` de Operações e Tipos (§13): habilitar, vigência, histórico | `set_application_operation_link`, `set_application_vehicle_type_link` |
| Pré-visualização | tipo, operação, tipo de equipamento e subcategoria → `checklist_version_preview` → o próprio `ChecklistRunner` em modo prévia (sem rascunho local, sem envio) | `checklist_version_preview` |
| Histórico | versões major.minor com situação, publicação e execuções | `checklist_version_tree` |

**A gaveta da pergunta** mostra a chave técnica somente leitura; editar o
texto preserva a identidade (§47). "Nova identidade" só com chave nova, e a
recusa do servidor aparece palavra por palavra. Um condicional por pergunta,
escolha com pelo menos duas opções; regras de aplicabilidade (incluir,
excluir, orientação) só para quem tem `manage_rules`.

**Publicar** abre a validação (`validate_checklist_version`): impedimentos
bloqueiam o botão, avisos não. Publicada, a versão arquiva a anterior e vira
imutável — pela rotina e pelo gatilho. A prévia da administração e o
formulário do executor usam o mesmo construtor (`private.checklist_build_form`).

Prévia com dados fixos: `/dev/preview-configuracao` (ações em memória que
repetem as recusas do servidor).

---

## 16. Histórico e detalhe (§59–§60, §64)

**Meus checklists** (`checklist_my_executions`) lista só o que o colaborador
da sessão enviou. **Checklists do escopo** (`checklist_scope_executions`, só
com `applications.checklist_fleet.view_details`) filtra por período (mês
corrente por padrão), operação, tipo (saída/retorno) e busca por placa,
frota ou colaborador, até 200 linhas com aviso quando o limite é atingido.

**O detalhe** (`checklist_execution_detail`, `security invoker`: a RLS decide
se a execução é sua ou do seu escopo) abre numa gaveta somente leitura:
cabeçalho com colaborador, matrícula, tipo, versão e duração; operação, BR,
cidade/UF, placa, frota, líder, início e envio; os quatro KPIs; resumo por
cluster; e duas abas — "Checklist completo" (cada pergunta com SIM/NÃO,
situação Conforme/Inconforme · crítica, o valor dos condicionais por rótulo e a
observação ou "sem observação") e "Inconformidades (n)". Não há editar,
salvar, anexar nem campo de entrada: um checklist enviado não se edita (§60).

Prévia com dados fixos: `/dev/preview-historico`; fluxo de seleção completo:
`/dev/preview-checklist-fluxo`.
