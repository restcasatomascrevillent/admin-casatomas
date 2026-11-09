// Capturas antes/después de una release, con DATOS DE PRUEBA (docs/PROCESO-DE-CAMBIOS.md).
//
//   node scripts/capturas-release.mjs --antes <url> --despues <url> --salida <carpeta> [--paginas "/,/carta"]
//
// «antes» y «después» son dos builds servidos en local: el de main y el de la release.
//   - Web: el build de los e2e (scripts/e2e-build.mjs), con la carta de prueba y sin Supabase.
//   - Panel: el build con VITE_SUPABASE_URL=https://e2e-falso.supabase.co y el Supabase falso
//     de tests/e2e-movil (sesión y datos sintéticos): nada sale a Internet ni hay datos reales.
// Saca la misma pantalla en móvil (390x844) y escritorio (1440x900) en los dos y escribe
// <salida>/capturas.json para el informe del PR. Lo usa .github/workflows/release-candidata.yml.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARNES_PANEL = path.join(RAIZ, "tests/e2e-movil/supabase-falso.mjs");
const ES_PANEL = existsSync(ARNES_PANEL);
const PAGINAS = ES_PANEL ? ["/dashboard", "/reservas", "/gestion-web", "/marketing", "/facturas"] : ["/", "/carta", "/carta/vinos", "/reservas", "/regala"];
const TAMANOS = [
  { nombre: "móvil", ancho: 390, alto: 844, movil: true },
  { nombre: "escritorio", ancho: 1440, alto: 900, movil: false },
];

const slug = (ruta) => (ruta === "/" ? "inicio" : ruta.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, ""));

async function prepararContexto(navegador, tamano) {
  const contexto = await navegador.newContext({
    viewport: { width: tamano.ancho, height: tamano.alto },
    deviceScaleFactor: 1,
    isMobile: tamano.movil,
    hasTouch: tamano.movil,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    reducedMotion: "reduce",
  });
  // Siempre la misma fecha: las pantallas con «hoy» salen iguales en las dos versiones.
  await contexto.addInitScript(() => {
    const fija = new Date("2026-11-09T12:00:00+01:00").valueOf();
    const DateReal = Date;
    Date = class extends DateReal { constructor(...a) { super(...(a.length ? a : [fija])); } static now() { return fija; } };
    try { localStorage.setItem("cookieConsent", JSON.stringify({ maps: false, ts: new DateReal(fija).toISOString() })); } catch { /* sin localStorage */ }
  });
  if (ES_PANEL) {
    const { instalarSupabaseFalso } = await import(pathToFileURL(ARNES_PANEL).href);
    const { tablas, rpcSinteticas, funcionesSinteticas } = await import(pathToFileURL(path.join(RAIZ, "tests/e2e-movil/datos-sinteticos.mjs")).href);
    await instalarSupabaseFalso(contexto, { urlSupabase: process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co", tablas: tablas(), rpc: rpcSinteticas, funciones: funcionesSinteticas });
  } else {
    // Web: solo el propio servidor; lo externo (mapas, analítica, Supabase de mentira) se corta.
    await contexto.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  }
  return contexto;
}

export async function capturar({ antes, despues, salida, paginas = PAGINAS }) {
  const { chromium } = await import("@playwright/test");
  mkdirSync(salida, { recursive: true });
  const navegador = await chromium.launch();
  const items = [];
  try {
    for (const tamano of TAMANOS) {
      for (const ruta of paginas) {
        const fila = { nombre: `${ruta} · ${tamano.nombre}` };
        for (const [lado, base] of [["antes", antes], ["despues", despues]]) {
          const contexto = await prepararContexto(navegador, tamano);
          const pagina = await contexto.newPage();
          await pagina.goto(new URL(ruta, base).href, { waitUntil: "domcontentloaded" });
          await pagina.waitForLoadState("networkidle").catch(() => {});
          await pagina.waitForTimeout(800);
          const fichero = `${slug(ruta)}-${tamano.ancho}-${lado}.png`;
          await pagina.screenshot({ path: path.join(salida, fichero), animations: "disabled" });
          fila[lado] = fichero;
          await contexto.close();
        }
        items.push(fila);
      }
    }
  } finally {
    await navegador.close();
  }
  const resultado = { ok: true, items };
  writeFileSync(path.join(salida, "capturas.json"), JSON.stringify(resultado, null, 2));
  return resultado;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valor = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const [antes, despues, salida] = [valor("--antes"), valor("--despues"), valor("--salida") ?? "capturas"];
  if (!antes || !despues) {
    console.error("Uso: node scripts/capturas-release.mjs --antes <url> --despues <url> --salida <carpeta> [--paginas \"/,/carta\"]");
    process.exit(2);
  }
  const paginas = valor("--paginas")?.split(",").map((p) => p.trim()).filter(Boolean);
  capturar({ antes, despues, salida, paginas: paginas?.length ? paginas : undefined })
    .then((r) => console.log(`${r.items.length * 2} capturas en ${salida}/`))
    .catch((e) => {
      mkdirSync(salida, { recursive: true });
      writeFileSync(path.join(salida, "capturas.json"), JSON.stringify({ ok: false, motivo: e instanceof Error ? e.message.split("\n")[0] : String(e) }));
      console.error(e);
      process.exitCode = 1;
    });
}
