import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Aplicativos → Verificação Preditiva de Frota.
 *
 * Roda contra `/dev/preview-verificacao-preditiva`, o aplicativo inteiro com
 * contexto fixo e carregadores injetados. O que se prova aqui é o que só
 * aparece no navegador: a validação do KM (divergência pede justificativa; sem
 * KM oficial o KM é obrigatório), os bloqueios do roteiro (não conforme sem
 * descrição, monitoramento sem alvo, passo obrigatório sem resposta, número
 * inválido), os tipos de resposta, a revisão, o protocolo com a corretiva
 * aberta e o rascunho que sobrevive ao recarregar com a mesma chave de
 * idempotência. As regras (elegibilidade, desfecho de cada item, KM oficial)
 * ficam nas rotinas `maintenance_predictive_app_*` do banco.
 */
const PREVIEW = "/dev/preview-verificacao-preditiva";
const MOBILE = { width: 390, height: 844 };

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

/** Início → Nova verificação → frota → identificação. */
async function abrirIdentificacao(page: Page, plate = "ABC1D23") {
  await page.goto(PREVIEW);
  await page.getByTestId("predictive-app-new").click();
  await expect(page.getByTestId("predictive-app-vehicle")).toHaveCount(3);
  await page.getByTestId("predictive-app-vehicle").filter({ hasText: plate }).click();
  await expect(page.getByTestId("predictive-app-identification")).toBeVisible();
}

/** Identificação sem mexer no KM → roteiro. */
async function abrirRoteiro(page: Page) {
  await abrirIdentificacao(page);
  await page.getByTestId("predictive-app-start").click();
  await expect(page.getByTestId("predictive-app-items")).toBeVisible();
}

/** A chave de idempotência do rascunho guardado no aparelho. */
const draftKey = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("hfm.predictive.draft."));
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { clientSubmissionId: string }).clientSubmissionId : null;
  });

test.describe("aplicativo Verificação Preditiva de Frota", () => {
  test("a entrada no menu Aplicativos e a tela inicial", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Verificação Preditiva de Frota", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Verificação Preditiva" })).toHaveAttribute("href", "/aplicativos/verificacao-preditiva");

    const home = page.getByTestId("predictive-app-home");
    await expect(page.getByTestId("predictive-app")).toBeVisible();
    await expect(home).toContainText("Técnico de Teste");
    await expect(home).toContainText("Matrícula 000456");
    await expect(page.getByTestId("predictive-app-new")).toBeEnabled();
    const history = page.getByTestId("predictive-app-history");
    await expect(history.getByTestId("predictive-app-history-item")).toHaveCount(3);
    await expect(history.getByTestId("predictive-app-history-item").filter({ hasText: "VPF-2026-000123" })).toContainText("1 NC");
    await expect(history.getByTestId("predictive-app-history-item").filter({ hasText: "VPF-2026-000119" })).toContainText("KM divergente");
    await expect(history.getByTestId("predictive-app-history-item").filter({ hasText: "VPF-2026-000111" })).toContainText("Conforme");
    expect(crashes).toEqual([]);
  });

  test("quem só consulta vê Nova verificação desabilitada, com o motivo", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=consulta`);
    await expect(page.getByTestId("predictive-app-new")).toBeDisabled();
    await expect(page.getByTestId("predictive-app-blocker")).toContainText("applications.predictive.execute");
    await expect(page.getByTestId("predictive-app-history-item")).toHaveCount(0);
  });

  test("escolha da frota: lista inicial com a pior situação, busca no servidor", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await page.getByTestId("predictive-app-new").click();
    const vehicles = page.getByTestId("predictive-app-vehicle");
    await expect(vehicles).toHaveCount(3);
    await expect(vehicles.filter({ hasText: "ABC1D23" })).toContainText("Vencido");
    await expect(vehicles.filter({ hasText: "ABC1D23" })).toContainText("105.000 km");
    await expect(vehicles.filter({ hasText: "DEF4G56" })).toContainText("Crítico");
    await expect(vehicles.filter({ hasText: "DEF4G56" })).toContainText("KM desatualizado");
    await expect(vehicles.filter({ hasText: "DEF4G56" })).toContainText("1 aguard. corretiva");
    await expect(vehicles.filter({ hasText: "HIJ7K89" })).toContainText("Sem KM");

    await page.getByTestId("predictive-app-search").fill("0150");
    await expect(vehicles).toHaveCount(1);
    await expect(vehicles.first()).toContainText("DEF4G56");

    await page.getByTestId("predictive-app-search").fill("ZZZ");
    await expect(page.getByText("Nenhuma frota encontrada")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("identificação: KM divergente do oficial exige justificativa; o oficial não muda", async ({ page }) => {
    await abrirIdentificacao(page);
    const screen = page.getByTestId("predictive-app-identification");
    await expect(screen).toContainText("Técnico de Teste");
    await expect(screen).toContainText("Plano Van Master · v3");
    await expect(screen.getByTestId("predictive-app-km")).toContainText("105.000 km");
    await expect(screen.getByTestId("predictive-app-km")).toContainText("Tolerância de 5.250 km");

    // Dentro da tolerância: nenhuma justificativa.
    await page.getByTestId("predictive-app-km-input").fill("105300");
    await expect(page.getByTestId("predictive-app-km-justification")).toHaveCount(0);

    // 6.000 km de diferença: justificativa obrigatória, e o roteiro só abre com ela.
    await page.getByTestId("predictive-app-km-input").fill("99000");
    await expect(page.getByTestId("predictive-app-km-justification")).toBeVisible();
    await page.getByTestId("predictive-app-start").click();
    await expect(screen).toBeVisible();
    await expect(screen).toContainText("Mínimo de 5 caracteres");
    await page.getByTestId("predictive-app-km-justification").fill("Hodômetro substituído na oficina.");
    await page.getByTestId("predictive-app-start").click();
    await expect(page.getByTestId("predictive-app-items")).toBeVisible();
  });

  test("identificação: sem KM oficial, o KM do hodômetro é obrigatório e os itens ficam Sem KM", async ({ page }) => {
    await abrirIdentificacao(page, "HIJ7K89");
    const screen = page.getByTestId("predictive-app-identification");
    await expect(screen.getByTestId("predictive-app-km")).toContainText("sem leitura");
    await page.getByTestId("predictive-app-start").click();
    await expect(screen).toContainText("Sem KM oficial para hoje: informe o KM do hodômetro.");
    await page.getByTestId("predictive-app-km-input").fill("48300");
    await page.getByTestId("predictive-app-start").click();
    const items = page.getByTestId("predictive-app-items");
    await expect(items).toBeVisible();
    await expect(items.getByText("Sem KM", { exact: true })).toHaveCount(3);
  });

  test("celular: roteiro por cluster, tipos de resposta, bloqueios, revisão e protocolo com corretiva", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    const crashes = crashesOf(page);
    await abrirIdentificacao(page);
    await page.getByTestId("predictive-app-km-input").fill("99000");
    await page.getByTestId("predictive-app-km-justification").fill("Hodômetro substituído na oficina.");
    await page.getByTestId("predictive-app-start").click();
    const items = page.getByTestId("predictive-app-items");
    await expect(items).toBeVisible();

    // Dois clusters, três itens, na ordem do roteiro; a situação de cada item vem do servidor.
    const cards = page.locator('[data-testid^="predictive-app-item-"]');
    await expect(cards).toHaveCount(3);
    await expect(page.getByTestId("predictive-app-cluster-cl-fre")).toContainText("Freios");
    await expect(page.getByTestId("predictive-app-cluster-cl-mot")).toContainText("Motor");
    const freios = page.getByTestId("predictive-app-item-c-1");
    await expect(freios).toContainText("Pastilhas e discos de freio");
    await expect(freios).toContainText("Vencido");
    await expect(freios).toContainText("1.000 km excedidos");
    await expect(page.getByTestId("predictive-app-item-c-2")).toContainText("Monitorando");
    // O passo desativado do roteiro não aparece.
    await expect(page.getByTestId("predictive-app-step-c-3-antigo")).toHaveCount(0);

    // Alvo de toque dos resultados: 44 px é o mínimo; aqui é maior de propósito.
    for (const id of ["predictive-app-result-c-1-conforming", "predictive-app-result-c-1-non_conforming"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} sem caixa`).not.toBeNull();
      expect(box!.height, `${id} tem ${box!.height}px`).toBeGreaterThanOrEqual(44);
    }

    // Nada respondido: revisar bloqueia.
    await page.getByTestId("predictive-app-review-button").click();
    await expect(items).toContainText("Registre o resultado de pelo menos um item do roteiro.");
    await expect(page.getByTestId("predictive-app-review")).toHaveCount(0);

    // Não conforme sem descrição e sem o passo obrigatório: bloqueia e aponta o quê.
    await page.getByTestId("predictive-app-result-c-1-non_conforming").click();
    await expect(page.getByTestId("predictive-app-result-c-1-non_conforming")).toHaveAttribute("aria-pressed", "true");
    await expect(freios).toContainText("Critério: ≥ 3 mm");
    await page.getByTestId("predictive-app-review-button").click();
    const pending = page.getByTestId("predictive-app-pending");
    await expect(pending).toContainText("1 item pendente");
    await expect(pending).toContainText("descreva a não conformidade");
    await expect(pending).toContainText("responda “Espessura das pastilhas (mm)”");

    await page.getByTestId("predictive-app-notes-c-1").fill("Pastilhas com 2 mm e ruído metálico.");
    await page.getByTestId("predictive-app-step-c-1-espessura").fill("abc");
    await page.getByTestId("predictive-app-review-button").click();
    await expect(pending).toContainText("use um número");
    await page.getByTestId("predictive-app-step-c-1-espessura").fill("2");
    await page.getByTestId("predictive-app-step-c-1-discos").getByRole("button", { name: "Fora" }).click();
    await expect(freios).toContainText("Desfecho esperado: Manutenção aberta");

    // Monitoramento sem alvo e sem as respostas obrigatórias (sim/não e seleção).
    await page.getByTestId("predictive-app-result-c-2-monitor").click();
    await page.getByTestId("predictive-app-review-button").click();
    await expect(pending).toContainText("1 item pendente");
    await expect(pending).toContainText("informe o alvo do monitoramento");
    await page.getByTestId("predictive-app-monitor-km-c-2").fill("1500");
    await page.getByTestId("predictive-app-step-c-2-nivel").getByRole("button", { name: "Sim" }).click();
    await page.getByTestId("predictive-app-step-c-2-cor").selectOption("Âmbar");

    // Conforme com roteiro de conformidade; foto e texto são opcionais.
    await page.getByTestId("predictive-app-result-c-3-conforming").click();
    await page.getByTestId("predictive-app-step-c-3-ruido").getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("predictive-app-step-c-3-obs")).toHaveAttribute("placeholder", "Descreva em poucas palavras");

    // Agora a revisão abre, com os três itens e o KM informado.
    await page.getByTestId("predictive-app-review-button").click();
    const review = page.getByTestId("predictive-app-review");
    await expect(review).toBeVisible();
    await expect(review).toContainText("99.000 km");
    await expect(review.getByTestId("predictive-app-review-item-c-1")).toContainText(/não conforme/i);
    await expect(review.getByTestId("predictive-app-review-item-c-1")).toContainText("Abre corretiva");
    await expect(review.getByTestId("predictive-app-review-item-c-2")).toContainText("Monitorar por 1.500 km");
    await expect(review.getByTestId("predictive-app-review-item-c-3")).toContainText(/conforme/i);

    const key = await draftKey(page);
    expect(key).toBeTruthy();

    await page.getByTestId("predictive-app-submit").click();
    await expect(page.getByTestId("predictive-app-protocol")).toHaveText("VPF-2026-000124");
    const done = page.getByTestId("predictive-app-done");
    await expect(done.getByTestId("predictive-app-maintenances")).toContainText("MAN-2026-000740");
    await expect(done.getByTestId("predictive-app-maintenances")).toContainText("aberta agora");
    await expect(done).toContainText("KM informado (99.000 km) divergente do oficial (105.000 km)");
    await expect(done).toContainText("O KM oficial não foi alterado");
    // Com o protocolo em mãos, o rascunho sai do aparelho.
    expect(await draftKey(page)).toBeNull();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `sobra de ${overflow}px`).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Nova verificação" }).click();
    await expect(page.getByTestId("predictive-app-vehicles")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("o rascunho sobrevive ao recarregar e mantém a mesma chave de idempotência", async ({ page }) => {
    await abrirRoteiro(page);
    await page.getByTestId("predictive-app-result-c-3-conforming").click();
    const before = await draftKey(page);
    expect(before).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("predictive-app-continue")).toContainText("ABC1D23");
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByTestId("predictive-app-identification")).toBeVisible();
    await page.getByTestId("predictive-app-start").click();
    await expect(page.getByTestId("predictive-app-result-c-3-conforming")).toHaveAttribute("aria-pressed", "true");
    expect(await draftKey(page)).toBe(before);
  });

  test("detalhe do envio próprio: desfecho de cada item, corretiva aberta e KM divergente justificado", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await page.getByTestId("predictive-app-history-item").filter({ hasText: "VPF-2026-000123" }).click();
    const detail = page.getByTestId("predictive-app-detail");
    await expect(detail).toContainText("ABC1D23");
    await expect(detail.getByTestId("predictive-app-detail-item")).toHaveCount(3);
    const pastilhas = detail.getByTestId("predictive-app-detail-item").filter({ hasText: "Pastilhas e discos de freio" });
    await expect(pastilhas).toContainText("Manutenção aberta");
    await expect(pastilhas).toContainText("MAN-2026-000738");
    await expect(pastilhas).toContainText("Agendado");
    await expect(detail.getByTestId("predictive-app-detail-item").filter({ hasText: "Fluido de freio" })).toContainText("Monitorar por 2.000 km");

    await page.getByRole("button", { name: "Voltar" }).click();
    await page.getByTestId("predictive-app-history-item").filter({ hasText: "VPF-2026-000119" }).click();
    await expect(detail).toContainText("justificada");
    await expect(detail).toContainText("Hodômetro substituído em 01/10");
    await expect(detail.getByTestId("predictive-app-detail-item")).toHaveCount(2);
    expect(crashes).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade (${theme}): início, frotas e roteiro sem violações`, async ({ page }) => {
      await setTheme(page, PREVIEW, theme);
      await expect(page.getByRole("heading", { name: "Verificação Preditiva de Frota", level: 1 })).toBeVisible();
      const check = async (label: string) => {
        // O ponteiro fica sobre o último botão clicado; afastá-lo avalia o estado de repouso, não o hover.
        await page.mouse.move(0, 0);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
      };
      await check("inicio");

      await page.getByTestId("predictive-app-new").click();
      await expect(page.getByTestId("predictive-app-vehicle")).toHaveCount(3);
      await check("frotas");

      await page.getByTestId("predictive-app-vehicle").first().click();
      await expect(page.getByTestId("predictive-app-identification")).toBeVisible();
      await check("identificacao");

      await page.getByTestId("predictive-app-start").click();
      await expect(page.getByTestId("predictive-app-items")).toBeVisible();
      await page.getByTestId("predictive-app-result-c-1-non_conforming").click();
      await page.getByTestId("predictive-app-result-c-2-monitor").click();
      await page.getByTestId("predictive-app-review-button").click();
      await expect(page.getByTestId("predictive-app-pending")).toBeVisible();
      await check("roteiro");
    });
  }
});
