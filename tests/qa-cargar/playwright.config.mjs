// Banco QA de Facturas › Cargar (05/11/2026). Reutiliza el Supabase falso de tests/e2e-movil.
// Uso (ver README.md de esta carpeta):
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build --outDir <DIST>
//   QA_DIST=<DIST> npx playwright test -c tests/qa-cargar/playwright.config.mjs
import { defineConfig } from "@playwright/test";

const puerto = Number(process.env.QA_PUERTO ?? 4183);
const base = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${puerto}`;
const dist = process.env.QA_DIST ?? "dist";

const TAMANOS = {
  "1180x820": { width: 1180, height: 820, movil: false },
  "820x1180": { width: 820, height: 1180, movil: false },
  "390x844": { width: 390, height: 844, movil: true },
};

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.mjs$/,
  timeout: 90_000,
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 3),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: base, locale: "es-ES", timezoneId: "Europe/Madrid", headless: true,
    launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
  },
  projects: Object.entries(TAMANOS).map(([nombre, t]) => ({
    name: nombre,
    use: { viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1, isMobile: t.movil, hasTouch: true },
  })),
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `node node_modules/vite/bin/vite.js preview --outDir "${dist}" --port ${puerto} --strictPort --host 127.0.0.1`,
        cwd: "../..", url: base, reuseExistingServer: true, timeout: 60_000,
      },
});
