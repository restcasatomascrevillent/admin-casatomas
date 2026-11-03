// Configuración PROPIA de las pruebas e2e móviles (no toca nada del producto: ni package.json ni vite.config.ts).
// Uso: ver README.md de esta carpeta.
import { defineConfig } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";

// Los móviles que se auditan (vertical y horizontal) y una tablet vertical.
const DISPOSITIVOS = {
  "320x568": { ancho: 320, alto: 568, dpr: 2 },
  "360x740": { ancho: 360, alto: 740, dpr: 3 },
  "375x812": { ancho: 375, alto: 812, dpr: 3 },
  "390x844": { ancho: 390, alto: 844, dpr: 3 },
  "414x896": { ancho: 414, alto: 896, dpr: 2 },
  "430x932": { ancho: 430, alto: 932, dpr: 3 },
  "812x375": { ancho: 812, alto: 375, dpr: 3 },
  "768x1024": { ancho: 768, alto: 1024, dpr: 2 },
};

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.mjs$/, // no `.spec`/`.test`: Vitest (npm test) las recogería
  timeout: 60_000,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: base, locale: "es-ES", timezoneId: "Europe/Madrid", headless: true, launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] } },
  projects: Object.entries(DISPOSITIVOS).map(([nombre, d]) => ({
    name: nombre,
    use: { viewport: { width: d.ancho, height: d.alto }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true },
  })),
  // Sirve el build ya hecho (`npm run build` con VITE_SUPABASE_URL=https://e2e-falso.supabase.co). Con E2E_BASE_URL se usa un servidor ya levantado.
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npx vite preview --port 4173 --strictPort --host 127.0.0.1", cwd: "../..", url: base, reuseExistingServer: true, timeout: 60_000 },
});
