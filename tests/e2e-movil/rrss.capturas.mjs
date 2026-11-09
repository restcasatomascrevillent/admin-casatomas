// Capturas de la sección RRSS para el PR (pestañas Instagram, Facebook y Subida de fotos: editor IA e ideas para
// grabar) con el Supabase falso de esta carpeta: ninguna petición sale a Supabase ni a Internet. Encima del falso se
// añaden las tablas rrss_*, el cubo privado «rrss» (URL firmadas que sirven ficheros del disco, con Range para el
// vídeo) y la Edge Function rrss-ia simulada (ideas). Los datos y de dónde salen las fotos editadas: rrss-datos.mjs.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   RRSS_DATOS=<carpeta con carrusel-0..2.jpg, reel.mp4 y reel-portada.jpg> node tests/e2e-movil/rrss.capturas.mjs [carpeta-de-capturas]
//
// Por defecto escribe en docs/rrss/capturas/. Sin RRSS_DATOS (o si falta algún fichero) usa recortes simples de las
// fotos originales en lugar de los resultados del motor. Al final lista los errores de consola y los avisos de
// maquetación (scroll horizontal, contenido que se sale sin poder hacer scroll). No entra en `npm test`.
// Variables: E2E_BASE_URL, E2E_SUPABASE_URL, RRSS_DATOS.
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_ID, consultar, instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";
import { funciones, rpc, tablasInstagram } from "./instagram-datos.mjs";
import { PETICION_IDEAS, P_CARRUSEL, P_REEL, ficherosCubo, rrssIa, tablasRrss } from "./rrss-datos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "docs/rrss/capturas";
const DATOS = process.env.RRSS_DATOS || null;
const MAX_BYTES = 1.5 * 1024 * 1024;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS", "access-control-expose-headers": "content-range, content-type, content-length, accept-ranges" };
const TIPOS = { ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4" };

const { mapa: CUBO, sustitutos } = await ficherosCubo(DATOS);
if (sustitutos.length) console.warn(`Sin resultado del motor para ${sustitutos.join(", ")}: se usa un recorte de la foto original${DATOS ? "" : " (falta RRSS_DATOS)"}.`);

/** Usuario de Marketing (ver y editar), sin super admin: lo que verá el restaurante. */
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

/** Cubo «rrss» (URL firmadas y ficheros) y escrituras en rrss_* que sí se guardan en memoria. */
async function instalarRrss(contexto, t) {
  await contexto.route(/^https?:\/\/[^/]*supabase\.(co|in)\/storage\/v1\//, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (req.method() === "POST" && u.pathname === "/storage/v1/object/sign/rrss") {
      const { paths = [] } = JSON.parse(req.postData() || "{}");
      const cuerpo = paths.map((p) => (CUBO[p] ? { error: null, path: p, signedURL: `/object/sign/rrss/${p}?token=firma-falsa` } : { error: "Object not found", path: p, signedURL: null }));
      return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
    }
    const m = /^\/storage\/v1\/object\/(?:sign|authenticated|public)?\/?rrss\/(.+)$/.exec(u.pathname);
    if (req.method() === "GET" && m) {
      const ruta = decodeURIComponent(m[1]);
      const fichero = CUBO[ruta];
      if (!fichero) return route.fulfill({ status: 404, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }) });
      const buf = await readFile(fichero);
      const tipo = TIPOS[path.extname(fichero)] ?? "application/octet-stream";
      const rango = /bytes=(\d+)-(\d*)/.exec(req.headers().range ?? "");
      if (rango) {
        const ini = Number(rango[1]);
        const fin = rango[2] ? Math.min(Number(rango[2]), buf.length - 1) : buf.length - 1;
        return route.fulfill({ status: 206, headers: { ...CORS, "content-type": tipo, "accept-ranges": "bytes", "content-range": `bytes ${ini}-${fin}/${buf.length}` }, body: buf.subarray(ini, fin + 1) });
      }
      return route.fulfill({ status: 200, headers: { ...CORS, "content-type": tipo, "accept-ranges": "bytes" }, body: buf });
    }
    return route.fallback();
  });

  await contexto.route(/^https?:\/\/[^/]*supabase\.(co|in)\/rest\/v1\/rrss_/, async (route) => {
    const req = route.request();
    const metodo = req.method();
    if (metodo === "GET" || metodo === "HEAD" || metodo === "OPTIONS") return route.fallback();
    const u = new URL(req.url());
    const tabla = decodeURIComponent(u.pathname.slice("/rest/v1/".length));
    const filas = (t[tabla] ??= []);
    const sel = u.searchParams.get("select") ?? "*";
    const filtros = new URLSearchParams([...u.searchParams].filter(([k]) => !["select", "columns", "on_conflict"].includes(k)));
    let cuerpo = null;
    try {
      cuerpo = JSON.parse(req.postData() || "null");
    } catch {
      /* sin cuerpo */
    }
    let ids = [];
    const ahora = new Date().toISOString();
    if (metodo === "POST") {
      for (const f of Array.isArray(cuerpo) ? cuerpo : [cuerpo]) {
        const nueva = { id: f?.id ?? crypto.randomUUID(), created_at: ahora, updated_at: ahora, ...f };
        filas.push(nueva);
        ids.push(nueva.id);
      }
    } else {
      ids = consultar(t, tabla, filtros).filas.map((f) => f.id);
      if (metodo === "DELETE") t[tabla] = filas.filter((f) => !ids.includes(f.id));
      else for (const f of filas) if (ids.includes(f.id)) Object.assign(f, cuerpo, "updated_at" in f ? { updated_at: ahora } : {});
    }
    const prefer = req.headers().prefer ?? "";
    if (!/return=representation/.test(prefer)) return route.fulfill({ status: metodo === "POST" ? 201 : 204, headers: CORS });
    const eco = metodo === "DELETE" ? [] : consultar(t, tabla, new URLSearchParams({ select: sel, id: `in.(${ids.join(",")})` })).filas;
    const objeto = (req.headers().accept ?? "").includes("vnd.pgrst.object");
    return route.fulfill({ status: metodo === "POST" ? 201 : 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(objeto ? eco[0] ?? null : eco) });
  });
}

// ── Recogida de errores y avisos ────────────────────────────────────────────
const errores = [];
const avisos = [];
let capturaActual = "inicio";
/** Errores que provoca el propio montaje hermético (fuentes y hosts externos cortados), no la pantalla. */
const DEL_MONTAJE = /ERR_BLOCKED_BY_CLIENT|blockedbyclient|fonts\.(googleapis|gstatic)\.com/i;

function vigilar(pagina) {
  pagina.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const texto = m.text();
    if (DEL_MONTAJE.test(texto) || DEL_MONTAJE.test(m.location()?.url ?? "")) return;
    errores.push(`[${capturaActual}] console.${m.type()}: ${texto.slice(0, 400)}`);
  });
  pagina.on("pageerror", (e) => errores.push(`[${capturaActual}] pageerror: ${e.message.slice(0, 400)}`));
  pagina.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (DEL_MONTAJE.test(f) || /ERR_ABORTED/.test(f)) return;
    errores.push(`[${capturaActual}] petición fallida: ${r.method()} ${r.url().slice(0, 160)} (${f})`);
  });
  pagina.on("response", (r) => {
    if (r.status() >= 400 && /supabase\.co/.test(r.url())) errores.push(`[${capturaActual}] ${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
  });
}

async function nuevoContexto(navegador, { ancho, alto, dpr = 1, movil = false }) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: dpr, isMobile: movil, hasTouch: movil, locale: "es-ES", timezoneId: "Europe/Madrid", baseURL: BASE });
  const t = tablasCaptura();
  await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: t, rpc, funciones: { ...funciones, "rrss-ia": rrssIa } });
  await instalarRrss(contexto, t);
  const pagina = await contexto.newPage();
  vigilar(pagina);
  return { contexto, pagina };
}

async function ir(pagina, ruta) {
  await pagina.goto(ruta, { waitUntil: "domcontentloaded" });
  await pagina.waitForLoadState("networkidle").catch(() => {});
  await pagina.getByTestId("pagina-rrss").waitFor();
}

/** Espera a que todas las imágenes que casan con `selector` estén cargadas. */
async function esperarImagenes(pagina, selector, minimo = 1) {
  await pagina.waitForFunction(
    ({ selector, minimo }) => {
      const imgs = [...document.querySelectorAll(selector)];
      return imgs.length >= minimo && imgs.every((i) => i.complete && i.naturalWidth > 0);
    },
    { selector, minimo },
    { timeout: 20_000 },
  );
}

/** Alarga la ventana hasta que el contenedor con scroll interno quepa entero (las capturas «tan altas como haga falta»). */
async function altoParaVerTodo(pagina, selector, maximo = 4000) {
  for (let i = 0; i < 4; i++) {
    const extra = await pagina.locator(selector).first().evaluate((el) => el.scrollHeight - el.clientHeight);
    if (extra <= 1) return;
    const v = pagina.viewportSize();
    await pagina.setViewportSize({ width: v.width, height: Math.min(maximo, v.height + extra + 8) });
    await pagina.waitForTimeout(400);
  }
}

/** Avisos de maquetación de la pantalla actual. */
async function revisarMaquetacion(pagina, nombre) {
  const r = await pagina.evaluate(() => {
    const out = [];
    const w = window.innerWidth;
    if (document.documentElement.scrollWidth > w + 1) out.push(`scroll horizontal de página (${document.documentElement.scrollWidth} > ${w})`);
    // Contenedores que recortan (overflow hidden/visible) con contenido más alto y sin scroll propio.
    const editor = document.querySelector("[data-testid=editor-ia]");
    if (editor) {
      const pagina = document.querySelector("[data-testid=pagina-rrss]");
      const caja = pagina?.getBoundingClientRect();
      const main = editor.querySelector(":scope > main");
      const mr = main?.getBoundingClientRect();
      const estilo = main ? getComputedStyle(main).overflowY : "";
      if (caja && mr && mr.bottom > caja.bottom + 1 && estilo !== "auto" && estilo !== "scroll") {
        const docScroll = document.scrollingElement.scrollHeight > window.innerHeight + 1;
        out.push(`el editor (${Math.round(mr.height)} px) se sale del bloque de la página (alto fijo ${Math.round(caja.height)} px) y su <main> no tiene scroll propio (overflow-y: ${estilo}); scroll de documento: ${docScroll ? "sí" : "no"}`);
      }
    }
    // Elementos que se salen por la derecha.
    const fuera = [];
    for (const el of document.body.querySelectorAll("*")) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > w + 1 && !el.closest("[role=tablist]") && fuera.length < 4) fuera.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} (${Math.round(b.right)} px)`);
    }
    if (fuera.length) out.push(`se sale por la derecha: ${fuera.join(" · ")}`);
    return out;
  });
  for (const a of r) avisos.push(`[${nombre}] ${a}`);
}

/** Captura de la ventana y recompresión si pesa demasiado. */
async function capturar(pagina, nombre) {
  await pagina.waitForTimeout(500);
  await revisarMaquetacion(pagina, nombre);
  const destino = path.join(SALIDA, nombre);
  await pagina.screenshot({ path: destino, animations: "disabled", caret: "hide" });
  let bytes = (await stat(destino)).size;
  if (bytes > MAX_BYTES) {
    await writeFile(destino, await sharp(destino).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer());
    bytes = (await stat(destino)).size;
  }
  if (bytes > MAX_BYTES) {
    await writeFile(destino, await sharp(destino).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toBuffer());
    bytes = (await stat(destino)).size;
  }
  const v = pagina.viewportSize();
  console.log(`${nombre}: ${v.width}×${v.height} · ${(bytes / 1024).toFixed(0)} KB`);
}

// ── Recorrido ───────────────────────────────────────────────────────────────
await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();

{
  const { contexto, pagina } = await nuevoContexto(navegador, { ancho: 1440, alto: 900 });

  // 1. RRSS › Instagram (por defecto), con las tres pestañas arriba.
  capturaActual = "01-rrss-instagram";
  await ir(pagina, "/rrss");
  await pagina.getByRole("tab", { name: "Instagram" }).waitFor();
  await pagina.waitForTimeout(1500);
  await capturar(pagina, "01-rrss-instagram.png");

  // 2. RRSS › Facebook: preparar (sí) y publicar (no conectado), con el editor debajo.
  capturaActual = "02-rrss-facebook";
  await ir(pagina, "/rrss?red=facebook");
  await pagina.getByTestId("fb-publicacion").waitFor();
  await pagina.getByTestId("editor-ia").waitFor();
  await pagina.getByTestId(/^trabajo:/).first().waitFor();
  await pagina.waitForTimeout(800);
  await capturar(pagina, "02-rrss-facebook.png");

  // 3. Editor con el carrusel de 3 fotos: paso «Estilo» con las 6 vistas previas sobre la primera foto.
  capturaActual = "03-editor-estilos";
  await ir(pagina, `/rrss?red=editor&trabajo=${P_CARRUSEL}`);
  await pagina.getByTestId("resultado:0").waitFor(); // abre solo en «Resultado» (tiene resultados)
  await pagina.getByTestId("paso:4").click();
  await esperarImagenes(pagina, "img[data-testid^='imagen-estilo:']", 6);
  await altoParaVerTodo(pagina, "[data-testid=editor-ia] > main", 1300);
  await capturar(pagina, "03-editor-estilos.png");

  // 4. Paso «Resultado»: carrusel editado con el comparador antes/después y el texto de la publicación.
  capturaActual = "04-editor-resultado";
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.getByTestId("paso:7").click();
  await esperarImagenes(pagina, "[data-testid=comparador] img", 6);
  // El primero, con el corte un poco a la izquierda para que se vea el «después» con el rótulo.
  await pagina.getByLabel("Comparar antes y después").first().fill("38");
  await altoParaVerTodo(pagina, "[data-testid=editor-ia] > main");
  await capturar(pagina, "04-editor-resultado.png");

  // 5. «Ajustar» abierto en la primera foto.
  capturaActual = "05-editor-ajustes";
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.getByTestId("resultado:0").getByRole("button", { name: "Ajustar" }).click();
  await pagina.getByTestId("ajustes-foto").waitFor();
  await pagina.waitForTimeout(400);
  const cajaAjustes = await pagina.getByTestId("resultado:0").evaluate((el) => {
    const main = el.closest("main");
    main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - 12;
    return { alto: el.getBoundingClientRect().height, top: main.getBoundingClientRect().top };
  });
  await pagina.setViewportSize({ width: 1440, height: Math.min(2200, Math.round(cajaAjustes.top + cajaAjustes.alto + 90)) });
  await pagina.waitForTimeout(500);
  await pagina.getByTestId("resultado:0").evaluate((el) => {
    const main = el.closest("main");
    main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - 12;
  });
  await capturar(pagina, "05-editor-ajustes.png");

  // 6. Reel: resultado en vídeo (reproductor con póster) y la lista de tomas de «Ajustar el vídeo».
  capturaActual = "06-editor-video";
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await ir(pagina, `/rrss?red=editor&trabajo=${P_REEL}`);
  await pagina.getByTestId("resultado-video").waitFor();
  await pagina.getByRole("button", { name: "Ajustar el vídeo" }).click();
  await pagina.getByTestId("ajustes-video").waitFor();
  await pagina.waitForFunction(() => {
    const v = document.querySelector("[data-testid=resultado-video] video");
    return v && v.poster && v.readyState >= 1;
  }, null, { timeout: 15_000 }).catch(() => avisos.push("[06-editor-video] el <video> no llegó a leer los metadatos (readyState < 1)"));
  const sinTomas = await pagina.getByTestId("ajustes-video").evaluate((el) => {
    const main = el.closest("main");
    const tit = el.querySelector("#av-titulos");
    return { main: main.getBoundingClientRect().top, fin: tit.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop };
  });
  // Hasta el final de la lista de tomas («Duración total»), sin el resto de ajustes.
  await pagina.setViewportSize({ width: 1440, height: Math.min(2400, Math.round(sinTomas.main + sinTomas.fin + 10)) });
  await pagina.waitForTimeout(500);
  await pagina.locator("[data-testid=editor-ia] > main").evaluate((m) => (m.scrollTop = 0));
  await capturar(pagina, "06-editor-video.png");
  const estadoVideo = await pagina.locator("[data-testid=resultado-video] video").evaluate((v) => ({ readyState: v.readyState, error: v.error?.code ?? null, duracion: v.duration }));
  if (estadoVideo.error) avisos.push(`[06-editor-video] el navegador de las capturas no reproduce el MP4 (MediaError ${estadoVideo.error}); se ve el póster`);

  // 7. «Dame ideas para grabar» con una tanda de ideas.
  capturaActual = "07-ideas";
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await ir(pagina, "/rrss?red=editor&modo=ideas");
  await pagina.getByRole("button", { name: "Un plato" }).click();
  await pagina.getByRole("button", { name: /Pulpo á feira/ }).click();
  await pagina.locator("#ideas-detalle").fill(PETICION_IDEAS.detalle);
  await pagina.locator("#ideas-material").fill(PETICION_IDEAS.material);
  await pagina.getByRole("button", { name: "Dame ideas" }).click();
  await pagina.getByRole("article", { name: "Propuesta 3" }).waitFor();
  await pagina.waitForTimeout(300);
  await altoParaVerTodo(pagina, "[role=tabpanel][data-state=active] [role=tabpanel][data-state=active]", 3200);
  await capturar(pagina, "07-ideas.png");

  await contexto.close();
}

{
  // 8. El editor en el móvil (390×844): el carrusel en «Resultado».
  capturaActual = "08-editor-movil";
  const { contexto, pagina } = await nuevoContexto(navegador, { ancho: 390, alto: 844, dpr: 2, movil: true });
  await ir(pagina, `/rrss?red=editor&trabajo=${P_CARRUSEL}`);
  await pagina.getByTestId("resultado:0").waitFor();
  await esperarImagenes(pagina, "[data-testid=comparador] img", 6);
  await capturar(pagina, "08-editor-movil.png");
  await contexto.close();
}

await navegador.close();

console.log(errores.length ? `\n${errores.length} error(es) de consola o de red:\n- ${errores.join("\n- ")}` : "\nSin errores de consola.");
if (avisos.length) console.log(`\n${avisos.length} aviso(s) de maquetación:\n- ${avisos.join("\n- ")}`);
