import { test, expect, type Page } from "@playwright/test";

/**
 * Central de Fidelização (Etapa 15) montada: a mesma `FidelizationView` da rota
 * real, com os dados fixos de Setembro/2026 de `/dev/preview-central-fidelizacao`.
 *
 * As prévias `planner` e `areas` testam cada área sozinha. Aqui fica o que só
 * existe com elas juntas (§5): as seis áreas na ordem da leitura, a área aberta
 * guardada na URL, a competência preservada ao trocar de área e vice-versa, e
 * os filtros de uma área que não apagam a outra.
 */
const URL = "/dev/preview-central-fidelizacao";

const AREAS = [
  "Visão geral",
  "Planner de frotas",
  "Planner de motoristas",
  "Histórico de mobilizações",
  "Importação",
  "Planner de locais e BRs",
];

const abrir = async (page: Page, query = "") => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto(`${URL}${query}`);
  return crashes;
};

const areas = (page: Page) => page.getByRole("tablist", { name: "Áreas da Central de Fidelização" });
const area = (page: Page, name: string) => areas(page).getByRole("tab", { name, exact: true });
/** O painel de uma área, pelo nome — a Visão geral tem abas próprias lá dentro. */
const painelDe = (page: Page, name: string) => page.getByRole("tabpanel", { name, exact: true });

test.describe("Central de Fidelização montada", () => {
  test("as seis áreas aparecem na ordem da leitura e a Visão geral abre primeiro", async ({ page }) => {
    const crashes = await abrir(page);
    await expect(areas(page).getByRole("tab")).toHaveText(AREAS);
    await expect(area(page, "Visão geral")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Central de Fidelização", level: 1 })).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("a área aberta vai para a URL e continua aberta ao recarregar", async ({ page }) => {
    const crashes = await abrir(page);
    await area(page, "Planner de frotas").click();
    await expect(page).toHaveURL(/[?&]aba=frotas/);
    await expect(painelDe(page, "Planner de frotas")).toContainText("BR0024706");

    await page.reload();
    await expect(area(page, "Planner de frotas")).toHaveAttribute("aria-selected", "true");
    await expect(painelDe(page, "Planner de frotas")).toContainText("BR0024706");

    // Voltar à Visão geral limpa a chave, em vez de guardar o padrão.
    await area(page, "Visão geral").click();
    await expect(page).not.toHaveURL(/aba=/);
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("trocar a competência mantém a área aberta, e trocar de área mantém a competência", async ({ page }) => {
    const crashes = await abrir(page, "?aba=historico");
    await expect(area(page, "Histórico de mobilizações")).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "Próxima competência" }).click();
    await expect(page).toHaveURL(/[?&]mes=10/);
    await expect(page).toHaveURL(/[?&]aba=historico/);
    await expect(area(page, "Histórico de mobilizações")).toHaveAttribute("aria-selected", "true");

    await area(page, "Planner de motoristas").click();
    await expect(page).toHaveURL(/[?&]aba=motoristas/);
    await expect(page).toHaveURL(/[?&]mes=10/);

    await page.getByRole("button", { name: "Competência anterior" }).click();
    await expect(page).toHaveURL(/[?&]mes=9/);
    await expect(area(page, "Planner de motoristas")).toHaveAttribute("aria-selected", "true");
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("o filtro do histórico e a liderança vão para a URL e sobrevivem à troca de área", async ({ page }) => {
    const crashes = await abrir(page, "?aba=historico");
    const painel = painelDe(page, "Histórico de mobilizações");

    await painel.getByLabel("Tipo de movimentação").selectOption("vehicle_inversion");
    await expect(page).toHaveURL(/[?&]mov_tipo=vehicle_inversion/);
    await expect(page).toHaveURL(/[?&]aba=historico/);

    const lideranca = painel.getByLabel("Liderança na data");
    const primeira = await lideranca.locator("option").nth(1).getAttribute("value");
    expect(primeira).toBeTruthy();
    await lideranca.selectOption(primeira!);
    await expect(page).toHaveURL(new RegExp(`[?&]lideranca=${primeira}`));

    await area(page, "Planner de frotas").click();
    await expect(page).toHaveURL(/[?&]aba=frotas/);
    await expect(page).toHaveURL(new RegExp(`[?&]lideranca=${primeira}`));
    await expect(page).toHaveURL(/[?&]mov_tipo=vehicle_inversion/);
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("a importação lista os lotes e abre o arquivo de alocações", async ({ page }) => {
    const crashes = await abrir(page, "?aba=importacao");
    const painel = painelDe(page, "Importação");
    await expect(painel).toContainText("alocacoes-setembro-2026.xlsx");
    await painel.getByRole("button", { name: "Importar alocações" }).click();
    await expect(page.getByRole("dialog", { name: "Importar fidelização" })).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("uma aba desconhecida na URL cai na Visão geral", async ({ page }) => {
    await abrir(page, "?aba=nao-existe");
    await expect(area(page, "Visão geral")).toHaveAttribute("aria-selected", "true");
  });
});

for (const size of [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
]) {
  test(`nenhuma área rola a página na horizontal (${size.name})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const abas: [string, string][] = [
      ["", "Visão geral"],
      ["frotas", "Planner de frotas"],
      ["motoristas", "Planner de motoristas"],
      ["historico", "Histórico de mobilizações"],
      ["importacao", "Importação"],
      ["locais", "Planner de locais e BRs"],
    ];
    for (const [aba, nome] of abas) {
      await page.goto(`${URL}${aba ? `?aba=${aba}` : ""}`);
      await expect(painelDe(page, nome)).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow, `aba ${aba || "visao-geral"}`).toBeLessThanOrEqual(1);
    }
  });
}
