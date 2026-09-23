import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Gestão de Checklist → Aderência → Minha situação (§63).
 *
 * Roda contra `/dev/preview-aderencia-minha-situacao`, a mesma tela com um
 * carregador injetado de dados fixos: setembro/2026, hoje dia 23, um
 * motorista titular de duas BRs no mês e um checklist enviado por ele numa BR
 * que não é a dele. Os totais saem dos próprios dias pela regra oficial:
 * 39 feitas em 44 devidas = 88,64%.
 *
 * A regra (quem é a pessoa, quais obrigações são dela, a fórmula e a
 * permissão) está no banco e é coberta por
 * `supabase/tests/remote/16d_adherence_own_situation.sql`. Aqui se prova a
 * apresentação: resumo com a fórmula, pendências sem chamar retorno no prazo
 * de falta, dia a dia legível no celular, estados vazios que dizem o porquê,
 * menu só com a própria situação, acessibilidade nos dois temas.
 */
const PREVIEW = "/dev/preview-aderencia-minha-situacao";
const THEME_KEY = "hfm.theme";

function collectCrashes(page: Page): string[] {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  return crashes;
}

test.describe("aderência · minha situação", () => {
  test("resumo do mês com a fórmula oficial e as duas BRs do motorista", async ({ page }) => {
    const crashes = collectCrashes(page);
    await page.goto(PREVIEW);

    await expect(page.getByRole("heading", { name: "Minha situação", level: 1 })).toBeVisible();
    await expect(page.getByText("Rafael Souza Campos")).toBeVisible();

    // Soma sobre soma: 39 feitas / 44 devidas = 88,64%.
    await expect(page.getByText("88,64%").first()).toBeVisible();
    await expect(page.getByText("39 feitas / 44 devidas · meta 90,00%")).toBeVisible();
    await expect(page.getByText("Devidas", { exact: true })).toBeVisible();
    await expect(page.getByText("Pendências de retorno", { exact: true })).toBeVisible();
    await expect(page.getByText("no prazo — não é falta")).toBeVisible();

    // Saída e retorno com denominadores próprios.
    await expect(page.getByText("20 / 23")).toBeVisible();
    await expect(page.getByText("19 / 21 · 1 no prazo")).toBeVisible();

    const positions = page.getByRole("list", { name: "BRs em que você é motorista titular" });
    await expect(positions.getByRole("listitem")).toHaveCount(2);
    await expect(positions.getByText("BR0024706")).toBeVisible();
    await expect(positions.getByText("BR0024901")).toBeVisible();
    await expect(positions.getByText(/de 19\/09\/2026 a 30\/09\/2026/)).toBeVisible();

    await expect(page.getByText(/Checklists enviados por você na competência:\s*8/).first()).toBeVisible();
    // Sem adherence.view, nenhum atalho para a Aderência da operação.
    await expect(page.getByRole("link", { name: "Aderência da operação" })).toHaveCount(0);
    expect(crashes).toEqual([]);
  });

  test("pendências: dia vigente provisório, retorno no prazo não é falta, justificativa pendente visível", async ({ page }) => {
    await page.goto(PREVIEW);
    const list = page.getByRole("list", { name: "Pendências" });
    await expect(list.getByRole("listitem")).toHaveCount(6);
    await expect(list.getByText("Não fez checklist · dia vigente")).toHaveCount(1);
    await expect(list.getByText("Retorno no prazo · sem saída registrada")).toHaveCount(1);
    await expect(list.getByText("Retorno vencido (saiu)")).toHaveCount(1);
    await expect(list.getByText("Justificativa pendente")).toHaveCount(1);
    // O prazo do retorno vem do servidor, no fuso operacional.
    await expect(list.getByText(/prazo 24\/09\/2026, 02:00/)).toBeVisible();
  });

  test("dia a dia: hoje marcado, futuro planejado, checklist de outra BR identificado", async ({ page }) => {
    await page.goto(PREVIEW);
    const days = page.getByRole("list", { name: "Dia a dia" });
    await expect(days.getByRole("listitem")).toHaveCount(31);

    const today = days.locator('li[aria-current="date"]');
    await expect(today).toHaveCount(1);
    await expect(today.getByText("Hoje")).toBeVisible();
    await expect(today.getByText("Não fez checklist · provisório")).toBeVisible();
    await expect(today.getByText("Retorno pendente")).toBeVisible();

    await expect(days.getByText("Planejado").first()).toBeVisible();
    await expect(days.getByText("Sem rota").first()).toBeVisible();
    const other = days.getByRole("listitem").filter({ hasText: "checklist enviado por você em outra BR" });
    await expect(other).toHaveCount(1);
    await expect(other.getByText("Retorno: sem obrigação")).toBeVisible();
    await expect(other.getByText("Checklist enviado por você", { exact: true })).toHaveCount(1);
  });

  test("a competência vive na URL; mês sem vínculo explica o vazio; Mês atual volta", async ({ page }) => {
    const crashes = collectCrashes(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("button", { name: "Mês atual" })).toBeDisabled();

    await page.getByRole("button", { name: "Competência anterior" }).click();
    await expect(page).toHaveURL(/ano=2026/);
    await expect(page).toHaveURL(/mes=8/);
    await expect(page.getByRole("heading", { name: "Nenhuma BR fidelizada em Agosto/2026", level: 2 })).toBeVisible();
    await expect(page.getByText(/peça à sua liderança para registrar você como motorista na Fidelização/)).toBeVisible();

    await page.getByRole("button", { name: "Mês atual" }).click();
    await expect(page).toHaveURL(/mes=9/);
    await expect(page.getByText("88,64%").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("estados vazios: conta sem colaborador, sem fidelização, só checklists enviados, erro", async ({ page }) => {
    await page.goto(`${PREVIEW}?cenario=sem-colaborador`);
    await expect(page.getByRole("heading", { name: "Sua conta não está vinculada a um colaborador", level: 2 })).toBeVisible();
    await expect(page.getByText(/vincular o seu cadastro em Colaboradores e usuários/)).toBeVisible();
    await expect(page.getByText("88,64%")).toHaveCount(0);

    await page.goto(`${PREVIEW}?cenario=sem-fidelizacao`);
    await expect(page.getByRole("heading", { name: "Nenhuma BR fidelizada em Setembro/2026", level: 2 })).toBeVisible();

    await page.goto(`${PREVIEW}?cenario=so-checklists`);
    await expect(page.getByText(/não está como motorista titular de nenhuma BR nesta competência/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Dia a dia" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("100,00%").first()).toBeVisible();

    await page.goto(`${PREVIEW}?cenario=erro`);
    await expect(page.getByRole("heading", { name: "Não foi possível carregar a sua situação.", level: 2 })).toBeVisible();
    await expect(page.getByText("Você não tem autorização para consultar a própria situação na Aderência.")).toBeVisible();
  });

  test("menu: com só adherence.view_own aparece Minha situação e não a Aderência da operação", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Minha situação" })).toHaveAttribute("href", "/checklist/aderencia/minha-situacao");
    await expect(nav.getByRole("link", { name: "Aderência", exact: true })).toHaveCount(0);

    // Com adherence.view, o atalho para a visão da operação aparece.
    await page.goto(`${PREVIEW}?operacao=1`);
    await expect(page.getByRole("link", { name: "Aderência da operação" })).toHaveAttribute("href", "/dev/preview-aderencia");
  });

  test("celular 390px: sem rolagem horizontal em nenhum estado", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const cenario of ["situacao", "sem-colaborador", "sem-fidelizacao", "erro"]) {
      await page.goto(`${PREVIEW}?cenario=${cenario}`);
      await expect(page.getByRole("heading", { name: "Minha situação", level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${cenario}: a página não pode rolar horizontalmente no celular`).toBeLessThanOrEqual(0);
    }
    // As listas cabem na largura: nenhum item passa da borda da tela.
    await page.goto(PREVIEW);
    const rights = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main li")).map((li) => li.getBoundingClientRect().right),
    );
    expect(rights.length).toBeGreaterThan(30);
    expect(Math.max(...rights)).toBeLessThanOrEqual(390);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade sem violações (${theme})`, async ({ page }) => {
      for (const cenario of ["situacao", "sem-colaborador"]) {
        await page.goto(`${PREVIEW}?cenario=${cenario}`);
        await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, theme] as const);
        await page.reload();
        await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);
        await expect(page.getByRole("heading", { name: "Minha situação", level: 1 })).toBeVisible();

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const violations = results.violations.map((v) => ({
          id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, target: v.nodes[0]?.target?.join(" "),
        }));
        expect(violations, `${cenario} (${theme}): ${JSON.stringify(violations, null, 2)}`).toEqual([]);
      }
    });
  }
});
