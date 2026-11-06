// Servidor falso de la subida de facturas: procesar-factura (iniciar / sustituir / añadir página / síncrono),
// los trabajos de ocr_trabajos (que el panel sondea cada 3 s), Storage (pendientes/) e importar-factura-historica.
// Se monta ENCIMA del Supabase falso de tests/e2e-movil (las rutas registradas después mandan).
// Nada sale a Internet ni a OpenAI.
import { instalarSupabaseFalso, USER_ID } from "../e2e-movil/supabase-falso.mjs";
import { tablas as tablasBase, rpcSinteticas, funcionesSinteticas } from "../e2e-movil/datos-sinteticos.mjs";

export const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS" };
const ahora = () => new Date().toISOString();

export const EXISTENTE = {
  id: 77, numero_documento: "A26/60875", proveedor: "SIM Distribuciones Alimentarias del Norte de España, S.L.U.", fecha: "2026-10-01",
  total: 1234.56, total_origen: "leido", lineas: 5, alertas: 1, alertas_graves: 0, updated_at: "2026-10-01T10:00:00Z", paginas: 1, paginas_lineas: [5], trabajo_pendiente: false,
};
const NUEVO = { total: 1240.1, total_origen: "leido", lineas: 6, alertas: 0, proveedor: EXISTENTE.proveedor, fecha: "2026-10-01" };

/** Lo que devuelve el servidor (resultado del trabajo) según una palabra clave del nombre del fichero. */
export function resultadoPara(nombre, trabajoId) {
  const n = nombre.toLowerCase();
  const base = { success: true, tipo: "factura", alertas: [], archivo_guardado: true, archivo_estado: "drive", coste_usd: 0.0123, webhookResponse: { tipo: "factura", factura_id: 501, numero_documento: "F-2026-1", proveedor: "SIM Proveedor" } };
  if (n.includes("albaran")) return { ...base, tipo: "Albarán", webhookResponse: { ...base.webhookResponse, tipo: "Albarán" } };
  if (n.includes("avisos")) return { ...base, alertas: [{ tipo: "total", severidad: "alta", mensaje: "La suma de líneas (98,00 €) no cuadra con el total (120,00 €)" }] };
  // Drive caído: el servidor guarda una copia temporal en Storage (archivo_estado "temporal") y lo dice en archivo_error.
  if (n.includes("drive")) return { ...base, archivo_guardado: true, archivo_estado: "temporal", archivo_error: "original pendiente de subir a Drive (invalid_grant: Token has been expired or revoked.)" };
  if (n.includes("sinorig")) return { ...base, archivo_guardado: false, archivo_estado: "perdido", archivo_error: "No se pudo guardar el original ni en Drive ni en Storage" };
  if (n.includes("sust")) return { success: true, duplicado: true, tipo: "factura", coste_usd: 0.02, webhookResponse: { tipo: "factura", factura_existente_id: EXISTENTE.id }, sustituible: { trabajo_id: trabajoId, existente: EXISTENTE, nuevo: NUEVO } };
  if (n.includes("pagina")) return { success: true, duplicado: true, tipo: "factura", coste_usd: 0.02, webhookResponse: { tipo: "factura", factura_existente_id: EXISTENTE.id }, anadible: { trabajo_id: trabajoId, existente: EXISTENTE, pagina: { actual: 2, total: 3 }, nuevo: NUEVO } };
  if (n.includes("dup")) return { success: true, duplicado: true, tipo: "factura", coste_usd: 0.02, webhookResponse: { tipo: "factura", factura_existente_id: EXISTENTE.id }, motivo_no_sustituible: "la existente tiene ediciones a mano" };
  return base;
}

/**
 * Monta el panel con el servidor falso. `opciones`:
 *  - iniciar(nombre, cuerpo): null (ok) | { status, body, contentType } para forzar la respuesta de {modo:"iniciar"}
 *  - estadoFinal(nombre): "completado" | "fallido" | "colgado" (nunca termina) — por defecto según el nombre
 *  - demoraMs: lo que tarda un trabajo en terminar (por defecto 1500)
 *  - decision(modo, cuerpo): respuesta de sustituir / anadir_pagina
 *  - storage(path): null | { status, body } para forzar un fallo de subida
 *  - historica(cuerpo): respuesta de importar-factura-historica
 *  - trabajosPrevios: filas de ocr_trabajos ya existentes (adopción al cargar)
 *  - sinRpcTrabajos: true = el servidor aún NO tiene ocr_descartar_trabajo / ocr_reintentar_trabajo (204, como sin migración)
 *  - ficherosBorrados(id): true = ocr_reintentar_trabajo responde ok:false (ya no están los ficheros)
 *
 * RPC nuevas (05/11/2026, contrato del servidor):
 *  - ocr_descartar_trabajo(p_trabajo_id) → {ok, estado?, motivo?}: duplicado/pendiente/pagina1/paginas → «cancelado»;
 *    idempotente si ya está cancelado; ok:false si está consolidando o terminado.
 *  - ocr_reintentar_trabajo(p_trabajo_id) → {ok, estado, motivo?, factura_id?}: en marcha → ok + estado actual;
 *    fallido con ficheros → lo reanuda (mismo trabajo) y estado «reanudado»; terminado → su estado; sin ficheros → ok:false.
 */
export async function montar(context, opciones = {}) {
  const t = tablasBase();
  t.facturas = [{ id: EXISTENTE.id, numero_documento: EXISTENTE.numero_documento, proveedor: EXISTENTE.proveedor, fecha: EXISTENTE.fecha, total: EXISTENTE.total, tipo: "factura", drive_url: null, archivo_path: "temporal/2026/10/a26-60875.pdf", created_at: ahora() }];
  t.ocr_trabajos = [...(opciones.trabajosPrevios ?? [])];
  t.ocr_trabajo_paginas = [];
  const registro = { iniciar: [], decisiones: [], subidas: [], sincrono: [], historica: [], notificaciones: [], descartes: [], reintentos: [] };

  const fijarEstado = (id, cambio) => { const f = t.ocr_trabajos.find((x) => x.id === id); if (f) Object.assign(f, cambio, { updated_at: ahora() }); };
  /** Termina un trabajo como lo haría el servidor (salvo que ya se haya cancelado). */
  const terminarTrabajo = (id, nombre, fin = "completado") => {
    const f = t.ocr_trabajos.find((x) => x.id === id);
    if (!f || f.estado === "cancelado") return;
    if (fin === "fallido") return fijarEstado(id, { estado: "fallido", error: "OpenAI no ha respondido tras 3 intentos (timeout)" });
    const resultado = resultadoPara(nombre, id);
    fijarEstado(id, { estado: resultado.duplicado ? "duplicado" : "completado", resultado, factura_id: resultado.webhookResponse?.factura_id ?? null });
  };

  const rpcTrabajos = opciones.sinRpcTrabajos ? {} : {
    ocr_descartar_trabajo: ({ p_trabajo_id: id }) => {
      registro.descartes.push(id);
      const f = t.ocr_trabajos.find((x) => x.id === id);
      if (!f) return { ok: false, motivo: "No existe ese documento en el servidor." };
      if (f.estado === "cancelado") return { ok: true, estado: "cancelado" };
      if (["duplicado", "pendiente", "pagina1", "paginas"].includes(f.estado)) {
        fijarEstado(id, { estado: "cancelado" });
        return { ok: true, estado: "cancelado" };
      }
      return { ok: false, estado: f.estado, motivo: f.estado === "consolidando" ? "Ya se está guardando: no se puede cancelar." : "Ya ha terminado: no hay nada que cancelar." };
    },
    ocr_reintentar_trabajo: ({ p_trabajo_id: id }) => {
      registro.reintentos.push(id);
      const f = t.ocr_trabajos.find((x) => x.id === id);
      if (!f) return { ok: false, estado: "desconocido", motivo: "El servidor ya no tiene este documento: vuelve a subirlo." };
      if (["pendiente", "pagina1", "paginas", "consolidando"].includes(f.estado)) return { ok: true, estado: f.estado };
      if (f.estado === "completado" || f.estado === "duplicado") return { ok: true, estado: f.estado, factura_id: f.factura_id ?? null };
      if (opciones.ficherosBorrados?.(id)) return { ok: false, estado: f.estado, motivo: "Los ficheros de este documento ya no están en el servidor: vuelve a subirlo." };
      fijarEstado(id, { estado: "pagina1", error: null });
      setTimeout(() => terminarTrabajo(id, f.nombre_original), opciones.demoraMs ?? 1500);
      return { ok: true, estado: "reanudado" };
    },
  };
  const rpc = { ...rpcSinteticas, ocr_resumen_factura: () => opciones.resumen?.() ?? EXISTENTE, ...rpcTrabajos, ...(opciones.rpc ?? {}) };
  const falso = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: t, rpc, funciones: funcionesSinteticas });

  // Storage: subidas a pendientes/ (y firma de URL del original existente).
  await context.route(/supabase\.co\/storage\/v1\//, async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (p.includes("/object/sign/")) return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ signedURL: `/object/sign/facturas-originales/x?token=t` }) });
    if (req.method() === "POST" || req.method() === "PUT") {
      registro.subidas.push(p);
      const forzado = opciones.storage?.(p);
      if (forzado) { if (forzado.demoraMs) await new Promise((r) => setTimeout(r, forzado.demoraMs)); if (forzado.status) return route.fulfill({ status: forzado.status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(forzado.body) }); }
      return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ Key: p, Id: "x" }) });
    }
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/svg+xml" }, body: "<svg xmlns='http://www.w3.org/2000/svg'/>" });
  });

  await context.route(/supabase\.co\/functions\/v1\/(procesar-factura|ocr-trabajo|importar-factura-historica)/, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const nombreFn = new URL(req.url()).pathname.split("/").pop();
    let cuerpo = {}; try { cuerpo = JSON.parse(req.postData() || "{}"); } catch { /* */ }
    const responder = (status, body, contentType = "application/json") =>
      route.fulfill({ status, headers: { ...CORS, "content-type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body) });

    if (nombreFn === "importar-factura-historica") {
      registro.historica.push(cuerpo.clave);
      const r = (await opciones.historica?.(cuerpo)) ?? { status: 200, body: { estado: "importada", facturaId: 900 + registro.historica.length, mensaje: "" } };
      if (r.demoraMs) await new Promise((x) => setTimeout(x, r.demoraMs));
      return responder(r.status, r.body, r.contentType);
    }
    if (cuerpo.modo === "iniciar") {
      registro.iniciar.push(cuerpo.nombre);
      const forzado = opciones.iniciar?.(cuerpo.nombre, cuerpo);
      if (forzado) return responder(forzado.status, forzado.body, forzado.contentType);
      const id = cuerpo.trabajo_id;
      t.ocr_trabajos.push({ id, estado: "pendiente", num_paginas: cuerpo.piezas?.length ?? 1, nombre_original: cuerpo.nombre, error: null, resultado: null, factura_id: null, creado_por: USER_ID, created_at: ahora(), updated_at: ahora(), limite_at: new Date(Date.now() + 15 * 60_000).toISOString(), ocr_trabajo_paginas: null });
      const fin = opciones.estadoFinal?.(cuerpo.nombre) ?? (/colgado|lento/i.test(cuerpo.nombre) ? "colgado" : /fallido/i.test(cuerpo.nombre) ? "fallido" : "completado");
      const demora = opciones.demoraMs ?? 1500;
      setTimeout(() => { if (t.ocr_trabajos.find((x) => x.id === id)?.estado === "pendiente") fijarEstado(id, { estado: "pagina1" }); }, 300);
      if (fin !== "colgado") setTimeout(() => terminarTrabajo(id, cuerpo.nombre, fin), demora);
      return responder(200, { success: true, trabajo_id: id });
    }
    if (cuerpo.modo === "sustituir" || cuerpo.modo === "anadir_pagina") {
      registro.decisiones.push(cuerpo);
      const r = opciones.decision?.(cuerpo.modo, cuerpo) ?? { status: 200, body: { success: true, message: cuerpo.modo === "sustituir" ? "Factura A26/60875 sustituida" : "Página 2 añadida", alertas: [] } };
      if (r.status === 200 && r.body?.success) fijarEstado(cuerpo.trabajo_id, { estado: "completado" });
      return responder(r.status, r.body, r.contentType);
    }
    // Camino síncrono (respaldo)
    registro.sincrono.push(cuerpo.archivo?.nombre);
    const r = opciones.sincrono?.(cuerpo) ?? { status: 200, body: resultadoPara(cuerpo.archivo?.nombre ?? "", "sinc") };
    return responder(r.status, r.body, r.contentType);
  });

  return { tablas: t, registro, falso, fijarEstado, terminarTrabajo };
}

// ───────── ficheros de prueba ─────────
// PNG 1×1 válido.
export const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const png = (name) => ({ name, mimeType: "image/png", buffer: PNG_1x1 });

/** PDF con `n` páginas (pdf-lib, como el panel). */
export async function pdf(name, n = 1) {
  const { PDFDocument } = await import("pdf-lib");
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([595, 842]).drawText(`Pagina ${i + 1}`, { x: 50, y: 800 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await d.save()) };
}

// ───────── comprobaciones de pantalla ─────────
/** Scroll vertical/horizontal de PÁGINA, cosas fuera del viewport y diálogos cortados. */
export const REVISAR = () => {
  const se = document.scrollingElement; const vw = document.documentElement.clientWidth; const vh = window.innerHeight;
  const dialogos = [...document.querySelectorAll("[role=dialog],[role=alertdialog]")].map((d) => {
    const r = d.getBoundingClientRect();
    const fueraBotones = [...d.querySelectorAll("button,a[href]")].filter((b) => { const x = b.getBoundingClientRect(); if (getComputedStyle(b).display === "none" || b.closest(".sr-only")) return false; return (x.width < 8 && (b.textContent || "").trim()) || x.bottom > Math.min(vh, r.bottom) + 1 || x.right > Math.min(vw, r.right) + 1 || x.left < Math.max(0, r.left) - 1 || x.top < Math.max(0, r.top) - 1; }).map((b) => `${(b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 40)} [${Math.round(b.getBoundingClientRect().left)}..${Math.round(b.getBoundingClientRect().right)}]`);
    const scrollPropio = d.scrollHeight > d.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(d).overflowY);
    return { titulo: (d.querySelector("h2")?.textContent ?? "").slice(0, 60), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), cortado: r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1, fueraBotones, scrollPropio };
  });
  return { scrollV: se.scrollHeight - vh, scrollH: se.scrollWidth - vw, vw, vh, dialogos };
};

export const CAPTURAS = process.env.QA_CAPTURAS ?? "C:/Users/migue/AppData/Local/Temp/claude/5a2feb32f03e5f09/da67d530-328a-475d-915f-c23c8c95702b/scratchpad/qa/cargar";
