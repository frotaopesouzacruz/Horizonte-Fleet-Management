import { test, expect, type Page } from "@playwright/test";

/**
 * Fidelização — competência mensal contínua (Frota × BR × Local).
 *
 * A faixa da competência na Central montada (`/dev/preview-central-fidelizacao`,
 * Setembro/2026 da fixture; Outubro/2026 é o "mês corrente"), o histórico
 * consolidado de 2024 (sem BR) e 2025 (com BR), e o diálogo "Replicar
 * competência" com a rotina da fixture (`/dev/preview-central-fidelizacao/competencia`).
 */
const CENTRAL = "/dev/preview-central-fidelizacao";
const COMPETENCIA = "/dev/preview-central-fidelizacao/competencia";

const abrir = async (page: Page, url: string) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto(url);
  return crashes;
};

const faixa = (page: Page) => page.getByTestId("fidelization-competence-strip").first();
const areas = (page: Page) => page.getByRole("tablist", { name: "Áreas da Central de Fidelização" });

test.describe("Faixa da competência", () => {
  test("diz a competência, a situação, a origem, as contagens e a última atualização", async ({ page }) => {
    const crashes = await abrir(page, CENTRAL);
    const strip = faixa(page);
    await expect(strip.getByTestId("fidelization-competence-label")).toHaveText("Setembro/2026");
    await expect(strip.getByTestId("fidelization-competence-situation")).toHaveText("Encerrada");
    await expect(strip.getByTestId("fidelization-competence-origin")).toHaveText("Origem: Importação histórica");
    for (const label of ["Placas fidelizadas", "BRs", "Locais de operação", "Última atualização"]) {
      await expect(strip.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(strip).toContainText("30/09/2026 16:42");
    await expect(strip).toContainText("Ana Ribeiro");

    // O mês seguinte: criado pela rotina automática a partir de 30/09.
    await page.getByRole("button", { name: "Próxima competência" }).first().click();
    await expect(page).toHaveURL(/[?&]mes=10/);
    await expect(strip.getByTestId("fidelization-competence-label")).toHaveText("Outubro/2026");
    await expect(strip.getByTestId("fidelization-competence-situation")).toHaveText("Em andamento");
    await expect(strip.getByTestId("fidelization-competence-origin")).toHaveText("Origem: Replicação automática");
    await expect(strip.getByTestId("fidelization-competence-note")).toContainText("30/09/2026 (Setembro/2026)");
    await expect(strip).toContainText("Rotina automática");
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("cada situação tem o seu rótulo (Em andamento, Encerrada, Não criada, Histórica)", async ({ page }) => {
    const crashes = await abrir(page, COMPETENCIA);
    const situacoes = page.getByTestId("fidelization-competence-situation");
    await expect(situacoes).toHaveText(["Em andamento", "Encerrada", "Não criada", "Histórica (consulta)"]);
    await expect(page.getByTestId("fidelization-competence-note").nth(2)).toContainText(
      "Ainda não criada. A posição inicial será a vigente em 31/10/2026 (Outubro/2026)",
    );
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
});

test.describe("Competência histórica (somente consulta)", () => {
  test("2024 sem BR: Operação → Cidade → Placas, BR \"—\", e a área abre sozinha", async ({ page }) => {
    const crashes = await abrir(page, `${CENTRAL}?ano=2024&mes=3`);
    await expect(areas(page).getByRole("tab", { name: "Histórico consolidado" })).toHaveAttribute("aria-selected", "true");
    await expect(faixa(page).getByTestId("fidelization-competence-situation")).toHaveText("Histórica (consulta)");

    const history = page.getByTestId("fidelization-history");
    await expect(history).toContainText("Competência histórica — somente consulta");
    await expect(history).toContainText("não é usado para recriar vínculos atuais");
    // Os grupos: operação e, dentro dela, a cidade (sem nível de BR).
    await expect(history.locator("summary", { hasText: "Last Mille MG" })).toBeVisible();
    await expect(history.locator("summary", { hasText: "Contagem/MG" })).toBeVisible();
    await expect(history.locator("summary", { hasText: /^BR / })).toHaveCount(0);
    // Sem filtro de BR quando o mês não tem BR, e nenhuma BR inventada.
    await expect(history.getByLabel("Filtrar o histórico por BR")).toHaveCount(0);
    const brs = history.getByTestId("fidelization-history-br");
    await expect(brs.first()).toBeVisible();
    for (const text of await brs.allInnerTexts()) expect(text).toMatch(/—$/);
    await expect(page.getByTestId("fidelization-history-evolution")).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("2025 com BR: Operação → BR → Local, filtro por BR e pela BR nula", async ({ page }) => {
    const crashes = await abrir(page, `${CENTRAL}?ano=2025&mes=5`);
    const history = page.getByTestId("fidelization-history");
    await expect(history.locator("summary", { hasText: "BR BR0024901" })).toBeVisible();
    await expect(history.locator("summary", { hasText: "BR —" })).toBeVisible();
    await expect(history.getByText("Local · Belém/PA").first()).toBeVisible();

    await history.getByLabel("Filtrar o histórico por BR").selectOption("BR0024702");
    await expect(page.getByTestId("fidelization-history-totals")).toContainText("2 placa(s)");
    await expect(history.getByTestId("fidelization-history-plate")).toHaveCount(2);

    await history.getByLabel("Filtrar o histórico por BR").selectOption({ label: "Sem BR (—)" });
    await expect(history.getByTestId("fidelization-history-plate")).toHaveCount(1);
    await expect(history.getByTestId("fidelization-history-plate")).toContainText("RTG7G77");

    await history.getByLabel("Filtrar o histórico por BR").selectOption("");
    await history.getByLabel("Buscar placa ou frota no histórico").fill("qpb2");
    await expect(history.getByTestId("fidelization-history-plate")).toHaveCount(1);
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("a Visão geral continua acessível numa competência histórica", async ({ page }) => {
    await abrir(page, `${CENTRAL}?ano=2025&mes=5`);
    await areas(page).getByRole("tab", { name: "Visão geral", exact: true }).click();
    await expect(page).toHaveURL(/[?&]aba=visao-geral/);
    await expect(areas(page).getByRole("tab", { name: "Visão geral", exact: true })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Replicar competência", () => {
  test("destino já criado: origem, referência, destino, placas encontradas e só complementar", async ({ page }) => {
    const crashes = await abrir(page, COMPETENCIA);
    await page.getByRole("button", { name: "Setembro → Outubro (já criada)" }).click();
    const dialog = page.getByRole("dialog", { name: "Replicar competência" });

    const facts = dialog.getByTestId("replicate-facts");
    await expect(facts).toContainText("Competência de origemSetembro/2026");
    await expect(facts).toContainText("Data de referência30/09/2026");
    await expect(facts).toContainText("Competência de destinoOutubro/2026");
    await expect(facts).toContainText("Placas encontradas4");

    const notice = dialog.getByTestId("replicate-already-created");
    await expect(notice).toContainText(
      "A competência Outubro/2026 já foi criada em 01/10/2026 00:07 por Rotina automática (Replicação automática).",
    );
    await expect(notice).toContainText("Nenhum registro será duplicado.");

    const breakdown = dialog.getByTestId("replicate-breakdown");
    await expect(breakdown).toContainText("Novas2");
    await expect(breakdown).toContainText("Já existentes0");
    await expect(breakdown).toContainText("Conflitos1");
    await expect(breakdown).toContainText("Ignoradas1");
    await expect(dialog.getByTestId("replicate-confirm")).toHaveText("Complementar (2 placas)");
    await expect(dialog.getByTestId("replicate-confirm")).toBeEnabled();

    // Mudar o destino leva a origem junto (o mês anterior) e a prévia se refaz.
    await dialog.getByRole("button", { name: "Próxima competência" }).nth(1).click();
    await expect(facts).toContainText("Competência de origemOutubro/2026");
    await expect(facts).toContainText("Data de referência31/10/2026");
    await expect(facts).toContainText("Competência de destinoNovembro/2026");
    await expect(dialog.getByTestId("replicate-not-created")).toContainText("Novembro/2026 ainda não foi criada");
    await expect(dialog.getByTestId("replicate-confirm")).toHaveText("Replicar (4 placas)");
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("2024 e 2025 não entram na replicação", async ({ page }) => {
    await abrir(page, COMPETENCIA);
    await page.getByRole("button", { name: "Setembro → Outubro (já criada)" }).click();
    const dialog = page.getByRole("dialog", { name: "Replicar competência" });
    await dialog.getByLabel("Ano da competência").first().selectOption("2025");
    await expect(dialog).toContainText("Competências de 2024 e 2025 são históricas (somente consulta)");
    await expect(dialog.getByTestId("replicate-confirm")).toBeDisabled();
  });
});

for (const size of [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
]) {
  test(`competência e histórico sem rolagem horizontal (${size.name})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const url of [COMPETENCIA, `${CENTRAL}?ano=2024&mes=3`, `${CENTRAL}?ano=2025&mes=5`]) {
      await page.goto(url);
      await expect(faixa(page)).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow, url).toBeLessThanOrEqual(1);
    }
  });
}
