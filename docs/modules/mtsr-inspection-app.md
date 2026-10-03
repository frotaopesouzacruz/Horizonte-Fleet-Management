# Aplicativos › Vistoria MTSR

Rota: `/aplicativos/vistoria-mtsr` · Menu: **Aplicativos → Vistoria MTSR** ·
Permissão de entrada: `applications.view` · Permissão para executar:
`applications.mtsr.execute`

O aplicativo de campo da Gestão de MTSR (`/seguranca/mtsr`, documentada à
parte). Quem está ao lado do veículo registra **OK** ou **NOK** em cada
componente de campo, anexa as fotos exigidas e envia. O envio recebe um
**protocolo** e vai para **validação da Segurança**: nada do que o aplicativo
envia altera o estado oficial dos componentes por conta própria.

---

## 1. Permissões

| Código | Para quê |
|---|---|
| `applications.view` | entrar no grupo Aplicativos e ver a tela do aplicativo |
| `applications.mtsr.execute` | executar a vistoria: listar frotas, enviar fotos, enviar a vistoria, ver as próprias vistorias |

O código é `applications.mtsr.execute`, e não `mtsr.inspection.submit`, por uma
regra da plataforma: **toda permissão de aplicativo depende de
`applications.view`** (Perfis & Permissões valida essa dependência). O código
está em `MTSR_PERMISSION_CODES.appExecute` (`src/lib/mtsr/types.ts`), e as
ações do servidor conferem a permissão em cada chamada — esconder o botão não é
segurança.

Quem tem só `applications.view` vê a tela com o cartão **Nova vistoria**
desabilitado e o motivo ("não foi autorizado a executar vistorias"), em vez de
um menu que leva a lugar nenhum. O mesmo cartão explica quando o aplicativo
não está cadastrado (`reason = nao_cadastrado`), está inativo (`inativo`) ou não
há componente de campo ativo.

---

## 2. Elegibilidade da frota

A lista de frotas vem da rotina `mtsr_inspection_vehicles`, já filtrada por:

- **escopo** da pessoa (as operações que ela enxerga);
- **habilitação do aplicativo** `vistoria_mtsr` em **Operações › Aplicativos
  habilitados** e em **Tipos de equipamento › Aplicativos habilitados** —
  a frota precisa estar numa operação habilitada e ser de um tipo habilitado;
- veículo ativo.

A busca por placa ou código de frota também roda na rotina (`p_search`), com
300 ms de espera depois da última tecla. O navegador **nunca** carrega a frota
inteira para filtrar localmente; a lista inicial (sem busca) é o que a rotina
devolve sem filtro.

Cada frota mostra placa, código, tipo, operação e cidade/UF, a **última
vistoria válida** com o selo de prazo (`DeadlineBadge`: Conforme / Atenção /
Vencido / Pendente), a contagem de NOK oficiais e o selo **"Vistoria pendente de
validação"** quando já existe uma vistoria desta frota aguardando a Segurança.

---

## 3. Fluxo

```
início → escolher frota → itens → revisão → envio → protocolo
                                                   ↘ Minhas vistorias → detalhe
```

**Início.** Saudação com o nome e a matrícula de quem está logado
(`context.actor`), o cartão **Nova vistoria**, o cartão **Vistoria em
andamento** quando há rascunho no aparelho (Continuar / Descartar) e a lista
**Minhas vistorias** (protocolo, placa, data, situação, NOK; toque abre o
detalhe).

**Itens.** Um cartão por componente de **campo** (`context.components`, na
ordem do catálogo): nome, descrição, selos com a regra do item, botões grandes
**OK** / **NOK** (56 px, `aria-pressed`), fotos e observação. O que o
componente exige vem do catálogo da Segurança:

| Regra do componente | Efeito na tela |
|---|---|
| `evidenceRequiredWhenOk` | foto obrigatória quando a resposta é OK |
| `evidenceRequiredWhenNok` | foto obrigatória quando a resposta é NOK |
| `observationRequiredWhenNok` | observação obrigatória quando a resposta é NOK |
| `evidence.maxPerItem` | limite de fotos por item |

Os componentes de **backoffice** (`context.backofficeComponents`: MDVR,
Câmeras/CFTV, Geotab…) aparecem num aviso fixo — **"verificados pelo
backoffice (não entram na vistoria)"** — e não têm cartão.

**Revisar** só abre quando não há pendência (item sem resposta, foto
obrigatória ausente, NOK sem observação) e nenhuma foto está a meio caminho do
envio; as pendências são listadas e o primeiro item pendente é rolado para a
tela.

**Revisão.** Placa, frota, tipo, operação, vistoriador, início; contagem de OK,
NOK e fotos; a lista dos itens com status e observação; observação geral
(opcional) e o aviso "A vistoria será enviada para validação da Segurança. O
estado oficial dos componentes só muda após a validação."

**Protocolo.** Tela de sucesso com o protocolo, itens, NOK e fotos, a frase
"A vistoria foi enviada para validação da Segurança; o estado oficial dos
componentes só muda após a validação." e os botões **Nova vistoria** / **Minhas
vistorias**.

**Detalhe de vistoria própria.** `mtsr_inspection_detail` (a rotina decide o
acesso): itens com o status registrado, o **estado oficial** do componente
(`ComponentStatusBadge`, com "aguardando revalidação" quando há manutenção
vinculada), situação da vistoria (`InspectionStatusBadge`), **motivo de
retorno ou rejeição** com quem e quando, manutenção vinculada e as fotos por
URL assinada; fotos já expurgadas aparecem como texto.

---

## 4. Idempotência e rascunho

A chave `clientSubmissionId = crypto.randomUUID()` nasce quando a pessoa
**escolhe a frota** — antes de qualquer foto ou envio — e acompanha todas as
tentativas dessa mesma vistoria. O rascunho (`draft.ts`) fica em
`localStorage`, sob a chave `hfm.mtsr.draft.<usuário>`, com a frota, o início,
as respostas, as observações e os **caminhos das fotos já enviadas** ao bucket.

- Fechar o navegador no meio não perde o trabalho: o início mostra **Vistoria
  em andamento** com Continuar / Descartar.
- Reenviar depois de uma falha de rede usa a **mesma chave**; a rotina
  `mtsr_inspection_submit` devolve o **mesmo protocolo** com `duplicate = true`
  em vez de criar uma segunda vistoria.
- O rascunho só sai do aparelho quando o servidor devolve o protocolo. A tela
  nunca diz "enviado" por causa do rascunho: enviado é o que o servidor
  confirmou.
- Iniciar uma vistoria de **outra** frota com um rascunho pendente pede
  confirmação e descarta o rascunho anterior.

---

## 5. Evidências (fotos)

Bucket **privado** `mtsr-evidence` (`src/lib/mtsr/evidence.ts`): até 10 MB por
foto, JPEG/PNG/WebP, até 6 por item — os limites vêm em `context.evidence`, e
o aplicativo os mostra ("Até 6 fotos por item…").

Caminho de cada foto (`evidence-capture.tsx`):

1. `<input type="file" accept="image/*" capture="environment" multiple>`
   (câmera; um segundo input sem `capture` abre a galeria);
2. **redução no navegador**: no máximo **1600 px** no maior lado, JPEG com
   qualidade **0,82** — poupa dados móveis de quem está em campo. Fotos já
   pequenas (≤ 600 KB) e dentro do limite vão como vieram; formatos que o
   bucket não aceita são recodificados para JPEG quando o navegador consegue
   decodificá-los;
3. validação de tipo e tamanho **antes** de pedir o envio;
4. `createEvidenceUpload({clientSubmissionId, componentId, mimeType, sizeBytes})`
   emite um **bilhete de envio** (URL assinada) para um caminho dentro da área
   de rascunho desta pessoa e deste envio
   (`<org>/inspections/drafts/<usuário>/<envio>/<componente>/<uuid>.<ext>`);
5. o cliente do navegador sobe o arquivo com
   `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType })`;
6. SHA-256 calculado no aparelho (`crypto.subtle`) e `capturedAt` do arquivo;
7. a referência `{storagePath, mimeType, sizeBytes, sha256, capturedAt}` entra
   no rascunho e vai no envio da vistoria.

Estado por foto (enviando / ok / erro com **Repetir**), miniatura local
(`URL.createObjectURL`) e **Remover** — que só tira a foto da lista: a rotina
de envio ignora objetos não referenciados, e a **retenção** parametrizada
(`evidenceRetentionInspections` / `evidenceRetentionDays` em Cadastros ›
Parâmetros) expurga depois o que não vale mais. Nenhuma URL pública: a leitura
usa URLs assinadas curtas (`loadOwnEvidenceUrls`), emitidas só depois de a
rotina de detalhe ter mostrado a evidência à pessoa.

Na prévia, o botão **Simular foto** (visível só com `preview`) gera uma imagem
no próprio navegador e a faz percorrer exatamente o mesmo caminho.

---

## 6. O que o envio NÃO faz

- **Não altera o estado oficial** de nenhum componente. A vistoria nasce
  `pendente_validacao`; só a validação pela Segurança (em Gestão de MTSR ›
  Vistorias recebidas) aplica os itens ao estado oficial, e o retorno ou a
  rejeição os descarta.
- Não abre manutenção, não vincula manutenção, não muda prazo nem
  criticidade — tudo isso é calculado nas rotinas da Gestão de MTSR a partir
  do estado oficial.
- Não grava componentes de backoffice.
- Não conclui nada por causa do rascunho local.

---

## 7. Rotinas e ações usadas

| Rotina | Ação (`src/lib/mtsr/app-actions.ts`) | Para quê |
|---|---|---|
| `mtsr_inspection_context` | `loadAppContext()` | disponibilidade do app, pessoa, componentes de campo e regras, componentes de backoffice, limites de evidência |
| `mtsr_inspection_vehicles` | `loadAppVehicles(search)` | frotas elegíveis do escopo, com prazo, NOK e pendência |
| — (storage) | `createEvidenceUpload(...)` | bilhete de envio assinado para a área de rascunho |
| `mtsr_inspection_submit` | `submitInspection(...)` | envio idempotente; devolve `MtsrSubmitResult` (protocolo, itens, NOK, fotos, `duplicate`) |
| `mtsr_my_inspections` | `loadMyInspections(limit)` | as próprias vistorias (histórico do início) |
| `mtsr_inspection_detail` | `loadOwnInspection(id)` / `loadOwnEvidenceUrls(id)` | detalhe e URLs assinadas das fotos |

Todas as ações conferem `applications.mtsr.execute` e devolvem
`Result<T> = { ok, error?, data? }`; erro de rotina vira mensagem em
português na tela (nunca JSON cru), com **Tentar novamente** onde cabe. A
`page.tsx` carrega o contexto e o histórico no servidor; perder o histórico
não derruba o aplicativo.

---

## 8. Arquivos

```
src/app/(app)/aplicativos/vistoria-mtsr/
  page.tsx               server: requireOrganization("applications.view"), canExecute, contexto, histórico
  mtsr-app.tsx           shell: início, escolher frota (busca no servidor), minhas vistorias, detalhe
  inspection-runner.tsx  itens → revisão → envio → protocolo; AppTopBar
  evidence-capture.tsx   captura, redução, upload assinado, sha256, miniaturas
  my-inspections.tsx     lista das próprias vistorias e detalhe
  draft.ts               rascunho em localStorage (useSyncExternalStore) e chave de idempotência
src/app/dev/preview-vistoria-mtsr/   prévia sem sessão (contexto fixo, loaders injetados; ?perfil=consulta)
tests/ui/mtsr-app.spec.ts            Playwright contra a prévia (390×844, axe, pageerror)
```

Mobile-first: conteúdo em `max-w-md` centralizado, botões de 44 px ou mais
(OK/NOK com 56 px), barra "Revisar" fixa no rodapé, tokens semânticos e dark
mode automático.

---

## 9. Test ids

| `data-testid` | Onde |
|---|---|
| `mtsr-app` | raiz do aplicativo |
| `mtsr-app-home` · `mtsr-app-new` · `mtsr-app-blocker` · `mtsr-app-continue` | início, botão Nova vistoria, motivo do bloqueio, rascunho em andamento |
| `mtsr-app-vehicles` · `mtsr-app-search` · `mtsr-app-vehicle` | tela de frotas, busca, cada frota |
| `mtsr-app-items` · `mtsr-app-item-<code>` · `mtsr-app-ok-<code>` · `mtsr-app-nok-<code>` | tela de itens e cada cartão/botão |
| `mtsr-app-evidence-<code>` · `mtsr-app-photo` (`data-status`) · `mtsr-app-simulate-photo-<code>` | fotos do item (a simulação só na prévia) |
| `mtsr-app-pending` · `mtsr-app-backoffice-notice` · `mtsr-app-review` | pendências, aviso do backoffice, botão Revisar |
| `mtsr-app-review-screen` · `mtsr-app-review-item-<code>` · `mtsr-app-submit` | revisão e botão Enviar |
| `mtsr-app-done` · `mtsr-app-protocol` | tela de sucesso e protocolo |
| `mtsr-app-history` · `mtsr-app-history-item` · `mtsr-app-history-screen` | lista das próprias vistorias |
| `mtsr-app-detail` · `mtsr-app-detail-reason` · `mtsr-app-detail-item` · `mtsr-app-detail-photo` | detalhe da vistoria |
