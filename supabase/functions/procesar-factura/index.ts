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

// Fallback de archivo: bucket PRIVADO de Supabase Storage.
// Mientras los secrets GOOGLE_* no existan, DRIVE_ENABLED es false y el
// original se perdia con un console.warn. Con esto siempre queda guardado en
// algun sitio, y `facturas.archivo_path` apunta a el.
// Creado por la migracion 20260919110000_facturas_archivo_original_y_validacion.sql
const STORAGE_BUCKET = "facturas-originales";

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
    // No es un error: simplemente Drive no esta configurado. Quien llama debe
    // recurrir al fallback de Storage, nunca descartar el fichero.
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

// ─── Supabase Storage (fallback del archivo original) ────────────────────────

// Marcas diacriticas (U+0300–U+036F) que deja sueltas `normalize("NFD")`.
// Se construye con fromCharCode para no depender de secuencias de escape en el
// fichero fuente, que es facil que se corrompan al editarlo.
const DIACRITICOS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

/** Nombre de fichero seguro para una clave de Storage. */
function nombreSeguro(nombre: string): string {
  const limpio = (nombre || "documento")
    .normalize("NFD")
    .replace(DIACRITICOS, "")         // "Factura Nº Ángel" -> "Factura N Angel"
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);                     // por la cola: conserva la extension
  return limpio || "documento";
}

/**
 * Guarda el original en el bucket privado. Devuelve la ruta dentro del bucket.
 * Misma jerarquia año/mes que Drive, tomada de la FECHA DEL DOCUMENTO.
 */
// deno-lint-ignore no-explicit-any
async function guardarEnStorage(
  supabase: any,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  fecha: string,
  facturaId: number,
): Promise<string> {
  const path = `${fecha.slice(0, 4)}/${fecha.slice(5, 7)}/${facturaId}-${nombreSeguro(fileName)}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([bytes], { type: mimeType }), {
      contentType: mimeType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  return path;
}

/**
 * Archiva el documento original. Drive si esta configurado, Supabase Storage si
 * no (o si Drive falla). Nunca lanza: el documento ya esta en base de datos y
 * un fallo de archivado no debe invalidar el procesado. Devuelve que se logro.
 */
// deno-lint-ignore no-explicit-any
async function archivarOriginal(
  supabase: any,
  b64: string,
  fileName: string,
  mimeType: string,
  fecha: string,
  facturaId: number,
): Promise<{ drive_url: string | null; archivo_path: string | null; error: string | null }> {
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "base64 invalido";
    console.error("[archivo] No se pudo decodificar el base64:", msg);
    return { drive_url: null, archivo_path: null, error: msg };
  }

  // 1) Google Drive, si hay secrets.
  if (DRIVE_ENABLED) {
    try {
      const driveUrl = await subirADrive(bytes, fileName, mimeType, fecha);
      if (driveUrl) return { drive_url: driveUrl, archivo_path: null, error: null };
    } catch (e) {
      console.error("[Drive] Fallo la subida, se intenta Storage:", e);
    }
  } else {
    console.warn(
      "[Drive] Secrets GOOGLE_* no configurados → el original va a Supabase Storage.",
    );
  }

  // 2) Fallback: bucket privado de Supabase.
  try {
    const path = await guardarEnStorage(supabase, bytes, fileName, mimeType, fecha, facturaId);
    return { drive_url: null, archivo_path: path, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    // Este SI es un problema serio: se ha perdido el original.
    console.error(
      `[archivo] PERDIDA DEL ORIGINAL de la factura ${facturaId} (${fileName}): ${msg}`,
    );
    return { drive_url: null, archivo_path: null, error: msg };
  }
}

// ─── Autenticación / autorización ────────────────────────────────────────────
// ⚠️ `verify_jwt` NO sirve como autenticación en este proyecto: la anon key es
// un JWT válido y viaja en el bundle público del panel. Hay que comprobar que
// detrás del token hay un USUARIO real y que ese usuario tiene acceso a la
// sección `facturas`. Mismo patrón que las funciones `admin-*`.
//
// El panel llama con `supabase.functions.invoke()` desde una sesión iniciada,
// así que el JWT de usuario llega en la cabecera Authorization.
async function autenticar(req: Request): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.error("[procesar-factura] Sin cabecera Authorization");
    return { ok: false, response: json({ success: false, error: "No autorizado" }, 401) };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Cliente con el token del llamante: resuelve QUIÉN es.
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    // Aquí cae la anon key suelta: es un JWT válido pero sin usuario detrás.
    console.error("[procesar-factura] Token sin usuario:", userError?.message);
    return { ok: false, response: json({ success: false, error: "Usuario no autenticado" }, 401) };
  }

  // Cliente service role solo para comprobar permisos.
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // `has_section_permission` ya devuelve true para administradores.
  // Se exige 'view' (no 'edit') porque es exactamente lo que exige el panel
  // para entrar en /facturas (ProtectedRoute.tsx:63-65) y el uploader no está
  // gateado por can_edit. Subir a 'edit' requiere antes gatear la UI.
  const { data: permitido, error: permError } = await supabaseAdmin.rpc(
    "has_section_permission",
    { _user_id: user.id, _section: "facturas", _permission: "view" },
  );

  if (permError) {
    console.error("[procesar-factura] Error comprobando permisos:", permError.message);
    return { ok: false, response: json({ success: false, error: "Error verificando permisos" }, 500) };
  }

  if (!permitido) {
    console.error("[procesar-factura] Usuario sin acceso a facturas:", user.id);
    return {
      ok: false,
      response: json({ success: false, error: "Sin permisos sobre la sección de facturas" }, 403),
    };
  }

  return { ok: true, userId: user.id };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Autenticación ANTES de tocar OpenAI, Drive o la base de datos.
  const auth = await autenticar(req);
  if (!auth.ok) return auth.response;

  try {
    const payload = await req.json();
    const archivo = payload.archivo;
    if (!archivo?.contenido_base64) throw new Error("No se recibió ningún archivo");

    const mimeType: string = archivo.tipo || "application/pdf";
    const isPdf = mimeType.includes("pdf");
    const b64: string = archivo.contenido_base64.includes(",")
      ? archivo.contenido_base64.split(",")[1]
      : archivo.contenido_base64;

    console.log(`[procesar-factura] ${archivo.nombre} (${mimeType}) — user ${auth.userId}`);

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

    // 8) Validación de cordura de los importes (T5)
    //    No corrige ni bloquea: deja constancia de lo que un humano deberia
    //    mirar. Se hace DESPUES de insertar las lineas porque la funcion SQL
    //    usa `nombre_normalizado`, que es una columna generada.
    // deno-lint-ignore no-explicit-any
    let alertas: any[] = [];
    try {
      const { data: alertasData, error: valErr } = await supabase.rpc(
        "validar_cordura_factura",
        { p_factura_id: facturaId },
      );
      if (valErr) throw new Error(valErr.message);
      alertas = Array.isArray(alertasData) ? alertasData : [];
      if (alertas.length > 0) {
        console.warn(
          `[validacion] ${datos.tipo} ${datos.numero_documento} con ${alertas.length} alerta(s):`,
          alertas.map((a) => a?.codigo).join(", "),
        );
        const { error: updErr } = await supabase
          .from("facturas")
          .update({ alertas_validacion: alertas })
          .eq("id", facturaId);
        if (updErr) console.error("[validacion] No se pudieron guardar las alertas:", updErr.message);
      }
    } catch (valError) {
      // Que falle la validacion no invalida el documento, pero tiene que verse.
      console.error("[validacion] Error validando importes:", valError);
    }

    // 9) Archivar el original: Drive si esta configurado, Supabase Storage si no.
    const archivado = await archivarOriginal(
      supabase, b64, archivo.nombre, mimeType, datos.fecha, facturaId,
    );
    if (archivado.drive_url || archivado.archivo_path) {
      const { error: archErr } = await supabase
        .from("facturas")
        .update({
          ...(archivado.drive_url ? { drive_url: archivado.drive_url } : {}),
          ...(archivado.archivo_path ? { archivo_path: archivado.archivo_path } : {}),
        })
        .eq("id", facturaId);
      if (archErr) {
        console.error("[archivo] No se pudo guardar la referencia al original:", archErr.message);
      }
    }

    const alertasAltas = alertas.filter((a) => a?.severidad === "alta").length;
    console.log(
      `[procesar-factura] OK ${datos.tipo} ${datos.numero_documento} · ` +
      `${datos.productos.length} productos · alertas: ${alertas.length} · ` +
      `original: ${archivado.drive_url ? "drive" : archivado.archivo_path ? "storage" : "NO GUARDADO"}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        nombre: archivo.nombre,
        tipo: datos.tipo,
        message: alertas.length > 0
          ? `Documento procesado. Revisa ${alertas.length} aviso(s) sobre los importes.`
          : "Documento procesado correctamente",
        // Avisos para que SubidaFacturas.tsx pueda pintarlos.
        alertas,
        archivo_guardado: !!(archivado.drive_url || archivado.archivo_path),
        archivo_error: archivado.error,
        webhookResponse: {
          tipo: datos.tipo,
          numero_documento: datos.numero_documento,
          proveedor: datos.proveedor,
          total: datos.total,
          factura_id: facturaId,
          alertas: alertas.length,
          alertas_graves: alertasAltas,
          archivo_guardado: !!(archivado.drive_url || archivado.archivo_path),
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
