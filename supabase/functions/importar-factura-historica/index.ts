import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirAdmin } from "../_shared/autorizacion.ts";
import { autenticar, type ConfigAuth, corsHeaders, jsonResponse } from "../procesar-factura/auth.ts";
import { configModelo } from "../procesar-factura/modelo.ts";
import { crearClienteOpenAI } from "../procesar-factura/openai.ts";
import { crearRegistroUso } from "../procesar-factura/registroUso.ts";
import { normalizarDatos } from "../procesar-factura/extraccion.ts";
import { guardarDocumento } from "../procesar-factura/guardado.ts";
import { aplicarExtras, mismaFacturaPorImporte, prepararImportacion, validarEntrada } from "./mapeo.ts";
const createClient = clienteConAuditoria(createClientBase, "importar-factura-historica");

// ============================================================================
//  importar-factura-historica  ·  Facturas del histórico SIN volver a pasar el OCR
// ----------------------------------------------------------------------------
//  La llama el panel (Facturas › Importación histórica) con el JWT del
//  usuario, UNA factura por petición:
//
//    IN : { clave, datos, pdf_b64, nombre_pdf, local?, paginas? }
//         `datos` = una factura en el formato de
//         facturas-conocimiento/INSTRUCCIONES-EXTRACCION.md.
//    OUT: { estado: "importada" | "ya_importada" | "duplicado" | "error",
//           facturaId, mensaje, ... }   (HTTP 200 salvo auth: 401/403/503)
//
//  Permisos: los de procesar-factura con EDICIÓN en Facturas y, además, rol
//  admin (la pantalla solo la ven administradores).
//
//  Pasos:
//    1. import_clave ya existe → «ya_importada» (reanudar es seguro).
//    2. datos → crudo (mapeo.ts) → normalizarDatos (la MISMA normalización
//       que el OCR); se vuelven a pegar bultos, descuento y valor sin
//       descuento por orden de línea.
//    3. Duplicado por importe: mismo proveedor (CIF), misma fecha y mismo
//       total → «duplicado».
//    4. guardarDocumento (procesar-factura/guardado.ts): duplicado por
//       número, cabecera (con local e import_clave en el mismo insert),
//       líneas con embeddings, alertas de cordura y el PDF a Drive
//       (Proveedor → «2026-03 Marzo»; Storage si Drive falla).
//  Solo usa OpenAI para los embeddings (céntimos), no la visión.
// ============================================================================

const cfgAuth: ConfigAuth = {
  supabaseUrl: Deno.env.get("SUPABASE_URL")!,
  anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  crearCliente: createClient,
};

const drive = {
  clientId: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
  clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
  refreshToken: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "",
  parentFolder: Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") ?? "",
};

const cfgModelo = configModelo({
  OCR_MODELO: Deno.env.get("OCR_MODELO"),
  OCR_MODELO_PIEZAS: Deno.env.get("OCR_MODELO_PIEZAS"),
  OCR_DETALLE: Deno.env.get("OCR_DETALLE"),
}, "unico");

type Respuesta = {
  estado: "importada" | "ya_importada" | "duplicado" | "error";
  facturaId: number | null;
  mensaje: string;
  [k: string]: unknown;
};

const responder = (r: Respuesta) => jsonResponse(r);

serve(conAuditoriaDePeticion("importar-factura-historica", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await autenticar(req, cfgAuth, "edit");
  if (!auth.ok) return auth.response;
  const admin = await exigirAdmin(req, { crearCliente: createClient, corsHeaders });
  if (!admin.ok) return admin.response;

  let clave = "";
  try {
    const v = validarEntrada(await req.json());
    if (!v.ok) return responder({ estado: "error", facturaId: null, mensaje: v.error });
    clave = v.clave;
    const supabase = createClient(cfgAuth.supabaseUrl, cfgAuth.serviceKey);

    // 1) ¿Ya importada?
    const { data: ya, error: yaErr } = await supabase.from("facturas").select("id").eq("import_clave", clave).maybeSingle();
    if (yaErr) throw new Error(`No se pudo comprobar la clave: ${yaErr.message}`);
    if (ya?.id) {
      return responder({ estado: "ya_importada", facturaId: ya.id, mensaje: `Ya importada (factura ${ya.id})` });
    }

    // 2) Mapeo + normalización del OCR
    const prep = prepararImportacion(v.datos, { nombrePdf: v.nombrePdf, local: v.local, paginas: v.paginas });
    const d = normalizarDatos(prep.crudo);
    d.productos = aplicarExtras(d.productos, prep.extras);
    d.observaciones = prep.observaciones;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.datos.fecha ?? ""))) {
      return responder({ estado: "error", facturaId: null, mensaje: `Fecha no válida en el JSON: «${v.datos.fecha ?? ""}»` });
    }

    // 3) Duplicado por importe (mismo proveedor, fecha y total)
    if (d.total !== null) {
      const { data: candidatas, error: cErr } = await supabase.from("facturas")
        .select("id, cif, proveedor, total, fecha, numero_documento").eq("fecha", d.fecha);
      if (cErr) throw new Error(`No se pudo buscar duplicados: ${cErr.message}`);
      const igual = mismaFacturaPorImporte(d, candidatas ?? []);
      if (igual) {
        return responder({
          estado: "duplicado",
          facturaId: igual.id,
          mensaje: `Ya existe la factura ${igual.numero_documento} (id ${igual.id}) del mismo proveedor, con la misma fecha y el mismo total`,
        });
      }
    }

    // 4) Guardar como una subida del OCR
    const registro = crearRegistroUso({ funcion: "procesar-factura", disparador: `importacion:${clave.slice(0, 120)}`, cliente: supabase });
    const ctx = {
      supabase,
      openai: crearClienteOpenAI({ apiKey: claveOpenAI("ocr"), config: cfgModelo, alUsar: registro.alUsar }),
      drive,
    };
    const alertasPrevias = [...prep.alertas, ...(d.avisos as unknown as Record<string, unknown>[])];
    try {
      const g = await guardarDocumento(ctx, {
        datos: d,
        alertasPrevias,
        totalOrigen: d.total === null ? null : "leido",
        original: { tipo: "base64", b64: v.pdfB64, mime: "application/pdf", nombre: v.nombrePdf },
        paginas: prep.paginas,
        documentoCompleto: true,
        cabeceraExtra: { local: prep.local, import_clave: clave },
      });
      if (g.estado === "duplicado") {
        return responder({
          estado: "duplicado",
          facturaId: g.existente?.id ?? null,
          mensaje: `Ya existe el documento ${g.existente?.numero_documento ?? d.numero_documento}` +
            (g.existente?.id ? ` (id ${g.existente.id})` : ""),
        });
      }
      const r = g.respuesta;
      return responder({
        estado: "importada",
        facturaId: g.facturaId,
        mensaje: `${d.numero_documento} · ${d.productos.length} línea(s)` +
          (r.alertas.length > 0 ? ` · ${r.alertas.length} aviso(s)` : "") +
          (r.archivo_guardado ? "" : ` · PDF sin guardar: ${r.archivo_error ?? "error"}`),
        alertas: r.alertas.length,
        archivo_guardado: r.archivo_guardado,
        abono: prep.esAbono,
      });
    } finally {
      await registro.esperar();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error(`[importar-factura-historica] ${clave}:`, msg);
    return responder({ estado: "error", facturaId: null, mensaje: msg });
  }
}));
