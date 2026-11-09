// Capturas de RRSS › Métricas (panel global de redes e informe mensual) para el PR, con el Supabase falso de esta
// carpeta: ninguna petición sale a Supabase ni a Internet. Encima del falso se añaden métricas de Instagram
// sintéticas (instagram_metricas_cuenta e instagram_metricas_publicacion_ultima, del 1 del mes de hace dos meses a
// ayer) y las procedencias de Tráfico web (RPC trafico_web_desglose_resumen).
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/rrss-metricas.capturas.mjs [carpeta-de-capturas] [pdf-de-ejemplo]
//
// Por defecto escribe en docs/rrss/capturas/. Además descarga el PDF del informe (comprueba que se genera y cuántas
// páginas tiene) y, si se da la segunda ruta, lo guarda allí. Al final lista los errores de consola y los avisos de
// maquetación. No entra en `npm test`. Variables: E2E_BASE_URL, E2E_SUPABASE_URL.
import { chromium } from "playwright";
import sharp from "sharp";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_ID, instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";
import { funciones, rpc, tablasInstagram } from "./instagram-datos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "docs/rrss/capturas";
const PDF_EJEMPLO = process.argv[3] ?? null;
const MAX_BYTES = 1.5 * 1024 * 1024;
const CUENTA = "17841400000000001";

// ── Datos sintéticos de Instagram ───────────────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 10);
const hoy = new Date();
const inicio = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - 2, 1));
const ayer = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1));

function metricasCuenta() {
  const filas = [];
  let seguidores = 1890;
  for (let d = new Date(inicio), i = 0; d <= ayer; d.setUTCDate(d.getUTCDate() + 1), i++) {
    const finde = [0, 5, 6].includes(d.getUTCDay());
    const tendencia = 1 + i / 160;
    const alcance = Math.round((420 + ((i * 53) % 170) + (finde ? 180 : 0)) * tendencia + (i % 17 === 9 ? 900 : 0));
    seguidores += (i * 7) % 5 === 0 ? 1 : 2;
    filas.push({
      id: i + 1,
      fecha: iso(d),
      ig_user_id: CUENTA,
      seguidores,
      alcance,
      visualizaciones: Math.round(alcance * 2.4),
      interacciones: Math.round(alcance * 0.055),
      cuentas_interaccion: Math.round(alcance * 0.03),
      visitas_perfil: Math.round(alcance * 0.02),
      toques_enlaces: Math.round(alcance * 0.004),
      me_gusta: null,
      comentarios: null,
      guardados: null,
      compartidos: null,
      capturado_at: `${iso(d)}T05:00:00Z`,
    });
  }
  return filas;
}

const TEXTOS = [
  ["SIM Arroz del senyoret para el domingo, como siempre. #crevillent #arroz", "REELS", "VIDEO", 3.1],
  ["SIM La terraza ya está lista para las noches de otoño", "FEED", "CAROUSEL_ALBUM", 1.6],
  ["SIM Menú del día: puchero con pelotas", "FEED", "IMAGE", 1.0],
  ["SIM Así preparamos la gamba roja", "REELS", "VIDEO", 2.4],
  ["SIM Vino de la semana: un tinto de Alicante", "FEED", "IMAGE", 0.8],
  ["SIM Touza: cócteles de temporada", "FEED", "CAROUSEL_ALBUM", 1.3],
  ["SIM Hoy abrimos a mediodía", "STORY", "IMAGE", 0.5],
];

function publicaciones() {
  const out = [];
  let n = 0;
  for (let d = new Date(inicio); d <= ayer; d.setUTCDate(d.getUTCDate() + 3)) {
    const [caption, producto, tipo_medio, factor] = TEXTOS[n % TEXTOS.length];
    const alcance = Math.round((700 + ((n * 211) % 600)) * factor);
    const interacciones = Math.round(alcance * (0.04 + (n % 4) * 0.01));
    out.push({
      id: 1000 + n,
      media_id: String(18000000000000000 + n),
      ig_user_id: CUENTA,
      fecha_captura: iso(ayer),
      capturado_at: `${iso(ayer)}T05:00:00Z`,
      pieza_id: null,
      tipo_medio,
      producto,
      publicado_at: `${iso(d)}T11:30:00Z`,
      permalink: null,
      miniatura_url: null,
      caption,
      alcance,
      me_gusta: Math.round(interacciones * 0.7),
      comentarios: Math.round(interacciones * 0.1),
      guardados: Math.round(interacciones * 0.15),
      compartidos: Math.round(interacciones * 0.05),
      visualizaciones: Math.round(alcance * 2.1),
      interacciones,
    });
    n++;
  }
  return out;
}

/** Procedencias de Tráfico web: proporcionales a los días pedidos, con redes, buscadores y directo. */
function procedencias({ p_desde, p_hasta }) {
  const dias = Math.max(1, Math.round((Date.parse(p_hasta) - Date.parse(p_desde)) / 86400000) + 1);
  const anterior = Date.parse(p_hasta) < Date.parse(iso(new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - 1, 1))));
  const f = (anterior ? 0.8 : 1) * dias;
  const filas = [
    ["(directo)", 21],
    ["google.com", 18],
    ["l.instagram.com", 4.2],
    ["instagram.com", 1.1],
    ["m.facebook.com", 0.9],
    ["lm.facebook.com", 0.3],
    ["tripadvisor.es", 1.2],
  ].map(([valor, porDia]) => ({ valor, visitas: Math.round(porDia * f), visitantes: Math.round(porDia * f * 0.8) }));
  const total = filas.reduce((a, x) => a + x.visitas, 0);
  return filas.map((x) => ({ ...x, pct: Math.round((1000 * x.visitas) / total) / 10 }));
}

function tablasCaptura({ superAdmin }) {
  const t = tablas();
  Object.assign(t, tablasInstagram());
  t.instagram_metricas_cuenta = metricasCuenta();
  t.instagram_metricas_publicacion_ultima = publicaciones();
  if (!superAdmin) {
    t.super_admins = [];
    t.user_roles = [{ id: "00000000-0000-4000-8000-000000000002", user_id: USER_ID, role: "manager", created_at: new Date().toISOString() }];
    t.user_permissions = [
      { id: "00000000-0000-4000-8000-000000000300", user_id: USER_ID, section_key: "dashboard", can_view: true, can_edit: false },
      { id: "00000000-0000-4000-8000-000000000302", user_id: USER_ID, section_key: "marketing", can_view: true, can_edit: true },
    ];
  }
  return t;
}

// ── Recogida de errores y avisos ────────────────────────────────────────────
const errores = [];
const avisos = [];
const filtrados = new Set();
let capturaActual = "inicio";
const DEL_MONTAJE = /ERR_BLOCKED_BY_CLIENT|blockedbyclient|fonts\.(googleapis|gstatic)\.com/i;

function vigilar(pagina) {
  pagina.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const texto = m.text();
    if (DEL_MONTAJE.test(texto) || DEL_MONTAJE.test(m.location()?.url ?? "")) return void filtrados.add(texto.slice(0, 160));
    errores.push(`[${capturaActual}] console.${m.type()}: ${texto.slice(0, 400)}`);
  });
  pagina.on("pageerror", (e) => errores.push(`[${capturaActual}] pageerror: ${e.message.slice(0, 400)}`));
  pagina.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (DEL_MONTAJE.test(f) || /ERR_ABORTED/.test(f)) return void filtrados.add(`${f} ${r.url().slice(0, 120)}`);
    errores.push(`[${capturaActual}] petición fallida: ${r.method()} ${r.url().slice(0, 160)} (${f})`);
  });
  pagina.on("response", (r) => {
    if (r.status() >= 400 && /supabase\.co/.test(r.url())) errores.push(`[${capturaActual}] ${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
  });
}

async function nuevoContexto(navegador, { ancho, alto, dpr = 1, movil = false, superAdmin = false }) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: dpr, isMobile: movil, hasTouch: movil, locale: "es-ES", timezoneId: "Europe/Madrid", baseURL: BASE, acceptDownloads: true });
  await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: tablasCaptura({ superAdmin }), rpc: { ...rpc, trafico_web_desglose_resumen: procedencias }, funciones });
  const pagina = await contexto.newPage();
  vigilar(pagina);
  return { contexto, pagina };
}

async function ir(pagina, ruta) {
  await pagina.goto(ruta, { waitUntil: "domcontentloaded" });
  await pagina.waitForLoadState("networkidle").catch(() => {});
  await pagina.getByTestId("pagina-rrss").waitFor();
}

async function revisarMaquetacion(pagina, nombre) {
  const ancho = pagina.viewportSize().width;
  const r = await pagina.evaluate((ancho) => {
    const out = [];
    const w = Math.max(window.innerWidth, document.documentElement.scrollWidth);
    if (w > ancho + 1) out.push(`scroll horizontal de página: el contenido mide ${w} px en una pantalla de ${ancho} px`);
    const fuera = [];
    for (const el of document.body.querySelectorAll("button, a, [role=tab], input, select, textarea")) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && (b.right > ancho + 1 || b.left < -1) && fuera.length < 4) fuera.push(`«${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40)}» (${Math.round(b.left)}..${Math.round(b.right)} px)`);
    }
    if (fuera.length) out.push(`controles fuera del ancho de la pantalla: ${fuera.join(" · ")}`);
    return out;
  }, ancho);
  for (const a of r) avisos.push(`[${nombre}] ${a}`);
}

async function recomprimir(destino) {
  let bytes = (await stat(destino)).size;
  if (bytes > MAX_BYTES) {
    await writeFile(destino, await sharp(destino).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer());
    bytes = (await stat(destino)).size;
  }
  if (bytes > MAX_BYTES) {
    await writeFile(destino, await sharp(destino).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toBuffer());
    bytes = (await stat(destino)).size;
  }
  return bytes;
}

async function capturar(pagina, nombre) {
  await pagina.waitForTimeout(500);
  await revisarMaquetacion(pagina, nombre);
  const destino = path.join(SALIDA, nombre);
  await pagina.screenshot({ path: destino, animations: "disabled", caret: "hide" });
  const bytes = await recomprimir(destino);
  const v = pagina.viewportSize();
  console.log(`${nombre}: ${v.width}×${v.height} · ${(bytes / 1024).toFixed(0)} KB`);
}

// ── Recorrido ───────────────────────────────────────────────────────────────
await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();

{
  // Escritorio, como Super Admin (el dueño): las tres tarjetas, con la web desde redes.
  const { contexto, pagina } = await nuevoContexto(navegador, { ancho: 1440, alto: 900, superAdmin: true });
  capturaActual = "09-metricas";
  await ir(pagina, "/rrss?red=metricas");
  await pagina.getByTestId("red-web").getByText("Instagram").waitFor();
  await pagina.getByTestId("red-instagram").getByText("Conectado").waitFor();
  await pagina.waitForTimeout(1200);
  await capturar(pagina, "09-metricas-escritorio.png");

  // Informe: vista previa (primeras diapositivas) y todas las diapositivas en una sola imagen.
  capturaActual = "10-informe";
  await pagina.getByRole("button", { name: /Generar informe/ }).click();
  await pagina.getByTestId("diapositiva-1").waitFor();
  await pagina.locator("[data-fuente-lista]").waitFor({ timeout: 15_000 });
  await pagina.waitForTimeout(1000);
  await capturar(pagina, "10-informe-vista-previa.png");

  const diapositivas = pagina.locator("[data-testid^=diapositiva-]");
  const n = await diapositivas.count();
  const piezas = [];
  for (let i = 0; i < n; i++) {
    const d = diapositivas.nth(i);
    await d.scrollIntoViewIfNeeded();
    await pagina.waitForTimeout(150);
    piezas.push(await sharp(await d.screenshot({ animations: "disabled" })).resize(640, 360).png().toBuffer());
  }
  const columnas = 2;
  const filas = Math.ceil(n / columnas);
  const hueco = 16;
  const mosaico = path.join(SALIDA, "11-informe-diapositivas.png");
  await sharp({ create: { width: columnas * 640 + (columnas + 1) * hueco, height: filas * 360 + (filas + 1) * hueco, channels: 3, background: "#e7e2dd" } })
    .composite(piezas.map((input, i) => ({ input, left: hueco + (i % columnas) * (640 + hueco), top: hueco + Math.floor(i / columnas) * (360 + hueco) })))
    .png()
    .toFile(mosaico);
  console.log(`11-informe-diapositivas.png: ${n} diapositivas · ${((await recomprimir(mosaico)) / 1024).toFixed(0)} KB`);

  // PDF: se genera de verdad (html2canvas + jsPDF) y se cuenta una página por diapositiva.
  capturaActual = "pdf";
  const [descarga] = await Promise.all([pagina.waitForEvent("download", { timeout: 120_000 }), pagina.getByRole("button", { name: /Descargar PDF/ }).click()]);
  const rutaPdf = await descarga.path();
  const pdf = await readFile(rutaPdf);
  const paginasPdf = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log(`PDF: ${descarga.suggestedFilename()} · ${(pdf.length / 1024).toFixed(0)} KB · ${paginasPdf} página(s) para ${n} diapositivas`);
  if (paginasPdf !== n) errores.push(`[pdf] el PDF tiene ${paginasPdf} páginas y el informe ${n} diapositivas`);
  if (PDF_EJEMPLO) await copyFile(rutaPdf, PDF_EJEMPLO);
  await contexto.close();
}

{
  // Móvil, como usuario de Marketing (sin Tráfico web): Instagram y Facebook.
  const { contexto, pagina } = await nuevoContexto(navegador, { ancho: 390, alto: 844, dpr: 2, movil: true });
  capturaActual = "12-metricas-movil";
  await ir(pagina, "/rrss?red=metricas");
  await pagina.getByTestId("red-instagram").getByText("Conectado").waitFor();
  await pagina.waitForTimeout(1200);
  if (await pagina.getByTestId("red-web").count()) errores.push("[12-metricas-movil] un usuario sin Tráfico web ve la tarjeta «Web desde redes»");
  await capturar(pagina, "12-metricas-movil.png");
  capturaActual = "12b-informe-movil";
  await pagina.getByRole("button", { name: /Generar informe/ }).click();
  await pagina.getByTestId("diapositiva-1").waitFor();
  await pagina.waitForTimeout(800);
  await revisarMaquetacion(pagina, "12b-informe-movil (sin captura)");
  await contexto.close();
}

await navegador.close();

if (filtrados.size) console.log(`\n${filtrados.size} mensaje(s) del propio montaje (hosts externos cortados o peticiones abortadas), no cuentan:\n- ${[...filtrados].join("\n- ")}`);
console.log(errores.length ? `\n${errores.length} error(es) de consola o de red:\n- ${errores.join("\n- ")}` : "\nSin errores de consola.");
if (avisos.length) console.log(`\n${avisos.length} aviso(s) de maquetación:\n- ${avisos.join("\n- ")}`);
