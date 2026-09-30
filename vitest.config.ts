import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    // testes de integração usam um banco próprio, nunca o de desenvolvimento
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL || "postgresql://caixa:caixa@127.0.0.1:5432/fechamento_test",
      APP_TIMEZONE: "America/Sao_Paulo",
    },
    include: ["tests/**/*.test.ts"],
    // testes de integração compartilham um único banco: rodam em série
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
