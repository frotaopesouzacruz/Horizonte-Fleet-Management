import { test, expect, type Page } from "@playwright/test";

/**
 * Filiais — importação, exportação e centros de custo (Etapa 09, §38, §58–§62).
 *
 * Roda contra `/dev/preview-filiais`, que renderiza a tela real com dados fixos
 * e loaders em memória (mesmo portão do design system). A validação de verdade
 * — CNPJ, operação de outra organização, código duplicado, estado × cidade — é
 * do banco e está coberta pela suíte SQL 16a; aqui se confere que a tela mostra
 * o que o banco devolveu, pede confirmação antes de gravar e não quebra no
 * celular nem no tema escuro.
 */

const PREVIEW = "/dev/preview-filiais";
const MG = "00000000-0000-4000-8000-000000000087";
const BETIM = "00000000-0000-4000-8000-000000000301";

const CSV = [
  "Código;Nome da Filial;CNPJ;Estado;Cidade;Operações vinculadas;Observações",
  "MG-02;Horizonte Sete Lagoas;11.222.333/0001-81;MG;Sete Lagoas;Last Mille MG;",
].join("\r\n");

function watchCrashes(page: Page) {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  return crashes;
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openPreview(page: Page) {
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Importar filiais" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Arquivo de filiais").setInputFiles({
    name: "filiais-setembro.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await drawer.getByRole("button", { name: "Validar arquivo" }).click();
  await expect(drawer.getByTestId("branch-import-preview")).toBeVisible();
  return drawer;
}

test.describe("filiais: importação, exportação e centros de custo", () => {
  test("o cabeçalho oferece Importar e Exportar, e a seleção vira exportação", async ({ page }) => {
    const crashes = watchCrashes(page);
    await page.goto(PREVIEW);

    await expect(page.getByRole("heading", { level: 1, name: "Filiais" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Importar", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar", exact: true })).toBeVisible();

    // Sem filtro e sem seleção, essas duas opções ficam indisponíveis — e dizem por quê.
    await page.getByRole("button", { name: "Exportar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Exportar filiais" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /Filiais filtradas/ })).toBeDisabled();
    await expect(dialog.getByRole("radio", { name: /Filiais selecionadas \(0\)/ })).toBeDisabled();
    await expect(dialog.getByText("Nenhum filtro aplicado na tela.")).toBeVisible();

    // Todas, XLSX por padrão.
    await expect(dialog.getByTestId("branch-export-download")).toHaveAttribute("href", /tipo=todas&format=xlsx/);
    // Relação filiais × operações em CSV.
    await dialog.getByRole("radio", { name: /Relação filiais × operações/ }).click();
    await dialog.getByRole("radio", { name: "CSV" }).click();
    await expect(dialog.getByTestId("branch-export-download")).toHaveAttribute("href", /tipo=operacoes&format=csv/);
    // Modelo de importação.
    await dialog.getByRole("radio", { name: /Modelo de importação/ }).click();
    await expect(dialog.getByTestId("branch-export-download")).toHaveAttribute("href", /tipo=modelo&format=csv/);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();

    // Seleção: duas linhas, e a barra oferece exportar só elas.
    await page.getByRole("checkbox", { name: "Selecionar Horizonte MG" }).click();
    await page.getByRole("checkbox", { name: "Selecionar Base Betim" }).click();
    const bar = page.getByRole("region", { name: "Filiais selecionadas" });
    await expect(bar.getByText("2 filial(is) selecionada(s)")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Selecionar todas as filiais da lista" })).toHaveAttribute(
      "data-state",
      "indeterminate",
    );

    await bar.getByRole("button", { name: "Exportar selecionadas" }).click();
    const dialog2 = page.getByRole("dialog", { name: "Exportar filiais" });
    await expect(dialog2.getByRole("radio", { name: /Filiais selecionadas \(2\)/ })).toBeChecked();
    // A seleção vai no corpo de um POST (sem teto de filiais marcadas), não na URL.
    const form = dialog2.getByTestId("branch-export-download").locator("xpath=ancestor::form");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.locator('input[name="tipo"]')).toHaveValue("selecionadas");
    const ids = (await form.locator('input[name="ids"]').inputValue()).split(",");
    expect(ids.sort()).toEqual([MG, BETIM].sort());
    await dialog2.getByRole("button", { name: "Cancelar" }).click();

    // Selecionar todas e limpar.
    await page.getByRole("checkbox", { name: "Selecionar todas as filiais da lista" }).click();
    await expect(bar.getByText("3 filial(is) selecionada(s)")).toBeVisible();
    await bar.getByRole("button", { name: "Limpar seleção" }).click();
    await expect(bar).toBeHidden();

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("importação: prévia com atual × recebido, recusas do banco e confirmação", async ({ page }) => {
    const crashes = watchCrashes(page);
    await page.goto(PREVIEW);
    const drawer = await openPreview(page);

    // O modelo vazio sai da rota de exportação, nos dois formatos.
    await expect(drawer.getByRole("link", { name: "Modelo (XLSX)" })).toHaveAttribute("href", `${PREVIEW}/export?tipo=modelo&format=xlsx`);
    await expect(drawer.getByRole("link", { name: "Modelo (CSV)" })).toHaveAttribute("href", `${PREVIEW}/export?tipo=modelo&format=csv`);

    const resumo = drawer.getByLabel("Resumo da prévia");
    await expect(resumo.getByText("A criar")).toBeVisible();
    await expect(resumo).toContainText("A criar1");
    await expect(resumo).toContainText("A atualizar1");
    await expect(resumo).toContainText("Com erro3");

    const rows = drawer.getByRole("list", { name: "Linhas da prévia" });
    await expect(rows.getByRole("listitem").filter({ has: page.getByText(/^Linha \d+$/) })).toHaveCount(6);

    // §60: a filial existente mostra o que muda, campo a campo.
    const existing = rows.getByRole("listitem", { name: "Linha 3, código 87" });
    const diff = existing.getByTestId("branch-import-diff");
    await expect(diff.getByText("Atual × recebido")).toBeVisible();
    await expect(diff).toContainText("CEPAtual: 32010-000Recebido: 32010-100");
    await expect(diff).toContainText("ObservaçõesAtual: vazioRecebido: Atende a região metropolitana");
    // Só acrescenta vínculo; o que já existe fica, e o que não veio no arquivo também.
    await expect(existing.getByText("+ Redespacho - Belém/Pa")).toBeVisible();
    await expect(existing.getByText("Last Mille MG (já vinculada)")).toBeVisible();
    await expect(existing.getByText(/mantidas fora do arquivo: Merchandising/)).toBeVisible();
    await expect(existing.getByText(/não inativa nem reativa filiais/)).toBeVisible();

    // §59: as recusas chegam com o motivo.
    await expect(rows.getByText(/CNPJ inválido: 11\.222\.333\/0001-00/)).toBeVisible();
    await expect(rows.getByText(/não pertence ao estado SP \(encontrada em: MG\)/)).toBeVisible();
    await expect(rows.getByText(/Operação não encontrada nesta organização/)).toBeVisible();
    await expect(rows.getByText(/aparece em mais de uma linha do arquivo/)).toBeVisible();

    // Filtro "Com erro".
    await drawer.getByRole("tab", { name: /Com erro/ }).click();
    await expect(rows.getByRole("listitem").filter({ has: page.getByText(/^Linha \d+$/) })).toHaveCount(3);
    await drawer.getByRole("tab", { name: /Todas/ }).click();

    // Confirmar pede confirmação e diz o que NÃO acontece.
    await drawer.getByRole("button", { name: "Importar 2 filial(is)" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Confirmar a importação?" });
    await expect(confirm.getByText(/Nenhum vínculo operacional é removido/)).toBeVisible();
    await confirm.getByRole("button", { name: "Importar", exact: true }).click();

    await expect(
      page.getByText(/Importação concluída: 1 criada\(s\), 1 atualizada\(s\), 2 vínculo\(s\) novo\(s\)/).first(),
    ).toBeVisible();
    await expect(drawer).toBeHidden();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("centros de custo: associar e desassociar na filial, sem roubar de outra", async ({ page }) => {
    const crashes = watchCrashes(page);
    await page.goto(PREVIEW);
    await page.getByRole("button", { name: "Editar Horizonte MG" }).click();
    const drawer = page.getByRole("dialog", { name: "Editar Horizonte MG" });
    await drawer.getByRole("tab", { name: "Centros de custo" }).click();

    const linked = drawer.getByRole("list", { name: "Centros de custo da filial" });
    await expect(linked.getByRole("listitem")).toHaveCount(1);
    await expect(linked.getByText("CC-100 · Operação Contagem")).toBeVisible();

    const select = drawer.getByLabel("Associar centro de custo");
    // O centro de outra filial e o inativo aparecem, mas não podem ser escolhidos.
    await expect(select.locator("option", { hasText: "associado a Horizonte Belém" })).toBeDisabled();
    await expect(select.locator("option", { hasText: "inativo" })).toBeDisabled();

    await select.selectOption({ label: "CC-200 · Manutenção MG" });
    await drawer.getByRole("button", { name: "Associar", exact: true }).click();
    await expect(page.getByText("Manutenção MG associado a Horizonte MG.", { exact: true })).toBeVisible();
    await expect(linked.getByRole("listitem")).toHaveCount(2);

    await linked.getByRole("button", { name: "Desassociar Operação Contagem" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Desassociar Operação Contagem?" });
    await confirm.getByRole("button", { name: "Desassociar", exact: true }).click();
    await expect(page.getByText("Operação Contagem desassociado de Horizonte MG.", { exact: true })).toBeVisible();
    await expect(linked.getByRole("listitem")).toHaveCount(1);
    await expect(linked.getByText("CC-200 · Manutenção MG")).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("centros de custo: organização sem nenhum mostra o estado vazio, sem inventar", async ({ page }) => {
    await page.goto(`${PREVIEW}?centros=vazio`);
    await page.getByRole("button", { name: "Editar Horizonte MG" }).click();
    const drawer = page.getByRole("dialog", { name: "Editar Horizonte MG" });
    await drawer.getByRole("tab", { name: "Centros de custo" }).click();
    await expect(drawer.getByRole("heading", { name: "Nenhum centro de custo cadastrado" })).toBeVisible();
    await expect(drawer.getByText(/esta tela não cria centros de custo/)).toBeVisible();
    await expect(drawer.getByLabel("Associar centro de custo")).toHaveCount(0);
  });

  test("sem branches.import/export: nada de importar, exportar ou selecionar", async ({ page }) => {
    const crashes = watchCrashes(page);
    await page.goto(`${PREVIEW}?perfil=leitura`);
    await expect(page.getByRole("heading", { level: 1, name: "Filiais" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Importar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exportar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    // Sem cost_centers.manage, a aba só lê.
    await page.getByRole("button", { name: "Editar Horizonte MG" }).click();
    const drawer = page.getByRole("dialog", { name: "Editar Horizonte MG" });
    await drawer.getByRole("tab", { name: "Centros de custo" }).click();
    await expect(drawer.getByText("CC-100 · Operação Contagem")).toBeVisible();
    await expect(drawer.getByText(/pode consultar os centros de custo da filial, mas não alterá-los/)).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Desassociar/ })).toHaveCount(0);
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`celular 390px no tema ${theme === "dark" ? "escuro" : "claro"}: sem rolagem horizontal na tela e na prévia`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
      const page = await context.newPage();
      const crashes = watchCrashes(page);
      await page.goto(PREVIEW);
      await page.evaluate((value) => window.localStorage.setItem("hfm.theme", value), theme);
      await page.reload();

      const htmlClass = await page.evaluate(() => document.documentElement.className);
      if (theme === "dark") expect(htmlClass).toContain("dark");
      else expect(htmlClass).not.toContain("dark");

      await expect(page.getByRole("heading", { level: 1, name: "Filiais" })).toBeVisible();
      expect(await horizontalOverflow(page), "rolagem horizontal na lista").toBeLessThanOrEqual(0);

      const drawer = await openPreview(page);
      await expect(drawer.getByRole("listitem", { name: "Linha 3, código 87" }).getByTestId("branch-import-diff")).toBeVisible();
      expect(await horizontalOverflow(page), "rolagem horizontal com a prévia aberta").toBeLessThanOrEqual(0);
      const drawerOverflow = await drawer.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(drawerOverflow, "a gaveta transborda na largura").toBeLessThanOrEqual(0);

      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Exportar", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Exportar filiais" });
      await expect(dialog).toBeVisible();
      expect(await horizontalOverflow(page), "rolagem horizontal com a exportação aberta").toBeLessThanOrEqual(0);

      expect(crashes, crashes.join("\n")).toEqual([]);
      await context.close();
    });
  }
});
