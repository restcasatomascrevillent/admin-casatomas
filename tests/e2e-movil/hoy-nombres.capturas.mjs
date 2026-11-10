// Capturas de Reservas › Hoy (lista de la izquierda + mesas de la derecha) en móvil, tablet y escritorio, con el
// Supabase falso de esta carpeta: nada sale a Supabase ni a Internet (10/11/2026, «los nombres no se ven, y eso es
// lo primordial»). Mide, en cada anchura, cuánto se ve del NOMBRE de cada fila de la lista de escritorio (ancho
// visible en px y letras aproximadas), el tamaño de las tarjetas de mesa y si la página hace scroll vertical.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/hoy-nombres.capturas.mjs [carpeta-de-capturas] [prefijo]
//
// No entra en `npm test`. Sale con código 1 si la página hace scroll vertical en alguna anchura.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-hoy-nombres";
const PREFIJO = process.argv[3] ?? "";

const TAMANOS = [
  { nombre: "movil-390", width: 390, height: 844, tactil: true },
  { nombre: "tablet-vertical-768", width: 768, height: 1024, tactil: true },
  { nombre: "tablet-vertical-834", width: 834, height: 1194, tactil: true },
  { nombre: "tablet-horizontal-1024", width: 1024, height: 768, tactil: true },
  { nombre: "tablet-horizontal-1180", width: 1180, height: 820, tactil: true },
  { nombre: "tablet-horizontal-1366", width: 1366, height: 1024, tactil: true },
  { nombre: "portatil-1280", width: 1280, height: 800, tactil: false },
  { nombre: "escritorio-1440", width: 1440, height: 900, tactil: false },
  { nombre: "escritorio-1920", width: 1920, height: 1080, tactil: false },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();
let conScroll = 0;
for (const t of TAMANOS) {
  const context = await navegador.newContext({
    viewport: { width: t.width, height: t.height },
    deviceScaleFactor: 1,
    hasTouch: t.tactil,
    isMobile: t.width < 768,
  });
  await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: tablas(), rpc: rpcSinteticas, funciones: funcionesSinteticas });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  error JS (${t.nombre}): ${e.message}`));
  await page.goto(`${BASE}/reservas`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const movil = t.width < 768;
  await page
    .locator(movil ? "[data-testid='hoy-movil-lista']" : "[data-testid='lista-hoy-escritorio']")
    .first()
    .waitFor({ state: "attached", timeout: 20_000 })
    .catch(() => {});
  if (!movil) await page.locator("[data-testid='mesas-grandes'] button").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const datos = await page.evaluate(() => {
    const filas = [...document.querySelectorAll("[data-testid='lista-hoy-escritorio'] li[data-reserva-id]")];
    const nombres = filas
      .map((li) => {
        // El nombre: el span con `title` = nombre completo (antes y después del cambio).
        const s = [...li.querySelectorAll("span[title]")].find((e) => e.getAttribute("title") === e.textContent);
        if (!s) return null;
        const letras = s.textContent.length;
        const visibles = s.scrollWidth > 0 ? Math.min(letras, Math.floor((letras * s.clientWidth) / s.scrollWidth)) : 0;
        return { nombre: s.textContent, ancho: Math.round(s.clientWidth), visibles, cortado: s.scrollWidth > s.clientWidth + 1 };
      })
      .filter(Boolean);
    const tarjeta = document.querySelector("[data-testid='mesas-grandes'] button[data-mesa-id]");
    const r = tarjeta?.getBoundingClientRect();
    const lista = document.querySelector("[data-testid='lista-hoy-escritorio']");
    const el = document.scrollingElement;
    return {
      nombres,
      anchoLista: lista ? Math.round(lista.getBoundingClientRect().width) : null,
      tarjeta: r ? `${Math.round(r.width)}×${Math.round(r.height)}` : null,
      scrollPagina: el.scrollHeight > window.innerHeight + 1 ? el.scrollHeight - window.innerHeight : 0,
      scrollHorizontal: el.scrollWidth > window.innerWidth + 1,
    };
  });
  const min = datos.nombres.length ? Math.min(...datos.nombres.map((n) => n.ancho)) : null;
  const letrasMin = datos.nombres.length ? Math.min(...datos.nombres.map((n) => n.visibles)) : null;
  const cortados = datos.nombres.filter((n) => n.cortado).length;
  console.log(
    `${t.nombre}: lista ${datos.anchoLista ?? "-"} px · nombre ≥ ${min ?? "-"} px (≥ ${letrasMin ?? "-"} letras) · cortados ${cortados}/${datos.nombres.length} · tarjeta ${datos.tarjeta ?? "-"} · scroll vertical ${datos.scrollPagina} px${datos.scrollHorizontal ? " · ¡scroll horizontal!" : ""}`,
  );
  if (datos.scrollPagina > 0 && !movil) conScroll++;
  await page.screenshot({ path: path.join(SALIDA, `${PREFIJO}${t.nombre}.png`) });
  await context.close();
}
await navegador.close();
process.exit(conScroll ? 1 : 0);
