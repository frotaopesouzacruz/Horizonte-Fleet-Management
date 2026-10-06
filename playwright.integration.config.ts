import { defineConfig } from "@playwright/test";

/**
 * Testes de integração sem navegador (motor de sincronização com a fonte
 * oficial dos pneus contra um banco PostgreSQL LOCAL de teste e uma Graph
 * simulada). Exigem o banco local de teste (HFM_TEST_PG_*); nunca apontam
 * para produção.
 */
export default defineConfig({
  testDir: "./tests/integration",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./tests/integration/.results",
});
