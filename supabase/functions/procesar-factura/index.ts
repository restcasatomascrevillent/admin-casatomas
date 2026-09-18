import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
//  procesar-factura  ·  OCR de facturas/albaranes SIN n8n
// ----------------------------------------------------------------------------
//  Reemplaza el antiguo proxy al webhook de n8n. Hace todo el trabajo inline:
//  GPT-5 Vision → normalizar → dedup → embeddings → insert → subir a Drive.
//  Mantiene el MISMO contrato que esperaba SubidaFacturas.tsx:
//    IN : { tipo, archivo:{ nombre, tipo, size, contenido_base64 }, fecha }
//    OUT: { success, tipo, webhookResponse:{ tipo, numero_documento, ... } }
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI = "https://api.openai.com/v1";

// Google Drive (Opción A: OAuth de usuario real con refresh token)
const G_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const G_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const G_REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "";
const G_PARENT_FOLDER = Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") ?? "";
const DRIVE_ENABLED = !!(G_CLIENT_ID && G_CLIENT_SECRET && G_REFRESH_TOKEN && G_PARENT_FOLDER);

// Prompt de Vision — COPIADO VERBATIM del workflow n8n "OCR Facturas".
const VISION_SYSTEM_PROMPT = `Eres un sistema experto de análisis documental para contabilidad en España.

Tu objetivo es ANALIZAR VISUALMENTE la imagen de un documento comercial y extraer los datos en un JSON estricto. El documento puede ser una FACTURA o un ALBARÁN.

 RETO DE GENERALIZACIÓN:
Este sistema procesa miles de documentos de proveedores distintos.
Los nombres de las columnas CAMBIAN (ej: "Importe" puede ser Precio Unitario en un documento y Total en otro).
El orden de las columnas CAMBIA.
Algunos tienen descuentos del 100% (productos bonificados con coste 0).

1. CLASIFICACIÓN DEL DOCUMENTO
Determina si es FACTURA o ALBARÁN basándote en el texto explícito del documento.
Prioridad: Si dice "Albarán", "Nota de entrega" o "Delivery Note" -> ALBARÁN (incluso si tiene precios e IVA).
Si dice "Factura" o "Invoice" -> FACTURA.

2. EXTRACCIÓN DE PRODUCTOS (MOTOR LÓGICO)
Para extraer correctamente la tabla de productos, aplica estas reglas de inteligencia:

A. Detección de Columnas por Lógica Matemática (CRÍTICO):
No confíes solo en los nombres de las cabeceras. Busca patrones numéricos en las líneas para identificar las columnas:
Identifica la CANTIDAD (suele ser un número entero pequeño: 1, 6, 12, 24...).
Identifica dos valores monetarios grandes en la línea.
Aplica la prueba: ¿Valor_A * Cantidad ≈ Valor_B?
Si SÍ: Valor_A es el PRECIO UNITARIO y Valor_B es el TOTAL LÍNEA.

B. Gestión de "Bonificaciones" y Descuentos 100%:
Si encuentras líneas con Cantidad > 0 pero Total = 0.00 (o muy cercano a 0), NO LAS ELIMINES.
Son productos bonificados/regalo.
En el JSON: precio_unitario: (el valor real si aparece, o 0), total: 0.

C. Limpieza de Datos:
Descripción: Extrae el nombre del producto limpiando códigos de referencia internos o lotes si es posible.
Formato Numérico: Convierte siempre a formato estándar (ej: "1.200,50" -> 1200.50).

3. VENTAJA VISUAL
Al ver directamente la imagen del documento:
- Puedes identificar la ESTRUCTURA de las tablas visualmente
- Distinguir cabeceras de datos
- Identificar subtotales, IVA y totales por su posición en el documento
- Leer texto que un OCR podría confundir

4. SALIDA JSON (ESTRICTA)
Devuelve SOLAMENTE el JSON. No añadas explicaciones ni bloques de código markdown.

Estructura si es FACTURA:
{
"tipo": "factura",
"proveedor": "Nombre detectado",
"cif": "CIF detectado",
"numero_documento": "Nº Factura",
"fecha": "YYYY-MM-DD",
"productos": [
{
"nombre": "Descripción limpia",
"cantidad": 0.0,
"unidad": "ud/kg/litro/null",
"precio_unitario": 0.00,
"total": 0.00,
"notas": "Si es bonificado o dto 100%"
}
],
"subtotal": 0.00,
"iva": 0.00,
"total": 0.00,
"observaciones": "Forma de pago, vencimientos, notas",
"resumen": "Frase de 1-2 líneas describiendo semánticamente el documento: tipo de productos/servicios suministrados, nombre del proveedor, importe total y contexto de uso o categoría"
}

Estructura si es ALBARÁN:
{
"tipo": "albaran",
"proveedor": "Nombre detectado",
"cif": "CIF detectado",
"numero_documento": "Nº Albarán",
"fecha": "YYYY-MM-DD",
"productos": [
{
"nombre": "Descripción limpia",
"cantidad": 0.0,
"unidad": "ud/kg/litro/null",
"precio_unitario": 0.00,
"total": 0.00,
"notas": "Si es bonificado o dto 100%"
}
],
"subtotal": 0.00,
"iva": 0.00,
"total": 0.00,
"observaciones": "Dirección envío, transportista, notas entrega",
"resumen": "Frase de 1-2 líneas describiendo semánticamente el documento: tipo de productos/servicios suministrados, nombre del proveedor, importe total y contexto de uso o categoría"
}`;

// ─── Helpers numéricos / normalización (portado de "Parsear Respuesta IA") ───
function toNumber(value: unknown, allowNull = false): number | null {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(",", ".").trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? (allowNull ? null : 0) : parsed;
  }
  return allowNull ? null : 0;
}

function normalizarDatos(data: any) {
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

  const productos = Array.isArray(data.productos)
    ? data.productos.map((p: any, i: number) => ({
        nombre: (p.nombre || "").trim() || `Producto ${i + 1}`,
        cantidad: toNumber(p.cantidad) || 1,
        unidad: (p.unidad || "unidades").toLowerCase().trim(),
        precio_unitario: toNumber(p.precio_unitario, true),
        total: toNumber(p.total, true),
      }))
    : [];

  return {
    tipo,
    proveedor: data.proveedor || null,
    cif: data.cif || null,
    numero_documento: String(data.numero_documento),
    fecha,
    subtotal: toNumber(data.subtotal, true),
    iva: toNumber(data.iva, true),
    total: toNumber(data.total, true),
    observaciones: data.observaciones || null,
    resumen: data.resumen || null,
    productos,
  };
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────
async function embed(input: string | string[]): Promise<number[][]> {
  const res = await fetch(`${OPENAI}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.map((d: any) => d.embedding);
}
const vec = (arr: number[]) => "[" + arr.join(",") + "]";

// ─── Google Drive (OAuth refresh token) ──────────────────────────────────────
async function driveToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: G_CLIENT_ID,
    client_secret: G_CLIENT_SECRET,
    refresh_token: G_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Drive token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function ensureFolder(name: string, parentId: string, token: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const list = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const found = (await list.json()).files?.[0];
  if (found) return found.id;
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!create.ok) throw new Error(`Drive crear carpeta ${create.status}: ${await create.text()}`);
  return (await create.json()).id;
}

async function subirADrive(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  fecha: string,
): Promise<string | null> {
  if (!DRIVE_ENABLED) {
    console.warn("[Drive] Variables de Google no configuradas → se omite la subida.");
    return null;
  }
  const token = await driveToken();
  const year = fecha.slice(0, 4);
  const month = fecha.slice(5, 7);
  const yearFolder = await ensureFolder(year, G_PARENT_FOLDER, token);
  const monthFolder = await ensureFolder(month, yearFolder, token);

  // 1) metadata
  const meta = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: fileName, parents: [monthFolder] }),
  });
  if (!meta.ok) throw new Error(`Drive metadata ${meta.status}: ${await meta.text()}`);
  const fileId = (await meta.json()).id;

  // 2) media
  const up = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,webViewLink`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType }, body: bytes },
  );
  if (!up.ok) throw new Error(`Drive upload ${up.status}: ${await up.text()}`);
  return (await up.json()).webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json();
    const archivo = payload.archivo;
    if (!archivo?.contenido_base64) throw new Error("No se recibió ningún archivo");

    const mimeType: string = archivo.tipo || "application/pdf";
    const isPdf = mimeType.includes("pdf");
    const b64: string = archivo.contenido_base64.includes(",")
      ? archivo.contenido_base64.split(",")[1]
      : archivo.contenido_base64;

    console.log(`[procesar-factura] ${archivo.nombre} (${mimeType})`);

    // 1) Bloque de contenido para Vision
    const contentBlock = isPdf
      ? { type: "file", file: { filename: archivo.nombre || "document.pdf", file_data: `data:application/pdf;base64,${b64}` } }
      : { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}`, detail: "high" } };

    // 2) GPT-5 Vision
    const visionRes = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-5-mini",
        max_completion_tokens: 16000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: VISION_SYSTEM_PROMPT },
          { role: "user", content: [contentBlock, { type: "text", text: "Analiza visualmente este documento comercial español (factura o albarán) y extrae todos los datos en el formato JSON especificado." }] },
        ],
      }),
    });
    if (!visionRes.ok) throw new Error(`Vision ${visionRes.status}: ${await visionRes.text()}`);
    const raw = (await visionRes.json())?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Vision no devolvió contenido");
    const parsed = typeof raw === "string"
      ? JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim())
      : raw;
    const datos = normalizarDatos(parsed);

    // 3) Cliente Supabase (service role)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 4) Verificar duplicado
    const { data: dup, error: dupErr } = await supabase.rpc("verificar_duplicado_factura", {
      p_numero_documento: datos.numero_documento,
      p_proveedor: datos.proveedor ?? "",
      p_fecha: datos.fecha,
      p_total: datos.total ?? 0,
    });
    if (dupErr) throw new Error(`verificar_duplicado_factura: ${dupErr.message}`);
    if (dup?.es_duplicado === true) {
      console.log(`[procesar-factura] DUPLICADO: ${datos.numero_documento}`);
      return new Response(
        JSON.stringify({
          success: true,
          nombre: archivo.nombre,
          tipo: datos.tipo,
          duplicado: true,
          message: "El documento ya existía (duplicado)",
          webhookResponse: { tipo: datos.tipo, numero_documento: datos.numero_documento, duplicado: true },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // 5) Embedding de la factura (a partir del resumen)
    const textoEmbedding = datos.resumen
      ? datos.resumen
      : `${datos.tipo} de ${datos.proveedor || "proveedor desconocido"}, ${datos.fecha}, total ${datos.total}€. Productos: ${datos.productos.map((p) => p.nombre).join(", ")}`;
    const [facturaEmbedding] = await embed(textoEmbedding);

    // 6) Insertar factura
    const { data: factura, error: facErr } = await supabase
      .from("facturas")
      .insert({
        tipo: datos.tipo,
        proveedor: datos.proveedor,
        cif: datos.cif,
        numero_documento: datos.numero_documento,
        fecha: datos.fecha,
        subtotal: datos.subtotal,
        iva: datos.iva,
        total: datos.total,
        observaciones: datos.observaciones,
        resumen: datos.resumen,
        embedding: vec(facturaEmbedding),
        verificada: false,
        procesado_en: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (facErr) throw new Error(`insert factura: ${facErr.message}`);
    const facturaId = factura.id;

    // 7) Productos: embeddings en batch (1 sola llamada) + insert masivo
    if (datos.productos.length > 0) {
      const embeddings = await embed(datos.productos.map((p) => p.nombre));
      const filas = datos.productos.map((p, i) => ({
        factura_id: facturaId,
        nombre: p.nombre,
        cantidad: p.cantidad,
        unidad: p.unidad,
        precio_unitario: p.precio_unitario,
        total: p.total,
        embedding: vec(embeddings[i]),
      }));
      const { error: prodErr } = await supabase.from("productos_factura").insert(filas);
      if (prodErr) throw new Error(`insert productos: ${prodErr.message}`);
    }

    // 8) Subir archivo a Drive y guardar el enlace (no bloquea la respuesta si falla)
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const driveUrl = await subirADrive(bytes, archivo.nombre, mimeType, datos.fecha);
      if (driveUrl) {
        await supabase.from("facturas").update({ drive_url: driveUrl }).eq("id", facturaId);
      }
    } catch (driveError) {
      console.error("[Drive] Error subiendo (la factura YA está guardada):", driveError);
    }

    console.log(`[procesar-factura] OK ${datos.tipo} ${datos.numero_documento} · ${datos.productos.length} productos`);
    return new Response(
      JSON.stringify({
        success: true,
        nombre: archivo.nombre,
        tipo: datos.tipo,
        message: "Documento procesado correctamente",
        webhookResponse: {
          tipo: datos.tipo,
          numero_documento: datos.numero_documento,
          proveedor: datos.proveedor,
          total: datos.total,
          factura_id: facturaId,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("[procesar-factura] Error:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }
});
