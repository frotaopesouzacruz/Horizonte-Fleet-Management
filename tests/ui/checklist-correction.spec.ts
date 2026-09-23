import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Check List de Frota — correção administrativa de checklist enviado (§60, §62).
 *
 * Roda contra `/dev/preview-checklist-correcao`, que renderiza a lista do
 * escopo, o detalhe e a correção reais com a "rotina" em memória do
 * `fixture.ts` (as mesmas recusas e o mesmo cálculo do banco). O que se prova
 * aqui é o FLUXO e a APRESENTAÇÃO; a regra — permissão, organização, motivo,
 * identidade selada, auditoria — é do banco e está em
 * `supabase/tests/remote/16c_checklist_correction.sql`.
 *
 *  · sem a permissão, nada é editável (nem botão, nem campo);
 *  · com ela: escolher itens, motivo obrigatório, antes → depois com o resumo
 *    recalculado, confirmação, e o detalhe passa a mostrar "Corrigida" com o
 *    histórico (quem, quando, motivo, antes → depois);
 *  · a recusa do servidor chega com as mesmas palavras;
 *  · a identidade da execução aparece trancada;
 *  · nenhum caminho pede foto ou arquivo (§26);
 *  · no telefone, sem rolagem horizontal; claro e escuro sem violação de a11y.
 */
const PREVIEW = "/dev/preview-checklist-correcao";
const THEME_KEY = "hfm.theme";
const MOTIVO = "Gestor conferiu no pátio: a luz de freio esquerda estava queimada e a porta riscada.";

const drawer = (page: Page) => page.getByRole("dialog");

async function abrir(page: Page, placa: string, query = "") {
  await page.goto(`${PREVIEW}${query}`);
  await page.getByRole("button", { name: new RegExp(`^Ver checklist de ${placa}`) }).click();
  await expect(drawer(page).getByText("Check List finalizado")).toBeVisible();
}

async function abrirCorrecao(page: Page) {
  await abrir(page, "SNT8E16");
  await drawer(page).getByRole("button", { name: "Corrigir execução" }).click();
  await expect(drawer(page).getByText("Não corrigível por este procedimento")).toBeVisible();
  await expect(drawer(page).getByRole("checkbox").first()).toBeVisible();
}

function item(page: Page, pergunta: RegExp): Locator {
  return drawer(page).getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: pergunta }) });
}

async function marcarFreioEsquerdo(page: Page) {
  await drawer(page).getByRole("checkbox", { name: /luzes de freio/ }).check();
  const freio = item(page, /luzes de freio/);
  await freio.getByRole("radiogroup", { name: /Nova resposta/ }).getByRole("radio", { name: "NÃO" }).click();
  await freio.getByRole("radiogroup", { name: "Qual lado apresenta falha?" }).getByRole("radio", { name: "Esquerdo" }).click();
}

test.describe("correção administrativa do Check List de Frota", () => {
  test("sem a permissão, o detalhe não tem nada editável", async ({ page }) => {
    await abrir(page, "SNT8E16", "?sem_permissao=1");
    const d = drawer(page);
    await expect(d.getByRole("button", { name: /corrigir|editar|salvar|alterar/i })).toHaveCount(0);
    await expect(d.locator("input, textarea, select, [contenteditable='true']")).toHaveCount(0);
    await expect(d.getByText(/Um checklist enviado não pode ser editado/)).toBeVisible();
  });

  test("corrigir: itens, motivo obrigatório, antes → depois, confirmação e histórico", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));
    await abrirCorrecao(page);
    const d = drawer(page);

    // A identidade aparece, trancada: placa, data, tipo, operação, BR.
    const identidade = d.locator("section", { hasText: "Não corrigível por este procedimento" });
    await expect(identidade).toContainText("SNT8E16 · VA116");
    await expect(identidade).toContainText("Saída para rota");
    await expect(identidade).toContainText("BR0024107");
    await expect(identidade.locator("input, textarea, select, button")).toHaveCount(0);

    // Nada escolhido e sem motivo: recusado antes de ir ao servidor.
    await d.getByRole("button", { name: "Revisar correção" }).click();
    await expect(d.getByText("Escolha ao menos um item para corrigir.")).toBeVisible();
    await expect(d.getByText(/Informe o motivo da correção administrativa/).first()).toBeVisible();

    // Luz de freio: NÃO exige o lado (condicional obrigatório).
    await d.getByRole("checkbox", { name: /luzes de freio/ }).check();
    const freio = item(page, /luzes de freio/);
    await freio.getByRole("radio", { name: "NÃO" }).click();
    await expect(freio).toContainText("Passa a: Inconforme · crítica");
    await d.getByRole("button", { name: "Revisar correção" }).click();
    await expect(freio.getByText(/Preencha "Qual lado apresenta falha\?"/)).toBeVisible();
    await freio.getByRole("radio", { name: "Esquerdo" }).click();

    // A invertida: SIM é inconformidade e pede a descrição.
    await d.getByRole("checkbox", { name: /Possui alguma avaria/ }).check();
    const avaria = item(page, /Possui alguma avaria/);
    await avaria.getByRole("radio", { name: "SIM" }).click();
    await expect(avaria).toContainText("Passa a: Inconforme");
    await avaria.getByLabel(/Descreva a avaria identificada/).fill("Risco na porta traseira");
    await avaria.getByLabel(/Observação/).fill("Visto no pátio.");

    // Motivo curto é recusado.
    const motivo = d.getByLabel(/Motivo da correção/);
    await motivo.fill("curto");
    await d.getByRole("button", { name: "Revisar correção" }).click();
    await expect(d.getByText("Informe o motivo da correção administrativa (pelo menos 10 caracteres).")).toBeVisible();
    await motivo.fill(MOTIVO);
    await d.getByRole("button", { name: "Revisar correção" }).click();

    // Revisão: antes → depois e o resumo recalculado pela regra da pergunta.
    await expect(d.getByRole("heading", { name: "Revise antes de confirmar" })).toBeVisible();
    await expect(d.getByText("2 itens serão corrigidos.", { exact: false })).toBeVisible();
    const resumo = d.getByRole("definition").filter({ hasText: "Antes: 1" });
    await expect(resumo.first()).toContainText("Depois: 3");
    const revisao = d.locator("section", { hasText: "Revise antes de confirmar" });
    const linhaFreio = revisao.getByRole("listitem").filter({ hasText: /luzes de freio/ });
    await expect(linhaFreio).toContainText("Antes: SIM · Conforme");
    await expect(linhaFreio).toContainText("Depois: NÃO · Inconforme · crítica");
    await expect(linhaFreio).toContainText("Qual lado apresenta falha?");
    await expect(linhaFreio).toContainText("Depois: Esquerdo");
    const linhaAvaria = revisao.getByRole("listitem").filter({ hasText: /Possui alguma avaria/ });
    await expect(linhaAvaria).toContainText("Antes: NÃO · Conforme");
    await expect(linhaAvaria).toContainText("Depois: SIM · Inconforme");
    await expect(linhaAvaria).toContainText("Antes: sem observação");
    await expect(linhaAvaria).toContainText("Depois: Visto no pátio.");
    await expect(revisao).toContainText(MOTIVO);

    // Confirmação explícita.
    await d.getByRole("button", { name: "Confirmar correção" }).click();
    const confirmar = page.getByRole("alertdialog", { name: "Registrar a correção administrativa?" });
    await expect(confirmar).toBeVisible();
    await confirmar.getByRole("button", { name: "Registrar correção" }).click();
    await expect(confirmar).toBeHidden();

    // O detalhe volta com "Corrigida", o resumo novo e o histórico.
    await expect(d.getByText("Correção registrada (correção 1)")).toBeVisible();
    await expect(d.getByTestId("execution-corrected-badge")).toHaveText("Corrigida");
    await expect(d.getByRole("tab", { name: "Inconformidades (3)" })).toBeVisible();
    const luzes = d.locator("section", { hasText: "Resumo por cluster" }).first()
      .getByRole("listitem").filter({ hasText: "Luzes e Sinalização" });
    await expect(luzes).toContainText("2 inconformes");
    await expect(d.getByRole("row").filter({ hasText: /luzes de freio/ })).toContainText("Corrigida");

    await d.getByRole("tab", { name: "Correções (1)" }).click();
    const historico = d.getByRole("article", { name: "Correção 1" });
    await expect(historico).toContainText("Marina Costa");
    await expect(historico).toContainText(MOTIVO);
    await expect(historico).toContainText("Depois: NÃO · Inconforme · crítica");
    await expect(historico).toContainText("Depois: Risco na porta traseira");

    // Detalhe sem campo editável depois de registrar.
    await expect(d.locator("input, textarea, select, [contenteditable='true']")).toHaveCount(0);
    expect(crashes).toEqual([]);
  });

  test("a recusa do servidor aparece com as mesmas palavras e nada é gravado", async ({ page }) => {
    await abrirCorrecao(page);
    const d = drawer(page);
    await marcarFreioEsquerdo(page);
    await d.getByLabel(/Motivo da correção/).fill("Execução fora do escopo, só para testar a recusa.");
    await d.getByRole("button", { name: "Revisar correção" }).click();
    await expect(d.getByRole("alert").filter({ hasText: "A correção não foi aceita" }))
      .toContainText("Esta execução não faz parte do seu escopo de acesso.");
    await expect(d.getByRole("heading", { name: "Revise antes de confirmar" })).toHaveCount(0);

    // Cancelar volta ao detalhe, sem "Corrigida".
    await d.getByRole("button", { name: "Cancelar" }).click();
    await expect(d.getByText("Check List finalizado")).toBeVisible();
    await expect(d.getByTestId("execution-corrected-badge")).toHaveCount(0);
  });

  test("voltar e editar preserva o que foi preenchido; item sem mudança é recusado", async ({ page }) => {
    await abrirCorrecao(page);
    const d = drawer(page);

    // Marcar e não mudar nada é recusado: a trilha registra só o que mudou.
    await d.getByRole("checkbox", { name: /cabine está organizada/ }).check();
    await d.getByLabel(/Motivo da correção/).fill(MOTIVO);
    await d.getByRole("button", { name: "Revisar correção" }).click();
    await expect(item(page, /cabine está organizada/).getByText(/Nada muda nesta pergunta/)).toBeVisible();
    await d.getByRole("checkbox", { name: /cabine está organizada/ }).uncheck();

    await marcarFreioEsquerdo(page);
    await d.getByRole("button", { name: "Revisar correção" }).click();
    await expect(d.getByRole("heading", { name: "Revise antes de confirmar" })).toBeVisible();
    await d.getByRole("button", { name: "Voltar e editar" }).click();
    await expect(d.getByRole("checkbox", { name: /luzes de freio/ })).toBeChecked();
    await expect(item(page, /luzes de freio/).getByRole("radio", { name: "Esquerdo" })).toHaveAttribute("aria-checked", "true");
    await expect(d.getByLabel(/Motivo da correção/)).toHaveValue(MOTIVO);
  });

  test("execução já corrigida: Corrigida com quem, quando, motivo e antes → depois — também sem a permissão", async ({ page }) => {
    await abrir(page, "SNT1A73", "?sem_permissao=1");
    const d = drawer(page);
    await expect(d.getByTestId("execution-corrected-badge")).toHaveText("Corrigida");
    await expect(d.getByText(/1 correção administrativa · última em 23\/09\/2026 09:15 por Leandro Carvalho Silva/)).toBeVisible();
    await d.getByRole("tab", { name: "Correções (1)" }).click();
    const c1 = d.getByRole("article", { name: "Correção 1" });
    await expect(c1).toContainText("Leandro Carvalho Silva");
    await expect(c1).toContainText("23/09/2026 09:15");
    await expect(c1).toContainText("o motorista marcou a falha por engano");
    await expect(c1).toContainText("Antes: NÃO · Inconforme · crítica");
    await expect(c1).toContainText("Depois: SIM · Conforme");
    await expect(c1).toContainText("Antes: Esquerdo");
    await expect(d.getByRole("button", { name: /corrigir/i })).toHaveCount(0);
  });

  test("sem anexo: a correção não pede foto, câmera nem arquivo", async ({ page }) => {
    await abrirCorrecao(page);
    const d = drawer(page);
    for (const pergunta of [/luzes de freio/, /faróis/, /Possui alguma avaria/, /limpa externamente/]) {
      await d.getByRole("checkbox", { name: pergunta }).check();
    }
    await item(page, /luzes de freio/).getByRole("radio", { name: "NÃO" }).click();
    await item(page, /Possui alguma avaria/).getByRole("radio", { name: "SIM" }).click();
    const proibidos = await d.evaluate((root) => ({
      fileInputs: root.querySelectorAll('input[type="file"]').length,
      capture: root.querySelectorAll("[capture]").length,
      accept: root.querySelectorAll("[accept]").length,
      texto: /anexar|anexo|fotografia|tirar foto|c[âa]mera|galeria|upload/i.test((root as HTMLElement).innerText),
    }));
    expect(proibidos).toEqual({ fileInputs: 0, capture: 0, accept: 0, texto: false });
  });

  test("telefone (390px): sem rolagem horizontal e alvos de toque de 44px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirCorrecao(page);
    const d = drawer(page);
    await marcarFreioEsquerdo(page);
    await d.getByRole("checkbox", { name: /Possui alguma avaria/ }).check();
    await item(page, /Possui alguma avaria/).getByRole("radio", { name: "SIM" }).click();

    const nao = item(page, /luzes de freio/).getByRole("radio", { name: "NÃO" });
    const box = await nao.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const sobra = async () =>
      page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        const body = dialog.querySelector('[data-testid="execution-correction"]') as HTMLElement | null;
        return {
          pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          gaveta: dialog.scrollWidth - dialog.clientWidth,
          corpo: body ? body.scrollWidth - body.clientWidth : 0,
        };
      });
    expect(Math.max(...Object.values(await sobra())), "rolagem horizontal").toBeLessThanOrEqual(1);

    await item(page, /Possui alguma avaria/).getByLabel(/Descreva a avaria/).fill("Risco na porta traseira");
    await d.getByLabel(/Motivo da correção/).fill(MOTIVO);
    await d.getByRole("button", { name: "Revisar correção" }).click();
    await expect(d.getByRole("heading", { name: "Revise antes de confirmar" })).toBeVisible();
    expect(Math.max(...Object.values(await sobra())), "rolagem horizontal").toBeLessThanOrEqual(1);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade da correção e do histórico sem violações (${theme})`, async ({ page }) => {
      await page.goto(PREVIEW);
      await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, theme] as const);
      await page.reload();
      await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);

      await page.getByRole("button", { name: /^Ver checklist de SNT8E16/ }).click();
      await drawer(page).getByRole("button", { name: "Corrigir execução" }).click();
      await marcarFreioEsquerdo(page);
      // O ponteiro sai de cima dos botões: o estado de hover não é o que se audita.
      const axe = async () => {
        await page.mouse.move(0, 0);
        return new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      };
      const resumir = (r: Awaited<ReturnType<typeof axe>>) =>
        r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") }));

      expect(resumir(await axe()), `correção (${theme})`).toEqual([]);

      await drawer(page).getByLabel(/Motivo da correção/).fill(MOTIVO);
      await drawer(page).getByRole("button", { name: "Revisar correção" }).click();
      await expect(drawer(page).getByRole("heading", { name: "Revise antes de confirmar" })).toBeVisible();
      expect(resumir(await axe()), `revisão (${theme})`).toEqual([]);

      await page.keyboard.press("Escape");
      await expect(drawer(page)).toBeHidden();
      await page.getByRole("button", { name: /^Ver checklist de SNT1A73/ }).click();
      await drawer(page).getByRole("tab", { name: "Correções (1)" }).click();
      await expect(drawer(page).getByRole("article", { name: "Correção 1" })).toBeVisible();
      expect(resumir(await axe()), `histórico (${theme})`).toEqual([]);
    });
  }
});
