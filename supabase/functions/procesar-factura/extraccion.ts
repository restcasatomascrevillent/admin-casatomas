// ============================================================================
//  Extracción de UN documento (camino síncrono de una página)
// ----------------------------------------------------------------------------
//  Movido desde index.ts (04b, tarea B1) sin cambiar el comportamiento:
//  extracción con esquema estricto + 1 relectura correctiva, verificador del
//  pie, contador de filas (solo si el total tendría que salir de las líneas),
//  retirada de importes no citados, deducción del total y normalización.
//  Sin Deno.env: recibe un ClienteOpenAI. Lo usan index.ts y el banco local.
// ============================================================================

import { avisoMagnitudes, resolverMagnitud } from "./magnitudes.ts";
import { toNumber } from "./normalizacion.ts";
import {
  aplicarRecuentoVerificado,
  comprobarCuadre,
  compararExpansion,
  conservarRecuentoFilas,
  contarCambiosNumericos,
  deducirImportes,
  type Descuadre,
  descuadresComoAlertas,
  describirProblemas,
  type DocumentoExtraido,
  MAX_CAMBIOS_RELECTURA,
  mensajeCorrectivo,
  type OrigenImporte,
  retirarImportesNoImpresos,
  validarEstructura,
} from "./esquema.ts";
import { type BloqueContenido, bloqueContenido, type ClienteOpenAI } from "./openai.ts";
import { diagnosticoResolucion } from "./imagen.ts";
import { CIF_CLIENTE, TEXTO_EXTRACCION, VISION_SYSTEM_PROMPT } from "./prompts.ts";

/** Peso de un conjunto de descuadres, para poder comparar dos intentos.
 *  Una alerta 'alta' (precio o total inverosímil) pesa más que diez 'media'. */
export function peso(descuadres: { severidad: string }[]): number {
  return descuadres.reduce((acc, d) => acc + (d.severidad === "alta" ? 10 : 1), 0);
}

/** Parsea + valida la forma. Lanza con la RUTA de los campos que fallan. */
export function validarOLanzar(parsed: unknown, contexto: string): DocumentoExtraido {
  const v = validarEstructura(parsed);
  if (!v.ok) {
    throw new Error(
      `La extracción no cumple el contrato (${contexto}): ${describirProblemas(v.problemas)}`,
    );
  }
  return v.datos;
}

/** CIF normalizado para comparar: mayúsculas, sin espacios, puntos ni guiones. */
export function normalizarCif(cif: string | null | undefined): string {
  return String(cif ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** ¿Es el CIF del restaurante (el CLIENTE)? Caso Garre F/25011959 (factura 39). */
export function esCifCliente(cif: string | null | undefined): boolean {
  const n = normalizarCif(cif);
  return n.length > 0 && n === CIF_CLIENTE;
}

const NOMBRES_CLIENTE = /\b(MASIDE\s*2011|CASA\s+TOMAS|CASA\s+TOM[ÁA]S|BARRA\s+CASA\s+TOM[ÁA]S)\b/i;

/** ¿El «proveedor» que ha devuelto el modelo es en realidad el restaurante? */
export function esNombreCliente(nombre: string | null | undefined): boolean {
  return !!nombre && NOMBRES_CLIENTE.test(nombre);
}

// deno-lint-ignore no-explicit-any
export function normalizarDatos(data: any) {
  if (!data || typeof data !== "object") throw new Error("Los datos extraídos no son un objeto válido");
  if (!data.numero_documento) throw new Error("Falta el campo obligatorio: numero_documento");

  // tipo
  let tipo = (data.tipo || "factura").toLowerCase().trim();
  if (tipo.includes("albaran") || tipo.includes("albarán")) tipo = "albaran";
  else if (tipo.includes("factura") || tipo.includes("invoice")) tipo = "factura";
  else tipo = "factura";

  // fecha → YYYY-MM-DD
  let fecha: string = data.fecha;
  if (fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      const m = String(fecha).match(/(\d{4})-(\d{2})-(\d{2})/);
      fecha = m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().split("T")[0];
    }
  } else {
    fecha = new Date().toISOString().split("T")[0];
  }

  // El CIF del cliente NUNCA es el del proveedor: si llega, se descarta (null
  // antes que un dato falso). Y si el «proveedor» es el propio restaurante, se
  // deja a null por la misma razón. Red de seguridad del prompt (sección 1b).
  const cif = data.cif && !esCifCliente(data.cif) ? data.cif : null;
  const proveedor = data.proveedor && !esNombreCliente(data.proveedor) ? data.proveedor : null;

  // deno-lint-ignore no-explicit-any
  const productos = Array.isArray(data.productos)
    ? data.productos.map((p: any, i: number) => {
      const precio_unitario = toNumber(p.precio_unitario, true);
      const total = toNumber(p.total, true);
      // Cantidad = la magnitud por la que se multiplica el precio (kilos si el
      // precio es por kilo), unidad normalizada, y las unidades/bultos aparte.
      // Ver magnitudes.ts (Luga ML/101511: 12 uds · 24 kg · 4,14 → 99,46).
      const m = resolverMagnitud({
        cantidad: toNumber(p.cantidad, true),
        unidad: p.unidad,
        peso_kg: toNumber(p.peso_kg, true),
        base_precio: p.base_precio,
        precio_unitario,
        total,
        bonificada: p.bonificada === true,
      });
      return {
        nombre: (p.nombre || "").trim() || `Producto ${i + 1}`,
        cantidad: m.cantidad || 1,
        unidad: m.unidad,
        bultos: m.bultos,
        precio_unitario,
        total,
        // `base_precio`, `bonificada`, `regla_magnitud` y `sugerencia_magnitud`
        // NO tienen columna en `productos_factura`.
        base_precio: p.base_precio ?? "desconocida",
        bonificada: p.bonificada === true,
        regla_magnitud: m.regla,
        sugerencia_magnitud: m.sugerencia,
        // Multipágina (04b): posición y procedencia. El camino síncrono deja
        // pagina = 1 y orden = i.
        pagina: Number.isInteger(p.pagina) ? p.pagina : 1,
        orden: Number.isInteger(p.orden) ? p.orden : i,
        albaran_ref: typeof p.albaran_ref === "string" && p.albaran_ref.trim()
          ? p.albaran_ref.trim().slice(0, 100)
          : null,
      };
    })
    : [];
  const cambiadasAPeso = productos.filter((p: { regla_magnitud: string }) =>
    p.regla_magnitud === "peso_cuadra" || p.regla_magnitud === "peso_con_descuento"
  ).length;
  if (cambiadasAPeso > 0) {
    console.log(`[magnitudes] ${data.numero_documento}: ${cambiadasAPeso} línea(s) guardadas por peso (precio por kilo/litro).`);
  }
  const avisoMagnitud = avisoMagnitudes(productos.map((p: {
    nombre: string; cantidad: number; unidad: string; precio_unitario: number | null; total: number | null;
    sugerencia_magnitud: number | null;
  }) => ({ ...p, sugerencia: p.sugerencia_magnitud })));

  return {
    tipo,
    proveedor,
    cif,
    numero_documento: String(data.numero_documento),
    fecha,
    subtotal: toNumber(data.subtotal, true),
    iva: toNumber(data.iva, true),
    total: toNumber(data.total, true),
    observaciones: data.observaciones || null,
    resumen: data.resumen || null,
    productos,
    /** Avisos de la normalización de cantidades (no van a ninguna columna:
     *  los llamantes los añaden a alertasPrevias). */
    avisos: avisoMagnitud ? [avisoMagnitud] : [],
  };
}

export type DatosNormalizados = ReturnType<typeof normalizarDatos>;

/**
 * Extrae el documento y, si los números no cuadran, le pide UNA vez al modelo
 * que vuelva a mirar. Devuelve la mejor de las dos lecturas y los descuadres
 * que queden, para dejarlos anotados en `alertas_validacion`.
 */
export async function extraerConCuadre(
  cliente: ClienteOpenAI,
  contentBlock: BloqueContenido,
): Promise<{ documento: DocumentoExtraido; descuadres: Descuadre[]; intentos: number }> {
  // deno-lint-ignore no-explicit-any
  const mensajes: any[] = [
    { role: "system", content: VISION_SYSTEM_PROMPT },
    { role: "user", content: [contentBlock, { type: "text", text: TEXTO_EXTRACCION }] },
  ];

  const primera = validarOLanzar(await cliente.llamarVision(mensajes), "primer intento");
  const descuadres1 = comprobarCuadre(primera);
  if (descuadres1.length === 0) return { documento: primera, descuadres: [], intentos: 1 };

  console.warn(
    `[extraccion] ${primera.tipo} ${primera.numero_documento}: ${descuadres1.length} descuadre(s) ` +
      `en el primer intento (${descuadres1.map((d) => d.codigo).join(", ")}). Se pide relectura.`,
  );

  let segunda: DocumentoExtraido;
  let descuadres2: Descuadre[];
  try {
    mensajes.push({ role: "assistant", content: JSON.stringify(primera) });
    mensajes.push({ role: "user", content: mensajeCorrectivo(descuadres1) });
    segunda = validarOLanzar(await cliente.llamarVision(mensajes), "reintento");
    descuadres2 = comprobarCuadre(segunda);
  } catch (e) {
    console.error("[extraccion] El reintento falló, se conserva el primer intento:", e);
    return { documento: primera, descuadres: descuadres1, intentos: 2 };
  }

  // Ver index.ts v101: una relectura que solo AÑADE filas no es una
  // recomposición; una que cambia más de MAX_CAMBIOS_RELECTURA números, sí.
  const expansion = compararExpansion(primera, segunda);
  if (expansion.esExpansion) {
    console.log(
      `[extraccion] Relectura aceptada como EXPANSION: ${expansion.lineasAntes} -> ` +
        `${expansion.lineasDespues} linea(s). Descuadres ${descuadres1.length} -> ${descuadres2.length}.`,
    );
    return { documento: conservarRecuentoFilas(primera, segunda), descuadres: descuadres2, intentos: 2 };
  }

  const cambios = contarCambiosNumericos(primera, segunda);
  if (cambios.total > MAX_CAMBIOS_RELECTURA) {
    console.warn(
      `[extraccion] Relectura DESCARTADA: cambia ${cambios.total} valores numéricos ` +
        `(${cambios.campos.slice(0, 8).join(", ")}${cambios.campos.length > 8 ? "..." : ""}). ` +
        `Se conserva la primera lectura con sus avisos.`,
    );
    return { documento: primera, descuadres: descuadres1, intentos: 2 };
  }

  if (peso(descuadres2) <= peso(descuadres1)) {
    console.log(
      `[extraccion] Relectura aceptada: ${descuadres1.length} -> ${descuadres2.length} descuadre(s), ` +
        `${cambios.total} valor(es) corregido(s): ${cambios.campos.join(", ") || "ninguno"}.`,
    );
    return { documento: conservarRecuentoFilas(primera, segunda), descuadres: descuadres2, intentos: 2 };
  }
  console.warn("[extraccion] La relectura salió peor que el primer intento; se conserva el primero.");
  return { documento: primera, descuadres: descuadres1, intentos: 2 };
}

export interface DocumentoListo {
  datos: DatosNormalizados;
  alertasPrevias: Record<string, unknown>[];
  totalOrigen: OrigenImporte | null;
  intentos: number;
}

/**
 * Pasos 2 → 2b del camino síncrono (index.ts v101 :1297-1385): extracción,
 * verificador de pie, contador de filas, retirada de importes no citados,
 * deducción y normalización. Puro respecto a la base de datos.
 */
export async function extraerDocumentoUnico(
  cliente: ClienteOpenAI,
  contentBlock: BloqueContenido,
): Promise<DocumentoListo> {
  const extraccion = await extraerConCuadre(cliente, contentBlock);

  const hayImportes = !extraccion.documento.sin_importes && (
    extraccion.documento.total !== null ||
    extraccion.documento.subtotal !== null ||
    extraccion.documento.iva !== null
  );
  const verificacion = hayImportes ? await cliente.verificarPie(contentBlock) : null;

  const { datos: citado, retiradas, discordancias } = retirarImportesNoImpresos(extraccion.documento, verificacion);
  for (const r of retiradas) {
    console.warn(
      `[cita] ${extraccion.documento.tipo} ${extraccion.documento.numero_documento}: se retira ` +
        `${r.campo} = ${r.valor}; el modelo no cita los caracteres impresos.`,
    );
  }

  const totalSaldriaDeLasLineas = !citado.sin_importes &&
    citado.subtotal === null && citado.iva === null && citado.total === null &&
    (citado.productos?.length ?? 0) > 0;
  const recuento = totalSaldriaDeLasLineas ? await cliente.contarFilas(contentBlock) : null;
  const { datos: contado, alerta: alertaRecuento } = aplicarRecuentoVerificado(citado, recuento);

  const { datos: documento, deduccion } = deducirImportes(contado);
  const datos = normalizarDatos(documento);
  const totalOrigen: OrigenImporte | null = datos.total === null ? null : deduccion ? "deducido" : "leido";

  const alertasPrevias = [
    ...descuadresComoAlertas(extraccion.descuadres, "pre-guardado"),
    ...retiradas.map((r) => r.alerta),
    ...discordancias,
    ...(alertaRecuento ? [alertaRecuento] : []),
    ...(deduccion ? [deduccion.alerta] : []),
    ...datos.avisos,
  ] as unknown as Record<string, unknown>[];

  console.log(
    `[extraccion] ${datos.tipo} ${datos.numero_documento}: ${extraccion.intentos} intento(s), ` +
      `${datos.productos.length} linea(s), ${extraccion.descuadres.length} descuadre(s) sin resolver.`,
  );
  return { datos, alertasPrevias, totalOrigen, intentos: extraccion.intentos };
}

/** Fichero de UN documento tal y como lo lee el camino de una página. */
export interface FicheroUnico {
  /** Base64 sin cabecera `data:`. */
  b64: string;
  mime: string;
  /** Nombre del fichero (el del panel). Puede faltar en el camino síncrono. */
  nombre: string;
}

/**
 * Lectura COMPLETA de un documento de una página: diagnóstico de resolución
 * (solo log), bloque de contenido y extraerDocumentoUnico. Es la ÚNICA puerta
 * de los dos caminos de una página (05-oct-2026): el síncrono (index.ts →
 * unico.ts) y el de trabajos en segundo plano (ocr-trabajo, trabajo de una
 * pieza). Así el payload a OpenAI es el mismo byte a byte.
 */
export async function leerDocumentoUnico(cliente: ClienteOpenAI, f: FicheroUnico): Promise<DocumentoListo> {
  const isPdf = f.mime.includes("pdf");
  // Diagnóstico de resolución (solo log; ver imagen.ts).
  if (!isPdf) {
    try {
      const cabecera = atob(f.b64.slice(0, 65536));
      const bytes = new Uint8Array(cabecera.length);
      for (let i = 0; i < cabecera.length; i++) bytes[i] = cabecera.charCodeAt(i);
      const diag = diagnosticoResolucion(bytes);
      if (diag) console.log(diag);
    } catch {
      // Medir es informativo.
    }
  }
  const contentBlock = bloqueContenido(f.b64, f.mime, f.nombre || "document.pdf", cliente.config.detalle);
  // 2) → 2b) Extracción, pie, contador, citas, deducción y normalización.
  return await extraerDocumentoUnico(cliente, contentBlock);
}
