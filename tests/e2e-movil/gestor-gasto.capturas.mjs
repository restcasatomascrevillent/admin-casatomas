// Capturas de Super Admin › Gestor Gasto (recibos y Control Excel) con el Supabase falso de esta carpeta: nada sale a
// Supabase, a Google Drive ni a Internet. Datos sintéticos: un borrador de licencia, un recibo mensual emitido, los
// servicios de datos-sinteticos.mjs con costes del mes y el estado del Excel de control de un cliente inventado.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/gestor-gasto.capturas.mjs [carpeta-de-capturas]
//
// Saca móvil (375×812) y escritorio (1280×800) de cada pantalla (recibos, pago mensual con los gastos de Servicios y
// sus descuentos, vista previa del PDF y Control Excel), avisa si algo se desborda en horizontal y comprueba que en el
// recibo no aparece ningún dato fiscal. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-gestor-gasto";
const ahora = new Date();
const iso = ahora.toISOString();
const hoy = iso.slice(0, 10);
const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
const CLIENTE = "Bar Ejemplo";

const linea = (id, concepto, precio, x = {}) => ({ id, categoria: "Módulo", concepto, periodicidad: "Mensual", cantidad: 1, precio, descuento: 0, iva: 0, ...x });
const catalogo = {
  cuotaMensual: 800,
  productos: [
    { id: "instalacion", nombre: "Instalación y puesta en marcha", categoria: "Instalación", precio: 1700, periodicidad: "Puntual" },
    { id: "licencia", nombre: "Licencia del panel", categoria: "Licencia", precio: 0, periodicidad: "Mensual" },
    { id: "web", nombre: "Gestor Web", categoria: "Módulo", precio: 0, periodicidad: "Mensual" },
    { id: "reservas", nombre: "Reservas y espacios", categoria: "Módulo", precio: 0, periodicidad: "Mensual" },
  ],
  paquetes: [{ id: "esencial", nombre: "Panel esencial", productoIds: ["licencia", "web", "reservas"] }],
};
const parte = (nombre) => ({ nombre, nif: "", direccion: "", email: "" });
const base = { vencimiento: hoy, emisor: parte("OficiosOsIA"), cliente: parte(CLIENTE), retencion: 0, descuentoGlobal: 0, aplicarIva: false, pago: "Efectivo", notas: "" };
const licencia = { ...base, numero: "R-2026-002", fecha: hoy, tipo: "licencia", catalogo,
  lineas: [linea("l1", "Instalación y puesta en marcha", 1700, { categoria: "Instalación", periodicidad: "Puntual" }), linea("l2", "Extras: fotos y mejoras", 500, { categoria: "Otros", periodicidad: "Puntual", descuento: 10 })] };
const mensual = { ...base, numero: "R-2026-001", fecha: hoy, tipo: "mensual", mes: mesActual,
  lineas: [linea("m1", "Cuota mensual", 800, { categoria: "Licencia", productoId: "cuota-mensual" }), linea("m2", "OpenAI · IA", 12.4, { categoria: "Servicio", proveedor: "openai" }), linea("m3", "Vercel · Hosting", 21.47, { categoria: "Servicio", proveedor: "vercel", descuento: 50 })] };
const facturacion = () => ({
  config: { documento: licencia, actualizado_en: iso },
  facturas: [{ id: "f-1", numero: mensual.numero, documento: mensual, creado_en: iso, actualizado_en: iso }],
  borradores: [{ id: "b-1", numero: licencia.numero, documento: licencia, factura_id: null, creado_en: iso, actualizado_en: iso }],
});

const uso = (importe, moneda = "USD") => ({ importe, moneda, periodo: "mes en curso", origen: "api" });
const resumenMes = () => [
  { proveedor: "openai", lecturas: 40, coste_variable: uso(13.5) },
  { proveedor: "vapi", lecturas: 40, coste_variable: uso(1.2) },
  { proveedor: "stripe", lecturas: 40, coste_variable: uso(0.55, "EUR") },
  { proveedor: "vercel", lecturas: 3, manual_importe: 21.47, manual_moneda: "EUR", manual_nota: "Factura Vercel" },
];

const cobro = (fila, x) => ({ fila, fechaPrevista: hoy, fechaCobro: null, tipo: "Mensualidad", detalle: "", pactado: 0, cobrado: null, pendiente: 0, estado: "Pendiente", recibidoPor: "", metodo: "Efectivo", notas: "", comprobar: "", ...x });
const gasto = (fila, x) => ({ fila, fecha: hoy, proveedor: "", tipo: "IA", detalle: "", importe: null, pagadoPor: "", repercutir: "Sí", metodo: "Tarjeta", notas: "", comprobar: "", ...x });
const controlExcel = () => ({
  ok: true, disponible: true, cliente: CLIENTE, soloLectura: false, revision: "rev-1",
  archivo: { id: "excel-falso", nombre: "Control_OFICIOSOSIA.xlsm", modificado: iso, url: "https://drive.sim.test/file/excel-falso" },
  ficha: { estado: "Activo", desde: hoy, instalacionPactada: 1700, cuotaPactada: 800, diaCobro: 30, notas: "Primer pago: instalación + mes + extras" },
  cobros: [
    cobro(7, { tipo: "Instalación", detalle: "Instalación inicial", pactado: 1700, cobrado: 1700, fechaCobro: hoy, estado: "Cobrado", recibidoPor: "Caja común" }),
    cobro(8, { tipo: "Otro", detalle: "Extras fotos + mejoras", pactado: 500, cobrado: 200, fechaCobro: hoy, pendiente: 300, estado: "Parcial", comprobar: "Falta receptor" }),
    cobro(9, { tipo: "Mensualidad", detalle: "Noviembre", pactado: 800, pendiente: 800 }),
  ],
  gastos: [
    gasto(9, { proveedor: "Hostinger", tipo: "Dominio", detalle: "Noviembre", importe: 17.14, pagadoPor: "Pablo" }),
    gasto(11, { proveedor: "Vercel", tipo: "Hosting", detalle: "Noviembre", importe: 21.47, pagadoPor: "Miguel" }),
    gasto(8, { proveedor: "OpenAI", tipo: "IA", detalle: "Noviembre", repercutir: "", comprobar: "Falta pagador" }),
  ],
  resumen: { cobradoTotal: 1900, instalacionCobrada: 1700, instalacionPendiente: 0, cuotasCobradas: 0, reembolsosCobrados: 0, otrosCobrados: 200, pendienteCobro: 1100, cobrosPendientes: 2,
    gastosRepercutibles: 38.61, costesPorRecuperar: 38.61, gastosTotal: 38.61, avisos: 2 },
  listas: { estados: ["Activo", "Pausado", "Finalizado"], tiposCobro: ["Instalación", "Mensualidad", "Reembolso gastos", "Otro"], receptores: ["Caja común", "Miguel", "Pablo"],
    metodos: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"], tiposGasto: ["IA", "Hosting", "Dominio", "API", "Licencia", "Otros"], pagadores: ["Caja común", "Miguel", "Pablo"],
    metodosGasto: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"], repercutir: ["Sí", "No"] },
  filasLibres: { cobros: 497, gastos: 495 },
});

const rpc = { ...rpcSinteticas, oficiososia_facturacion_leer: facturacion, servicios_resumen_mes: resumenMes };
const funciones = { ...funcionesSinteticas, "control-excel": controlExcel };

const VISTAS = [
  { nombre: "movil-375", viewport: { width: 375, height: 812 }, dpr: 2, movil: true },
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
];
const FISCAL = [/FACTURA/, /\bNIF\b/i, /\bCIF\b/, /\bIVA\b/, /Retenci/i, /Base imponible/i, /Vencimiento/i, /IBAN/];
const pestana = (page, nombre) => page.getByRole("tab", { name: nombre }).click();
const paso = (page, nombre) => page.getByRole("button", { name: nombre, exact: true }).click();
/** Qué enseñar en cada captura (se parte siempre de la página recién cargada). */
const PANTALLAS = [
  { id: "recibos", ir: (page) => pestana(page, "Recibos") },
  { id: "licencia-datos", ir: async () => {} },
  { id: "licencia-revisar", recibo: true, ir: (page) => paso(page, "3. Revisar") },
  { id: "mensual-conceptos", ir: async (page) => { await page.getByRole("button", { name: "Nuevo pago mensual" }).click(); await paso(page, "2. Conceptos"); await page.getByText("Servicios en el recibo").waitFor({ timeout: 15_000 }); } },
  { id: "mensual-revisar", recibo: true, ir: async (page) => { await page.getByRole("button", { name: "Nuevo pago mensual" }).click(); await paso(page, "2. Conceptos"); await page.getByText("Servicios en el recibo").waitFor({ timeout: 15_000 }); await paso(page, "3. Revisar"); } },
  // Los gastos de Servicios se editan en su bloque: un descuento a uno y otro a todos.
  { id: "mensual-descuentos", ir: async (page) => { await page.getByRole("button", { name: "Nuevo pago mensual" }).click(); await paso(page, "2. Conceptos"); await page.getByText("Servicios en el recibo").waitFor({ timeout: 15_000 }); await page.getByLabel("Descuento a todos los servicios (%)").fill("20"); await page.getByRole("button", { name: "Aplicar a todos" }).click(); await page.getByLabel("Descuento de OpenAI (%)").fill("50"); } },
  // Vista previa del PDF: de un borrador (desde la lista) y de un recibo emitido.
  { id: "previa-pdf-borrador", ir: async (page) => { await pestana(page, "Recibos"); await page.getByRole("button", { name: "Vista previa del PDF de R-2026-002" }).click(); await page.getByRole("dialog").locator("img").first().waitFor({ timeout: 30_000 }); } },
  { id: "previa-pdf-emitido", ir: async (page) => { await pestana(page, "Recibos"); await page.getByRole("button", { name: "Vista previa del PDF de R-2026-001" }).click(); await page.getByRole("dialog").locator("img").first().waitFor({ timeout: 30_000 }); } },
  { id: "tarifas", ir: (page) => pestana(page, "Tarifas") },
  { id: "control-excel", ir: async (page) => { await pestana(page, "Control Excel"); await page.getByText(CLIENTE).first().waitFor({ timeout: 15_000 }); } },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let fallos = 0;
for (const v of VISTAS) {
  for (const p of PANTALLAS) {
    const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
    const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: tablas(), rpc, funciones });
    const page = await context.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await page.goto(`${BASE}/super-admin/gestor-gasto`);
    await page.getByRole("tab", { name: "Nuevo recibo" }).waitFor({ timeout: 20_000 });
    await page.getByRole("textbox", { name: "Cliente" }).waitFor({ timeout: 20_000 });
    try { await p.ir(page); } catch (e) { fallos++; console.log(`${v.nombre}/${p.id}: no se pudo llegar a la pantalla (${e.message.split("\n")[0]})`); }
    await page.waitForTimeout(900);
    const nombre = path.join(SALIDA, `${p.id}-${v.nombre}`);
    await page.screenshot({ path: `${nombre}-vista.png` });
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (ancho > visible) { fallos++; console.log(`${v.nombre}/${p.id}: la página se desborda en horizontal (${ancho} px de ${visible})`); }
    if (p.recibo) {
      const recibo = page.getByRole("article", { name: "Vista previa del recibo" });
      const texto = await recibo.innerText();
      for (const f of FISCAL) if (f.test(texto)) { fallos++; console.log(`${v.nombre}/${p.id}: el recibo enseña un dato fiscal (${f})`); }
      if (await recibo.locator("img").count()) { fallos++; console.log(`${v.nombre}/${p.id}: el recibo lleva una imagen (membrete)`); }
      await recibo.screenshot({ path: `${nombre}-recibo.png` });
    }
    // Página entera: se quita el alto fijo y el scroll propio de cada región.
    await page.evaluate(() => {
      document.querySelectorAll("[style*='height']").forEach((e) => { e.style.height = "auto"; });
      document.querySelectorAll(".overflow-y-auto").forEach((e) => { e.style.overflow = "visible"; e.style.flex = "none"; });
    });
    await page.screenshot({ path: `${nombre}-entera.png`, fullPage: true });
    if (errores.length) { fallos++; console.log(`${v.nombre}/${p.id}: errores de la página: ${errores.join(" | ")}`); }
    const faltan = [...sinMock].filter((x) => !/version_auditoria/.test(x));
    if (faltan.length) console.log(`${v.nombre}/${p.id}: sin simular → ${faltan.join(", ")}`);
    await context.close();
  }
}
await navegador.close();
console.log(fallos ? `Capturas en ${SALIDA} con ${fallos} aviso(s).` : `Capturas en ${SALIDA}: sin desbordes ni datos fiscales.`);
process.exitCode = fallos ? 1 : 0;
