import { test, expect, type Page } from "@playwright/test";

/**
 * A Sidebar do HFM, exercitada na prévia pública `/dev/preview-navegacao` —
 * mesma marcação do App Shell autenticado, com todas as permissões ligadas
 * para que nenhum módulo fique escondido por RBAC durante a checagem.
 *
 * O que estes testes protegem, e por que cada um existe:
 *
 * - Os rótulos de grupo precisam caber inteiros. "GOVERNANÇA OPERACIONAL"
 *   cortado no meio deixa de ser um título. A causa real do corte não era a
 *   largura: `text-overline` era descartado pelo merge de classes e o rótulo
 *   renderizava em 16px em vez dos 11px do token. Por isso aqui se mede o
 *   tamanho da fonte *e* o transbordo — a largura sozinha voltaria a passar
 *   com a tipografia errada.
 * - Recolhida, a faixa tem 68px e a marca divide a altura da Topbar. Empilhar
 *   marca e controle nesses 56px fazia o símbolo invadir a Topbar.
 * - Sem rótulo visível, o tooltip é a única forma de saber o que cada ícone é.
 */

const NAV = "/dev/preview-navegacao";
const SIDEBAR_KEY = "hfm.sidebar.collapsed";
const GROUPS_KEY = "hfm.nav.closed";

/** Larguras de referência do produto, da estação de trabalho ao celular. */
const WIDTHS = [1920, 1600, 1440, 1366, 1280, 1024, 768, 390];

const groupButtons = (page: Page) =>
  page.getByRole("navigation", { name: "Navegação principal" }).getByRole("button");

async function openCollapsed(page: Page) {
  await page.goto(NAV);
  await page.evaluate((key) => window.localStorage.setItem(key, "1"), SIDEBAR_KEY);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.sidebar)).toBe("collapsed");
}

test.describe("sidebar", () => {
  test("mostra as quatro estruturas oficiais, na ordem, com Filiais na estrutura operacional", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(NAV);

    await expect(groupButtons(page)).toHaveText([
      "Administração",
      "Estrutura operacional",
      "Governança operacional",
      "Gestão de frota",
      "Módulos futuros",
    ]);

    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    for (const [label, href] of [
      ["Operações", "/organizacao/operacoes"],
      ["Filiais", "/estrutura/filiais"],
      ["Tipos de equipamento", "/frota/tipos-equipamento"],
      ["Lideranças", "/governanca/liderancas"],
      ["Fidelização", "/governanca/fidelizacao"],
      ["Cadastro de frotas", "/frota/cadastro"],
    ] as const) {
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  test("nenhum rótulo de grupo é cortado, em nenhuma largura de desktop", async ({ page }) => {
    for (const width of WIDTHS.filter((w) => w >= 1024)) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(NAV);

      const labels = await page.$$eval("aside nav button[aria-expanded] span", (spans) =>
        spans.map((span) => ({
          text: span.textContent?.trim() ?? "",
          overflow: span.scrollWidth - span.clientWidth,
          fontSize: getComputedStyle(span).fontSize,
        })),
      );

      expect(labels.length, `viewport ${width}px`).toBe(5);
      for (const label of labels) {
        // 11px é o token `--text-overline`. Qualquer outro valor significa que
        // a classe de tamanho se perdeu de novo no merge.
        expect(label.fontSize, `${label.text} @ ${width}px`).toBe("11px");
        expect(label.overflow, `${label.text} @ ${width}px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("expandida fica entre 240 e 260px e os itens entre 38 e 44px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(NAV);

    const width = await page.$eval("aside", (el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(240);
    expect(width).toBeLessThanOrEqual(260);

    const heights = await page.$$eval("aside nav a > span", (els) => [
      ...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height))),
    ]);
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(38);
      expect(height).toBeLessThanOrEqual(44);
    }
  });

  test("recolhida cabe na faixa: símbolo dentro da marca e nada invadindo a Topbar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCollapsed(page);

    const rail = await page.$eval("aside", (el) => el.getBoundingClientRect().width);
    expect(rail).toBeGreaterThanOrEqual(64);
    expect(rail).toBeLessThanOrEqual(76);

    const fits = await page.evaluate(() => {
      const aside = document.querySelector("aside")!;
      const header = aside.firstElementChild!;
      const mark = header.querySelector("img, [role='img']")!;
      const h = header.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      return m.top >= h.top - 0.5 && m.bottom <= h.bottom + 0.5 && m.left >= h.left - 0.5 && m.right <= h.right + 0.5;
    });
    expect(fits, "o símbolo oficial precisa caber na faixa da marca").toBe(true);

    const spilling = await page.evaluate(() => {
      const aside = document.querySelector("aside")!;
      const bounds = aside.getBoundingClientRect();
      return [...aside.querySelectorAll("img, svg, span, a, button")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.left < bounds.left - 0.5 || r.right > bounds.right + 0.5)).length;
    });
    expect(spilling, "nada pode extrapolar a faixa recolhida").toBe(0);
  });

  test("recolhida, cada ícone diz o que é por tooltip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCollapsed(page);

    await page.getByRole("link", { name: "Filiais" }).hover();
    await expect(page.getByRole("tooltip").filter({ hasText: "Filiais" })).toBeVisible();
  });

  test("recolher e expandir persiste, e o grupo fechado continua fechado", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(NAV);
    await page.evaluate(
      ([sidebar, groups]) => {
        window.localStorage.removeItem(sidebar);
        window.localStorage.removeItem(groups);
      },
      [SIDEBAR_KEY, GROUPS_KEY] as const,
    );
    await page.reload();

    await page.getByRole("button", { name: "Recolher menu" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.sidebar)).toBe("collapsed");
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.sidebar)).toBe("collapsed");

    await page.getByRole("button", { name: "Expandir menu" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.sidebar)).toBe("expanded");

    const group = groupButtons(page).nth(1);
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(groupButtons(page).nth(1)).toHaveAttribute("aria-expanded", "false");
  });

  test("abaixo de 1024px a faixa some e o menu vira drawer", async ({ page }) => {
    for (const width of WIDTHS.filter((w) => w < 1024)) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(NAV);

      await expect(page.locator("aside"), `viewport ${width}px`).toBeHidden();
      await page.getByRole("button", { name: "Abrir menu" }).click();
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Filiais" })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }
  });

  test("não há rolagem horizontal em nenhuma largura de referência", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(NAV);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `viewport ${width}px`).toBeLessThanOrEqual(1);
    }
  });
});
