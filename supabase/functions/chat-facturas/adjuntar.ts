// ============================================================================
//  chat-facturas · turno «adjuntar presupuesto» (16/11/2026)
// ----------------------------------------------------------------------------
//  TS puro (sin Deno): el lector de Excel y el fetch se inyectan, así que lo
//  prueba vitest con un OpenAI y un Supabase de mentira.
//
//  NO pasa por el modelo de chat: lee el documento, casa cada línea con el
//  catálogo, lo guarda en chat_presupuestos (no es una factura) y contesta
//  SIEMPRE con la pregunta del descuento. Nada se calcula antes de esa
//  respuesta; la comparación llega en el siguiente mensaje, con la herramienta
//  comparar_presupuesto.
// ============================================================================
import {
  bloqueArchivo,
  embeberNombres,
  leerPresupuesto,
  MAX_BYTES_PRESUPUESTO,
  mensajeTrasAdjuntar,
  tipoDePresupuesto,
  unirEmparejadas,
  type EntradaLectura,
} from "./presupuesto.ts";

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
  /** Solo Deno (excel.ts): bytes de la hoja -> texto. */
  textoDeExcel?: (bytes: Uint8Array) => string;
  fetchImpl?: typeof fetch;
  alUsarChat?: (usage: unknown) => void;
  alUsarEmbed?: (usage: unknown) => void;
}

export interface ResultadoAdjuntar {
  success: boolean;
  respuesta: string;
  presupuesto_id?: string;
}

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
  const rechazo = (respuesta: string): ResultadoAdjuntar => ({ success: false, respuesta });

  const tipo = tipoDePresupuesto(mime, nombre);
  if (!tipo) return rechazo("Ese tipo de archivo no vale: adjunta el presupuesto en PDF, Excel (.xlsx, .xls, .csv) o foto (JPG, PNG).");
  if (!b64) return rechazo("El archivo llegó vacío. Vuelve a adjuntarlo.");
  if (b64.length > Math.ceil((MAX_BYTES_PRESUPUESTO * 4) / 3) + 16) return rechazo("El archivo pesa más de 8 MB. Adjunta uno más pequeño.");

  let entrada: Pick<EntradaLectura, "bloque" | "texto">;
  if (tipo === "pdf" || tipo === "imagen") {
    entrada = { bloque: bloqueArchivo(b64, mime, nombre, tipo) };
  } else {
    const bytes = bytesDeBase64(b64);
    let texto: string;
    if (tipo === "csv") {
      texto = new TextDecoder().decode(bytes);
    } else if (e.textoDeExcel) {
      try {
        texto = e.textoDeExcel(bytes);
      } catch {
        return rechazo("No he podido abrir ese Excel. Prueba a guardarlo como .xlsx o PDF.");
      }
    } else {
      return rechazo("Este servidor no puede leer Excel: adjunta el presupuesto en PDF o foto.");
    }
    if (!texto.trim()) return rechazo("El archivo no tiene datos.");
    entrada = { texto };
  }

  const leido = await leerPresupuesto({
    ...entrada,
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
  const lineas = unirEmparejadas(leido.lineas, emparejadas ?? []);

  // Purga (best-effort) de los de hace más de 30 días y alta del nuevo.
  try {
    await e.supabase.from("chat_presupuestos").delete().lt("creado_en", new Date(Date.now() - 30 * 86_400_000).toISOString());
  } catch { /* la purga no es crítica */ }
  const { data: fila, error: errIns } = await e.supabase
    .from("chat_presupuestos")
    .insert({
      session_id: e.sessionId,
      usuario_id: e.usuarioId,
      nombre_archivo: nombre,
      proveedor: leido.proveedor,
      fecha_documento: leido.fecha,
      lineas,
    })
    .select("id")
    .single();
  if (errIns) throw new Error(`chat_presupuestos: ${errIns.message}`);

  return {
    success: true,
    presupuesto_id: fila.id,
    respuesta: mensajeTrasAdjuntar({
      archivo: nombre,
      proveedor: leido.proveedor,
      lineas: lineas.length,
      queCompras: lineas.filter((l) => l.producto_id != null).length,
      avisos: leido.avisos,
    }),
  };
}
