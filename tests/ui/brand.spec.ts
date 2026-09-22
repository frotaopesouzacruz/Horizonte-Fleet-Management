import { test, expect } from "@playwright/test";

/**
 * A marca no topo do menu e o ícone da aba.
 *
 * Duas regressões reais que estes testes seguram:
 *
 *  · o nome do produto CORTADO. A faixa tinha 256px e "Horizonte Fleet
 *    Management" precisa de 182px ao lado do símbolo — sobravam 163px, e o
 *    `truncate` transformava o título em "Horizonte Fleet Manag…". Cortar o
 *    nome do sistema no lugar mais visível da tela não é um detalhe de
 *    espaçamento.
 *
 *  · o ícone da aba OPACO. Antes ele era a marca sobre um quadrado azul; o
 *    pedido é transparência, e transparência só funciona com as DUAS variantes
 *    oficiais declaradas por `prefers-color-scheme` — uma sozinha some em
 *    metade das barras de abas.
 */
const NAV = "/dev/preview-navegacao";
const LARGURAS = [1920, 1600, 1440, 1366, 1280, 1024];

test.describe("marca", () => {
  test("o cabeçalho traz símbolo, nome do produto e descritor, sem cortar nada", async ({ page }) => {
    await page.goto(NAV);

    const marca = page.locator('aside a[aria-label*="início"]');
    await expect(marca).toBeVisible();

    // O símbolo oficial entra como imagem, não como texto redesenhado.
    await expect(marca.locator("img")).toHaveCount(1);

    await expect(marca).toContainText("Horizonte Fleet Management");
    await expect(marca).toContainText("Central operacional");
  });

  test("o nome do produto não é truncado em nenhuma largura de desktop", async ({ page }) => {
    for (const width of LARGURAS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(NAV);

      const cortes = await page.$$eval('aside a[aria-label*="início"] span span', (spans) =>
        spans.map((s) => ({
          texto: s.textContent?.trim() ?? "",
          sobra: s.scrollWidth - s.clientWidth,
          fontSize: getComputedStyle(s).fontSize,
        })),
      );

      expect(cortes.length, `viewport ${width}px`).toBe(2);
      for (const linha of cortes) {
        expect(linha.sobra, `"${linha.texto}" cortado em ${linha.sobra}px @ ${width}px`).toBeLessThanOrEqual(0);
      }
      // O descritor é menor que o título; se os dois empatarem, a hierarquia
      // se perdeu — foi o que o bug do `text-overline` fez com a Sidebar.
      expect(parseFloat(cortes[0].fontSize)).toBeGreaterThan(parseFloat(cortes[1].fontSize));
    }
  });

  test("recolhida, sobra só o símbolo — e ele continua sendo o oficial", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(NAV);

    await page.getByRole("button", { name: /Recolher menu/i }).click();
    await page.waitForTimeout(400);

    const marca = page.locator('aside a[aria-label*="início"]');
    await expect(marca.locator("img")).toHaveCount(1);
    await expect(marca).not.toContainText("Horizonte Fleet Management");
  });

  test("a aba declara as duas variantes do ícone, uma por tema", async ({ page }) => {
    await page.goto(NAV);

    const icones = await page.$$eval('link[rel="icon"]', (links) =>
      links.map((l) => ({
        href: l.getAttribute("href") ?? "",
        media: l.getAttribute("media") ?? "",
        sizes: l.getAttribute("sizes") ?? "",
      })),
    );

    const escuro = icones.filter((i) => i.media.includes("dark"));
    const claro = icones.filter((i) => i.media.includes("light"));

    expect(escuro.length, "nenhum ícone para barra de abas escura").toBeGreaterThan(0);
    expect(claro.length, "nenhum ícone para barra de abas clara").toBeGreaterThan(0);
    for (const i of escuro) expect(i.href).toContain("favicon-dark");
    // O .ico sem media é o que navegadores antigos leem.
    expect(icones.some((i) => i.href.includes(".ico") && i.media === "")).toBe(true);
  });

  test("o ícone da aba é transparente; o do iOS não é", async ({ request }) => {
    // O PNG carrega a assinatura do tipo de cor no byte 25 do bloco IHDR:
    // 6 = RGBA, 2 = RGB sem alfa. É o bastante para provar que o canal existe.
    const tipoDeCor = async (url: string) => {
      const buf = Buffer.from(await (await request.get(url)).body());
      expect(buf.subarray(1, 4).toString(), `${url} não é PNG`).toBe("PNG");
      return buf[25];
    };

    expect(await tipoDeCor("/favicon-32x32.png"), "favicon claro sem canal alfa").toBe(6);
    expect(await tipoDeCor("/favicon-dark-32x32.png"), "favicon escuro sem canal alfa").toBe(6);
    // O iOS compõe transparência sobre preto: este continua opaco de propósito.
    expect(await tipoDeCor("/apple-touch-icon.png")).toBe(6);
  });
});
