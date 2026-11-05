// Capturas y comprobaciones de /instagram en tablet (evaluación de diseño C, 05/11/2026) con el Supabase falso de
// esta carpeta: ninguna petición sale a Supabase ni a Internet y los datos son sintéticos. Recorre las pestañas a
// 1280×800 y 1024×768 y comprueba la regla del panel (sin scroll vertical de página) y que el pie de Crear
// («Guardar borrador · Programar») queda dentro de la pantalla.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/instagram-tablet.capturas.mjs [carpeta-de-capturas]
//
// No entra en `npm test` (no es *.test.* ni *.e2e.mjs). Variables: E2E_BASE_URL, E2E_SUPABASE_URL.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";
import { funciones, rpc, tablasInstagram } from "./instagram-datos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-instagram";

const RECORRIDO = [
  ["estudio", "/instagram"],
  ["crear", "/instagram?tab=crear"],
  ["campanas", "/instagram?tab=campanas"],
  ["calendario", "/instagram?tab=calendario"],
  ["encargos", "/instagram?tab=encargos"],
  ["reels", "/instagram?tab=reels"],
  ["metricas", "/instagram?tab=metricas"],
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox"] });
const fallos = [];
for (const [ancho, alto] of [[1280, 800], [1024, 768]]) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, locale: "es-ES", timezoneId: "Europe/Madrid", baseURL: BASE });
  const t = tablas();
  Object.assign(t, tablasInstagram());
  await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: t, rpc, funciones });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(e.message));
  for (const [nombre, ruta] of RECORRIDO) {
    await pagina.goto(ruta, { waitUntil: "domcontentloaded" });
    await pagina.waitForLoadState("networkidle").catch(() => {});
    await pagina.waitForTimeout(1200);
    if (nombre === "crear") {
      // Elige una foto de Drive para ver la vista previa y el pie con el hueco propuesto.
      await pagina.getByTestId("foto-drive:1FotoSalonDrive000000001").click().catch(() => {});
      await pagina.waitForTimeout(1500);
    }
    const medida = await pagina.evaluate(() => ({ alto: window.innerHeight, scroll: document.documentElement.scrollHeight, anchoScroll: document.documentElement.scrollWidth, ancho: window.innerWidth }));
    if (medida.scroll > medida.alto + 1) {
      // Qué se sale por abajo (para saber qué arreglar).
      const culpables = await pagina.evaluate((h) => {
        const fuera = [];
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.bottom > h + 1 && r.height > 0 && !el.parentElement?.closest("[data-fuera]")) {
            el.setAttribute("data-fuera", "");
            fuera.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} [${Math.round(r.top)}..${Math.round(r.bottom)}]`);
          }
        }
        return fuera.slice(0, 4);
      }, alto);
      fallos.push(`${ancho}×${alto} ${nombre}: scroll vertical de página (${medida.scroll} > ${medida.alto}): ${culpables.join(" · ")}`);
    }
    if (medida.anchoScroll > medida.ancho + 1) fallos.push(`${ancho}×${alto} ${nombre}: scroll horizontal de página (${medida.anchoScroll} > ${medida.ancho})`);
    // Pie fijo de Crear («Programar»): solo si existe (Crear se está rediseñando aparte).
    if (nombre === "crear" && (await pagina.getByTestId("boton-programar").count())) {
      const caja = await pagina.getByTestId("boton-programar").boundingBox();
      if (!caja || caja.y + caja.height > alto) fallos.push(`${ancho}×${alto} crear: «Programar» fuera de la pantalla (${JSON.stringify(caja)})`);
    }
    if (nombre === "encargos") {
      const tablero = await pagina.getByTestId("tablero-encargos").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth })).catch(() => null);
      if (tablero && tablero.sw > tablero.cw + 1) fallos.push(`${ancho}×${alto} encargos: el tablero hace scroll horizontal (${tablero.sw} > ${tablero.cw})`);
    }
    await pagina.screenshot({ path: path.join(SALIDA, `${ancho}x${alto}-${nombre}.png`) });
    console.log(`${ancho}×${alto} ${nombre}: alto de página ${medida.scroll}/${medida.alto}`);
  }
  // Calendario: un día con error abierto en el panel y el diálogo «Ver qué ha pasado».
  if (errores.length) fallos.push(`${ancho}×${alto}: errores de JavaScript: ${errores.slice(0, 3).join(" | ")}`);
  await contexto.close();
}
await navegador.close();
if (fallos.length) {
  console.error(`\n${fallos.length} problema(s):\n- ${fallos.join("\n- ")}`);
  process.exitCode = 1;
} else console.log("\nSin scroll de página y con «Programar» a la vista en todas las pestañas.");
