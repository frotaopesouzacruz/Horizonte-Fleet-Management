import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Aplicativos → Vistoria MTSR.
 *
 * Roda contra `/dev/preview-vistoria-mtsr`, o aplicativo inteiro com contexto
 * fixo e carregadores injetados. O que se prova aqui é o que só aparece no
 * navegador: os bloqueios de envio (item sem resposta, NOK sem observação, OK
 * sem a foto obrigatória), a foto percorrendo o caminho do upload, a revisão,
 * o protocolo e o rascunho que sobrevive ao recarregar com a mesma chave de
 * idempotência. As regras (elegibilidade, validação, estado oficial) ficam nas
 * rotinas `mtsr_*` do banco.
 */
const PREVIEW = "/dev/preview-vistoria-mtsr";
const MOBILE = { width: 390, height: 844 };

function crashesOf(page: Page) {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  return crashes;
}

async function setTheme(page: Page, url: string, theme: "light" | "dark") {
  const response = await page.goto(url);
  expect(response?.status(), `${url} must be reachable in this build`).toBe(200);
  await page.evaluate((t) => window.localStorage.setItem("hfm.theme", t), theme);
  await page.reload();
  await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);
}

/** Início → Nova vistoria → primeira frota → itens. */
async function abrirItens(page: Page) {
  await page.goto(PREVIEW);
  await page.getByTestId("mtsr-app-new").click();
  await expect(page.getByTestId("mtsr-app-vehicle")).toHaveCount(3);
  await page.getByTestId("mtsr-app-vehicle").first().click();
  await expect(page.getByTestId("mtsr-app-items")).toBeVisible();
}

/** A chave de idempotência do rascunho guardado no aparelho. */
const draftKey = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("hfm.mtsr.draft."));
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { clientSubmissionId: string }).clientSubmissionId : null;
  });

test.describe("aplicativo Vistoria MTSR", () => {
  test("a entrada no menu Aplicativos e a tela inicial", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Vistoria MTSR", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Vistoria MTSR" })).toHaveAttribute("href", "/aplicativos/vistoria-mtsr");

    const home = page.getByTestId("mtsr-app-home");
    await expect(page.getByTestId("mtsr-app")).toBeVisible();
    await expect(home).toContainText("Vistoriador de Teste");
    await expect(page.getByTestId("mtsr-app-new")).toBeEnabled();
    await expect(page.getByTestId("mtsr-app-history").getByTestId("mtsr-app-history-item")).toHaveCount(3);
    await expect(page.getByTestId("mtsr-app-history")).toContainText("Pendente de validação");
    expect(crashes).toEqual([]);
  });

  test("quem só consulta vê Nova vistoria desabilitada, com o motivo", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=consulta`);
    await expect(page.getByTestId("mtsr-app-new")).toBeDisabled();
    await expect(page.getByTestId("mtsr-app-blocker")).toContainText("applications.mtsr.execute");
  });

  test("escolha da frota: lista inicial, busca no servidor, prazo e pendência", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await page.getByTestId("mtsr-app-new").click();
    const vehicles = page.getByTestId("mtsr-app-vehicle");
    await expect(vehicles).toHaveCount(3);
    await expect(vehicles.filter({ hasText: "ABC1D23" })).toContainText("Conforme");
    await expect(vehicles.filter({ hasText: "DEF4G56" })).toContainText("Atenção");
    await expect(vehicles.filter({ hasText: "DEF4G56" })).toContainText("Vistoria pendente de validação");
    await expect(vehicles.filter({ hasText: "HIJ7K89" })).toContainText("Vencido");

    await page.getByTestId("mtsr-app-search").fill("0150");
    await expect(vehicles).toHaveCount(1);
    await expect(vehicles.first()).toContainText("DEF4G56");

    await page.getByTestId("mtsr-app-search").fill("ZZZ");
    await expect(page.getByText("Nenhuma frota encontrada")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("celular: itens, bloqueios de envio, foto simulada, revisão e protocolo", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    const crashes = crashesOf(page);
    await abrirItens(page);

    // Os quatro componentes de campo, na ordem; os de backoffice só no aviso.
    const items = page.locator('[data-testid^="mtsr-app-item-"]');
    await expect(items).toHaveCount(4);
    await expect(items.first()).toContainText("Teclado Macro");
    await expect(page.getByTestId("mtsr-app-backoffice-notice")).toContainText("MDVR, Câmeras (CFTV), Geotab");

    // Alvo de toque de OK e NOK: 44 px é o mínimo; aqui é maior de propósito.
    for (const id of ["mtsr-app-ok-teclado_macro", "mtsr-app-nok-teclado_macro"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} sem caixa`).not.toBeNull();
      expect(box!.height, `${id} tem ${box!.height}px`).toBeGreaterThanOrEqual(44);
    }

    // Nada respondido: revisar bloqueia e aponta os quatro.
    await page.getByTestId("mtsr-app-review").click();
    await expect(page.getByTestId("mtsr-app-pending")).toContainText("4 itens pendentes");
    await expect(page.getByTestId("mtsr-app-review-screen")).toHaveCount(0);

    await page.getByTestId("mtsr-app-ok-teclado_macro").click();
    await page.getByTestId("mtsr-app-nok-travas_bau_lateral").click();
    await page.getByTestId("mtsr-app-ok-travas_bau_traseiro").click();
    await page.getByTestId("mtsr-app-ok-sirene").click();
    await expect(page.getByTestId("mtsr-app-ok-teclado_macro")).toHaveAttribute("aria-pressed", "true");

    // OK sem a foto obrigatória e NOK sem observação continuam bloqueando.
    await page.getByTestId("mtsr-app-review").click();
    await expect(page.getByTestId("mtsr-app-pending")).toContainText("2 itens pendentes");
    const teclado = page.getByTestId("mtsr-app-item-teclado_macro");
    const lateral = page.getByTestId("mtsr-app-item-travas_bau_lateral");
    await expect(teclado).toContainText("Adicione ao menos uma foto");
    await expect(lateral).toContainText("Descreva o problema encontrado");

    // NOK: observação + foto (obrigatória em NOK para as travas).
    await lateral.getByLabel(/Observação/).fill("Trava lateral esquerda não aciona pelo sistema.");
    await lateral.getByTestId("mtsr-app-simulate-photo-travas_bau_lateral").click();
    await expect(lateral.getByTestId("mtsr-app-photo")).toHaveAttribute("data-status", "ok");

    await page.getByTestId("mtsr-app-review").click();
    await expect(page.getByTestId("mtsr-app-pending")).toContainText("1 item pendente");

    await teclado.getByTestId("mtsr-app-simulate-photo-teclado_macro").click();
    await expect(teclado.getByTestId("mtsr-app-photo")).toHaveAttribute("data-status", "ok");

    // Agora a revisão abre, com o resumo e o aviso de validação.
    await page.getByTestId("mtsr-app-review").click();
    const review = page.getByTestId("mtsr-app-review-screen");
    await expect(review).toBeVisible();
    await expect(review).toContainText("validação da Segurança");
    await expect(review.getByTestId("mtsr-app-review-item-travas_bau_lateral")).toContainText("NOK");
    await expect(review.getByTestId("mtsr-app-review-item-teclado_macro")).toContainText("1 foto");

    const key = await draftKey(page);
    expect(key).toBeTruthy();

    await page.getByTestId("mtsr-app-submit").click();
    await expect(page.getByTestId("mtsr-app-protocol")).toHaveText("MTSR-2026-000123");
    await expect(page.getByTestId("mtsr-app-done")).toContainText("o estado oficial dos componentes só muda após a validação");
    // Com o protocolo em mãos, o rascunho sai do aparelho.
    expect(await draftKey(page)).toBeNull();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `sobra de ${overflow}px`).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Nova vistoria" }).click();
    await expect(page.getByTestId("mtsr-app-vehicles")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("o rascunho sobrevive ao recarregar e mantém a mesma chave de idempotência", async ({ page }) => {
    await abrirItens(page);
    await page.getByTestId("mtsr-app-ok-sirene").click();
    const before = await draftKey(page);
    expect(before).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("mtsr-app-continue")).toContainText("ABC1D23");
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByTestId("mtsr-app-ok-sirene")).toHaveAttribute("aria-pressed", "true");
    expect(await draftKey(page)).toBe(before);
  });

  test("detalhe da vistoria própria: situação, motivo do retorno, estado oficial e fotos", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await page.getByTestId("mtsr-app-history-item").filter({ hasText: "MTSR-2026-000121" }).click();
    const detail = page.getByTestId("mtsr-app-detail");
    await expect(detail).toContainText("Retornada");
    await expect(page.getByTestId("mtsr-app-detail-reason")).toContainText("ilegível");
    await expect(detail.getByTestId("mtsr-app-detail-item")).toHaveCount(4);
    await expect(detail.getByTestId("mtsr-app-detail-item").filter({ hasText: "Travas do Baú Lateral" })).toContainText("aguardando revalidação");
    await expect(detail.getByRole("img", { name: "Foto 1 de Teclado Macro" })).toBeVisible();
    await expect(detail).toContainText("Foto expurgada pela retenção");
    expect(crashes).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade (${theme}): início, frotas e itens sem violações`, async ({ page }) => {
      await setTheme(page, PREVIEW, theme);
      await expect(page.getByRole("heading", { name: "Vistoria MTSR", level: 1 })).toBeVisible();
      const check = async (label: string) => {
        // O ponteiro fica sobre o último botão clicado; afastá-lo avalia o estado de repouso, não o hover.
        await page.mouse.move(0, 0);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
      };
      await check("inicio");

      await page.getByTestId("mtsr-app-new").click();
      await expect(page.getByTestId("mtsr-app-vehicle")).toHaveCount(3);
      await check("frotas");

      await page.getByTestId("mtsr-app-vehicle").first().click();
      await expect(page.getByTestId("mtsr-app-items")).toBeVisible();
      await page.getByTestId("mtsr-app-nok-travas_bau_lateral").click();
      await page.getByTestId("mtsr-app-review").click();
      await expect(page.getByTestId("mtsr-app-pending")).toBeVisible();
      await check("itens");
    });
  }
});
