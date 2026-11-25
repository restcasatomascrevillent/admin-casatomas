#!/usr/bin/env node
// ============================================================================
//  Informes mensuales: saca en PDF todos los informes de Super Admin › Informes
//  (incluido el recibo mensual de Gestor Gasto), los sube a Google Drive y avisa
//  por Telegram con los enlaces.
// ----------------------------------------------------------------------------
//  Petición del dueño (25/11/2026): «Quiero una tarea programada cada mes el
//  último jueves del mes que me saque los informes del apartado de informes en
//  PDF, me saque el recibo mensual de gestor de gasto».
//
//  Por qué así: los PDF se hacen en el NAVEGADOR (diapositivas con html2canvas +
//  jsPDF, y el recibo con jsPDF) con los datos que ve el usuario conectado. Para
//  no duplicar ni el diseño ni los permisos, este script abre el panel publicado
//  con Chromium (Playwright), entra con un usuario super admin de servicio, va a
//  Super Admin › Informes con el mes y pulsa «Descargar PDF» en cada informe,
//  como haría el dueño. Lo que se añada al registro de informes sale solo.
//  Luego sube cada PDF a Drive con la Edge Function `informes-mensuales` y manda
//  el mensaje con `avisos-telegram` (acción «informes»), las dos con el JWT de
//  ese usuario: no hacen falta credenciales de Google ni de Telegram aquí.
//
//  Uso:
//    PANEL_USUARIO=… PANEL_CONTRASENA=… node scripts/informes-mensuales.mjs \
//      [--panel https://admin-casatomas.vercel.app] [--mes 2026-11] [--salida carpeta] \
//      [--sin-drive] [--sin-telegram] [--solo id1,id2]
//    node scripts/informes-mensuales.mjs --comprobar [--cron "7 6 * * 4"]   (¿toca hoy? → GITHUB_OUTPUT)
//
//  Los PDF llevan datos personales (auditoría, votación del vino): se quedan en
//  la carpeta de salida y en Drive; el workflow NO los sube como artefacto. El
//  log solo lleva títulos y nombres de fichero.
// ============================================================================
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { decidir } from "./informes-mensuales/calendario.mjs";
import { leerSesion, nombrePdfSeguro, textoResumen } from "./informes-mensuales/utiles.mjs";

const PANEL_PRODUCCION = "https://admin-casatomas.vercel.app";
const MS_ESTADO = 3 * 60_000; // lo que puede tardar un informe en cargar sus datos
const MS_PDF = 12 * 60_000; // lo que puede tardar en hacerse un PDF de muchas diapositivas

const { values: opciones } = parseArgs({
  options: {
    comprobar: { type: "boolean", default: false },
    cron: { type: "string", default: "" },
    panel: { type: "string", default: process.env.PANEL_URL || PANEL_PRODUCCION },
    mes: { type: "string", default: "" },
    salida: { type: "string", default: "informes-mensuales-pdf" },
    "sin-drive": { type: "boolean", default: false },
    "sin-telegram": { type: "boolean", default: false },
    solo: { type: "string", default: "" },
  },
});

function salidaGithub(clave, valor) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${clave}=${valor}\n`);
}
function resumenGithub(texto) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texto}\n`);
}

// ─── ¿Toca hoy? ──────────────────────────────────────────────────────────────
if (opciones.comprobar) {
  const d = decidir({ cron: opciones.cron });
  console.log(`${d.ejecutar ? "Toca" : "No toca"}: ${d.motivo}.`);
  salidaGithub("ejecutar", String(d.ejecutar));
  salidaGithub("mes", d.mes);
  process.exit(0);
}

// ─── Sacar los informes ──────────────────────────────────────────────────────
const usuario = (process.env.PANEL_USUARIO ?? "").trim();
const contrasena = process.env.PANEL_CONTRASENA ?? "";
if (!usuario || !contrasena) {
  console.error("Faltan PANEL_USUARIO y PANEL_CONTRASENA (usuario super admin de servicio del panel).");
  process.exit(1);
}
const panel = opciones.panel.replace(/\/+$/, "");
const mes = opciones.mes || decidir({}).mes;
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
  console.error(`--mes tiene que ser AAAA-MM (llegó «${mes}»).`);
  process.exit(1);
}
const solo = new Set(opciones.solo.split(",").map((s) => s.trim()).filter(Boolean));
const salida = path.resolve(opciones.salida);
mkdirSync(salida, { recursive: true });

const { chromium } = await import("playwright-core");
const navegador = await chromium.launch({ headless: true });
const contexto = await navegador.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 900 },
  locale: "es-ES",
  timezoneId: "Europe/Madrid",
});
const pagina = await contexto.newPage();
pagina.setDefaultTimeout(60_000);

// La clave pública (apikey) que usa el panel con Supabase: se copia de sus propias peticiones.
let apikey = null;
pagina.on("request", (r) => {
  if (!apikey && /\.supabase\.co\/(rest|auth|functions)\/v1\//.test(r.url())) apikey = r.headers()["apikey"] ?? null;
});

const resultado = { mes, panel, generados: [], sinDatos: [], fallidos: [], subidos: [], carpetaUrl: null, telegram: null };

try {
  // 1. Entrar.
  await pagina.goto(`${panel}/auth`, { waitUntil: "domcontentloaded" });
  await pagina.locator("#login-email").fill(usuario);
  await pagina.locator("#login-password").fill(contrasena);
  await pagina.locator('button[type="submit"]').click();
  await pagina.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 60_000 }).catch(() => {
    throw new Error("No se ha podido entrar en el panel: revisa PANEL_USUARIO y PANEL_CONTRASENA.");
  });
  console.log(`Dentro del panel (${panel}).`);

  // 2. La lista de informes del mes.
  await pagina.goto(`${panel}/super-admin/informes?mes=${mes}`, { waitUntil: "domcontentloaded" });
  const lista = pagina.locator('nav[aria-label="Informes disponibles"]');
  await lista.waitFor({ state: "visible", timeout: 90_000 }).catch(() => {
    throw new Error("No sale la lista de informes: ¿el usuario es super admin?");
  });
  const botones = lista.locator("li button");
  const total = await botones.count();
  const titulos = [];
  for (let i = 0; i < total; i++) titulos.push(((await botones.nth(i).locator("span.block").first().textContent()) ?? "").trim());
  console.log(`${total} informes en la página.`);

  // 3. Cada informe: elegirlo, esperar a que cargue y pulsar «Descargar PDF».
  const usados = new Set();
  for (let i = 0; i < total; i++) {
    const titulo = titulos[i] || `Informe ${i + 1}`;
    await botones.nth(i).click();
    await pagina.waitForURL((u) => u.searchParams.has("informe"));
    const id = new URL(pagina.url()).searchParams.get("informe");
    if (solo.size && !solo.has(id)) continue;
    const vista = pagina.locator("main");
    // La cabecera del informe nuevo (no quedarse con el botón del anterior).
    await vista.locator("h2", { hasText: titulo }).first().waitFor({ state: "visible" }).catch(() => undefined);
    const boton = vista.getByRole("button", { name: /^(Descargar PDF|Creando PDF)/ });
    try {
      const estado = await esperarEstado(vista, boton);
      if (estado === "vacio") {
        console.log(`· ${titulo}: sin datos este mes.`);
        resultado.sinDatos.push(titulo);
        continue;
      }
      if (estado === "error") throw new Error("el informe no ha podido cargar sus datos");
      const [descarga] = await Promise.all([pagina.waitForEvent("download", { timeout: MS_PDF }), boton.click()]);
      const nombre = nombrePdfSeguro(descarga.suggestedFilename(), usados);
      const ruta = path.join(salida, nombre);
      await descarga.saveAs(ruta);
      const fallo = await descarga.failure();
      if (fallo) throw new Error(`la descarga falló: ${fallo}`);
      console.log(`· ${titulo}: ${nombre}`);
      resultado.generados.push({ id, titulo, nombre, ruta });
    } catch (e) {
      console.error(`· ${titulo}: NO se ha podido sacar (${e instanceof Error ? e.message.split("\n")[0] : e}).`);
      resultado.fallidos.push(titulo);
    }
  }

  // 4. Subir a Drive.
  const sesion = async () => {
    const s = leerSesion(await pagina.evaluate(() => Object.entries(window.localStorage)));
    if (!s || !apikey) throw new Error("No se ha encontrado la sesión del panel para llamar a Supabase.");
    return s;
  };
  const llamar = async (funcion, cuerpo) => {
    const { token, supabaseUrl } = await sesion();
    const r = await fetch(`${supabaseUrl}/functions/v1/${funcion}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(180_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  };
  if (!opciones["sin-drive"]) {
    for (const g of resultado.generados) {
      try {
        const j = await llamar("informes-mensuales", { accion: "subir", mes, nombre: g.nombre, pdf_b64: readFileSync(g.ruta).toString("base64") });
        resultado.subidos.push({ titulo: g.titulo, url: j.url });
        resultado.carpetaUrl ??= j.carpeta_url;
        console.log(`  ↑ Drive: ${g.nombre}${j.reemplazado ? " (reemplazado)" : ""}`);
      } catch (e) {
        console.error(`  ↑ Drive: ${g.nombre} NO se ha subido (${e instanceof Error ? e.message : e}).`);
        resultado.fallidos.push(`${g.titulo} (Drive)`);
      }
    }
  }

  // 5. Telegram.
  if (!opciones["sin-telegram"] && !opciones["sin-drive"]) {
    try {
      resultado.telegram = await llamar("avisos-telegram", {
        accion: "informes",
        mes,
        carpeta_url: resultado.carpetaUrl,
        informes: resultado.subidos,
        sin_datos: resultado.sinDatos,
        fallidos: resultado.fallidos,
      });
      console.log(`Telegram: ${resultado.telegram.enviados ? "enviado" : `no enviado (${resultado.telegram.motivo ?? "sin motivo"})`}.`);
    } catch (e) {
      console.error(`Telegram: NO se ha enviado (${e instanceof Error ? e.message : e}).`);
      resultado.fallidos.push("Mensaje de Telegram");
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  resultado.fallidos.push(`Tarea entera: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
} finally {
  await navegador.close();
}

const texto = textoResumen({ mes, generados: resultado.generados.length, subidos: resultado.subidos.length, sinDatos: resultado.sinDatos, fallidos: resultado.fallidos });
console.log(`\n${texto}`);
resumenGithub(`### Informes mensuales\n\n${texto.replace(/\n/g, "\n\n")}`);
writeFileSync(
  path.join(salida, "resumen.json"),
  JSON.stringify({ ...resultado, generados: resultado.generados.map(({ ruta: _r, ...g }) => g) }, null, 2),
);
process.exit(resultado.fallidos.length ? 1 : 0);

/** Espera a que el informe esté listo: «listo» (botón activo), «vacio» (no hay datos) o «error». */
async function esperarEstado(vista, boton) {
  const fin = Date.now() + MS_ESTADO;
  while (Date.now() < fin) {
    if ((await boton.count()) && (await boton.first().isEnabled())) return "listo";
    if (await vista.getByText("No hay datos para este informe").count()) return "vacio";
    if (await vista.getByRole("button", { name: "Reintentar" }).count()) return "error";
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("el informe no ha terminado de cargar a tiempo");
}
