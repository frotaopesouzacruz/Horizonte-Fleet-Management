import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Aplicativos → Vistoria de Pneus.
 *
 * Roda contra `/dev/preview-vistoria-pneus`, o aplicativo inteiro com contexto
 * fixo e carregadores injetados (fixtures das rotinas `tire_inspection_*`). O
 * que se prova aqui é o que só aparece no navegador: a LEITURA CEGA (nada da
 * fotografia oficial na tela antes do envio), o diagrama de eixos derivado das
 * posições, o Nº Fogo como texto, o rascunho com a mesma chave de
 * idempotência, a revisão e o protocolo sem a comparação. A comparação, os
 * limites e a elegibilidade ficam nas rotinas do banco.
 */
const PREVIEW = "/dev/preview-vistoria-pneus";
const MOBILE = { width: 390, height: 844 };

const fixtures = JSON.parse(readFileSync(join(process.cwd(), "src/app/dev/preview-pneus/fixtures.json"), "utf8")) as Record<string, unknown>;
/** Todos os Nº Fogo da fotografia oficial presentes nos fixtures (não podem aparecer no app antes do envio). */
const officialFires = (() => {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(fixtures)) {
    if (!key.startsWith("vehicle_summary:")) continue;
    for (const t of ((value as { tires?: { fire_number: string }[] }).tires ?? [])) out.add(t.fire_number);
  }
  return [...out].filter((f) => f.length >= 4);
})();

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

async function openMeasurement(page: Page) {
  await page.goto(PREVIEW);
  await page.getByTestId("tires-app-new").click();
  await expect(page.getByTestId("tires-app-vehicle").first()).toBeVisible();
  await page.getByTestId("tires-app-vehicle").first().click();
  await expect(page.getByTestId("tires-app-diagram")).toBeVisible();
}

const draftKey = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("hfm.tires.draft."));
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { clientSubmissionId: string }).clientSubmissionId : null;
  });

test.describe("aplicativo Vistoria de Pneus", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!window.sessionStorage.getItem("__tires_init")) {
          window.sessionStorage.setItem("__tires_init", "1");
          for (const k of Object.keys(window.localStorage)) if (k.startsWith("hfm.tires.draft.")) window.localStorage.removeItem(k);
        }
      } catch {
        /* armazenamento indisponível */
      }
    });
  });

  test("tela inicial explica a leitura cega e a entrada no menu Aplicativos", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByTestId("tires-app-home")).toBeVisible();
    await expect(page.getByTestId("tires-app-blind")).toContainText(/n[ãa]o (vê|mostra)|cega/i);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Vistoria de Pneus" })).toHaveAttribute("href", "/aplicativos/vistoria-pneus");
    expect(crashes).toEqual([]);
  });

  test("quem só consulta não inicia vistoria", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=consulta`);
    await expect(page.getByTestId("tires-app-new")).toBeDisabled();
  });

  test("leitura cega: o diagrama mostra só posições — nenhum Nº Fogo, sulco ou PSI oficial", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.setViewportSize(MOBILE);
    await openMeasurement(page);
    const text = await page.locator("main").innerText();
    for (const fire of officialFires) expect(text, `Nº Fogo oficial ${fire} exposto`).not.toContain(fire);
    expect(text).not.toMatch(/esperad|oficial:\s*\d|referência:\s*\d/i);
    // O Nº Fogo é texto (teclado alfanumérico); sulco e PSI, decimal.
    await expect(page.getByTestId("tires-app-input-fire")).not.toHaveAttribute("inputmode", "numeric");
    await expect(page.getByTestId("tires-app-input-psi")).toHaveAttribute("inputmode", "decimal");
    expect(crashes).toEqual([]);
  });

  test("celular: mede, revisa e envia; o protocolo não mostra a comparação e o rascunho some", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.setViewportSize(MOBILE);
    await openMeasurement(page);
    const toForm = page.getByTestId("tires-app-to-form");
    if (await toForm.count()) await toForm.click();
    await page.getByTestId("tires-app-input-fire").fill("076225");
    await page.getByTestId("tires-app-input-t1").fill("11,5");
    await page.getByTestId("tires-app-input-t2").fill("10.2");
    await page.getByTestId("tires-app-input-t3").fill("10,3");
    await page.getByTestId("tires-app-input-t4").fill("12");
    await page.getByTestId("tires-app-input-psi").fill("110");
    // Zero à esquerda preservado: Nº Fogo nunca vira número.
    await expect(page.getByTestId("tires-app-input-fire")).toHaveValue("076225");
    await page.getByTestId("tires-app-next").click();
    const id = await draftKey(page);
    expect(id, "rascunho com chave de idempotência").toMatch(/^[0-9a-f-]{36}$/);

    await page.getByTestId("tires-app-review").click();
    await expect(page.getByTestId("tires-app-review-incomplete")).toBeVisible();
    await page.getByTestId("tires-app-submit").click();
    await expect(page.getByTestId("tires-app-done")).toBeVisible();
    await expect(page.getByTestId("tires-app-protocol")).toContainText("PNEU-2026-");
    await expect(page.getByTestId("tires-app-done")).not.toContainText(/diverg/i);
    expect(await draftKey(page)).toBeNull();
    expect(crashes).toEqual([]);
  });

  test("o rascunho sobrevive ao recarregar e mantém a mesma chave", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await openMeasurement(page);
    const toForm = page.getByTestId("tires-app-to-form");
    if (await toForm.count()) await toForm.click();
    await page.getByTestId("tires-app-input-fire").fill("ABC-12");
    await page.getByTestId("tires-app-input-psi").fill("100");
    await page.getByTestId("tires-app-next").click();
    const before = await draftKey(page);
    expect(before).not.toBeNull();
    await page.reload();
    expect(await draftKey(page)).toBe(before);
  });

  test("minhas vistorias: lista própria e detalhe com as próprias leituras", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await page.getByTestId("tires-app-open-history").click();
    await expect(page.getByTestId("tires-app-history-item").first()).toBeVisible();
    await page.getByTestId("tires-app-history-item").first().locator("button").first().click();
    await expect(page.getByTestId("tires-app-detail")).toBeVisible();
    await expect(page.getByTestId("tires-app-detail-item").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("celular 360 px: sem rolagem horizontal do início à medição", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openMeasurement(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade (${theme}): início, frotas e medição sem violações`, async ({ page }) => {
      const check = async (label: string) => {
        await page.mouse.move(0, 0);
        // deixa terminar a transição de tema (250 ms) antes de medir contraste
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      };
      await page.setViewportSize(MOBILE);
      await setTheme(page, PREVIEW, theme);
      await expect(page.getByTestId("tires-app-home")).toBeVisible();
      await check("inicio");
      await page.getByTestId("tires-app-new").click();
      await expect(page.getByTestId("tires-app-vehicle").first()).toBeVisible();
      await check("frotas");
      await page.getByTestId("tires-app-vehicle").first().click();
      await expect(page.getByTestId("tires-app-diagram")).toBeVisible();
      await check("medicao");
    });
  }
});
