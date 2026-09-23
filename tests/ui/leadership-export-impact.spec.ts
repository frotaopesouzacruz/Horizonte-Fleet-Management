import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Lideranças — exportação (Etapa 08 §20) e prévia de impacto da correção
 * histórica (Etapa 13 §14).
 *
 * Roda contra `/dev/preview-liderancas-impacto`, a mesma tela com dados fixos
 * ("hoje" = 23/09/2026) e com o carregador de impacto e a gravação injetados.
 * A rota de exportação é interceptada: o que se verifica aqui é que a tela
 * pede o arquivo com os filtros que mostra e diz o que aconteceu; o que o
 * arquivo contém e a auditoria obrigatória são cobertos pela suíte SQL 16b e
 * pela própria rota.
 */
const PREVIEW = "/dev/preview-liderancas-impacto";

type SavedInput = { effectiveFrom: string; changeReason?: string | null; id?: string | null };

/** A caixa visível dos avisos (a região `aria-live` repete o texto para leitores de tela). */
const toasts = (page: Page) => page.getByLabel("Notifications (F8)");

const saves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __leadershipSaves?: SavedInput[] }).__leadershipSaves ?? []);

async function openEdit(page: Page, city: string) {
  await page
    .getByRole("row")
    .filter({ hasText: city })
    .first()
    .getByRole("button", { name: "Editar responsabilidade" })
    .click();
  const drawer = page.getByRole("dialog", { name: "Editar responsabilidade" });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe("lideranças · exportação", () => {
  test("exporta com a competência e os filtros da tela e avisa que terminou", async ({ page }) => {
    let requested: URL | null = null;
    await page.route("**/governanca/liderancas/export?**", async (route) => {
      requested = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="liderancas-setembro-2026.csv"',
        },
        body: "Competência;Nível\nSetembro/2026;Cidade\n",
      });
    });

    await page.goto(`${PREVIEW}?operacao=op-1&situacao=active&lideranca=emp-1`);
    await page.getByRole("button", { name: "Exportar" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Texto separado (CSV)" }).click();
    expect((await download).suggestedFilename()).toBe("liderancas-setembro-2026.csv");

    expect(requested).not.toBeNull();
    const params = requested!.searchParams;
    expect(params.get("format")).toBe("csv");
    expect(params.get("ano")).toBe("2026");
    expect(params.get("mes")).toBe("9");
    expect(params.get("operacao")).toBe("op-1");
    expect(params.get("situacao")).toBe("active");
    expect(params.get("lideranca")).toBe("emp-1");

    await expect(toasts(page).getByText("Exportação concluída.")).toBeVisible();
    await expect(toasts(page).getByText(/registrada na auditoria/)).toBeVisible();
  });

  test("uma recusa da rota vira aviso com o motivo, sem sair da tela", async ({ page }) => {
    await page.route("**/governanca/liderancas/export?**", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "Não foi possível registrar a exportação na auditoria." }),
      }),
    );
    await page.goto(PREVIEW);
    await page.getByRole("button", { name: "Exportar" }).click();
    await page.getByRole("menuitem", { name: "Planilha (XLSX)" }).click();
    await expect(toasts(page).getByText("Não foi possível registrar a exportação na auditoria.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lideranças", level: 1 })).toBeVisible();
  });

  test("sessão expirada (a rota devolve a página de login) não vira arquivo", async ({ page }) => {
    await page.route("**/governanca/liderancas/export?**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>Entrar</title>" }),
    );
    await page.goto(PREVIEW);
    let downloaded = false;
    page.on("download", () => {
      downloaded = true;
    });
    await page.getByRole("button", { name: "Exportar" }).click();
    await page.getByRole("menuitem", { name: "Planilha (XLSX)" }).click();
    await expect(toasts(page).getByText("Sua sessão expirou. Entre novamente para exportar.")).toBeVisible();
    expect(downloaded).toBe(false);
  });

  test("sem leadership.export o botão não aparece", async ({ page }) => {
    await page.goto(`${PREVIEW}?sem_exportar=1`);
    await expect(page.getByRole("heading", { name: "Lideranças", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar" })).toHaveCount(0);
  });

  test("os filtros Liderança e Situação existem, com rótulo", async ({ page }) => {
    await page.goto(`${PREVIEW}?lideranca=emp-1`);
    const leader = page.getByLabel("Filtrar por liderança");
    await expect(leader).toHaveValue("emp-1");
    await expect(leader.locator("option")).toContainText(["Todas as lideranças", "Daniela Ferreira Lima (10234)"]);
    await expect(page.getByLabel("Filtrar por situação").locator("option")).toContainText([
      "Todas", "Vigentes hoje", "Ativas na competência", "Encerradas", "Canceladas",
    ]);
  });
});

test.describe("lideranças · prévia de impacto da correção histórica", () => {
  test("uma data passada mostra o impacto e só grava com motivo e confirmação", async ({ page }) => {
    await page.goto(PREVIEW);
    const drawer = await openEdit(page, "Contagem");

    await drawer.getByLabel("Início da vigência").fill("2026-01-01");
    await drawer.getByRole("button", { name: "Salvar alterações" }).click();

    const impact = drawer.getByTestId("leadership-impact");
    await expect(impact).toBeVisible();
    await expect(impact.getByText("Correção histórica", { exact: true })).toBeVisible();
    await expect(impact).toContainText("01/01/2026 a 30/06/2026");

    const totals = impact.locator("dl[aria-label='Impacto da alteração']");
    await expect(totals.locator("div").filter({ hasText: "BRs afetadas" })).toContainText("38");
    await expect(totals.locator("div").filter({ hasText: "Veículos" })).toContainText("60");
    await expect(totals.locator("div").filter({ hasText: "Motoristas" })).toContainText("0");
    await expect(totals.locator("div").filter({ hasText: "Checklists" })).toContainText("2");
    await expect(totals.locator("div").filter({ hasText: "Obrigações" })).toContainText("1.156");

    // Amostra curta com "e mais", e o antes → depois da liderança por BR.
    await expect(impact.getByText("sem liderança → Daniela Ferreira Lima", { exact: false })).toBeVisible();
    await expect(impact.getByText("e mais 36")).toBeVisible();
    await expect(impact.getByText("e mais 1.154")).toBeVisible();

    // §14: dito antes de confirmar — checklists e obrigações não são regravados.
    await expect(impact.getByText("O contexto histórico não é reescrito")).toBeVisible();
    await expect(impact.getByText(/liderança registrada: Walace Rocha de Souza/).first()).toBeVisible();

    // Nada foi gravado só por pedir a prévia.
    expect(await saves(page)).toHaveLength(0);

    const confirmButton = drawer.getByRole("button", { name: "Confirmar correção" });
    await expect(confirmButton).toBeDisabled();
    await impact.getByRole("checkbox", { name: "Revisei o impacto e confirmo a correção histórica." }).check();
    await expect(confirmButton).toBeEnabled();

    await confirmButton.click();
    await expect(drawer.getByText("Informe o motivo da correção histórica.")).toBeVisible();
    expect(await saves(page)).toHaveLength(0);

    await drawer.getByLabel("Motivo da correção").fill("Daniela assumiu Contagem em janeiro; o cadastro foi feito atrasado.");
    await confirmButton.click();

    await expect(drawer).toBeHidden();
    await expect(toasts(page).getByText("Correção histórica salva.")).toBeVisible();
    const saved = await saves(page);
    expect(saved).toHaveLength(1);
    expect(saved[0].effectiveFrom).toBe("2026-01-01");
    expect(saved[0].changeReason).toBe("Daniela assumiu Contagem em janeiro; o cadastro foi feito atrasado.");
  });

  test("mudar um campo depois da prévia descarta a prévia", async ({ page }) => {
    await page.goto(PREVIEW);
    const drawer = await openEdit(page, "Contagem");
    await drawer.getByLabel("Início da vigência").fill("2026-01-01");
    await drawer.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(drawer.getByTestId("leadership-impact")).toBeVisible();

    await drawer.getByLabel("Fim da vigência").fill("2026-12-31");
    await expect(drawer.getByTestId("leadership-impact")).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Salvar alterações" })).toBeVisible();

    // "Voltar e ajustar" também devolve o formulário sem gravar.
    await drawer.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(drawer.getByTestId("leadership-impact")).toBeVisible();
    await drawer.getByRole("button", { name: "Voltar e ajustar" }).click();
    await expect(drawer.getByTestId("leadership-impact")).toHaveCount(0);
    expect(await saves(page)).toHaveLength(0);
  });

  test("sem a permissão de correção histórica, a prévia é recusada e nada é gravado", async ({ page }) => {
    await page.goto(`${PREVIEW}?sem_historico=1`);
    const drawer = await openEdit(page, "Contagem");
    await expect(drawer.getByText(/exigem a permissão “Corrigir dados históricos da liderança”/)).toBeVisible();

    await drawer.getByLabel("Início da vigência").fill("2026-08-01");
    await drawer.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(drawer.getByRole("alert").filter({ hasText: "Corrigir dados históricos da liderança" })).toBeVisible();
    await expect(drawer.getByTestId("leadership-impact")).toHaveCount(0);
    expect(await saves(page)).toHaveLength(0);
  });

  test("uma edição que não alcança o passado grava direto, sem prévia nem motivo", async ({ page }) => {
    await page.goto(PREVIEW);
    const drawer = await openEdit(page, "Belo Horizonte");
    await drawer.getByLabel("Observações").fill("Reforço no fim do mês.");
    await drawer.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(drawer).toBeHidden();
    await expect(toasts(page).getByText("Vínculo de liderança salvo.")).toBeVisible();
    const saved = await saves(page);
    expect(saved).toHaveLength(1);
    expect(saved[0].changeReason ?? null).toBeNull();
  });
});

test.describe("lideranças · largura e tema", () => {
  for (const size of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "celular", width: 390, height: 844 },
  ]) {
    test(`sem rolagem horizontal com a prévia aberta (${size.name})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(PREVIEW);
      await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible();

      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageOverflow, `sobra de ${pageOverflow}px na largura`).toBeLessThanOrEqual(0);

      const drawer = await openEdit(page, "Contagem");
      await drawer.getByLabel("Início da vigência").fill("2026-01-01");
      await drawer.getByRole("button", { name: "Salvar alterações" }).click();
      const impact = drawer.getByTestId("leadership-impact");
      await expect(impact).toBeVisible();

      const overflow = await impact.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `prévia sobra ${overflow}px`).toBeLessThanOrEqual(0);
      const pageOverflowOpen = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageOverflowOpen).toBeLessThanOrEqual(0);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`a prévia aberta não tem violações de acessibilidade (${theme})`, async ({ page }) => {
      const crashes: string[] = [];
      page.on("pageerror", (error) => crashes.push(error.message));
      await page.goto(PREVIEW);
      await page.evaluate((value) => window.localStorage.setItem("hfm.theme", value), theme);
      await page.reload();
      await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);

      const drawer = await openEdit(page, "Contagem");
      await drawer.getByLabel("Início da vigência").fill("2026-01-01");
      await drawer.getByRole("button", { name: "Salvar alterações" }).click();
      await expect(drawer.getByTestId("leadership-impact")).toBeVisible();

      // Só a prévia: o restante da gaveta é o formulário da Etapa 08, com os
      // componentes do design system (texto auxiliar e botão primário no tema
      // escuro ficam em 4,38:1 e 4,14:1 — achado registrado, fora deste escopo).
      const results = await new AxeBuilder({ page })
        .include("[data-testid='leadership-impact']")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const violations = results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.length,
        target: v.nodes[0]?.target?.join(" "),
      }));
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
      expect(crashes, crashes.join("\n")).toEqual([]);
    });
  }
});
