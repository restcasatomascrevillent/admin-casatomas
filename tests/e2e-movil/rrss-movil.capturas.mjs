// Capturas y mediciones de TODA la sección RRSS en el MÓVIL (375×812 y 390×844) con el Supabase falso de esta carpeta:
// Instagram (Estudio, Crear, Campañas, Reels, Calendario, Encargos), Facebook, Subida de fotos y Métricas.
// Nada sale a Supabase ni a Internet. Sirve para sacar el ANTES y el DESPUÉS de la revisión móvil de RRSS (12/11/2026).
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   E2E_BASE_URL=http://127.0.0.1:4173 node tests/e2e-movil/rrss-movil.capturas.mjs <carpeta-de-capturas> [--tamanos 375x812,390x844]
//
// Por pantalla mide: scroll horizontal de la página, scroll vertical de la página (la regla del panel es que no haya),
// botones y pestañas por debajo de 48 px de alto, textos por debajo de 14 px y el alto que se come la navegación
// (lo que hay encima del contenido de la pestaña). Escribe `mediciones.json` junto a las capturas. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_ID, instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";
import { funciones, rpc, tablasInstagram } from "./instagram-datos.mjs";
import { ficherosCubo, rrssIa, tablasRrss } from "./rrss-datos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-rrss-movil";
const iTam = process.argv.indexOf("--tamanos");
const TAMANOS = (iTam > 0 ? process.argv[iTam + 1] : "375x812,390x844").split(",").map((t) => t.split("x").map(Number));

const PANTALLAS = [
  ["01-instagram-estudio", "/rrss?red=instagram&tab=estudio"],
  ["02-instagram-crear", "/rrss?red=instagram&tab=crear"],
  ["03-instagram-campanas", "/rrss?red=instagram&tab=campanas"],
  ["04-instagram-reels", "/rrss?red=instagram&tab=reels"],
  ["05-instagram-calendario", "/rrss?red=instagram&tab=calendario"],
  ["06-instagram-encargos", "/rrss?red=instagram&tab=encargos"],
  ["07-facebook", "/rrss?red=facebook"],
  ["08-subida", "/rrss?red=editor"],
  ["09-metricas", "/rrss?red=metricas"],
];

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

function tablasCaptura() {
  const t = tablas();
  Object.assign(t, tablasInstagram(), tablasRrss());
  t.super_admins = [];
  t.user_roles = [{ id: "00000000-0000-4000-8000-000000000002", user_id: USER_ID, role: "manager", created_at: new Date().toISOString() }];
  t.user_permissions = [
    { id: "00000000-0000-4000-8000-000000000300", user_id: USER_ID, section_key: "dashboard", can_view: true, can_edit: false },
    { id: "00000000-0000-4000-8000-000000000301", user_id: USER_ID, section_key: "reservas", can_view: true, can_edit: true },
    { id: "00000000-0000-4000-8000-000000000302", user_id: USER_ID, section_key: "marketing", can_view: true, can_edit: true },
  ];
  return t;
}

/** Mediciones de la pantalla actual (se ejecutan dentro de la página). */
function medir() {
  const ancho = window.innerWidth;
  const alto = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && !el.closest("[aria-hidden=true]") && !el.closest("[data-state=inactive]");
  };
  const nombre = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 36);
  const chicos = [];
  for (const el of document.querySelectorAll("button, a[href], [role=tab], [role=button], select, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio])")) {
    // Interruptores y casillas: su zona táctil es la fila entera. `data-compacto`: el destino real es el contenedor (≥ 48 px).
    if (el.matches("[role=switch], [role=checkbox], [data-compacto]")) continue;
    if (!visible(el) || el.closest("[data-radix-popper-content-wrapper]")) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > alto) continue;
    if (r.height < 47.5) chicos.push(`${nombre(el)} (${Math.round(r.height)})`);
  }
  const letra = [];
  for (const el of document.querySelectorAll("main *")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visible(el) || el.closest(".sr-only, svg")) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > alto) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 13.99) letra.push(`${el.textContent.trim().replace(/\s+/g, " ").slice(0, 24)} ${px}`);
  }
  const doc = document.documentElement;
  // Alto que se come la navegación: lo que hay entre la cabecera del panel y el contenido de la pestaña más interior.
  const paneles = [...document.querySelectorAll("[role=tabpanel][data-state=active]")];
  const panel = paneles[paneles.length - 1];
  const cajaPanel = panel?.getBoundingClientRect();
  return {
    scrollHorizontalPagina: Math.max(doc.scrollWidth, document.body.scrollWidth) > ancho + 1,
    scrollVerticalPagina: Math.max(doc.scrollHeight, document.body.scrollHeight) > alto + 1,
    altoDocumento: Math.max(doc.scrollHeight, document.body.scrollHeight),
    // 56 px de cabecera del panel + 12 px de relleno son de todas las pantallas: se restan.
    altoNavegacion: cajaPanel ? Math.max(0, Math.round(cajaPanel.top) - 68) : null,
    altoBarraInferior: (() => { const b = document.querySelector("[data-testid=barra-redes-movil]"); return b ? Math.round(b.getBoundingClientRect().height) : 0; })(),
    botonesBajos: chicos.length,
    ejemplosBajos: chicos.slice(0, 8),
    textosPequenos: letra.length,
    ejemplosPequenos: [...new Set(letra)].slice(0, 8),
  };
}

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox"] });
const resultados = {};
const { mapa: cubo } = await ficherosCubo(process.env.RRSS_DATOS || null).catch(() => ({ mapa: {} }));
void cubo;
for (const [ancho, alto] of TAMANOS) {
  const tam = `${ancho}x${alto}`;
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "es-ES", timezoneId: "Europe/Madrid", baseURL: BASE });
  const t = tablasCaptura();
  await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: t, rpc, funciones: { ...funciones, "rrss-ia": rrssIa } });
  // Fuentes externas cortadas (montaje hermético).
  await contexto.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  void CORS;
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(e.message.slice(0, 200)));
  for (const [nombre, ruta] of PANTALLAS) {
    await pagina.goto(ruta, { waitUntil: "domcontentloaded" });
    await pagina.waitForLoadState("networkidle").catch(() => {});
    await pagina.getByTestId("pagina-rrss").waitFor({ timeout: 20_000 });
    await pagina.waitForTimeout(2200);
    const m = await pagina.evaluate(medir);
    resultados[`${tam} ${nombre}`] = m;
    await pagina.screenshot({ path: path.join(SALIDA, `${tam}-${nombre}.png`), animations: "disabled", caret: "hide" });
    console.log(`${tam} ${nombre}: nav ${m.altoNavegacion}px · bajos ${m.botonesBajos} · letra<14 ${m.textosPequenos}${m.scrollHorizontalPagina ? " · SCROLL-H" : ""}${m.scrollVerticalPagina ? " · scroll-v" : ""}`);
  }
  // Solo en el «después»: la hoja de secciones de Instagram abierta (en el «antes» no existe y se salta).
  await pagina.goto("/rrss?red=instagram&tab=estudio", { waitUntil: "domcontentloaded" });
  await pagina.waitForLoadState("networkidle").catch(() => {});
  const selector = pagina.getByTestId("selector-seccion");
  if (await selector.count()) {
    await selector.click();
    await pagina.getByTestId("hoja-secciones").waitFor();
    await pagina.waitForTimeout(700);
    await pagina.screenshot({ path: path.join(SALIDA, `${tam}-10-hoja-secciones.png`), animations: "disabled" });
    console.log(`${tam} 10-hoja-secciones`);
  }
  if (errores.length) console.log(`${tam}: errores JS: ${errores.slice(0, 3).join(" | ")}`);
  await contexto.close();
}
await navegador.close();
await writeFile(path.join(SALIDA, "mediciones.json"), JSON.stringify(resultados, null, 1));
