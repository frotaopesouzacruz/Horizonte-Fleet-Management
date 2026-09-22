# Aplicativos

Rota base: `/aplicativos` · Permissão de entrada: `applications.view`

**Aplicativos** é o grupo do que se **opera**, não do que se administra. A
separação não é estética: quem abre um aplicativo está em campo — saindo para
rota, conferindo pneu, fazendo vistoria — e encontrar isso no meio de telas de
cadastro custa tempo em pé, ao lado do veículo.

---

## 1. Um aplicativo é uma identidade permanente

`operational_apps` já existia desde a Etapa 07, como esqueleto: um aplicativo é
uma entidade da organização, e um tipo de equipamento pode exigi-lo
(`vehicle_type_apps`). A Etapa 12 **ampliou** essa estrutura em vez de criar uma
segunda concorrente.

O que um aplicativo carrega:

| Coluna | Para quê |
|---|---|
| `code`, `slug` | identidade técnica estável (`checklist_frota`, `check-list-frota`) |
| `name`, `description` | o que a pessoa lê |
| `platform` | `mobile_responsive`, `web` ou `mobile_native` |
| `is_official` | aplicativo do produto, não criado pelo cliente |
| `is_configurable` | tem versão e formulário editável |
| `allows_attachments` | **sempre `false` no Check List de Frota** |

`allows_attachments` existe para que um aplicativo futuro possa declarar o
contrário de forma **explícita e auditável**, nunca por omissão. O Check List de
Frota não tem anexo, e a ausência é uma decisão registrada — não um recurso que
ninguém implementou ainda.

---

## 2. A cadeia de configuração

```
Aplicativo → Versão → Cluster → Pergunta → Condicional
                                     ↓
                              Regra de aplicabilidade
```

Cada nível é uma tabela: `checklist_app_versions`, `checklist_clusters`,
`checklist_questions`, `checklist_question_conditionals`,
`checklist_question_rules`. As três últimas pendem da versão, e é por isso que
publicar congela o conjunto inteiro.

### Versionamento Major/Minor

`label` é **gerado** (`major || '.' || minor`), não digitado: "1.10" e "1.1"
seriam a mesma coisa para quem digita e coisas diferentes para quem ordena.

Uma versão publicada é **imutável**, e isso é garantido pelo banco, não pela
tela — `private.tg_checklist_version_immutable()` recusa `update` e `delete` na
versão e em todos os seus filhos. Uma regra escrita só na interface é uma regra
que o primeiro script contorna, e o que está em jogo é a comparabilidade de toda
execução já feita sob aquela versão.

A única transição permitida numa versão publicada é **arquivar**: é mudança de
ciclo de vida, não de conteúdo.

Há no máximo **um rascunho por aplicativo** (índice parcial): duas frentes de
edição concorrentes sobre o mesmo formulário produzem uma publicação que ninguém
sabe o que contém.

---

## 3. A identidade da pergunta é estável; o texto não

Cada pergunta carrega `question_key` — `luzes.freio`, `funilaria.avaria` — que
atravessa versões. Mudar o texto de "As luzes de freio estão funcionando?" não
pode tornar impossível comparar uma execução de janeiro com uma de dezembro.

O texto fica na versão. A identidade, na chave. E a resposta gravada guarda
**as duas**: `question_key` para comparar, `question_text_snapshot` para saber o
que a pessoa realmente leu ao responder.

Quando o significado muda de verdade, cadastra-se uma **chave nova** — é a forma
de dizer "esta é outra pergunta" sem apagar o histórico da anterior.

---

## 4. Aplicabilidade é vínculo, nunca texto

O HFC decidia se uma pergunta aparecia com `tipo.includes("caminh")`. Aqui a
regra aponta para o **id** do tipo de equipamento, da subcategoria ou da
operação. Renomear "Caminhão" para "Caminhão 3/4" não pode apagar a pergunta da
plataforma hidráulica.

`private.checklist_question_applies(pergunta, tipo, subcategoria, operação)`
avalia três eixos, cada um independente:

1. uma regra `exclude` que casa → **não se aplica**;
2. existindo regra `include` naquele eixo → tem de casar uma;
3. sem nenhuma regra naquele eixo → o eixo **não restringe**.

### O terceiro modo: `guidance`

A §16 pede que, em Merchandising, veículos sem câmera e sirene de ré de fábrica
sigam regra operacional aprovada. Isso é **orientação**, não restrição: a
pergunta continua valendo para todo mundo.

Daí o modo `guidance`, que carrega o texto e é ignorado pela função de
aplicabilidade — ela só lê `include` e `exclude`. A orientação fica presa à
regra e ao seu escopo, nunca solta no texto da pergunta.

---

## 5. O que não se aplica não chega ao cliente

`checklist_fleet_form` devolve a versão publicada **já filtrada** para o veículo.
O executor não recebe as 34 perguntas para esconder algumas no navegador: o que
não se aplica não chega, e por isso não há como ser contado como pendente (§24),
nem virar inconformidade, nem impedir a conclusão.

Medido na base real:

| Tipo de equipamento | Perguntas aplicáveis |
|---|---|
| Caminhão | 33 |
| Van | 32 |
| Frota Leve ADM | 30 |

---

## 6. RBAC

Nove permissões, todas no módulo `applications`:

| Código | Para quê |
|---|---|
| `applications.view` | ver os aplicativos disponíveis |
| `applications.checklist_fleet.execute` | realizar checklists |
| `applications.checklist_fleet.view_own` | ver as próprias execuções |
| `applications.checklist_fleet.view_details` | ver execuções do escopo |
| `applications.checklist_fleet.configure` | editar a versão de trabalho |
| `applications.checklist_fleet.create_version` | abrir nova versão |
| `applications.checklist_fleet.publish` | publicar versão |
| `applications.checklist_fleet.manage_rules` | definir aplicabilidade |
| `applications.checklist_fleet.view_audit` | ler a trilha de auditoria |

A matriz padrão entra por `access_profile_defaults`, e o gatilho de
sincronização da Etapa 09 as leva aos papéis reais da organização. Foi criado
exatamente para impedir o que aconteceu naquela etapa, quando 32 permissões
ficaram no catálogo e em nenhum papel, deixando módulos inteiros inalcançáveis.
Conferido após aplicar: as 9 chegaram aos papéis certos, **nenhuma órfã**.

Operacional executa e vê o que fez. Liderança enxerga o escopo. Gestor de Frota
administra o formulário — é quem conhece o equipamento. Nenhum perfil recebe
acesso por ter um nome específico.

---

## 7. Preparado para os próximos

A estrutura foi desenhada para receber Conferência de Pneus, Vistoria, MTCR e
outros **sem virar uma lista de exceções**: um aplicativo novo é uma linha em
`operational_apps` com o seu próprio conjunto de versões. As tabelas de
configuração são genéricas o bastante para servi-los, e específicas o bastante
para não virar um motor de formulários que ninguém entende.

Esta etapa implementou **apenas** o Check List de Frota.


## Consumidor do outbox: Aderência (Etapa 11)

O evento `checklist.execution.submitted` é consumido pela Aderência na própria
transação do envio (gatilho `outbox_adherence_consume`) e, como rede de
segurança, pela rotina `private.adherence_cron_tick` a cada 15 minutos. A
conciliação está descrita em `docs/modules/checklist-adherence.md`.
