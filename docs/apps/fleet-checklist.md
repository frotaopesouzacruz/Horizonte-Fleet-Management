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

```
INÍCIO → TIPO (saída/retorno) → OPERAÇÃO → VEÍCULO
      → tipo de equipamento resolvido automaticamente
      → CLUSTERS → REVISÃO → ENVIO → CONFIRMAÇÃO
```

**Quem executa vem da sessão** (§31). A matrícula nunca vem do payload: deixar o
cliente informar `employee_id` permitiria fazer checklist no nome de outra pessoa
com uma requisição alterada.

**O tipo de equipamento é resolvido**, não escolhido: o Cadastro de Frotas já
sabe. O motorista não deve responder o que o sistema já tem.

**O veículo previsto pela fidelização vem marcado e primeiro** — mas não é o
único selecionável. Planejamento incompleto não pode impedir um checklist
legítimo (§33); nesse caso o BR fica nulo e a execução segue para conciliação.

**SIM e NÃO são dois botões de 56px**, acima do mínimo de 44px do design system.
Errar o botão aqui significa registrar uma inconformidade que não existe.

**O rascunho fica no aparelho** (§40), gravado a cada alteração. Mas a tela
nunca diz "enviado" por causa disso: enviado é o que o servidor confirmou, e o
rascunho só é apagado depois dessa confirmação.

---

## 7. O envio

Uma transação grava cabeçalho, respostas, resumo por cluster e o evento de
conciliação. Se qualquer parte falhar, nenhuma existe — é o que impede um
checklist "concluído" sem respostas.

### Idempotência

A chave nasce **no cliente, antes do envio**, e acompanha todas as tentativas.
Duplo toque, retry e queda de rede reenviam a mesma chave, e o índice único a
transforma na devolução do primeiro resultado em vez de um segundo checklist.

### Validação no servidor

* perguntas obrigatórias aplicáveis, todas respondidas;
* campos condicionais obrigatórios, preenchidos quando acionados;
* tempo mínimo configurável (60 s por padrão) — abaixo dele o envio é recusado.

O **máximo** (600 s) é registrado, não recusado: rejeitar um checklist lento
destruiria o trabalho de quem foi interrompido no meio.

### O contexto é congelado

A execução guarda placa, código de frota, tipo de equipamento, BR, cidade e
liderança **como estavam no dia** — não como estão hoje. Substituir o veículo de
um BR não pode reescrever o que foi inspecionado em março (§34).

### Selagem

Um checklist enviado não se edita. O banco recusa alteração de execução e de
respostas enviadas; a correção administrativa terá rotina própria, autorizada e
auditável, que abrirá o portão `hfm.checklist_correction`.

---

## 8. Integração com a Aderência — o que existe e o que falta

**Estado real: o lado produtor está pronto e testado. O lado consumidor depende
da Etapa 11, que não existe.**

Não há no banco nenhuma tabela de obrigação, jornada ou aderência. O Motor de
Aderência é a Etapa 11, com especificação própria de 75 seções, e não foi
construído — inventá-lo aqui produziria um motor que a etapa correta teria de
desfazer.

O que **está** entregue:

* `outbox_events` recebe, **na mesma transação da execução**, um evento
  `checklist.execution.submitted` com todo o contexto que a conciliação precisa:
  organização, veículo, placa, operação, BR, colaborador, tipo (saída/retorno),
  data operacional, versão, e as contagens de conformidade;
* o evento carrega `execution_valid: true` — §58: **aderência é realização,
  conformidade é resultado**. Um checklist com inconformidades é um checklist
  realizado;
* o evento fica `pending` até alguém consumi-lo. Nada se perde, e o motorista
  não refaz o que já enviou.

O que **falta**, e depende da Etapa 11:

* localizar a obrigação correspondente e conciliá-la;
* garantir que a saída satisfaça só a obrigação de saída, e o retorno só a de
  retorno;
* tratar execução sem obrigação compatível;
* atualizar os indicadores.

Por isso os critérios **CA22 a CA25 estão parcialmente atendidos**: o produtor
existe, está testado e emite o contrato completo; o consumidor não.

---

## 9. Segurança

| | |
|---|---|
| Identidade | resolvida da sessão, nunca do payload |
| Escopo de operação | `private.can_access_operation` no envio |
| Escopo de veículo | `private.vehicle_in_scope` no envio |
| Multi-tenant | RLS em todas as tabelas; nenhuma policy de escrita |
| Escrita | só por rotina transacional `security definer` |
| Leitura | rotinas `security invoker` — a RLS decide |
| Auditoria | versão, pergunta, condicional, regra e execução |

O operacional vê o que fez — comparado pelo colaborador da sessão. Quem tem
`view_details` vê o escopo operacional autorizado. Ninguém atravessa organização.

---

## 10. Validação executada

**`supabase/tests/remote/12_checklist_fleet.sql` — 15/15 PASS** contra o projeto
de desenvolvimento em 22/09/2026. Transacional: termina em `ROLLBACK_TESTES` e
desfaz tudo.

Cobre aplicabilidade nos três tipos de equipamento, orientação que orienta sem
restringir, envio válido, conformidade das invertidas e das positivas,
idempotência, evento no outbox, recusa de envio incompleto, recusa de condicional
vazio, tempo mínimo, imutabilidade da versão publicada e ausência de coluna de
anexo.

**`tests/ui/checklist.spec.ts` — 8/8 PASS**, contra `/dev/preview-checklist`.
Cobre a pergunta invertida na tela, o condicional de texto exigido e descartado
ao trocar a resposta, escolha única bloqueando e múltipla aceitando vários, o
destaque do item crítico, a orientação operacional, a **ausência total de
anexo/câmera/upload**, o alvo de toque de 56px e a ausência de rolagem horizontal
em 390px.

Suíte de navegador completa: **60 passaram, 8 puladas** (exigem credenciais),
zero regressões.

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

---

## 12. Pendências reais

* **Editor administrativo** (§45, CA16): a estrutura de versionamento está
  pronta e imutável, e as permissões existem — a tela de edição ainda não.
  Hoje a configuração se altera por migration.
* **Detalhe da execução no histórico** (§60): a rotina
  `checklist_execution_detail` existe e devolve tudo; a tela mostra a lista, não
  o detalhe aberto.
* **Conciliação com a Aderência**: depende da Etapa 11 (§8 deste documento).
* **Plano de Ação** (§61): `generates_action_plan` está preservado em todas as
  34 perguntas e a consulta por inconformidade tem índice próprio. O módulo em si
  não existe no HFM e não foi criado aqui.
