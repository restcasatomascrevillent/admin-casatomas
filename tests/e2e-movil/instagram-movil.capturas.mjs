// Capturas y comprobaciones de /instagram en el MÓVIL (asistente «Crear» y el resto de pestañas, 05/11/2026) con el
// Supabase falso de esta carpeta: nada sale a Supabase ni a Internet, los datos son sintéticos y la IA está simulada
// (montar_pieza responde tras unos segundos para poder ver el paso 2 «cargando»). Las fotos se pintan en el propio
// navegador (canvas) y la subida a tmp/ se guarda en memoria para servirlas luego.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/instagram-movil.capturas.mjs [carpeta-de-capturas]
//
// Comprueba en cada tamaño: sin scroll horizontal de página, el botón principal del asistente dentro de la pantalla
// y nada de texto por debajo de 14 px dentro del asistente. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";
import { funciones, rpc, tablasInstagram } from "./instagram-datos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-instagram-movil";
const TAMANOS = (process.env.E2E_TAMANOS ?? "375x812,390x844,360x740").split(",").map((t) => t.split("x").map(Number));
const ESPERA_IA_MS = 6000;

const TITULARES = ["Centolla del día", "Recién llegada", "Del mar a la mesa", "Para compartir", "Solo hoy", "Así llega"];
/** Montaje simulado con el mismo contrato que instagram-ia → montar_pieza. */
const montaje = (cuerpo) => ({
  ok: true,
  formato: cuerpo.fotos.length > 1 ? "carrusel" : "post",
  diapositivas: cuerpo.fotos.map((f, i) => ({ foto: f.id, plantilla: "ct-foto-titular", datos: { titular: `SIM ${TITULARES[i % TITULARES.length]}` }, altText: `Foto ${i + 1} del producto` })),
  caption: "SIM Hoy ha llegado la centolla y la tenemos en la barra y en el comedor. Ven a probarla antes de que se acabe.",
  hashtags: ["#Crevillent", "#CasaTomas", "#marisco"],
  horaSugerida: null,
  resumen: `SIM He entendido: ${cuerpo.fotos.length} fotos de centolla recién llegada; empiezo por la más vistosa.`,
  avisos: [],
});

/** JPEGs de prueba pintados en el navegador (no hacen falta ficheros). */
async function fotosDePrueba(pagina, n) {
  const datos = await pagina.evaluate(async (n) => {
    const colores = ["#b4472a", "#8a5a2b", "#7a2e1d", "#c49a4a", "#3d6b7a", "#5c7a3d"];
    const salida = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas");
      c.width = 1080;
      c.height = 1350;
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 1080, 1350);
      grad.addColorStop(0, colores[i % colores.length]);
      grad.addColorStop(1, "#1d1d1d");
      g.fillStyle = grad;
      g.fillRect(0, 0, 1080, 1350);
      g.fillStyle = "rgba(255,255,255,.85)";
      g.beginPath();
      g.ellipse(540, 700, 300 + i * 20, 220, i / 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#222";
      g.font = "bold 90px Georgia";
      g.textAlign = "center";
      g.fillText(`SIM foto ${i + 1}`, 540, 720);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (const b of buf) bin += String.fromCharCode(b);
      salida.push(btoa(bin));
    }
    return salida;
  }, n);
  return datos.map((b64, i) => ({ name: `centolla-${i + 1}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") }));
}

/** Comprobaciones de la pantalla actual: scroll horizontal, botón fuera, textos pequeños dentro del asistente. */
async function comprobar(pagina, etiqueta, fallos, { boton } = {}) {
  const m = await pagina.evaluate(() => ({ ancho: window.innerWidth, alto: window.innerHeight, sw: document.documentElement.scrollWidth }));
  if (m.sw > m.ancho + 1) {
    const anchos = await pagina.evaluate((w) => {
      const fuera = [];
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.right > w + 1 && r.width > 0 && !el.closest("[role=tablist], [data-testid=carrusel-previa], [aria-label^='Tus fotos']")) fuera.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} (${Math.round(r.right)})`);
      }
      return fuera.slice(0, 4);
    }, m.ancho);
    fallos.push(`${etiqueta}: scroll horizontal de página (${m.sw} > ${m.ancho}): ${anchos.join(" · ")}`);
  }
  // Lo que se sale por la derecha de la pestaña (su contenedor hace scroll y lo esconde: la página no lo nota).
  const panel = await pagina.evaluate(() => {
    const el = document.querySelector("[role=tabpanel][data-state=active]");
    if (!el || el.scrollWidth <= el.clientWidth + 1) return null;
    const derecha = el.getBoundingClientRect().right;
    const fuera = [];
    for (const x of el.querySelectorAll("*")) {
      const r = x.getBoundingClientRect();
      if (r.right > derecha + 1 && r.width > 0 && !x.parentElement?.closest("[data-fuera-panel]")) {
        x.setAttribute("data-fuera-panel", "");
        fuera.push(`${x.tagName.toLowerCase()}[${x.getAttribute("data-testid") ?? ""}].${String(x.className).split(" ").slice(0, 4).join(".")} (${Math.round(r.right)})`);
      }
    }
    return { sw: el.scrollWidth, cw: el.clientWidth, fuera: fuera.slice(0, 5) };
  });
  if (panel) fallos.push(`${etiqueta}: la pestaña hace scroll horizontal (${panel.sw} > ${panel.cw}): ${panel.fuera.join(" · ")}`);
  if (boton) {
    const caja = await pagina.getByRole("button", { name: boton }).first().boundingBox();
    if (!caja || caja.y + caja.height > m.alto + 1) fallos.push(`${etiqueta}: «${boton}» fuera de la pantalla (${JSON.stringify(caja)})`);
  }
  const pequenos = await pagina.evaluate(() => {
    const raiz = document.querySelector("[data-testid=crear-movil]");
    if (!raiz) return [];
    const malos = [];
    for (const el of raiz.querySelectorAll("*")) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      if (el.closest(".sr-only, iframe")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 14) malos.push(`«${el.textContent.trim().slice(0, 30)}» ${px}px`);
    }
    return malos.slice(0, 5);
  });
  if (pequenos.length) fallos.push(`${etiqueta}: textos de menos de 14 px: ${pequenos.join(" · ")}`);
}

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox"] });
const fallos = [];
for (const [ancho, alto] of TAMANOS) {
  const tam = `${ancho}x${alto}`;
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "es-ES", timezoneId: "Europe/Madrid", baseURL: BASE });
  const t = tablas();
  Object.assign(t, tablasInstagram());
  await instalarSupabaseFalso(contexto, {
    urlSupabase: URL_SUPABASE,
    tablas: t,
    rpc,
    funciones: {
      ...funciones,
      "instagram-ia": async (req) => {
        let cuerpo = {};
        try {
          cuerpo = JSON.parse(req.postData() || "{}");
        } catch {
          /* vacío */
        }
        if (cuerpo.accion !== "montar_pieza") return { ok: true };
        await new Promise((r) => setTimeout(r, ESPERA_IA_MS));
        return montaje(cuerpo);
      },
    },
  });
  // Subidas a tmp/: se guardan y se sirven (las rutas registradas después mandan sobre las del Supabase falso).
  const subidas = new Map();
  await contexto.route(/\.supabase\.co\/storage\/v1\//, async (route) => {
    const req = route.request();
    const ruta = new URL(req.url()).pathname.replace(/^.*\/instagram\//, "");
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.method() === "POST" || req.method() === "PUT") {
      // supabase-js manda el Blob en un multipart: nos quedamos con el JPEG (de FFD8 al último FFD9).
      const b = req.postDataBuffer() ?? Buffer.alloc(0);
      const ini = b.indexOf(Buffer.from([0xff, 0xd8]));
      const fin = b.lastIndexOf(Buffer.from([0xff, 0xd9]));
      subidas.set(ruta, ini >= 0 && fin > ini ? b.subarray(ini, fin + 2) : b);
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ Key: `instagram/${ruta}`, Id: ruta }) });
    }
    const cuerpo = subidas.get(ruta);
    if (cuerpo) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "image/jpeg" }, body: cuerpo });
    return route.fallback();
  });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(e.message));
  const foto = (nombre) => pagina.screenshot({ path: path.join(SALIDA, `${tam}-${nombre}.png`) });

  await pagina.goto("/instagram?tab=crear", { waitUntil: "domcontentloaded" });
  if (!process.env.E2E_SOLO_PESTANAS) {
  await pagina.getByTestId("crear-movil").waitFor({ timeout: 20_000 });
  await pagina.waitForTimeout(800);
  await comprobar(pagina, `${tam} paso 1 vacío`, fallos, { boton: /Montar con IA/ });
  await foto("01-paso1-vacio");

  await pagina.getByTestId("input-carrete").setInputFiles(await fotosDePrueba(pagina, 6));
  await pagina.getByLabel(/Algo que contar/).fill("Ha llegado la centolla gallega, solo este fin de semana");
  await pagina.getByText(/6 fotos listas/).waitFor({ timeout: 30_000 });
  await pagina.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {}); // cierra el teclado
  await pagina.getByTestId("crear-movil").locator("input").first().blur().catch(() => {});
  await pagina.getByTestId("crear-movil").locator(".overflow-y-auto").first().evaluate((el) => (el.scrollTop = 0));
  await comprobar(pagina, `${tam} paso 1 con fotos`, fallos, { boton: /Montar con IA/ });
  await foto("02-paso1-fotos");

  await pagina.getByRole("button", { name: /Montar con IA/ }).click();
  await pagina.getByTestId("montando-previa").waitFor();
  await pagina.waitForTimeout(3000);
  await comprobar(pagina, `${tam} paso 2 cargando`, fallos);
  await foto("03-paso2-cargando");

  await pagina.getByTestId("resumen-ia").waitFor({ timeout: 20_000 });
  await pagina.waitForTimeout(1500);
  await comprobar(pagina, `${tam} paso 2 terminado`, fallos, { boton: "Siguiente: publicar" });
  await foto("04-paso2-terminado");

  await pagina.getByRole("button", { name: "Siguiente: publicar" }).click();
  await pagina.waitForTimeout(600);
  await comprobar(pagina, `${tam} paso 3`, fallos, { boton: "Publicar ahora" });
  await foto("05-paso3-publicar");
  } else await pagina.waitForTimeout(1500);

  // Las demás pestañas (el asistente se queda guardado en el móvil).
  for (const [nombre, etiqueta] of [["estudio", "Estudio"], ["campanas", "Campañas"], ["calendario", "Calendario"], ["encargos", "Encargos"], ["metricas", "Métricas"]]) {
    await pagina.getByRole("tab", { name: new RegExp(`^${etiqueta}`) }).click();
    await pagina.waitForLoadState("networkidle").catch(() => {});
    await pagina.waitForTimeout(1500);
    await comprobar(pagina, `${tam} ${nombre}`, fallos);
    await foto(`1${["estudio", "campanas", "calendario", "encargos", "metricas"].indexOf(nombre)}-${nombre}`);
  }
  if (errores.length) fallos.push(`${tam}: errores de JavaScript: ${errores.slice(0, 3).join(" | ")}`);
  console.log(`${tam}: hecho`);
  await contexto.close();
}
await navegador.close();
if (fallos.length) {
  console.error(`\n${fallos.length} problema(s):\n- ${fallos.join("\n- ")}`);
  process.exitCode = 1;
} else console.log("\nSin scroll horizontal, botones a la vista y textos de 14 px o más en el asistente.");
