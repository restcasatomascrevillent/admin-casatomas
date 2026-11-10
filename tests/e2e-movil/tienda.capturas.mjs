// Capturas de Panel › Tienda con el Supabase falso de esta carpeta: nada sale a Supabase ni a Internet.
// Vinos sintéticos con los tres estados (a la venta, quitado de la tienda y sin precio / fuera de la carta),
// nombres largos y varias categorías; la configuración de la tienda visible con un 30 %.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/tienda.capturas.mjs [carpeta-de-capturas] [--sufijo antes]
//
// Saca escritorio (1280×800) y móvil (375×812): Vinos, Vinos filtrado sin resultados y Ajustes.
// No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso, USER_ID } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const args = process.argv.slice(2);
const iSufijo = args.indexOf("--sufijo");
const SUFIJO = iSufijo >= 0 ? `-${args[iSufijo + 1]}` : "";
const SALIDA = args.find((a, i) => !a.startsWith("--") && i !== iSufijo + 1) ?? "capturas-tienda";

const ahora = new Date().toISOString();
const VINOS = [
  ["SIM Rioja Crianza", "Tintos", 24],
  ["SIM Ribera del Duero Reserva Edición Limitada de Viñas Viejas", "Tintos", 42.5],
  ["SIM Priorat", "Tintos", 38],
  ["SIM Garnacha joven", "Tintos", null],
  ["SIM Albariño", "Blancos", 19.99],
  ["SIM Verdejo", "Blancos", 16],
  ["SIM Godello sobre lías", "Blancos", 27],
  ["SIM Cava Brut Nature", "Espumosos", 22],
  ["SIM Champagne Grand Cru", "Espumosos", 85],
  ["SIM Rosado de Navarra", "Rosados", 14.5],
  ["SIM Fondillón", "Dulces", 31],
  ["SIM Moscatel", "Dulces", 18],
].map(([nombre, categoria, precio_eur], i) => ({
  id: `vino-${i + 1}`, nombre, categoria, precio_eur, activado: true, restaurante: i !== 11, created_at: ahora, updated_at: ahora,
}));

function datos() {
  const t = tablas();
  t.user_permissions.push({ id: "perm-tienda", user_id: USER_ID, section_key: "tienda", can_view: true, can_edit: true });
  t.configuracion_tienda = [{
    id: true, activa: true, descuento_pct: "30.00", vinos_excluidos: ["vino-3", "vino-6", "vino-10"],
    aviso: "Del 1 al 15 de diciembre, 30 % en todos nuestros vinos.", recogida: "Pregunta en la barra, de martes a domingo de 12:00 a 16:00.",
    updated_at: ahora, updated_by: null,
  }];
  t.Vinos = VINOS;
  return t;
}

const TAMANOS = [
  { nombre: "escritorio", ancho: 1280, alto: 800, movil: false },
  { nombre: "movil", ancho: 375, alto: 812, movil: true },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();
try {
  for (const t of TAMANOS) {
    const contexto = await navegador.newContext({
      viewport: { width: t.ancho, height: t.alto }, deviceScaleFactor: 2, isMobile: t.movil, hasTouch: t.movil,
      locale: "es-ES", timezoneId: "Europe/Madrid", reducedMotion: "reduce",
    });
    await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc: rpcSinteticas, funciones: funcionesSinteticas });
    const pagina = await contexto.newPage();
    const foto = async (nombre, completa = false) => {
      await pagina.waitForTimeout(600);
      await pagina.screenshot({ path: path.join(SALIDA, `tienda-${nombre}-${t.ancho}${SUFIJO}.png`), fullPage: completa, animations: "disabled" });
    };
    await pagina.goto(`${BASE}/tienda`, { waitUntil: "domcontentloaded" });
    await pagina.getByText("SIM Rioja Crianza").first().waitFor({ timeout: 20000 });
    await foto("vinos");
    if (t.movil) await foto("vinos-completa", true);
    await pagina.getByLabel("Buscar vino").fill("zzz");
    await foto("vacio");
    await pagina.goto(`${BASE}/tienda?tab=ajustes`, { waitUntil: "domcontentloaded" });
    await pagina.getByLabel("Descuento sobre el precio de carta (%)").waitFor({ timeout: 20000 });
    await foto("ajustes", t.movil);
    await contexto.close();
  }
} finally {
  await navegador.close();
}
console.log(`Capturas en ${SALIDA}`);
