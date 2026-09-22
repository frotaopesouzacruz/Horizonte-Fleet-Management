# Governança operacional · Planner de Locais e BRs

Rota: `/governanca/fidelizacao`, aba **Planner de locais e BRs** · Permissão de
entrada: `fidelization.view`

A Etapa 08 criou a posição operacional. A Etapa 13 a torna operável: cadastrar
muitas de uma vez, enxergar todas por local, saber quem responde por cada uma e
ver por quais veículos cada uma já passou — com a base histórica real carregada.

---

## 1. A regra que o módulo inteiro existe para proteger

> **O BR é a posição operacional permanente. A placa e o motorista são recursos
> temporários que passam por ela.**

Disso decorrem quatro proibições, que valem para a tela, para as rotinas e para
a importação (§13 da etapa):

* **não** criar um novo BR quando há troca de veículo;
* **não** alterar o histórico anterior;
* **não** criar um segundo cadastro de BRs;
* **não** usar placa ou código textual isolado como identidade técnica da
  posição.

A identidade é `operation_brs.id`. O código (`BR0024706`, `Frota ADM_SNO1J56`) é
texto de negócio, único apenas dentro de `(organização, operação, cidade)` — a
base real traz códigos que embutem a placa de quando foram criados, e é
exatamente por isso que o código não pode ser a identidade.

A prova está na suíte: a `BR0024706` teve **10 vínculos com 6 veículos
distintos**, e continua sendo uma linha só em `operation_brs`.

---

## 2. Competência é uma janela, nunca um cadastro

Trocar o mês **muda o que se vê** — qual veículo, qual liderança —, nunca quais
BRs existem (§22/§23). O cadastro de posições não tem competência; a ocupação
tem.

A data que representa a competência é resolvida em um lugar só,
`private.competence_anchor(year, month)`:

| Competência | Âncora | Por quê |
|---|---|---|
| mês corrente | hoje | é o estado atual |
| mês passado | último dia do mês | o retrato de como terminou |
| mês futuro | primeiro dia do mês | o que já está planejado para quando começar |

Sem essa função num lugar só, cada consulta escolheria a sua âncora e os
indicadores não fechariam com as linhas. A tela diz a data escolhida no rodapé
do planner, em vez de deixá-la subentendida.

---

## 3. Quem responde por cada BR (§42/§43)

Não existe tabela nova de "liderança por BR". O modelo de lideranças nasceu com
`scope_level in ('operation','city','br')`, então uma exceção para um BR é uma
designação de escopo `br` — com vigência, motivo e auditoria próprios.

O que faltava era a **regra de leitura**, e é `private.br_leadership_at(br, data)`:

```
1. exceção do próprio BR   (scope_level = 'br')
2. planejamento da cidade  (scope_level = 'city')
3. planejamento da operação(scope_level = 'operation')
4. ninguém
```

Só designações `principal` e `active` respondem: um substituto não assume por
omissão e uma designação cancelada nunca vigorou. A função devolve **também o
nível que respondeu**, porque "o líder é a Daniela" e "o líder é a Daniela
porque ela responde pela cidade" são informações diferentes na tela — e é o que
a coluna mostra abaixo do nome.

Estar nesta tabela **não concede nada** no HFM. O acesso continua vindo de
perfil, permissões e escopo (§12/§28 da Etapa 08).

---

## 4. A tela

### Hierarquia, não lista plana (§24)

As linhas vêm agrupadas por **operação → cidade**, em cartões recolhíveis. Um
código como `BR0024901` não diz onde fica, e é onde ele fica que decide quem
responde por ele. O cabeçalho de cada local traz a contagem de posições e, em
destaque, quantas estão sem veículo.

Cada linha traz: código, descrição, situação, liderança vigente (e de onde ela
veio), veículo atual, motorista, data de início do vínculo e as ações.

### Indicadores (§26)

Separados em dois grupos que se parecem e não são a mesma coisa:

| Cadastrais | Da competência |
|---|---|
| posições cadastradas, ativas, inativas | com veículo, sem veículo, com motorista |

Tudo contado por **existência de vínculo por BR**, nunca `count(*)` sobre os
vínculos: um BR com seis trocas de placa no mês continua sendo um BR.

### Filtros (§25)

Operação, estado e cidade ficam no **cabeçalho da página** — são o recorte de
toda a tela, valem para todas as abas. O planner acrescenta os seus: busca por
código ou descrição, liderança, situação, com/sem veículo e com/sem motorista.

A busca dispara no **Enter**, não a cada tecla: cada navegação é uma consulta ao
servidor, e digitar `BR0024901` viraria nove consultas descartadas.

A lista de lideranças do filtro vem da fonte (`leadership_assignments`), não das
linhas exibidas — derivá-la do resultado filtrado faria a lista encolher para a
própria escolha, sem como trocar de líder sem limpar o filtro antes.

---

## 5. Multicadastro de BRs (§17/§18/§58)

Uma cidade tem várias posições, e cadastrá-las uma a uma significava repetir a
seleção de operação e cidade quarenta vezes. No painel lateral o local é
escolhido **uma vez** e os códigos vêm em lista — um por linha, aceitando também
vírgula e ponto e vírgula, porque a lista quase sempre chega colada de uma
planilha.

**Nada é gravado antes da prévia.** E a prévia não é um resumo otimista: é a
mesma contagem que a gravação fará, vinda da mesma rotina
(`create_operation_brs_batch` com `p_dry_run = true`). Cada código volta
classificado:

| Resultado | Significado |
|---|---|
| `create` | entra |
| `exists` | já cadastrado neste local |
| `duplicated_in_batch` | repetido na própria lista |
| `invalid` | vazio |

A conferência de duplicata repete **exatamente** o índice
`operation_brs_code_key` — `(organização, operação, cidade, normalize_code(code))`
entre os não excluídos. Se ela divergisse, a prévia diria "entra" e a gravação
devolveria violação de unicidade.

A prévia é descartada quando a lista ou o local mudam: mostrar a anterior seria
mostrar uma promessa vencida.

A rotina **não cria** operação, cidade nem veículo (§56), e a resolução é por
id, nunca por texto.

---

## 6. Histórico de veículos da posição (§34)

O botão de histórico abre a lista de **todo veículo que já passou por aquele
BR**, com vigência, situação, origem e os motivos de entrada e de saída. Nenhuma
linha reescreve a anterior — é a prova visível da regra do §1.

Carregado **ao abrir**, não junto com a tela: 88 posições × todo o histórico
seria a consulta mais cara do módulo para responder uma pergunta que se faz uma
de cada vez.

---

## 7. A base histórica carregada

A base de fidelização do PO (`05_Fidelização_Frotas.xlsx`, aberta por dia) foi
condensada em vigências antes de entrar:

| | |
|---|---|
| Linhas diárias na origem | 24.024 |
| Vigências resultantes | 239 |
| Posições operacionais | 88 |
| Período | 01/01/2026 → 30/09/2026 |
| BRs que trocaram de placa | 53 de 88 |
| Placas que passaram por mais de um BR | 46 |
| Situação das vigências | 151 `executed` · 88 `confirmed` |
| Conflitos de ocupação no mesmo dia | **0** |

Zero conflitos significa que a base real é inteiramente compatível com as duas
EXCLUDE constraints da Etapa 08 — um BR tem um titular por intervalo, e um
veículo não é titular de dois BRs ao mesmo tempo. Nada precisou ser afrouxado
para a história caber.

Todas as 239 vigências entraram com `source = 'import'`.

### Dois ajustes que a carga tornou necessários

**Origem declarada.** `save_fidelization_assignment` gravava `source = 'manual'`
fixo. A coluna existe para distinguir de onde veio o vínculo, e 239 linhas
importadas carimbadas como "manual" tornariam a auditoria inútil justamente onde
ela mais importa. A origem passa a vir do payload, com lista branca
(`manual | import | substitution | inversion`) e com `fidelization.import`
exigida para declarar `import`.

**Veículo inativo em período passado.** A checagem exigia veículo ativo, o que
está certo para planejar: ninguém aloca hoje um veículo que saiu da frota. Mas a
base tem sete vigências do Merchandising que terminaram entre 19/06 e 02/08 com
veículos desativados depois. Recusá-las apagaria meio ano de história de sete
posições. `assert_vehicle_fidelizable` passou a olhar o período: um vínculo que
**terminou no passado** pode referenciar um veículo hoje inativo, porque ele
estava ativo enquanto durou. Um vínculo que alcança hoje ou o futuro continua
exigindo veículo ativo, e o veículo arquivado segue recusado em qualquer caso.

### O que a carga deliberadamente não fez (e como a lacuna foi fechada)

Na carga original, duas posições de Belém apareceram **sem liderança** no
planner. Não era defeito da resolução: o gestor responsável (Leandro Carvalho
Silva) não existia em `employees`, e inventar o colaborador para "completar" a
tela seria criar um cadastro fictício. A lacuna ficou visível até o PO enviar o
QLP complementar com os dois líderes já desligados; eles entraram como
colaboradores **inativos**, sem e-mail nem conta de acesso, só para que as
vigências históricas apontem para uma pessoa real
(`supabase/loads/20260922_qlp_lideres_inativos.sql`). Desde então as posições
de Belém resolvem para Leandro Carvalho Silva em qualquer competência de 2026,
e as de Divinópolis, Mariana, Montes Claros, Pouso Alegre e Varginha resolvem
para Vitor Souza Silva de janeiro a junho.

---

## 8. Organização das abas (§5)

A ordem é a ordem da leitura:

1. **Visão geral** — a hierarquia operação → cidade → BR
2. **Planner de locais e BRs** — as posições e quem responde por elas
3. **Planner de frotas** — o calendário de ocupação por veículo
4. **Planner de motoristas** — quem dirige o quê, e quando
5. **Histórico de movimentações** — tudo o que já aconteceu

Substituições e inversões são um **recorte** do histórico, não outra tabela:
separá-las escondia que a linha anterior e a que a substituiu contam a mesma
sequência. O alternador no topo da aba filtra sem trocar de tela.

---

## 9. Desempenho (§67)

Toda linha do planner vem resolvida do servidor em **uma consulta só**. Abrir 88
BRs e perguntar veículo, motorista e liderança por linha seriam 264 idas ao
banco por tela — o N+1 que a §67 proíbe. `br_planner_rows` resolve os três com
`left join lateral`, e `br_planner_indicators` faz a sua própria agregação em vez
de contar as linhas já trazidas.

---

## 10. Segurança

`br_planner_rows`, `br_planner_indicators` e `br_vehicle_history` são
**`security invoker`**: a RLS de `operation_brs` decide quais posições o chamador
vê, e um total calculado fora dela seria vazamento por agregação.

`create_operation_brs_batch` é `security definer` porque grava, e por isso
verifica explicitamente, na primeira linha, `fidelization.manage_brs` e
`private.can_access_operation`.

`private.br_leadership_at` é `security definer` com `set search_path = ''`: ela
responde sobre um BR que o chamador **já alcançou** através de uma consulta sob
RLS, e precisa enxergar a designação de liderança para responder.

Nenhuma permissão nova foi criada. As nove da §63 já têm equivalente no catálogo
central (`fidelization.view`, `.manage_brs`, `.plan`, `.change_vehicle`,
`.change_driver`, `.import`, `.export`, `.audit`); criar sinônimos só faria a
matriz mentir sobre o tamanho dela.

---

## 11. Migrations desta etapa

| Arquivo | O que faz |
|---|---|
| `…_br_planner.sql` | `br_leadership_at`, `competence_anchor`, `br_planner_rows`, `br_planner_indicators`, `br_vehicle_history`, `create_operation_brs_batch` |
| `…_fidelization_history_import.sql` | `assert_vehicle_fidelizable` ciente do período; `source` vindo do payload com lista branca |
| `…_br_planner_types_fix.sql` | `state_id smallint`, `city_id integer` — os tipos reais das colunas |
| `…_br_planner_uf_cast.sql` | `states.uf` é `character(2)`; a assinatura devolve `text` |

As duas últimas corrigem erros meus na primeira: um `returns table` com o tipo
errado só falha na **execução**, nunca na criação da função — a migration aplica
limpa e a tela quebra depois. Vale como lembrete de rodar a função, não só
aplicá-la.

---

## 12. Suíte de testes

`supabase/tests/remote/13_br_planner.sql` — 19 casos, **19/19 PASS** contra o
projeto de desenvolvimento em 21/09/2026. Transacional: termina em `raise
exception 'ROLLBACK_TESTES …'` e desfaz tudo o que fez.

Cobre a âncora de competência nas três direções, os indicadores fechando com as
linhas, a troca de placa sem troca de BR, a precedência de liderança com a
exceção do BR por cima, a prévia que não grava e entrega o número prometido, as
duplicatas dentro e fora do lote, a cidade fora da cobertura, a origem fora da
lista branca, o veículo inativo em período passado e — sem privilégio — a recusa
do multicadastro e da origem `import`.

`tests/ui/fidelization.spec.ts` — 8 casos de navegador, contra
`/dev/preview-fidelizacao`, que renderiza o mesmo componente com dados fixos
(mesmo portão do design system: ausente de um build de produção normal). A tela
real fica atrás de sessão e organização, o que a torna impossível de olhar de um
ambiente que não alcança o Supabase; a rota de prévia é o que permite verificar
o agrupamento por local, o nível de onde veio a liderança, a posição sem
veículo, o recolher/expandir, o histórico abrindo sob o código certo e a
ausência de rolagem horizontal em 390, 768 e 1440px.

Foi esse último caso que pegou um defeito real: em 390px o cabeçalho do local
não cabia numa linha e os contadores empurravam a página inteira 17px para fora.
O cabeçalho passou a quebrar linha (`flex-wrap`) e os nomes a truncar.

---

## 13. Pendências

* **Importação de fidelização pela tela** (§57–§60). A carga histórica entrou por
  rotina transacional, não pelo fluxo `import_batches` → `import_rows` →
  validar → processar, que continua por construir. Quando for: não poderá criar
  veículos, BRs nem colaboradores, e não poderá alterar Perfil de Acesso de
  ninguém.
* **Exportação do planner** (`fidelization.export`): a permissão existe, a tela
  ainda não oferece o botão.
* **Dois BRs de Belém sem liderança**, pelo gestor ausente de `employees` (§7).
* **Confirmação e execução**: os estados existem; as 239 vigências importadas
  entraram como `executed`/`confirmed` por serem fato consumado, mas para o
  planejamento novo não há ainda origem confiável de confirmação, e tudo nasce
  `planned`.
