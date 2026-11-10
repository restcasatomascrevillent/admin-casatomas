// Capturas de Cheques › Stripe (y de su informe) con el Supabase falso de esta carpeta: nada sale a Supabase ni a Internet.
// Datos sintéticos (cheques-datos.mjs): ~4 meses de ventas por la web y manuales, con canjes, gastos de gestión y Stripe en
// modo producción.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/cheques-stripe.capturas.mjs [carpeta-de-capturas]
//
// Saca escritorio (1280×800) y móvil (375×812): la pestaña entera y, si existe el botón «Generar informe», el informe.
// Avisa si la página se desborda en horizontal. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";
import { filasCheques, informe, metricas } from "./cheques-datos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-cheques-stripe";

const filas = filasCheques();
const rpc = {
  ...rpcSinteticas,
  metricas_cheques_regalo: (p) => metricas(filas, p),
  informe_cheques_regalo: (p) => informe(filas, p),
  listar_cheques_regalo_v3: () => ({ total: 0, expedidos: 0, canjeados: 0, caducados: 0, disponibles: 0, coincidencias: 0, importe_pagado: 0, tickets: [] }),
};
const funciones = {
  ...funcionesSinteticas,
  "stripe-estado-cuenta": () => ({ configurado: true, modo: "live", pais: "ES", moneda_por_defecto: "eur", cobros_activos: true, payouts_activos: true, detalles_completos: true, nombre_negocio: "SIM Restaurante" }),
};

const VISTAS = [
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
  { nombre: "movil-375", viewport: { width: 375, height: 812 }, dpr: 2, movil: true },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const v of VISTAS) {
  const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
  const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: tablas(), rpc, funciones });
  const page = await context.newPage();
  await page.goto(`${BASE}/cheques`);
  await page.getByRole("tab", { name: "Stripe" }).click({ timeout: 20_000 });
  await page.getByText("Ganancia neta con cheques").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const base = path.join(SALIDA, v.nombre);
  const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (ancho > visible) console.log(`${v.nombre}: la página se desborda en horizontal (${ancho} px de ${visible})`);
  const desbordes = await page.evaluate(() => {
    const panel = document.querySelector("[role='tabpanel'][data-state='active']");
    if (!panel) return [];
    const limite = panel.getBoundingClientRect().right + 1;
    return [...panel.querySelectorAll("*")].filter((n) => n.getBoundingClientRect().right > limite && n.getBoundingClientRect().width > 0).slice(0, 5).map((n) => `${n.tagName.toLowerCase()}#${n.id || ""}.${String(n.className).slice(0, 40)}`);
  });
  if (desbordes.length) console.log(`${v.nombre}: elementos que se salen de la pestaña →`, desbordes.join(" | "));
  // Página entera: se quita el alto fijo de la página y el scroll propio de la pestaña.
  await page.evaluate(() => {
    const region = document.querySelector("[role='tabpanel'][data-state='active']");
    const raiz = region?.closest(".flex.flex-col");
    if (region) Object.assign(region.style, { overflow: "visible", flex: "none" });
    for (let n = region?.parentElement; n && n !== document.body; n = n.parentElement) Object.assign(n.style, { height: "auto", maxHeight: "none", overflowY: "visible" });
    if (raiz) raiz.style.height = "auto";
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${base}-stripe.png`, fullPage: true });

  const boton = page.getByRole("button", { name: /Generar informe/ });
  if (await boton.count()) {
    await boton.first().click();
    await page.getByTestId("diapositiva-1").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${base}-informe.png` });
    // Todas las diapositivas: el diálogo se estira para que quepan en una captura.
    await page.evaluate(() => {
      const d = document.querySelector("[role='dialog']");
      if (!d) return;
      Object.assign(d.style, { height: "auto", maxHeight: "none", position: "absolute", top: "0", transform: "translateX(-50%)" });
      d.querySelectorAll(".overflow-y-auto").forEach((n) => Object.assign(n.style, { overflow: "visible", flex: "none" }));
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${base}-informe-entero.png`, fullPage: true });
  }
  if (sinMock.size) console.log(`${v.nombre}: sin mock →`, [...sinMock].join(", "));
  await context.close();
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
