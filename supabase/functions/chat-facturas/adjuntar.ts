// ============================================================================
//  chat-facturas · turno «adjuntar presupuesto» (16/11/2026)
// ----------------------------------------------------------------------------
//  TS puro (sin Deno): el lector de Excel y el fetch se inyectan, así que lo
//  prueba vitest con un OpenAI y un Supabase de mentira.
//
//  NO pasa por el modelo de chat: lee el documento, casa cada línea con el
//  catálogo, lo guarda en chat_presupuestos (no es una factura) y contesta
//  SIEMPRE con la pregunta del descuento (y la del proveedor si el fichero no
//  lo dice). Nada se calcula antes de esa respuesta; la comparación llega en
//  el siguiente mensaje, con la herramienta comparar_presupuesto.
//
//  PDF y fotos: OpenAI lee el documento (como antes). Hojas de cálculo
//  (xlsx/xls/csv): lectura determinista de columnas (hoja.ts), sin LLM por
//  fila y sin tope de filas; solo se guardan las que se parecen a lo que se
//  compra (prefiltro en memoria contra nombres_compras_agente) y del resto se
//  guarda cuántas son.
// ============================================================================
import {
  bloqueArchivo,
  embeberNombres,
  leerPresupuesto,
  MAX_BYTES_PRESUPUESTO,
  mensajeTrasAdjuntar,
  tipoDePresupuesto,
  unirEmparejadas,
  type LineaPresupuesto,
} from "./presupuesto.ts";
import {
  columnasConIA,
  comprasPorProducto,
  confirmarParejas,
  depurarCandidatas,
  detectarColumnas,
  filasDeCsv,
  lineasDeHoja,
  prefiltrarLineas,
  type Candidata,
  type Filas,
  type NombreCompra,
} from "./hoja.ts";

export interface AdjuntoPresupuesto {
  nombre?: unknown;
  mime?: unknown;
  base64?: unknown;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface EntradaAdjuntar {
  supabase: Cliente;
  adjunto: AdjuntoPresupuesto;
  sessionId: string;
  usuarioId: string;
  clave: string;
  modelo: string;
  parametros: Record<string, unknown>;
  /** Solo Deno (excel.ts): bytes del libro -> filas de cada hoja. */
  filasDeExcel?: (bytes: Uint8Array) => Array<{ hoja: string; filas: Filas }>;
  fetchImpl?: typeof fetch;
  alUsarChat?: (usage: unknown) => void;
  alUsarEmbed?: (usage: unknown) => void;
  /** Gasto de la confirmación de parejas (MODELO_CONFIRMAR). */
  alUsarConfirmar?: (usage: unknown) => void;
}

export interface ResultadoAdjuntar {
  success: boolean;
  respuesta: string;
  presupuesto_id?: string;
}

const rechazo = (respuesta: string): ResultadoAdjuntar => ({ success: false, respuesta });

function bytesDeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function procesarPresupuesto(e: EntradaAdjuntar): Promise<ResultadoAdjuntar> {
  const nombre = typeof e.adjunto.nombre === "string" && e.adjunto.nombre.trim() ? e.adjunto.nombre.trim().slice(0, 150) : "presupuesto";
  const mime = typeof e.adjunto.mime === "string" ? e.adjunto.mime : "";
  const b64 = typeof e.adjunto.base64 === "string" ? e.adjunto.base64.replace(/^data:[^,]*,/, "") : "";

  const tipo = tipoDePresupuesto(mime, nombre);
  if (!tipo) return rechazo("Ese tipo de archivo no vale: adjunta el presupuesto en PDF, Excel (.xlsx, .xls, .csv) o foto (JPG, PNG).");
  if (!b64) return rechazo("El archivo llegó vacío. Vuelve a adjuntarlo.");
  if (b64.length > Math.ceil((MAX_BYTES_PRESUPUESTO * 4) / 3) + 16) return rechazo("El archivo pesa más de 8 MB. Adjunta uno más pequeño.");

  if (tipo === "excel" || tipo === "csv") return await procesarHoja(e, nombre, tipo, bytesDeBase64(b64));

  // PDF o foto: lo lee OpenAI (como antes).
  const leido = await leerPresupuesto({
    bloque: bloqueArchivo(b64, mime, nombre, tipo),
    clave: e.clave,
    modelo: e.modelo,
    parametros: e.parametros,
    fetchImpl: e.fetchImpl,
    alUsar: e.alUsarChat,
  });
  if (leido.lineas.length === 0) {
    return rechazo("No he encontrado ningún producto con precio en ese documento. ¿Es un presupuesto? Prueba con otro archivo o una foto más nítida.");
  }

  // Casar con el catálogo: texto en SQL y, de respaldo, el embedding del nombre.
  const vectores = await embeberNombres(leido.lineas.map((l) => l.producto), e.clave, e.fetchImpl, e.alUsarEmbed);
  const { data: emparejadas, error: errEmp } = await e.supabase.rpc("emparejar_presupuesto_agente", {
    p_lineas: leido.lineas.map((l, i) => ({ producto: l.producto, embedding: vectores[i] })),
  });
  if (errEmp) throw new Error(`emparejar_presupuesto_agente: ${errEmp.message}`);
  let lineas = unirEmparejadas(leido.lineas, emparejadas ?? []);
  // Como las hojas: reglas fijas (otro producto, otro tamaño) y confirmación por IA antes de comparar.
  const avisosPdf: string[] = [];
  if (lineas.some((l) => l.producto_id != null)) {
    const { data: compras, error: errNom } = await e.supabase.rpc("nombres_compras_agente");
    if (errNom) throw new Error(`nombres_compras_agente: ${errNom.message}`);
    const r = await confirmarLineasEmparejadas(lineas, (Array.isArray(compras) ? compras : []) as NombreCompra[], e);
    lineas = r.lineas;
    if (r.lotesFallidos > 0) avisosPdf.push("No se ha podido confirmar el formato de algunos productos: salen como «Revisar».");
  }

  const id = await guardar(e, { nombre, proveedor: leido.proveedor, fecha: leido.fecha, lineas, sinCompra: 0 });
  return {
    success: true,
    presupuesto_id: id,
    respuesta: mensajeTrasAdjuntar({
      archivo: nombre,
      proveedor: leido.proveedor,
      lineas: lineas.length,
      queCompras: lineas.filter((l) => l.producto_id != null).length,
      avisos: [...leido.avisos, ...avisosPdf],
    }),
  };
}

/**
 * Hoja de cálculo de cualquier tamaño: columnas por cabecera o por contenido
 * (la IA solo mira 20 filas si no se puede decidir), prefiltro en memoria
 * contra los nombres de compra y UNA escritura con lo que se parece a lo que
 * se compra. Sin embeddings ni LLM por fila.
 */
async function procesarHoja(e: EntradaAdjuntar, nombre: string, tipo: "excel" | "csv", bytes: Uint8Array): Promise<ResultadoAdjuntar> {
  let hojas: Array<{ hoja: string; filas: Filas }>;
  if (tipo === "csv") {
    hojas = [{ hoja: "csv", filas: filasDeCsv(new TextDecoder().decode(bytes)) }];
  } else if (e.filasDeExcel) {
    try {
      hojas = e.filasDeExcel(bytes);
    } catch {
      return rechazo("No he podido abrir ese Excel. Prueba a guardarlo como .xlsx o PDF.");
    }
  } else {
    return rechazo("Este servidor no puede leer Excel: adjunta el presupuesto en PDF o foto.");
  }
  hojas = hojas.filter((h) => h.filas.some((f) => (f ?? []).some((c) => c !== null && c !== undefined && String(c).trim() !== "")));
  if (hojas.length === 0) return rechazo("El archivo no tiene datos.");

  const leidas: LineaPresupuesto[] = [];
  let descartadas = 0;
  let sinColumnas = 0;
  for (const h of hojas) {
    const col = detectarColumnas(h.filas) ??
      await columnasConIA(h.filas, { clave: e.clave, modelo: e.modelo, parametros: e.parametros, fetchImpl: e.fetchImpl, alUsar: e.alUsarChat });
    if (!col) { sinColumnas++; continue; }
    const r = lineasDeHoja(h.filas, col);
    leidas.push(...r.lineas);
    descartadas += r.descartadas;
  }
  if (leidas.length === 0) {
    return rechazo("No he encontrado en la hoja una columna de producto y otra de precio. ¿Es una tarifa? Prueba a dejar una fila de cabecera con «Producto» y «Precio».");
  }

  const { data: compras, error: errNom } = await e.supabase.rpc("nombres_compras_agente");
  if (errNom) throw new Error(`nombres_compras_agente: ${errNom.message}`);
  // Paso 1: candidatas por texto (en memoria). Paso 2: la IA confirma producto y formato.
  const nombresCompra = (Array.isArray(compras) ? compras : []) as NombreCompra[];
  const previas = prefiltrarLineas(leidas, nombresCompra);
  // Paso 1b: reglas fijas (sin alcohol, otra edad, otro sabor, envases…) antes de gastar IA.
  const porProducto = comprasPorProducto(nombresCompra);
  const depuradas = depurarCandidatas(leidas, previas, porProducto);
  const conf = await confirmarParejas(leidas, depuradas.candidatas, {
    clave: e.clave, fetchImpl: e.fetchImpl, alUsar: e.alUsarConfirmar, compras: porProducto,
  });
  const lineas = conf.candidatas.map((c) => ({
    ...leidas[c.i],
    producto_id: c.producto_id,
    producto_catalogo: c.producto_catalogo,
    metodo: "texto+ia",
    confianza: c.confianza,
    similitud: c.similitud,
    ...(c.nota ? { nota: c.nota } : {}),
  }));
  const sinCompra = leidas.length - lineas.length;

  const avisos: string[] = [];
  if (conf.lotesFallidos > 0) avisos.push("No se ha podido confirmar el formato de algunos artículos: salen como «Revisar».");
  if (descartadas > 0) avisos.push(`${descartadas} fila(s) sin producto o sin precio no se han podido leer.`);
  if (sinColumnas > 0) avisos.push(`${sinColumnas} hoja(s) sin columnas de producto y precio se han saltado.`);

  const id = await guardar(e, { nombre, proveedor: null, fecha: null, lineas, sinCompra });
  return {
    success: true,
    presupuesto_id: id,
    respuesta: mensajeTrasAdjuntar({
      archivo: nombre,
      proveedor: null,
      lineas: leidas.length,
      queCompras: lineas.length,
      noCompras: sinCompra,
      avisos,
    }),
  };
}

async function guardar(
  e: EntradaAdjuntar,
  d: { nombre: string; proveedor: string | null; fecha: string | null; lineas: unknown[]; sinCompra: number },
): Promise<string> {
  // Purga (best-effort) de los de hace más de 30 días y alta del nuevo.
  try {
    await e.supabase.from("chat_presupuestos").delete().lt("creado_en", new Date(Date.now() - 30 * 86_400_000).toISOString());
  } catch { /* la purga no es crítica */ }
  const { data: fila, error: errIns } = await e.supabase
    .from("chat_presupuestos")
    .insert({
      session_id: e.sessionId,
      usuario_id: e.usuarioId,
      nombre_archivo: d.nombre,
      proveedor: d.proveedor,
      fecha_documento: d.fecha,
      lineas: d.lineas,
      lineas_sin_compra: d.sinCompra,
    })
    .select("id")
    .single();
  if (errIns) throw new Error(`chat_presupuestos: ${errIns.message}`);
  return fila.id;
}

/**
 * PDF y foto (revisión de producción 18/11/2026): antes solo pasaban por la similitud de texto de
 * emparejar_presupuesto_agente y volvían los fallos del 16/11 (tamaño, edición, otra marca). Ahora cada línea
 * emparejada pasa por las mismas reglas fijas (pareja.ts) y la misma confirmación por IA que las hojas.
 * Lo que las reglas o la IA descartan pierde el emparejamiento (cuenta como «no lo compras»).
 */
export async function confirmarLineasEmparejadas<L extends LineaPresupuesto & Record<string, unknown>>(
  lineas: L[],
  nombresCompra: NombreCompra[],
  e: Pick<EntradaAdjuntar, "clave" | "fetchImpl" | "alUsarConfirmar">,
): Promise<{ lineas: L[]; lotesFallidos: number }> {
  const porProducto = comprasPorProducto(nombresCompra);
  const cands: Candidata[] = [];
  lineas.forEach((l, i) => {
    if (l.producto_id == null) return;
    const pid = Number(l.producto_id);
    if (!Number.isFinite(pid)) return;
    const cat = String(l.producto_catalogo ?? "");
    const similitud = Number(l.similitud ?? 0.9);
    const opcion = { producto_id: pid, producto_catalogo: cat, nombre_compra: porProducto.get(pid)?.[0] ?? cat, cobertura: 1, similitud, trigramas: 0 };
    cands.push({ i, producto_id: pid, producto_catalogo: cat, cobertura: 1, similitud, confianza: l.confianza === "alta" ? "alta" : "media", opciones: [opcion] });
  });
  if (cands.length === 0) return { lineas, lotesFallidos: 0 };
  const dep = depurarCandidatas(lineas, cands, porProducto);
  const conf = await confirmarParejas(lineas, dep.candidatas, { clave: e.clave, fetchImpl: e.fetchImpl, alUsar: e.alUsarConfirmar, compras: porProducto });
  const final = new Map(conf.candidatas.map((c) => [c.i, c]));
  const salida = lineas.map((l, i) => {
    if (l.producto_id == null) return l;
    const c = final.get(i);
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any = { ...l };
    if (!c) {
      for (const k of ["producto_id", "producto_catalogo", "metodo", "confianza", "similitud", "nota"]) delete base[k];
      return base as L;
    }
    base.producto_id = c.producto_id;
    base.producto_catalogo = c.producto_catalogo;
    base.confianza = c.confianza;
    if (c.nota) base.nota = c.nota;
    return base as L;
  });
  return { lineas: salida, lotesFallidos: conf.lotesFallidos };
}
