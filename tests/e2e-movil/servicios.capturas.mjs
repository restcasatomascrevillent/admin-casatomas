// Capturas de Super Admin › Servicios (Estado y Costes) con el Supabase falso de esta carpeta: nada sale a Supabase ni
// a Internet. Datos sintéticos: los servicios de datos-sinteticos.mjs más Google Drive y Mapbox (con lectura
// automática) y Google Maps (sin ella), costes de los últimos meses y un mes de pago por uso sin coste.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/servicios.capturas.mjs [carpeta-de-capturas]
//
// Saca móvil (375×812) y escritorio (1280×800) de cada pestaña, la página entera, y avisa si algo se desborda en
// horizontal. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-servicios";
const ahora = new Date().toISOString();

const mes = (n) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 10); };
const extra = (proveedor, nombre, x) => ({
  proveedor, nombre, plan: "Free", precio_mensual: 0, precio_anual: null, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null,
  panel_url: `https://${proveedor}.sim.test/`, limites: {}, notas: null, actualizado_en: ahora, categoria: "otros", orden: 100, activo: true,
  por_confirmar: false, fuente_precio: null, ...x,
});
function datos() {
  const t = tablas();
  t.servicios_contratados = [
    ...t.servicios_contratados,
    extra("google_drive", "Google Drive (copias de facturas)", { plan: "Gratis, 15 GB", moneda: "EUR", categoria: "archivos", orden: 90, limites: { almacenamiento: { orden: 1, etiqueta: "Espacio de la cuenta de Google", limite: 15, unidad: "GB", periodo: "ahora" } } }),
    extra("mapbox", "Mapbox (mapa de vinos)", { plan: "Pago por uso (gratis hasta 50.000 cargas al mes)", precio_mensual: null, ciclo: "por_uso", categoria: "mapas", orden: 85, limites: { cargas_mapa_web: { orden: 1, etiqueta: "Cargas del mapa de vinos (web)", limite: 50000, unidad: "cargas", periodo: "mes natural" } } }),
    extra("google", "Google Maps Platform (reseñas)", { plan: "Pago por uso con uso gratuito al mes", precio_mensual: null, ciclo: "por_uso", categoria: "mapas", orden: 80 }),
  ];
  return t;
}
const lecturas = () => [
  ...funcionesSinteticas["servicios-uso"]().lecturas,
  { proveedor: "google_drive", tomado_en: ahora, error: null, detalles: { plan_detectado: "15 GB de espacio" }, metricas: {
    almacenamiento: { orden: 1, etiqueta: "Espacio de la cuenta de Google", valor: 9.6 * 1024 ** 3, unidad: "bytes", limite: 15, unidad_limite: "GB", periodo: "ahora" },
    en_drive: { orden: 2, etiqueta: "De ello, en Drive", valor: 2.1 * 1024 ** 3, unidad: "bytes", periodo: "ahora" },
  } },
  { proveedor: "mapbox", tomado_en: ahora, error: null, detalles: {}, metricas: {
    cargas_mapa_web: { orden: 1, etiqueta: "Cargas del mapa de vinos (web)", valor: 1840, unidad: "cargas", limite: 50000, periodo: "mes en curso" },
  }, coste_variable: { importe: 0, moneda: "USD", periodo: "mes en curso", origen: "estimado" } },
];
const resumenMes = ({ p_mes }) => {
  const uso = (importe, moneda = "USD") => ({ importe, moneda, periodo: "mes en curso", origen: "api" });
  if (p_mes === mes(0)) return [
    { proveedor: "openai", lecturas: 40, coste_variable: uso(3.1) }, { proveedor: "vapi", lecturas: 40, coste_variable: uso(1.2) },
    { proveedor: "stripe", lecturas: 40, coste_variable: uso(0.55, "EUR") }, { proveedor: "mapbox", lecturas: 40, coste_variable: uso(0) },
  ];
  if (p_mes === mes(1)) return [
    { proveedor: "openai", lecturas: 300, coste_variable: uso(12.4) }, { proveedor: "vapi", lecturas: 300, coste_variable: uso(4.75) },
    { proveedor: "stripe", lecturas: 300, coste_variable: uso(2.1, "EUR") }, { proveedor: "mapbox", lecturas: 300, coste_variable: null },
    { proveedor: "loading", lecturas: 0, manual_importe: 14.99, manual_moneda: "EUR", manual_nota: "Factura dominio 2026-118" },
  ];
  if (p_mes === mes(2)) return [
    { proveedor: "openai", lecturas: 280, coste_variable: uso(9.8) }, { proveedor: "vapi", lecturas: 280, coste_variable: uso(3.9) },
    { proveedor: "stripe", lecturas: 280, coste_variable: uso(1.4, "EUR") },
  ];
  return [];
};
const rpc = { ...rpcSinteticas, servicios_resumen_mes: resumenMes };
const funciones = { ...funcionesSinteticas, "servicios-uso": () => ({ lecturas: lecturas(), sin_lector: ["google", "loading"], generado_en: ahora }) };

const VISTAS = [
  { nombre: "movil-375", viewport: { width: 375, height: 812 }, dpr: 2, movil: true },
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
];
const PESTANAS = [
  { tab: "estado", espera: "[data-testid='estado-general']" },
  { tab: "costes", espera: "#costes-faltantes" },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const v of VISTAS) {
  for (const p of PESTANAS) {
    const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
    const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc, funciones });
    const page = await context.newPage();
    await page.goto(`${BASE}/super-admin/servicios${p.tab === "estado" ? "" : `?tab=${p.tab}`}`);
    await page.locator(p.espera).first().waitFor({ timeout: 20_000 }).catch(() => console.log(`${v.nombre}/${p.tab}: no apareció ${p.espera}`));
    await page.waitForTimeout(1200);
    const base = path.join(SALIDA, `${p.tab}-${v.nombre}`);
    await page.screenshot({ path: `${base}-vista.png` });
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (ancho > visible) console.log(`${v.nombre}/${p.tab}: la página se desborda en horizontal (${ancho} px de ${visible})`);
    // Página entera: se quita el alto fijo y el scroll propio de la pestaña.
    await page.evaluate(() => {
      const raiz = document.querySelector("[data-testid='servicios']");
      if (!raiz) return;
      raiz.style.height = "auto";
      raiz.querySelectorAll(".overflow-y-auto").forEach((n) => Object.assign(n.style, { overflow: "visible", flex: "none" }));
      for (let n = raiz.parentElement; n && n !== document.body; n = n.parentElement) Object.assign(n.style, { height: "auto", maxHeight: "none", overflowY: "visible" });
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${base}-entera.png`, fullPage: true });
    if (sinMock.size) console.log(`${v.nombre}/${p.tab}: sin mock →`, [...sinMock].join(", "));
    await context.close();
  }
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
