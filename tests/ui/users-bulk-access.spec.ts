import { test, expect } from "@playwright/test";

/**
 * Usuários › ações em massa de acesso (Suspender / Reativar acesso).
 *
 * Roda contra `/dev/preview-usuarios`: 8 colaboradores fixos, 2 com acesso
 * ativo, 1 suspenso, 1 com convite pendente e 4 sem conta. Prova o que a tela
 * decide ANTES de mandar algo ao banco: quem será alterado, quem fica como
 * está e por quê, e que uma seleção sem ninguém elegível não vira um "erro".
 * Quem decide de fato é `bulk_set_employee_access_status`, coberta por
 * `supabase/tests/remote/34_users_bulk_access.sql`.
 */
const PREVIEW = "/dev/preview-usuarios";

test.describe("usuários: ações em massa de acesso", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reativar com todos selecionados diz quem muda e quem fica", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.getByRole("checkbox", { name: "Selecionar todos os registros desta página" }).click();
    await expect(page.getByText("8 selecionado(s)")).toBeVisible();
    await page.getByRole("button", { name: "Reativar acesso" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("2 colaboradores terão o acesso ao HFM reativado.");
    await expect(dialog).toContainText("Ficam como estão: 4 sem conta de acesso ao HFM e 2 já ativos.");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
  });

  test("ninguém para reativar: não pergunta nem envia, explica e indica Conceder acesso", async ({ page }) => {
    await page.goto(PREVIEW);
    for (const name of ["Carlos Eduardo Nogueira Silva", "João Vitor Rodrigues de Oliveira", "Ana Paula de Almeida Rodrigues"]) {
      await page.getByRole("checkbox", { name: `Selecionar ${name}` }).click();
    }
    await page.getByRole("button", { name: "Reativar acesso" }).click();

    // o aviso também é repetido na região lida pelo leitor de tela; aqui vale o cartão visível
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("Nenhum acesso para reativar", { exact: true })).toBeVisible();
    await expect(
      page
        .getByText(/^Nenhum dos 3 selecionados tem acesso suspenso ou convite pendente: 2 sem conta de acesso ao HFM e 1 já ativo\./)
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/use “Conceder acesso ao HFM”/).first()).toBeVisible();
    await expect(page.getByText(/não puderam ser alterados/)).toHaveCount(0);
  });

  test("suspender conta só os acessos ativos", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.getByRole("checkbox", { name: "Selecionar todos os registros desta página" }).click();
    await page.getByRole("button", { name: "Suspender acesso" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("2 colaboradores terão o acesso ao HFM suspenso. O cadastro permanece ativo.");
    await expect(dialog).toContainText(
      "Ficam como estão: 4 sem conta de acesso ao HFM, 1 já suspenso e 1 com convite pendente.",
    );
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
  });
});
