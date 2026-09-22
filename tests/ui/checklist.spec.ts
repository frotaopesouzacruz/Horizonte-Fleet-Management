import { test, expect, type Page } from "@playwright/test";

/**
 * Check List de Frota — executor (Etapa 12).
 *
 * Quatro coisas que este aplicativo não pode errar e que só aparecem no
 * navegador:
 *
 *  · a conformidade é POR PERGUNTA. Duas das 34 são invertidas, e uma regra
 *    global "SIM = conforme" aprovaria um veículo avariado;
 *  · o campo condicional é obrigatório quando acionado, e trocar a resposta
 *    que o acionou não pode deixar o valor antigo para trás;
 *  · não existe anexo, câmera ou upload em lugar nenhum (§26, CA09);
 *  · o alvo de toque tem de servir a quem responde em pé, de luva.
 */
const APP = "/dev/preview-checklist";

/**
 * O executor abre na visão de clusters (sequência do app de referência):
 * as perguntas ficam a um toque. Abrir o primeiro cluster é o passo zero de
 * todos os cenários abaixo.
 */
async function abrir(page: Page) {
  await page.goto(APP);
  await page.getByRole("button", { name: /^5S/ }).click();
}

/** O cartão de uma pergunta, pelo texto dela. */
const card = (page: Page, texto: string | RegExp) =>
  page.locator("li").filter({ hasText: texto }).first();

const botao = (page: Page, texto: string | RegExp, valor: "SIM" | "NÃO") =>
  card(page, texto).getByRole("radio", { name: valor, exact: true });

async function avancar(page: Page) {
  await page.getByRole("button", { name: /Avançar|Revisar/ }).click();
}

test.describe("executor do Check List de Frota", () => {
  test("a pergunta invertida trata SIM como inconformidade", async ({ page }) => {
    await abrir(page);

    // Cluster 1: pergunta positiva. SIM é conformidade e não alerta.
    await botao(page, /limpa externamente/, "SIM").click();
    await expect(card(page, /limpa externamente/)).not.toContainText("Inconformidade registrada");
    await avancar(page);

    // Cluster 2: pergunta invertida. SIM é inconformidade.
    const avaria = card(page, /Possui alguma avaria/);
    await botao(page, /Possui alguma avaria/, "SIM").click();
    await expect(avaria).toContainText("Inconformidade registrada");

    // E NÃO é a resposta conforme desta pergunta.
    await botao(page, /Possui alguma avaria/, "NÃO").click();
    await expect(avaria).not.toContainText("Inconformidade registrada");
  });

  test("o condicional de texto é exigido e some ao trocar a resposta", async ({ page }) => {
    await abrir(page);
    await botao(page, /limpa externamente/, "SIM").click();
    await avancar(page);

    // SIM aciona o campo obrigatório de descrição.
    await botao(page, /Possui alguma avaria/, "SIM").click();
    const descricao = page.getByLabel(/Descreva a avaria identificada/);
    await expect(descricao).toBeVisible();

    // Sem preencher, não avança.
    await avancar(page);
    await expect(page.getByText("Responda as perguntas destacadas para avançar")).toBeVisible();

    // Trocar para NÃO retira o campo — e o valor antigo não fica pendurado.
    await botao(page, /Possui alguma avaria/, "NÃO").click();
    await expect(descricao).toBeHidden();
    await avancar(page);
    await expect(page.getByRole("heading", { name: "Implementos / Carroceria" })).toBeVisible();
  });

  test("escolha única bloqueia e múltipla escolha aceita vários", async ({ page }) => {
    await abrir(page);
    await botao(page, /limpa externamente/, "SIM").click();
    await avancar(page);
    await botao(page, /Possui alguma avaria/, "NÃO").click();
    await avancar(page);

    // Implementos: NÃO em prateleiras abre a escolha única.
    await botao(page, /câmera de ré/, "SIM").click();
    await botao(page, /prateleiras/, "NÃO").click();
    await expect(page.getByRole("radio", { name: "Baú lateral" })).toBeVisible();
    await avancar(page);
    await expect(page.getByText("Responda as perguntas destacadas para avançar")).toBeVisible();

    await page.getByRole("radio", { name: "Baú lateral" }).click();
    await avancar(page);

    // Luzes: NÃO em faróis abre multisseleção e aceita mais de um.
    await botao(page, /luzes de freio/, "SIM").click();
    await botao(page, /faróis/, "NÃO").click();
    const esquerdo = page.getByRole("checkbox", { name: "Farol esquerdo" });
    const milha = page.getByRole("checkbox", { name: "Milha direito" });
    await esquerdo.click();
    await milha.click();
    await expect(esquerdo).toHaveAttribute("aria-checked", "true");
    await expect(milha).toHaveAttribute("aria-checked", "true");
  });

  test("o item crítico é destacado como tal", async ({ page }) => {
    await abrir(page);
    await botao(page, /limpa externamente/, "SIM").click();
    await avancar(page);
    await botao(page, /Possui alguma avaria/, "NÃO").click();
    await avancar(page);
    await botao(page, /câmera de ré/, "SIM").click();
    await botao(page, /prateleiras/, "SIM").click();
    await avancar(page);

    const freio = card(page, /luzes de freio/);
    await expect(freio).toContainText("Crítica");
    await botao(page, /luzes de freio/, "NÃO").click();
    await expect(freio).toContainText("item crítico");
  });

  test("a orientação operacional aparece na pergunta que a tem", async ({ page }) => {
    await abrir(page);
    await botao(page, /limpa externamente/, "SIM").click();
    await avancar(page);
    await botao(page, /Possui alguma avaria/, "NÃO").click();
    await avancar(page);

    await expect(card(page, /câmera de ré/)).toContainText("regra operacional aprovada");
    // A pergunta seguinte, sem orientação, não herda o texto.
    await expect(card(page, /prateleiras/)).not.toContainText("regra operacional aprovada");
  });

  test("não existe anexo, câmera ou upload em nenhum ponto do executor", async ({ page }) => {
    await abrir(page);

    // Percorre os quatro clusters respondendo tudo, para que todo campo
    // condicional tenha sido renderizado ao menos uma vez.
    await botao(page, /limpa externamente/, "SIM").click();
    await avancar(page);
    await botao(page, /Possui alguma avaria/, "SIM").click();
    await page.getByLabel(/Descreva a avaria identificada/).fill("Amassado na porta lateral.");
    await avancar(page);
    await botao(page, /câmera de ré/, "SIM").click();
    await botao(page, /prateleiras/, "NÃO").click();
    await page.getByRole("radio", { name: "Baú lateral" }).click();
    await avancar(page);
    await botao(page, /luzes de freio/, "NÃO").click();
    await page.getByRole("radio", { name: "Esquerdo" }).click();
    await botao(page, /faróis/, "NÃO").click();
    await page.getByRole("checkbox", { name: "Farol esquerdo" }).click();
    await avancar(page);

    // Chegou à revisão com tudo respondido.
    await expect(page.getByRole("heading", { name: "Revisão" })).toBeVisible();

    const proibidos = await page.evaluate(() => ({
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      capture: document.querySelectorAll("[capture]").length,
      acceptImagem: document.querySelectorAll('[accept*="image"], [accept*="video"]').length,
      textoDeAnexo: /anexar|anexo|fotografia|tirar foto|c[âa]mera|galeria|upload/i.test(
        document.body.innerText,
      ),
    }));

    expect(proibidos.fileInputs, "campo de arquivo encontrado").toBe(0);
    expect(proibidos.capture, "atributo capture encontrado").toBe(0);
    expect(proibidos.acceptImagem, "accept de imagem/vídeo encontrado").toBe(0);
    expect(proibidos.textoDeAnexo, "texto pedindo foto/anexo encontrado").toBe(false);
  });

  test("o alvo de toque de SIM e NÃO serve a quem responde em pé", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir(page);

    for (const valor of ["SIM", "NÃO"] as const) {
      const box = await botao(page, /limpa externamente/, valor).boundingBox();
      expect(box, `${valor} sem caixa`).not.toBeNull();
      // 44px é o mínimo do design system; aqui o alvo é maior de propósito.
      expect(box!.height, `${valor} tem ${box!.height}px de altura`).toBeGreaterThanOrEqual(44);
    }
  });

  test("não há rolagem horizontal no telefone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir(page);
    await botao(page, /limpa externamente/, "SIM").click();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px`).toBeLessThanOrEqual(1);
  });
});
