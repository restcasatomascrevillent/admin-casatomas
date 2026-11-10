// Capturas de Super Admin › Informes con el Supabase falso de esta carpeta: nada sale a Supabase ni a Internet.
// Datos sintéticos: compras por proveedor (RPC explorar_compras) y votos del vino favorito.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/informes.capturas.mjs [carpeta-de-capturas]
//
// Saca móvil (375×812) y escritorio (1280×800): la lista, un informe de tabla de Facturas y la votación del vino
// favorito; avisa si algo se desborda en horizontal. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-informes";

const PROVEEDORES = [
  ["SIM Makro Distribución Mayorista", 4820.4, 18], ["SIM Pescados del Mediterráneo", 3311.75, 12], ["SIM Bodegas Alfa", 2290, 6],
  ["SIM Frutas y Verduras Huerta", 1610.3, 22], ["SIM Carnes Selectas", 1544.2, 9], ["SIM Panadería La Espiga", 612.5, 25],
  ["SIM Limpiezas Levante", 380, 3], ["SIM Cafés Tostados", 355.8, 4], ["SIM Hielo Express", 129.6, 8], ["SIM Papelería Oficina", 88.2, 2],
  ["SIM Aceites del Sur", 640, 2], ["SIM Quesos Artesanos", 512.9, 5], ["SIM Mantelerías", 300.5, 2],
];
const total = PROVEEDORES.reduce((a, [, v]) => a + v, 0);
const explorar = ({ p_desde, p_hasta, p_medida, p_agrupar }) => ({
  parametros: { desde: p_desde, hasta: p_hasta, medida: p_medida, agrupar: p_agrupar, desglose: null },
  sin_datos: false,
  total: { valor: total, documentos: PROVEEDORES.reduce((a, [, , d]) => a + d, 0) },
  series: [],
  puntos: PROVEEDORES.map(([etiqueta, valor, documentos], i) => ({ clave: String(i + 1), etiqueta, id: i + 1, valor, documentos })),
  resto: { entidades: 4, valor: 210.4, documentos: 6 },
});

function datos() {
  const t = tablas();
  const vinos = ["SIM Aalto 2021", "SIM Marqués de Riscal Reserva", "SIM Pago de Carraovejas", "SIM Enate Chardonnay"];
  t.votos_vino_favorito = Array.from({ length: 14 }, (_, i) => ({
    id: `v${i}`, vino_id: null, vino_nombre: vinos[i % 3 === 0 ? 0 : i % 4], nombre: `SIM Cliente ${i + 1}`, contacto: `cliente${i + 1}@sim.test`,
    idioma: i % 5 === 0 ? "en" : "es", created_at: new Date(Date.now() - (14 - i) * 864e5).toISOString(),
  }));
  return t;
}
const rpc = { ...rpcSinteticas, explorar_compras: explorar };

const VISTAS = [
  { nombre: "movil-375", viewport: { width: 375, height: 812 }, dpr: 2, movil: true },
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
];
const PANTALLAS = [
  { nombre: "lista", ruta: "/super-admin/informes", espera: "nav[aria-label='Informes disponibles']" },
  { nombre: "facturas-proveedor", ruta: "/super-admin/informes?informe=facturas-gasto-proveedor", espera: "[data-testid='diapositiva-2']" },
  { nombre: "vino-favorito", ruta: "/super-admin/informes?informe=carta-vino-favorito", espera: "[data-testid='diapositiva-3']" },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const v of VISTAS) {
  for (const p of PANTALLAS) {
    const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
    const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc, funciones: funcionesSinteticas });
    const page = await context.newPage();
    await page.goto(`${BASE}${p.ruta}`);
    await page.locator(p.espera).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(900);
    const base = path.join(SALIDA, `${v.nombre}-${p.nombre}`);
    await page.screenshot({ path: `${base}.png` });
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (ancho > visible) console.log(`${v.nombre} ${p.nombre}: la página se desborda en horizontal (${ancho} px de ${visible})`);
    if (sinMock.size) console.log(`${v.nombre} ${p.nombre}: sin mock →`, [...sinMock].join(", "));
    await context.close();
  }
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
