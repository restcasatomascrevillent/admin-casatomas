// Medición de «Reservas › Hoy» con mala cobertura (09/11/2026). NO es una prueba: no entra en `npm test` ni en Playwright
// (no se llama `*.e2e.mjs`). Mide cuánto tarda en verse la lista de reservas y las salas, en escritorio y en móvil, en
// frío (primera vez en el dispositivo) y en caliente (volver a abrir el panel: misma caché del navegador y del
// dispositivo, pestaña nueva).
//
// Red simulada (parecida a la tablet del local con poca cobertura contra Vercel, que sirve por HTTP/2):
//   · cada petición a Supabase (falso, `supabase-falso.mjs`) tarda LATENCIA_SUPABASE ms;
//   · los ficheros del panel: LATENCIA_FICHEROS ms + su tamaño a BAJADA_KBPS, con la bajada COMPARTIDA (si se
//     piden varios a la vez, se reparten la línea), sin el tope de 6 conexiones de `vite preview` (HTTP/1.1);
//   · sin service worker (en Playwright se salta la red simulada). En «caliente» los /assets/* salen de la
//     copia del dispositivo al momento, como hace el service worker del panel (cache-first); el HTML va por red.
// Uso (con el build de Supabase falso, ver README.md de esta carpeta):
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1      # en otra terminal
//   node tests/e2e-movil/medir-hoy.mjs [--base http://127.0.0.1:4173] [--latencia 600] [--latencia-ficheros 300] [--bajada 1500] [--veces 3]
import { chromium } from "@playwright/test";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const arg = (nombre, defecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : defecto;
};
const BASE = arg("base", process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173");
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const LATENCIA_SUPABASE = Number(arg("latencia", 600));
const VECES = Number(arg("veces", 3));
const LIMITE_MS = 60_000;

const DISPOSITIVOS = [
  { nombre: "escritorio 1440×900", viewport: { width: 1440, height: 900 }, movil: false },
  { nombre: "móvil 390×844", viewport: { width: 390, height: 844 }, movil: true },
];

// Marcas, comprobadas cada 25 ms desde el arranque de la página (performance.now() = ms desde la navegación):
//   · lista: la lista de «Hoy» enseña al menos una reserva (los nombres sintéticos empiezan por «SIM »).
//   · salas: el plano de la derecha enseña una sala con sus mesas (sin «Cargando…»). Solo escritorio.
//   · actualizando / al_dia: sale y se va la pastilla «Actualizando…» (datos de la copia del dispositivo
//     mientras llegan los de ahora; solo con la versión nueva del panel).
const MARCAS = `(() => {
  window.__marcas = {};
  const mirar = () => {
    const m = window.__marcas;
    const lista = document.querySelector('[data-testid="hoy-movil-lista"]');
    if (!m.lista && lista && /SIM /.test(lista.textContent || "")) m.lista = performance.now();
    const plano = document.querySelector('[data-testid="plano-hoy"]');
    if (!m.salas && plano && !/Cargando/.test(plano.textContent || "") && /Mesa|SIM /.test(plano.textContent || "") && plano.querySelector("button")) m.salas = performance.now();
    const pastilla = document.querySelector('[data-testid="hoy-actualizando"]');
    if (!m.actualizando && pastilla) m.actualizando = performance.now();
    if (m.actualizando && !m.al_dia && !pastilla) m.al_dia = performance.now();
  };
  const t = setInterval(mirar, 25);
  setTimeout(() => clearInterval(t), ${LIMITE_MS});
})();`;

const LATENCIA_FICHEROS = Number(arg("latencia-ficheros", 300));
const BAJADA_KBPS = Number(arg("bajada", 1500));

/** Línea de bajada compartida: devuelve cuándo termina de llegar una respuesta de `bytes` pedida ahora. */
function lineaCompartida() {
  let libreEn = 0;
  return (bytes) => {
    const ahora = Date.now();
    const empieza = Math.max(ahora + LATENCIA_FICHEROS, libreEn);
    libreEn = empieza + (bytes * 8) / BAJADA_KBPS; // kbit/s = bit/ms
    return libreEn - ahora;
  };
}

async function abrir(context, dispositivo, copiaAssets, caliente) {
  const page = await context.newPage();
  const espera = lineaCompartida();
  await page.route((u) => /^(127\.0\.0\.1|localhost)$/.test(u.hostname), async (route) => {
    const ruta = new URL(route.request().url()).pathname;
    if (caliente && copiaAssets.has(ruta)) {
      const c = copiaAssets.get(ruta);
      return route.fulfill({ status: 200, headers: c.headers, body: c.body });
    }
    const resp = await route.fetch();
    const body = await resp.body();
    await new Promise((r) => setTimeout(r, espera(body.length)));
    if (ruta.startsWith("/assets/")) copiaAssets.set(ruta, { headers: resp.headers(), body });
    return route.fulfill({ response: resp, body });
  });
  const supabase = [];
  page.on("request", (r) => {
    if (/supabase\.co/.test(r.url())) supabase.push(r.url().replace(URL_SUPABASE, "").slice(0, 110));
  });
  await page.goto(`${BASE}/reservas`, { waitUntil: "commit" });
  const objetivo = dispositivo.movil ? "m => m.lista" : "m => m.lista && m.salas";
  await page.waitForFunction(`(${objetivo})(window.__marcas || {})`, null, { timeout: LIMITE_MS, polling: 50 }).catch(() => {});
  await page.waitForTimeout(3000);
  const marcas = await page.evaluate(() => window.__marcas || {});
  // La copia del día que deja esta visita se «envejece» 10 minutos: al volver, como en la realidad (no
  // segundos después), lo guardado está viejo y se vuelve a pedir.
  await page.evaluate(() => {
    try {
      const k = "reservas-hoy:copia-offline";
      const c = JSON.parse(localStorage.getItem(k) || "null");
      if (!c) return;
      c.consultas.forEach((q) => (q.actualizado -= 600_000));
      localStorage.setItem(k, JSON.stringify(c));
    } catch { /* sin copia (versión anterior) */ }
  });
  await page.close();
  return { marcas, peticiones: supabase };
}

async function medir(browser, dispositivo) {
  const context = await browser.newContext({ viewport: dispositivo.viewport, locale: "es-ES", timezoneId: "Europe/Madrid", serviceWorkers: "block", ...(dispositivo.movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
  await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: tablas(), rpc: rpcSinteticas, funciones: funcionesSinteticas });
  // Encima del Supabase falso (Playwright prueba primero la última ruta): cada petición espera y pasa al falso.
  await context.route(/^https?:\/\/[^/]*supabase\.(co|in)\//, async (route) => {
    await new Promise((r) => setTimeout(r, LATENCIA_SUPABASE));
    await route.fallback();
  });
  await context.addInitScript(MARCAS);
  const copiaAssets = new Map();
  const frio = await abrir(context, dispositivo, copiaAssets, false);
  // Volver a abrir el panel: pestaña nueva en el mismo dispositivo (localStorage y copia de ficheros se conservan).
  const caliente = await abrir(context, dispositivo, copiaAssets, true);
  await context.close();
  return { frio, caliente };
}

const r = (v) => (v == null ? "  —  " : `${(v / 1000).toFixed(2)} s`);
const mediana = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

const browser = await chromium.launch({ headless: true });
console.log(`Supabase +${LATENCIA_SUPABASE} ms por petición · ficheros +${LATENCIA_FICHEROS} ms y ${BAJADA_KBPS} kbit/s compartidos · ${VECES} vueltas (mediana)\n`);
for (const d of DISPOSITIVOS) {
  const vueltas = [];
  for (let i = 0; i < VECES; i++) vueltas.push(await medir(browser, d));
  for (const modo of ["frio", "caliente"]) {
    const lista = mediana(vueltas.map((v) => v[modo].marcas.lista));
    const salas = mediana(vueltas.map((v) => v[modo].marcas.salas));
    const alDia = mediana(vueltas.map((v) => v[modo].marcas.al_dia));
    const peticiones = vueltas[0][modo].peticiones;
    console.log(`${d.nombre.padEnd(20)} ${modo === "frio" ? "frío    " : "caliente"}  lista ${r(lista)}  ${d.movil ? "" : `salas ${r(salas)}  `}${alDia ? `«Actualizando…» hasta ${r(alDia)}  ` : ""}peticiones a Supabase ${peticiones.length}`);
    if (process.env.MEDIR_DETALLE) { console.log("      marcas", JSON.stringify(vueltas[0][modo].marcas)); for (const p of peticiones) console.log(`      ${p}`); }
  }
}
await browser.close();
