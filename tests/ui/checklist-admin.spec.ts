import { test, expect, type Page } from "@playwright/test";

/**
 * Check List de Frota — editor administrativo (Etapa 12, §45–§47).
 *
 * Roda contra `/dev/preview-configuracao`, que renderiza a MESMA tela com um
 * rascunho 1.1 fixo e ações em memória que repetem as recusas do banco palavra
 * por palavra. O que se prova aqui é a apresentação da regra — a regra em si
 * mora no banco e é coberta por `supabase/tests/remote/12_checklist_fleet.sql`:
 *
 *  · o editor mostra clusters e perguntas do rascunho, com a resposta conforme
 *    POR pergunta (a invertida aparece como "Conforme: NÃO");
 *  · não existe configuração de anexo, fotografia, upload ou câmera em lugar
 *    nenhum — só a nota que diz que isso não existe;
 *  · editar o texto de uma pergunta preserva a identidade técnica; a nova
 *    identidade é uma declaração explícita (§47);
 *  · a recusa do servidor é mostrada literalmente (campo de escolha com uma
 *    opção só);
 *  · publicar passa pela validação: o impedimento bloqueia, resolvido o
 *    impedimento a publicação acontece e a versão vira imutável.
 */
const PREVIEW = "/dev/preview-configuracao";

/** Texto da nota "sem anexos" — o ÚNICO lugar onde essas palavras podem aparecer. */
const NOTA_SEM_ANEXOS = /Este formulário não admite anexos: nenhuma pergunta aceita fotografia, upload de arquivo ou uso de câmera/;
const PROIBIDO = /anexo|fotografia|tirar foto|c[âa]mera|galeria|upload/i;

async function aba(page: Page, nome: string | RegExp) {
  await page.getByRole("tab", { name: nome }).click();
}

/**
 * Nenhum controle de arquivo, e nenhum texto de anexo fora da nota que
 * explica que anexo não existe.
 */
async function semAnexo(page: Page, momento: string) {
  const achado = await page.evaluate(() => {
    // A nota é ocultada só durante a leitura: `innerText` ignora o que não é
    // exibido, então o que sobra é todo o resto da tela.
    const nota = document.querySelector('[data-testid="politica-anexos"]');
    const display = nota instanceof HTMLElement ? nota.style.display : "";
    if (nota instanceof HTMLElement) nota.style.display = "none";
    const texto = document.body.innerText;
    if (nota instanceof HTMLElement) nota.style.display = display;
    return {
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      capture: document.querySelectorAll("[capture]").length,
      acceptImagem: document.querySelectorAll('[accept*="image"], [accept*="video"]').length,
      textoDeAnexo: (/anexo|fotografia|tirar foto|c[âa]mera|galeria|upload/i.exec(texto) ?? [""])[0],
    };
  });
  expect(achado.fileInputs, `${momento}: campo de arquivo encontrado`).toBe(0);
  expect(achado.capture, `${momento}: atributo capture encontrado`).toBe(0);
  expect(achado.acceptImagem, `${momento}: accept de imagem/vídeo encontrado`).toBe(0);
  expect(achado.textoDeAnexo, `${momento}: texto de anexo fora da nota`).toBe("");
}

const pergunta = (page: Page, texto: string | RegExp) =>
  page.getByRole("listitem").filter({ hasText: texto }).first();

test.describe("editor administrativo do Check List de Frota", () => {
  test("apresenta o rascunho com clusters, perguntas e a resposta conforme por pergunta", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Configuração do Check List de Frota", level: 1 })).toBeVisible();
    // O rascunho é a versão padrão quando existe.
    await expect(page.getByText("Rascunho · 1.1")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Versão" })).toHaveValue("ver-11");

    // Clusters: os três, na ordem, com a chave derivada.
    await aba(page, /^Clusters/);
    const tabela = page.getByRole("table");
    await expect(tabela.getByRole("cell", { name: "5S", exact: true })).toBeVisible();
    await expect(tabela.getByRole("cell", { name: "Funilaria", exact: true })).toBeVisible();
    await expect(tabela.getByRole("cell", { name: "Documentação", exact: true })).toBeVisible();
    await expect(tabela.getByRole("cell", { name: "funilaria", exact: true })).toBeVisible();

    // Criar um cluster: aparece na tabela com a chave derivada do nome.
    await page.getByRole("button", { name: "Novo cluster" }).click();
    await page.getByRole("dialog").getByLabel("Nome").fill("Pneus e Rodas");
    await page.getByRole("button", { name: "Criar cluster" }).click();
    await expect(tabela.getByRole("cell", { name: "Pneus e Rodas", exact: true })).toBeVisible();
    await expect(tabela.getByRole("cell", { name: "pneus_e_rodas", exact: true })).toBeVisible();

    // Perguntas: agrupadas por cluster, com identidade e conformidade por pergunta.
    await aba(page, /^Perguntas/);
    await expect(page.getByRole("heading", { name: "5S" })).toBeVisible();
    const limpeza = pergunta(page, /limpa externamente/);
    await expect(limpeza).toContainText("5s.limpeza_externa");
    await expect(limpeza).toContainText("Conforme: SIM");
    const avaria = pergunta(page, /Possui alguma avaria/);
    await expect(avaria).toContainText("Conforme: NÃO");
    await expect(avaria).toContainText("Campo condicional");
    const retrovisores = pergunta(page, /retrovisores/);
    await expect(retrovisores).toContainText("Crítica");
    await expect(retrovisores).toContainText("1 regra(s)");

    expect(crashes).toEqual([]);
  });

  test("não existe configuração de anexo, fotografia, upload ou câmera em nenhuma aba", async ({ page }) => {
    await page.goto(PREVIEW);

    // Dados gerais: a nota diz que anexo não existe — e é o único lugar com essas palavras.
    await expect(page.getByTestId("politica-anexos")).toContainText(NOTA_SEM_ANEXOS);
    await semAnexo(page, "dados gerais");

    await aba(page, /^Clusters/);
    await semAnexo(page, "clusters");

    // A gaveta da pergunta, com condicional e aplicabilidade abertas.
    await aba(page, /^Perguntas/);
    await page.getByRole("button", { name: /^Editar: Possui alguma avaria/ }).click();
    await expect(page.getByRole("heading", { name: "Campo condicional" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aplicabilidade" })).toBeVisible();
    await semAnexo(page, "gaveta da pergunta");
    await page.getByRole("button", { name: "Concluir" }).click();

    await aba(page, /^Operações/);
    await semAnexo(page, "operações");
    await aba(page, /^Tipos de equipamento/);
    await semAnexo(page, "tipos de equipamento");

    // A prévia usa o mesmo executor do motorista.
    await aba(page, /^Pré-visualização/);
    await page.getByRole("combobox", { name: "Operação" }).selectOption({ label: "Last Mille MG" });
    await page.getByRole("button", { name: "Gerar prévia" }).click();
    await expect(page.getByTestId("previa-executor")).toBeVisible();
    await semAnexo(page, "pré-visualização");

    await aba(page, /^Histórico/);
    await semAnexo(page, "histórico");

    // Sobrou só a nota — e ela contém as palavras porque é ela que as proíbe.
    await aba(page, /^Dados gerais/);
    expect(PROIBIDO.test(await page.getByTestId("politica-anexos").innerText())).toBe(true);
  });

  test("editar o texto preserva a identidade técnica; a nova identidade é declarada (§47)", async ({ page }) => {
    await page.goto(PREVIEW);
    await aba(page, /^Perguntas/);

    // 1. Editar o texto: a chave continua a mesma.
    await page.getByRole("button", { name: /^Editar: A frota está limpa externamente/ }).click();
    const gaveta = page.getByRole("dialog");
    await expect(gaveta.getByLabel("Identidade atual")).toHaveValue("5s.limpeza_externa");
    await gaveta.getByLabel("Texto da pergunta").fill("A frota está limpa externamente, sem lama ou poeira acumulada?");
    await gaveta.getByRole("button", { name: "Salvar pergunta" }).click();
    await expect(page.getByText("Pergunta salva.", { exact: true })).toBeVisible();
    await gaveta.getByRole("button", { name: "Concluir" }).click();

    const limpeza = pergunta(page, /sem lama ou poeira/);
    await expect(limpeza).toBeVisible();
    await expect(limpeza).toContainText("5s.limpeza_externa");

    // 2. Nova identidade: só com a declaração explícita, e nunca igual à atual.
    await page.getByRole("button", { name: /^Editar: A frota está limpa externamente/ }).click();
    await gaveta.getByRole("checkbox", { name: /Nova identidade/ }).click();
    const novaChave = gaveta.getByLabel("Nova identidade técnica");
    await novaChave.fill("5s.limpeza_externa");
    await gaveta.getByRole("button", { name: "Salvar pergunta" }).click();
    // A recusa do servidor, literalmente.
    await expect(gaveta.getByText("Informe a nova identidade técnica da pergunta, diferente da atual (5s.limpeza_externa).")).toBeVisible();

    await novaChave.fill("5s.limpeza_geral");
    await gaveta.getByRole("button", { name: "Salvar pergunta" }).click();
    await expect(gaveta.getByLabel("Identidade atual")).toHaveValue("5s.limpeza_geral");
    await gaveta.getByRole("button", { name: "Concluir" }).click();
    await expect(pergunta(page, /sem lama ou poeira/)).toContainText("5s.limpeza_geral");
  });

  test("o campo condicional de escolha recusa uma opção só, com a mensagem do servidor", async ({ page }) => {
    await page.goto(PREVIEW);
    await aba(page, /^Perguntas/);
    await page.getByRole("button", { name: /^Editar: O interior está organizado/ }).click();
    const gaveta = page.getByRole("dialog");

    await gaveta.getByLabel("Tipo de campo").selectOption("single_select");
    await gaveta.getByLabel("Rótulo do campo").fill("Onde está a desorganização?");
    await gaveta.getByLabel("Opções").fill("Baú");
    await gaveta.getByRole("button", { name: "Adicionar campo" }).click();
    await expect(gaveta.getByText("Um campo de escolha precisa de pelo menos duas opções.")).toBeVisible();

    await gaveta.getByLabel("Opções").fill("Baú, Cabine");
    await gaveta.getByRole("button", { name: "Adicionar campo" }).click();
    await expect(page.getByText("Campo condicional salvo.", { exact: true })).toBeVisible();
    await expect(gaveta.getByText("Campo onde_esta_a_desorganizacao")).toBeVisible();
    await gaveta.getByRole("button", { name: "Concluir" }).click();
    await expect(pergunta(page, /interior está organizado/)).toContainText("Campo condicional");
  });

  test("publicar: a validação lista o impedimento; resolvido, publica e a versão vira imutável", async ({ page }) => {
    await page.goto(PREVIEW);

    // O cluster vazio impede a publicação — e o botão fica bloqueado.
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText('O cluster "Documentação" não possui pergunta ativa.')).toBeVisible();
    await expect(dialogo.getByRole("button", { name: "Publicar versão 1.1" })).toBeDisabled();
    await dialogo.getByRole("button", { name: "Cancelar" }).click();

    // Resolve: exclui o cluster vazio (com confirmação).
    await aba(page, /^Clusters/);
    await page.getByRole("button", { name: "Excluir Documentação" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByRole("table").getByRole("cell", { name: "Documentação", exact: true })).toHaveCount(0);

    // Agora a validação libera; os avisos aparecem sem bloquear.
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(dialogo.getByText("Nenhum impedimento: a versão pode ser publicada.")).toBeVisible();
    await dialogo.getByRole("button", { name: "Publicar versão 1.1" }).click();

    await expect(page.getByText("Versão 1.1 publicada. A versão 1.0 foi arquivada.", { exact: true })).toBeVisible();
    await expect(page.getByText("Publicada · 1.1")).toBeVisible();
    // Imutável: banner de somente leitura, e o caminho é uma nova versão de trabalho.
    await expect(page.getByText("Versão 1.1 publicada — somente leitura")).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova versão de trabalho" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar", exact: true })).toHaveCount(0);

    // O histórico registra a troca.
    await aba(page, /^Histórico/);
    const linhas = page.getByRole("table").getByRole("row");
    await expect(linhas.filter({ hasText: "1.1" }).first()).toContainText("Publicada");
    await expect(linhas.filter({ hasText: "1.0" }).first()).toContainText("Arquivada");
  });

  test("celular: o editor não rola horizontalmente", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PREVIEW);
    await aba(page, /^Perguntas/);
    await expect(pergunta(page, /limpa externamente/)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px`).toBeLessThanOrEqual(1);
  });
});
