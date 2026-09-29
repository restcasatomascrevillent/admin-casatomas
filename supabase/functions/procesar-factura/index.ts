import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toNumber } from "./normalizacion.ts";
import {
  comprobarCuadre,
  compararExpansion,
  conservarRecuentoFilas,
  contarCambiosNumericos,
  deducirImportes,
  retirarImportesNoImpresos,
  aplicarRecuentoVerificado,
  RECUENTO_FILAS_SCHEMA,
  type RecuentoFilas,
  VERIFICACION_PIE_SCHEMA,
  type VerificacionPie,
  DOCUMENTO_JSON_SCHEMA,
  describirProblemas,
  descuadresComoAlertas,
  MAX_CAMBIOS_RELECTURA,
  mensajeCorrectivo,
  validarEstructura,
  type Descuadre,
  type DocumentoExtraido,
  type OrigenImporte,
} from "./esquema.ts";
import { diagnosticoResolucion } from "./imagen.ts";

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

// ─── Prompt de Vision ────────────────────────────────────────────────────────
//  REESCRITO. El anterior venía COPIADO VERBATIM del workflow n8n "OCR
//  Facturas" y nunca se había revisado. Lo que se le encontró al leerlo
//  entero, y que este arregla:
//
//   1. Dedicaba ~50 líneas a dibujar la estructura JSON de salida, dos veces
//      (una para factura y otra para albarán, idénticas salvo el texto de
//      `observaciones`). Eso ahora lo impone `DOCUMENTO_JSON_SCHEMA` con
//      `strict: true`, que el modelo NO PUEDE incumplir. Repetirlo en el
//      prompt solo añadía tokens y una fuente de contradicción.
//   2. Los ejemplos mostraban `"cantidad": 0.0` y `"precio_unitario": 0.00`,
//      que invitan a devolver ceros literales cuando el modelo duda.
//      Se han quitado: ahora cada campo se describe en el esquema.
//   3. Pedía un campo `notas` de texto libre "Si es bonificado o dto 100%"
//      que `normalizarDatos` tiraba a la basura y que no tiene columna en
//      `productos_factura`. Sustituido por el booleano `bonificada`, que sí
//      se usa (evita marcar como descuadre una línea de regalo).
//   4. Sobre el formato numérico decía una sola frase: `Convierte siempre a
//      formato estándar (ej: "1.200,50" -> 1200.50)`. Insuficiente para el
//      punto más delicado del documento: en España "." es separador de MILES
//      y "," es DECIMAL, y confundirlos mueve la coma un lugar. Ahora es una
//      sección con ejemplos de los dos sentidos.
//   5. No decía NADA sobre precio por kilo frente a precio por pieza. Es
//      justo lo que falla en el albarán de Joselito (12 jamones a 9.316,67
//      EUR/ud). Ahora hay regla explícita y el campo `base_precio`.
//   6. No pedía ninguna comprobación aritmética antes de responder. Una
//      factura trae redundancia de serie (línea = cantidad x precio, suma de
//      líneas = subtotal, subtotal + IVA = total) y el prompt la ignoraba.
//      Ahora es un paso obligatorio.
//   7. No decía nada del formato de fecha de entrada. En España se escribe
//      DD/MM/AAAA y el modelo puede leerlo como MM/DD. Ahora es explícito.
const VISION_SYSTEM_PROMPT = `Eres un sistema experto de análisis documental para contabilidad en España.

Analizas VISUALMENTE documentos comerciales españoles (facturas y albaranes) de un RESTAURANTE y extraes sus datos. La forma exacta de la salida la impone el esquema JSON de la respuesta; tú concéntrate en LEER BIEN.

Cada documento es de un proveedor distinto: los nombres de las columnas cambian ("Importe" puede ser el precio unitario en un documento y el total en otro), el orden cambia, y algunas líneas son bonificaciones con coste 0.

════════════════════════════════════════════
1. CLASIFICACIÓN
════════════════════════════════════════════
Mira el TÍTULO del documento: la palabra grande de la cabecera, o la que va en
el recuadro destacado. Eso es lo que decide.
  "Factura" o "Invoice" en el título → factura
  "Albarán", "Nota de entrega" o "Delivery Note" en el título → albaran,
  aunque lleve precios e IVA.

CUIDADO: muchas facturas traen una CASILLA llamada "Albarán" o "Nº albarán"
con el número del albarán al que corresponden. Eso es una referencia cruzada,
no el tipo del documento. Si el título dice FACTURA, es una factura aunque
aparezca la palabra "albarán" tres veces dentro.
Regla práctica: si hay total a pagar, vencimiento, forma de pago o desglose de
IVA, casi siempre es una factura.

════════════════════════════════════════════
1b. QUIÉN ES EL PROVEEDOR (se confunde muy a menudo)
════════════════════════════════════════════
El proveedor es QUIEN EMITE y cobra. Suele estar en el LOGO, arriba a la
izquierda, o en el texto legal del margen o del pie ("Reg. Mercantil...",
"GRUPO X, S.A.").

El bloque que pone "Dirección de envío", "Cliente", "Facturar a", "Destinatario"
o "Enviar a" es el DESTINATARIO. NO es el proveedor, y su CIF tampoco.

El destinatario SIEMPRE es el restaurante: verás "MASIDE 2011, S.L.",
"RESTAURANTE CASA TOMAS", "CASA TOMAS", "BARRA CASA TOMAS" o "TOUZA", en
Crevillente (Alicante). Si el nombre que ibas a poner como proveedor es uno de
esos, te has equivocado de bloque: el proveedor es el otro.
Y el cif que se pide es el DEL PROVEEDOR. Si el único CIF que ves está dentro
del bloque del destinatario, devuelve cif = null antes que el del cliente.

════════════════════════════════════════════
2. NÚMEROS: FORMATO ESPAÑOL (lo más delicado)
════════════════════════════════════════════
En España el punto separa los MILES y la coma separa los DECIMALES. Al revés que en inglés. Confundirlos mueve la coma de sitio y multiplica o divide el importe por mil.

  "1.200,50"  → 1200.50     (mil doscientos con cincuenta)
  "12.513,50" → 12513.50    (doce mil quinientos trece con cincuenta)
  "931,67"    → 931.67      (novecientos treinta y uno con sesenta y siete)
  "120.580"   → 120580      (ciento veinte mil quinientos ochenta)
  "120,58"    → 120.58      (ciento veinte con cincuenta y ocho)
  "1.234.567,89" → 1234567.89

CUIDADO con la coma seguida de TRES decimales. En columnas de cantidad y de
peso es lo normal, porque los kilos se dan al gramo:

  "111,800"   → 111.8   kg   (ciento once kilos ochocientos gramos)
  "12,000"    → 12           (doce unidades justas)
  "1,000"     → 1            (una unidad)
  "-1,000"    → -1           (una unidad en negativo: un abono o un rappel)
  "7,350"     → 7.35    kg

Leer "111,800" como ciento once mil ochocientos es el error más caro que
puedes cometer aquí: convierte 111 kilos de jamón en 111.800 €.
Un mismo documento puede mezclar las dos convenciones: tres decimales en las
columnas de cantidad y peso, dos decimales en las de dinero.

NO DES POR HECHO EL FORMATO ESPAÑOL. Algunos proveedores emiten con el
formato anglosajón (punto decimal, coma de millares), y algún documento mezcla
los dos en la misma tabla:

  "1,130.47"  → 1130.47    (anglosajón: la coma es de millares)
  "1.130,47"  → 1130.47    (español: el punto es de millares)

Cómo decidirlo sin equivocarse: el separador que esté MÁS A LA DERECHA es el
decimal. Y si detrás de un separador hay exactamente 3 cifras y no hay ningún
otro separador, mira el resto de la columna y el total antes de decidir: en
una columna de dinero suele ser de millares, y en una de peso, decimales.
Comprueba siempre que la interpretación que elijas hace que las líneas sumen
el total impreso. Si no suma, has elegido mal el separador.

Devuelve SIEMPRE números JSON con punto decimal y SIN separador de miles.
NUNCA devuelvas 1234,56 ni "1.234,56" ni 1.234 para un valor que vale mil doscientos treinta y cuatro con cincuenta y seis.

Antes de dar un importe por bueno, pregúntate si el orden de magnitud tiene sentido: un restaurante no paga 9.000 € por un jamón ni 120.000 € por una entrega de género. Si un número te sale desproporcionado, casi siempre es (a) la coma leída un lugar más a la derecha, (b) el total de la línea metido en la columna del precio unitario, o (c) un dígito mal leído. Vuelve a mirar la imagen.

════════════════════════════════════════════
3. FECHAS
════════════════════════════════════════════
En España se escribe DD/MM/AAAA. "03/09/2026" es el 3 de SEPTIEMBRE, no el 9 de marzo.
Devuelve siempre AAAA-MM-DD. Usa la fecha DEL DOCUMENTO (emisión o entrega), nunca la de hoy.

════════════════════════════════════════════
4. TABLA DE LÍNEAS
════════════════════════════════════════════
A0. ANTES DE NADA: ¿ESTE DOCUMENTO LLEVA PRECIOS?
   Muchos albaranes de entrega NO llevan ningún importe: solo traen qué se
   entrega, cuántas unidades y cuánto pesa. Es lo normal, no un documento
   incompleto ni mal escaneado.
   Búscalo de forma explícita: ¿hay una columna con el símbolo €, o cabeceras
   tipo "Precio", "Importe", "P.V.P.", "Base", "Total €"? ¿Hay un total a pagar
   al pie?
   Si NO lo hay: sin_importes = true, y precio_unitario, total, subtotal, iva y
   total del documento van todos a null.
   PROHIBIDO deducir un precio. Nada de dividir un número entre la cantidad,
   nada de multiplicar, nada de estimar por lo que suele costar el producto.
   Si el precio no está impreso, NO EXISTE. Un hueco vacío es un dato correcto;
   un número inventado es un error que nadie detectará después.

A. Si el documento SÍ lleva precios, identifica las columnas por aritmética y
   no por el nombre de la cabecera:
     cantidad × precio_unitario = total_línea
   El que multiplica es el PRECIO UNITARIO; el resultado es el TOTAL DE LÍNEA.
   Si la aritmética no encaja con ninguna pareja de columnas, NO fuerces la
   interpretación: es señal de que esa columna no es dinero (ver A1).

A1. UNA COLUMNA DE NÚMEROS NO ES AUTOMÁTICAMENTE DINERO.
   En alimentación es muy frecuente que la tabla traiga CANTIDAD y PESO:
     "JAMON G.R. (2)     12,000     111,800"
   Eso son 12 piezas que pesan 111,8 kg. NO son 111.800 €, y el precio
   unitario NO es 111800/12. Van en cantidad = 12 y peso_kg = 111.8.
   Señales de que una columna es PESO y no importe: hay tres decimales
   (los kilos se dan al gramo), la cabecera dice Kg/Peso/Neto/Bruto, el
   producto se vende al peso (jamón, carne, pescado, queso), o no hay ningún
   símbolo de euro ni total a pagar en toda la página.

B. PRECIO UNITARIO vs PRECIO POR KILO. Muchos proveedores de alimentación
   facturan al peso. Si la columna de precio dice €/kg, EUR/Kg, "precio kilo"
   o similar, entonces:
     - precio_unitario es el precio POR KILO
     - base_precio = "por_kg"
     - cantidad son los KILOS (puede llevar decimales: 7.35)
   Si el precio es por pieza o por unidad de venta, base_precio = "por_unidad".
   Regla que decide siempre: elige la combinación que cumpla
   cantidad × precio_unitario = total_línea.
   Si el documento muestra a la vez un precio por kilo y un precio por pieza,
   pon en precio_unitario el que cuadre con el total de la línea, y marca
   base_precio en consecuencia.
   NO pongas nunca el total de la línea en precio_unitario.

C. Bonificaciones y descuentos del 100%: líneas con cantidad > 0 e importe 0
   son regalos. NO LAS ELIMINES. Marca bonificada = true, pon total = 0 y el
   precio_unitario real si aparece.
   Para el resto de líneas, bonificada = false.

C1. UNA LÍNEA POR CADA FILA IMPRESA. ESTO ES LO QUE MÁS SE FALLA.
   El mismo producto PUEDE APARECER VARIAS VECES en el mismo documento, con
   cantidades e importes distintos. Eso NO es un duplicado: son filas
   distintas del papel, y cada una hay que devolverla.
   Es lo normal en una FACTURA MENSUAL que agrupa varios albaranes del mes:
   ahí el mismo artículo sale una vez por cada entrega, a veces con el número
   de albarán y la fecha en su propia fila. Un documento así puede traer 54
   filas de sólo 21 productos distintos.
   PROHIBIDO:
     - agrupar dos filas del mismo producto en una,
     - sumar sus cantidades o sus importes,
     - quedarte con una fila y descartar las demás,
     - saltarte una fila porque su nombre ya lo habías escrito antes.
   Si al terminar la lista NO HAY NINGÚN NOMBRE REPETIDO y el documento sí
   repetía productos, te has dejado filas: vuelve a la tabla y recórrela fila
   por fila, de arriba abajo, sin mirar lo que ya has escrito.
   El recuento va aparte, en "filas_tabla": cuenta las filas SOBRE LA IMAGEN
   antes de extraerlas y pon ahí ese número. Tiene que coincidir con el número
   de entradas de "productos". Si no coincide, falta trabajo por hacer.
   Y si la foto es mala, está torcida o junta dos páginas: EXTRAE LO QUE
   CONSIGAS LEER. Nunca devuelvas la lista vacía ni te rindas pidiendo una
   foto mejor. Una lectura parcial se guarda con su aviso y sirve; una lista
   vacía no sirve para nada. Si no has podido contar las filas, pon
   "filas_tabla": null y extrae igualmente todas las que veas.

C2. "continua_en_otra_pagina": ¿EL DOCUMENTO SIGUE MÁS ALLÁ DE LA FOTO?
   ¿El papel dice "Pág. 1 de 2", "Hoja 1/2", "continúa", "sigue"? ¿La tabla
   llega al borde de la imagen sin cerrarse? ¿Falta el pie de totales que esta
   plantilla debería traer? Entonces true.
   Describe LA IMAGEN que te han dado, no el documento ideal. Es la única
   forma de que después se sepa que la lectura está incompleta, así que
   contéstalo mirando la foto.

D. Descripción: el nombre del producto, quitando códigos internos y lotes.

E. IVA: el campo "iva" es el IMPORTE EN EUROS IMPRESO, no el porcentaje. Si
   el documento dice "IVA 10%" y abajo "48,97 €", el valor es 48.97, no 10.
   Si hay varios tipos de IVA, suma los importes IMPRESOS.
   Si sólo ves el porcentaje y el importe en euros no aparece, o queda fuera
   del encuadre, iva = null. NO lo calcules aplicando el porcentaje a la base:
   un IVA calculado es indistinguible de uno leído.

F. IMPORTES DEL PIE: SE COPIAN, NO SE CALCULAN. Y SE CITAN.
   subtotal, iva y total son TRES LECTURAS INDEPENDIENTES del pie del
   documento. Cada uno vale null si no está impreso o no se ve en la imagen.
   Esto pasa mucho con fotos recortadas por abajo:
     · si ves la BASE y la CUOTA DE IVA pero la fila del TOTAL está cortada,
       entonces total = null. NO pongas base + iva.
     · si ves el TOTAL pero no la base, subtotal = null.
     · si no ves nada del pie, los tres a null.
   NO tiene que cumplirse subtotal + iva = total en tu respuesta: esa
   comprobación NO es tu trabajo. La hace un programa después, y sólo puede
   hacerla si los tres números vienen del papel. Si rellenas el que falta, lo
   único que consigues es que la comprobación no detecte nada.

   LA CITA. Cada uno de los tres va acompañado de su literal:
   "subtotal_literal", "iva_literal" y "total_literal". Ahí copias LOS
   CARACTERES tal como están impresos en la imagen, con su coma, sus puntos y
   su moneda: "2.488,11", "376,31 EUR", "34,21".
   La regla es de una pieza:
     SI NO PUEDES CITARLO, NO LO PONGAS. Y SI NO LO PONES, EL NÚMERO VA null.
   Escribe primero la cita, mirando la imagen, y sólo después el número.
   No inventes una cita para justificar un número que has calculado: el
   literal y el número se comparan después, y un total sin cita se retira
   entero. Dejarlo a null no pierde nada —si el dato es deducible a partir de
   importes que sí están impresos, se calcula aparte y queda marcado como
   calculado— mientras que una cita falsa sí destruye la única prueba de que
   el número venía del papel.
   Para el IVA, ojo: "10,00 %" es un porcentaje, no es la cita de la cuota.
   La cita de la cuota es el importe en euros. Si sólo está el porcentaje,
   iva_literal = null e iva = null.

════════════════════════════════════════════
5. REPASO ANTES DE RESPONDER
════════════════════════════════════════════
TU TRABAJO ES LEER. COMPROBAR QUE LAS CUENTAS CUADRAN ES TRABAJO DE OTRO.
Detrás de ti hay un programa que comprueba la aritmética del documento, y sólo
puede hacerlo si cada número que le llega es el que está impreso en el papel.
En cuanto tú "arreglas" un número para que una suma salga, ese programa se
queda ciego y el error entra en la contabilidad del restaurante. Ya pasó:
121.016,92 € de importes fabricados por intentar que cuadrase precio ×
cantidad.

Así que el repaso NO es "consigue que cuadre". Es esto, en este orden:

  (1) sin_importes = true → que no quede ni un número en precio_unitario,
      total, subtotal ni iva. Si queda alguno, o el documento sí tenía
      precios, o te lo has inventado.

  (2) RECUENTO: ¿"filas_tabla" coincide con el número de entradas de
      "productos"? Si no coincide, vuelve a la tabla y recórrela fila por
      fila. Es el error más frecuente y el más caro: faltan filas repetidas.

  (3) PROCEDENCIA: recorre precio_unitario y total de cada línea, y luego
      subtotal, iva y total, y para cada uno pregúntate "¿VEO este número
      impreso en la imagen?". Si la respuesta es no, va null: aunque lo puedas
      calcular, aunque el hueco quede feo, aunque sólo falte él.

  (4) Sólo ahora, y sólo como LUPA para encontrar dígitos mal leídos: mira si
      cantidad × precio_unitario se parece al total de la línea, si las líneas
      suman algo parecido al subtotal y si base + iva se parece al total.
      Cuando algo se desvíe, VUELVE A MIRAR ESA ZONA DE LA IMAGEN: casi
      siempre hay un dígito confundido (3/8, 5/6, 1/7, 0/9, 6/0) o una coma y
      un punto cambiados.
      Y si tras mirarlo otra vez el papel dice lo que dice, DEVUELVE LO
      IMPRESO. Los documentos reales no cuadran a menudo: cánones de punto
      verde, descuentos no desglosados, portes, precios unitarios redondeados
      que no dan el importe exacto de la línea. Un descuadre real es
      información útil; un descuadre tapado es un error contable que nadie
      volverá a encontrar.

Nunca cambies un número que has leído bien para que una suma salga. Nunca
rellenes un hueco con el resultado de una operación.

════════════════════════════════════════════
6. RESUMEN
════════════════════════════════════════════
El campo "resumen" son 1-2 frases que se usan para búsqueda semántica: qué tipo de género o servicio es, qué proveedor, importe total y para qué sirve en el restaurante.`;

// ─── Helpers numéricos / normalización (portado de "Parsear Respuesta IA") ───
// `toNumber` (y el parseo de importes en varios formatos) vive en
// normalizacion.ts: es lógica pura sin nada de Deno, así que se puede
// testear con vitest (ver normalizacion.test.ts). Aquí solo se usa.

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

  // `toNumber` se mantiene aunque con `json_schema` estricto los importes ya
  // llegan como `number`: es defensa en profundidad (deja el número tal cual
  // si ya lo es) y sigue cubriendo el caso de que el esquema no se aplique.
  // Ver normalizacion.ts para la ambigüedad "." / "," del formato español.
  const productos = Array.isArray(data.productos)
    ? data.productos.map((p: any, i: number) => ({
        nombre: (p.nombre || "").trim() || `Producto ${i + 1}`,
        cantidad: toNumber(p.cantidad) || 1,
        unidad: (p.unidad || "unidades").toLowerCase().trim(),
        precio_unitario: toNumber(p.precio_unitario, true),
        total: toNumber(p.total, true),
        // `base_precio` y `bonificada` NO tienen columna en
        // `productos_factura` y el insert no los manda (mapea campo a campo).
        // Se conservan aquí porque son los que dan sentido a los números:
        // distinguen un precio por kilo de uno por pieza, y una línea de
        // regalo de un descuadre real. Se usan en los logs y en el cuadre.
        base_precio: p.base_precio ?? "desconocida",
        bonificada: p.bonificada === true,
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

// ─── Pipeline post-cabecera (líneas, validación, archivado) + compensación ──
//  El paso 6 (insertar la cabecera en `facturas`) ya dejó un `facturaId` real
//  cuando se llega aquí. Si CUALQUIER cosa de lo que sigue falla, esa fila
//  queda huérfana: existe en `facturas` pero sin líneas, sin validar y sin
//  archivar, y el frontend pinta `{success:false}` (ver el catch general,
//  HTTP 200 a propósito) como si no se hubiese creado nada — cuando sí.
//
//  `completarFactura` aísla justo esa parte del pipeline (pasos 7-9 + la
//  respuesta de éxito) para que el handler pueda envolverla en un único
//  try/catch y, si algo revienta, deshacer la cabecera con
//  `compensarFacturaHuerfana` antes de propagar el error tal cual al catch
//  general. El paso 6 en sí NO se compensa aquí porque, si fallara, nunca se
//  habría llegado a tener `facturaId`.

/**
 * Pasos 7 (líneas de producto), 8 (validación de cordura, T5) y 9 (archivado
 * del original) + construcción de la respuesta de éxito. Si algo lanza,
 * quien llama (el handler) es responsable de compensar y relanzar.
 */
// deno-lint-ignore no-explicit-any
async function completarFactura(
  supabase: any,
  facturaId: number,
  // deno-lint-ignore no-explicit-any
  datos: any,
  // deno-lint-ignore no-explicit-any
  archivo: any,
  b64: string,
  mimeType: string,
  // Descuadres detectados ANTES de guardar (ver `extraerConCuadre`). Llegan ya
  // con el formato de `validar_cordura_factura` para poder mezclarlos.
  // deno-lint-ignore no-explicit-any
  alertasPrevias: any[] = [],
  // Procedencia de `facturas.total` (ver paso 2b del handler). Solo viaja
  // hasta la respuesta: la columna ya la escribió el insert del paso 6.
  totalOrigen: OrigenImporte | null = null,
): Promise<Response> {
  // 7) Productos: embeddings en batch (1 sola llamada) + insert masivo
  if (datos.productos.length > 0) {
    const embeddings = await embed(datos.productos.map((p: { nombre: string }) => p.nombre));
    const filas = datos.productos.map((p: Record<string, unknown>, i: number) => ({
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
  //    No corrige ni bloquea: deja constancia de lo que un humano debería
  //    mirar. Se hace DESPUÉS de insertar las líneas porque la función SQL
  //    usa `nombre_normalizado`, que es una columna generada.
  // deno-lint-ignore no-explicit-any
  let alertas: any[] = [];
  try {
    const { data: alertasData, error: valErr } = await supabase.rpc(
      "validar_cordura_factura",
      { p_factura_id: facturaId },
    );
    if (valErr) throw new Error(valErr.message);
    const alertasSql = Array.isArray(alertasData) ? alertasData : [];

    // Mezcla pre-guardado + post-guardado, sin duplicar por `codigo`.
    // Las dos comprobaciones miran los MISMOS números, así que casi todo
    // coincide; manda la versión SQL porque además cruza con el histórico.
    // Lo que sí aporta el pre-guardado es lo que SQL no llega a ver con sus
    // tolerancias: en particular `iva_incoherente`, donde SQL admite un 1%
    // del total (en una factura de 5.000 EUR, 50 EUR de error) y aquí la
    // tolerancia es el redondeo real, un céntimo por línea.
    const codigosSql = new Set(alertasSql.map((a) => a?.codigo));
    const soloPrevias = alertasPrevias.filter((a) => !codigosSql.has(a?.codigo));
    alertas = [...alertasSql, ...soloPrevias];

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
    // Que falle la validación no invalida el documento, pero tiene que verse.
    console.error("[validacion] Error validando importes:", valError);
    // Si la RPC no llegó a responder, al menos no se pierden los descuadres
    // que ya se detectaron antes de guardar: eran los que iban a avisar de un
    // documento mal leído, y son justo lo que no debe caerse en silencio.
    if (alertas.length === 0 && alertasPrevias.length > 0) {
      alertas = alertasPrevias;
      const { error: updErr } = await supabase
        .from("facturas")
        .update({ alertas_validacion: alertas })
        .eq("id", facturaId);
      if (updErr) console.error("[validacion] Tampoco se pudieron guardar las previas:", updErr.message);
    }
  }

  // 9) Archivar el original: Drive si está configurado, Supabase Storage si no.
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
        // 'deducido' = lo calculamos nosotros sumando, no se leyó del papel.
        total_origen: totalOrigen,
        factura_id: facturaId,
        alertas: alertas.length,
        alertas_graves: alertasAltas,
        archivo_guardado: !!(archivado.drive_url || archivado.archivo_path),
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
}

/**
 * Deshace una factura que quedó a medias: la cabecera se insertó (paso 6)
 * pero algo del resto del pipeline falló después. Sin esto, el usuario ve
 * `{success:false}` (HTTP 200, así lo espera el frontend) y cree que no se
 * creó nada — pero la fila sigue en `facturas`.
 *
 * Best-effort y defensivo:
 *  - Borra primero `productos_factura` por `factura_id` y LUEGO `facturas`
 *    por `id`. El `CREATE TABLE` de ninguna de las dos está en este repo
 *    (falta, es un problema real y aparte — ver el aviso del encargo), así
 *    que no se puede saber desde aquí si hay `ON DELETE CASCADE` entre
 *    ellas. Borrar explícito primero es correcto tanto si lo hay (el borrado
 *    de líneas no encuentra nada, no pasa nada) como si no lo hay (evita
 *    dejar líneas huérfanas o un error de FK al borrar la cabecera). En la
 *    práctica esto va a borrar 0 filas de `productos_factura` casi siempre:
 *    el insert del paso 7 es una única sentencia — si falló, no dejó ninguna
 *    fila a medias.
 *  - NO toca `historial_precios` (ni falta que hace: `procesar-factura` no
 *    escribe ahí — lo confirma un grep sobre `supabase/functions` — así que
 *    una factura huérfana de esta función no puede haber dejado rastro en
 *    esa tabla). Tocar esa tabla está fuera de alcance de todos modos.
 *  - Si el borrado mismo falla (best-effort: puede fallar, p.ej. por RLS o
 *    por una FK inesperada desde otra tabla), NO se enmascara el error
 *    original: se deja constancia por consola de que ha quedado una fila
 *    huérfana CON SU ID para poder limpiarla a mano, y quien llama sigue
 *    relanzando `causaOriginal` de todos modos.
 */
// deno-lint-ignore no-explicit-any
async function compensarFacturaHuerfana(
  supabase: any,
  facturaId: number,
  causaOriginal: unknown,
): Promise<void> {
  const causaMsg = causaOriginal instanceof Error ? causaOriginal.message : String(causaOriginal);
  try {
    const { error: delProdErr } = await supabase
      .from("productos_factura")
      .delete()
      .eq("factura_id", facturaId);
    if (delProdErr) {
      // No se aborta: se sigue intentando borrar la cabecera igualmente.
      console.error(
        `[compensacion] factura ${facturaId}: fallo borrando sus productos_factura antes de ` +
        `deshacer la cabecera: ${delProdErr.message}`,
      );
    }

    const { error: delFacErr } = await supabase.from("facturas").delete().eq("id", facturaId);
    if (delFacErr) {
      console.error(
        `[compensacion] FALLO AL LIMPIAR: la factura ${facturaId} quedó huérfana (pipeline ` +
        `incompleto tras insertar la cabecera) y NO se pudo borrar: ${delFacErr.message}. ` +
        `Revisar y borrar a mano. Causa original del fallo: ${causaMsg}`,
      );
      return;
    }
    console.warn(
      `[compensacion] factura ${facturaId} deshecha tras un fallo posterior al insert de la ` +
      `cabecera. Causa original: ${causaMsg}`,
    );
  } catch (compError) {
    const compMsg = compError instanceof Error ? compError.message : String(compError);
    console.error(
      `[compensacion] FALLO AL LIMPIAR: excepción borrando la factura huérfana ${facturaId}: ` +
      `${compMsg}. Revisar y borrar a mano. Causa original del fallo: ${causaMsg}`,
    );
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

// ─── Extracción: esquema estricto + validación + un reintento correctivo ────
//
//  ANTES: una sola llamada con `response_format: { type: "json_object" }`, que
//  solo garantiza que el texto devuelto sea JSON parseable. Nada comprobaba la
//  FORMA (campos de más, de menos, o con el tipo equivocado) ni que los
//  NÚMEROS cuadrasen entre sí. Un documento mal leído se guardaba entero y en
//  silencio, y la única red era `validar_cordura_factura`, que corre DESPUÉS
//  de insertar y se limita a anotar avisos que alguien tiene que mirar a mano.
//
//  AHORA, tres redes en cascada:
//   1. `response_format: { type: "json_schema", strict: true }` — el modelo no
//      puede devolver otra forma. El error salta en origen.
//   2. `validarEstructura` — por si el esquema no se aplicase (cambio de
//      modelo, degradación de la API). Falla diciendo qué campo está mal.
//   3. `comprobarCuadre` + UN reintento — si los números no cuadran entre sí,
//      se le devuelve al modelo el descuadre concreto y se le pide que vuelva
//      a mirar la imagen. Esto es lo que evita tener que repasar a mano.
//
//  El reintento es UNO solo, y deliberadamente:
//   - Cuesta otra llamada completa (la imagen viaja de nuevo en el historial).
//   - Si a la segunda sigue sin cuadrar, insistir rara vez ayuda: o el
//     documento está impreso así, o la imagen no da más de sí.
//   - Nunca bloquea el guardado. Un documento con un aviso sigue siendo mejor
//     que ningún documento; lo que no puede pasar es guardarlo SIN el aviso.

const MODELO_VISION = "gpt-5-mini";

/** Peso de un conjunto de descuadres, para poder comparar dos intentos.
 *  Una alerta 'alta' (precio o total inverosímil) pesa más que diez 'media'. */
function peso(descuadres: Descuadre[]): number {
  return descuadres.reduce((acc, d) => acc + (d.severidad === "alta" ? 10 : 1), 0);
}

// deno-lint-ignore no-explicit-any
async function llamarVision(mensajes: any[]): Promise<unknown> {
  const res = await fetch(`${OPENAI}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODELO_VISION,
      // 54 filas de concepto (la factura mensual ML/101511 de Luga Sabores)
      // mas el razonamiento no caben en 16k: la respuesta se cortaba por el
      // limite y el documento se perdia entero. El coste no sube por subir el
      // techo, solo por los tokens que de verdad se generen.
      max_completion_tokens: 32000,
      // El modo fuerte. `gpt-5-mini` declara `structured_outputs` entre sus
      // capacidades y admite `v1/chat/completions`, así que esto es válido
      // para el modelo que ya se venía usando: no hay cambio de modelo.
      response_format: { type: "json_schema", json_schema: DOCUMENTO_JSON_SCHEMA },
      messages: mensajes,
    }),
  });
  if (!res.ok) throw new Error(`Vision ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const choice = json?.choices?.[0];

  // Con Structured Outputs una negativa del modelo llega en su propio campo,
  // no como JSON malformado. Distinguirla evita un "JSON inválido" engañoso.
  if (choice?.message?.refusal) {
    throw new Error(`El modelo rechazó procesar el documento: ${choice.message.refusal}`);
  }
  // Un JSON cortado por el límite de tokens parsea mal y el error no dice por
  // qué. Con 16.000 tokens no debería pasar, pero si pasa hay que saberlo.
  if (choice?.finish_reason === "length") {
    throw new Error(
      "La respuesta del modelo se cortó por el límite de tokens (documento con demasiadas líneas). " +
      "El JSON está incompleto y no se guarda nada.",
    );
  }

  const raw = choice?.message?.content;
  if (!raw) throw new Error("Vision no devolvió contenido");
  if (typeof raw !== "string") return raw;
  // El destripado de ``` ya no hace falta con json_schema, pero se mantiene:
  // cuesta nada y cubre el caso de que la API degrade a texto libre.
  return JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
}


// ─── Verificador de pie: la segunda mirada ───────────────────────────────────
//  Ver el bloque 3c de esquema.ts para por que esto es una llamada aparte y no
//  un campo mas del esquema grande.
const PIE_SYSTEM_PROMPT = `Eres un verificador de encuadre de fotos de documentos comerciales españoles.

No extraes datos. Sólo respondes a UNA pregunta: ¿qué se ve, y hasta dónde, en el PIE del documento de la imagen?

El pie de una factura o albarán español suele traer, de arriba abajo:
  BASE IMPONIBLE / BASE I.V.A.  →  % I.V.A.  →  CUOTA DE IVA  →  TOTAL / TOTAL FACTURA / TOTAL ALBARÁN / IMPORTE A PAGAR

Es MUY frecuente que la foto corte el papel por abajo y que la fila del TOTAL quede fuera aunque sí se vean la base y la cuota. También pasa que una sombra, un dedo o la barra de un visor de PDF la tapen.

LO QUE DECIDE ES SI VES LOS DÍGITOS, NO CÓMO SE LLAME LA FILA.
El importe final no siempre viene etiquetado "TOTAL". Según la plantilla lo verás como TOTAL FACTURA, TOTAL ALBARÁN, IMPORTE A PAGAR, TOTAL A PAGAR, SUMA TOTAL, LÍQUIDO, SUBTOTAL, o sin etiqueta ninguna: sólo una cifra recuadrada, en negrita o al final de la línea de bases. Si en los píxeles hay una cifra que es el importe final del documento y puedes leer sus dígitos, ESO ES EL TOTAL y la respuesta es SÍ, se llame como se llame y esté donde esté.

No confundas las dos cosas que te pueden hacer fallar:
  · Decir NO porque la etiqueta no dice literalmente "TOTAL", aunque la cifra esté ahí y la estés leyendo. Eso es un error: si la has leído, está impresa.
  · Decir SÍ porque ves la base y la cuota de IVA y sabes sumarlas. Eso es el error contrario y es peor: la base y la cuota NO son el total, y si el importe final no aparece en los píxeles la respuesta es NO aunque sepas cuánto daría.

La prueba es siempre la misma: ¿puedes COPIAR los dígitos del importe final mirando la imagen? Si sí, es que está impreso. Si tendrías que calcularlo, no lo está.

Mira el borde inferior de la imagen y di la verdad sobre lo que llega a verse. NO completes el documento.`;

/**
 * Segunda lectura, estrecha, del pie del documento. Devuelve null si algo
 * falla: verificar es una mejora, no un requisito, y no puede tumbar una
 * subida que por lo demas ha ido bien.
 */
async function verificarPie(
  // deno-lint-ignore no-explicit-any
  contentBlock: any,
): Promise<VerificacionPie | null> {
  try {
    const resp = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO_VISION,
        max_completion_tokens: 4000,
        response_format: { type: "json_schema", json_schema: VERIFICACION_PIE_SCHEMA },
        messages: [
          { role: "system", content: PIE_SYSTEM_PROMPT },
          {
            role: "user",
            content: [contentBlock, { type: "text", text: "Mira el pie de este documento y contesta." }],
          },
        ],
      }),
    });
    if (!resp.ok) {
      console.warn(`[verificador-pie] HTTP ${resp.status}: se sigue sin verificar.`);
      return null;
    }
    const json = await resp.json();
    const choice = json?.choices?.[0];
    if (choice?.finish_reason === "length") {
      console.warn("[verificador-pie] respuesta cortada: se sigue sin verificar.");
      return null;
    }
    const v = JSON.parse(choice?.message?.content ?? "null") as VerificacionPie | null;
    if (!v || typeof v.fila_total_impresa !== "boolean") {
      console.warn("[verificador-pie] respuesta sin forma util: se sigue sin verificar.");
      return null;
    }
    console.log(
      `[verificador-pie] fila del total impresa: ${v.fila_total_impresa}. ` +
      `Ultimo texto visible: "${v.ultimo_texto_visible ?? ""}". ${v.motivo ?? ""}`,
    );
    return v;
  } catch (e) {
    console.warn("[verificador-pie] fallo, se sigue sin verificar:", e);
    return null;
  }
}

const CONTADOR_SYSTEM_PROMPT = `Eres un contador de filas de tablas de documentos comerciales españoles.

No extraes datos. No lees importes. Sólo cuentas.

Tu única tarea: contar cuántas FILAS DE CONCEPTO tiene la tabla de productos del documento de la imagen.

Cuenta TODAS las filas, una a una, de arriba abajo:
  · las repetidas (el mismo producto puede salir muchas veces con importes distintos: es lo normal en una factura mensual que agrupa varios albaranes),
  · las bonificadas y las de importe 0,
  · las que tienen la descripción partida en dos renglones cuentan como UNA fila.

NO cuentes: la fila de cabecera de la tabla, los subtotales por albarán, ni el pie de totales.

Si el documento tiene varias páginas o secciones dentro de la misma imagen, suma las filas de todas.

Cuenta mirando los PÍXELES, despacio. Es lo único que se te pide.`;

/**
 * Segunda lectura, estrecha, que SOLO cuenta las filas de la tabla. Devuelve
 * null si algo falla: contar es una mejora, no un requisito, y no puede tumbar
 * una subida que por lo demas ha ido bien. Ver el bloque 3d de esquema.ts para
 * por que esto es una llamada aparte y por que no se hace en todos los
 * documentos.
 */
async function contarFilas(
  // deno-lint-ignore no-explicit-any
  contentBlock: any,
): Promise<RecuentoFilas | null> {
  try {
    const resp = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO_VISION,
        max_completion_tokens: 6000,
        response_format: { type: "json_schema", json_schema: RECUENTO_FILAS_SCHEMA },
        messages: [
          { role: "system", content: CONTADOR_SYSTEM_PROMPT },
          {
            role: "user",
            content: [contentBlock, { type: "text", text: "Cuenta las filas de concepto de la tabla de este documento." }],
          },
        ],
      }),
    });
    if (!resp.ok) {
      console.warn(`[contador-filas] HTTP ${resp.status}: se sigue sin contar.`);
      return null;
    }
    const json = await resp.json();
    const choice = json?.choices?.[0];
    if (choice?.finish_reason === "length") {
      console.warn("[contador-filas] respuesta cortada: se sigue sin contar.");
      return null;
    }
    const r = JSON.parse(choice?.message?.content ?? "null") as RecuentoFilas | null;
    if (!r || (r.filas_tabla !== null && typeof r.filas_tabla !== "number")) {
      console.warn("[contador-filas] respuesta sin forma util: se sigue sin contar.");
      return null;
    }
    console.log(
      `[contador-filas] filas impresas: ${r.filas_tabla} (bloques: ${JSON.stringify(r.filas_por_bloque ?? [])}). ` +
      `${r.motivo ?? ""}`,
    );
    return r;
  } catch (e) {
    console.warn("[contador-filas] fallo, se sigue sin contar:", e);
    return null;
  }
}

/** Parsea + valida la forma. Lanza con la RUTA de los campos que fallan. */
function validarOLanzar(parsed: unknown, contexto: string): DocumentoExtraido {
  const v = validarEstructura(parsed);
  if (!v.ok) {
    throw new Error(
      `La extracción no cumple el contrato (${contexto}): ${describirProblemas(v.problemas)}`,
    );
  }
  return v.datos;
}

/**
 * Extrae el documento y, si los números no cuadran, le pide UNA vez al modelo
 * que vuelva a mirar. Devuelve la mejor de las dos lecturas y los descuadres
 * que queden, para dejarlos anotados en `alertas_validacion`.
 */
async function extraerConCuadre(
  // deno-lint-ignore no-explicit-any
  contentBlock: any,
): Promise<{ documento: DocumentoExtraido; descuadres: Descuadre[]; intentos: number }> {
  // deno-lint-ignore no-explicit-any
  const mensajes: any[] = [
    { role: "system", content: VISION_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        contentBlock,
        {
          type: "text",
          text:
            "Analiza visualmente este documento comercial español (factura o albarán) y extrae sus datos. " +
            "Copia los importes tal como están impresos y deja a null los que no veas en la imagen. " +
            "Antes de responder haz el repaso de la sección 5: cuenta las filas de la tabla y comprueba " +
            "que cada número que devuelves lo has VISTO impreso.",
        },
      ],
    },
  ];

  const primera = validarOLanzar(await llamarVision(mensajes), "primer intento");
  const descuadres1 = comprobarCuadre(primera);
  if (descuadres1.length === 0) return { documento: primera, descuadres: [], intentos: 1 };

  console.warn(
    `[extraccion] ${primera.tipo} ${primera.numero_documento}: ${descuadres1.length} descuadre(s) ` +
    `en el primer intento (${descuadres1.map((d) => d.codigo).join(", ")}). Se pide relectura.`,
  );

  let segunda: DocumentoExtraido;
  let descuadres2: Descuadre[];
  try {
    // El historial incluye el bloque de imagen del primer turno, así que el
    // modelo vuelve a tener el documento delante — que es justo lo que se le
    // pide: que mire otra vez los píxeles, no que recalcule sobre su respuesta.
    mensajes.push({ role: "assistant", content: JSON.stringify(primera) });
    mensajes.push({ role: "user", content: mensajeCorrectivo(descuadres1) });
    segunda = validarOLanzar(await llamarVision(mensajes), "reintento");
    descuadres2 = comprobarCuadre(segunda);
  } catch (e) {
    // Que falle el reintento no puede perder la primera lectura: se guarda
    // esa, con sus avisos.
    console.error("[extraccion] El reintento falló, se conserva el primer intento:", e);
    return { documento: primera, descuadres: descuadres1, intentos: 2 };
  }

  // Antes de quedarse con la relectura hay que mirar CÓMO ha cambiado, no
  // solo si cuadra mejor. Hay medidas publicadas de modelos que alteran
  // precios e inventan importes de IVA para forzar el cuadre: es decir, el
  // propio criterio con el que se detecta el error es el que aprenden a
  // satisfacer. Una corrección real toca uno o dos números; una
  // recomposición toca medio documento. Ver `contarCambiosNumericos`.
  // Antes del veto por numero de cambios: si la relectura se ha limitado a
  // ANADIR las filas que faltaban (mismos importes de linea, mismo pie, mas
  // lineas), no es una recomposicion y no se le puede aplicar el umbral de
  // tres cambios — insertar filas desplaza todos los indices de golpe. Es
  // justo el caso de la factura mensual que agrupa albaranes.
  const expansion = compararExpansion(primera, segunda);
  if (expansion.esExpansion) {
    console.log(
      `[extraccion] Relectura aceptada como EXPANSION: ${expansion.lineasAntes} -> ` +
      `${expansion.lineasDespues} linea(s), sin perder ningun importe de linea ni tocar el pie. ` +
      `Descuadres ${descuadres1.length} -> ${descuadres2.length}.`,
    );
    return {
      documento: conservarRecuentoFilas(primera, segunda),
      descuadres: descuadres2,
      intentos: 2,
    };
  }

  const cambios = contarCambiosNumericos(primera, segunda);
  if (cambios.total > MAX_CAMBIOS_RELECTURA) {
    console.warn(
      `[extraccion] Relectura DESCARTADA: cambia ${cambios.total} valores numéricos ` +
      `(${cambios.campos.slice(0, 8).join(", ")}${cambios.campos.length > 8 ? "..." : ""}). ` +
      `Eso no es corregir un dígito, es reescribir el documento para que cuadre. ` +
      `Se conserva la primera lectura con sus avisos.`,
    );
    return { documento: primera, descuadres: descuadres1, intentos: 2 };
  }

  // Se queda la lectura con menos problemas. En empate, la segunda: es la que
  // ha mirado el documento sabiendo dónde estaba el descuadre.
  if (peso(descuadres2) <= peso(descuadres1)) {
    console.log(
      `[extraccion] Relectura aceptada: ${descuadres1.length} -> ${descuadres2.length} descuadre(s), ` +
      `${cambios.total} valor(es) corregido(s): ${cambios.campos.join(", ") || "ninguno"}.`,
    );
    return {
      documento: conservarRecuentoFilas(primera, segunda),
      descuadres: descuadres2,
      intentos: 2,
    };
  }
  console.warn("[extraccion] La relectura salió peor que el primer intento; se conserva el primero.");
  return { documento: primera, descuadres: descuadres1, intentos: 2 };
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
    //
    //    Antes, mide qué resolución va a ver REALMENTE el modelo. Solo para
    //    imágenes: con un PDF el bloque `type: "file"` deja que OpenAI extraiga
    //    por su cuenta el texto y las imágenes de cada página, y ahí no hay
    //    nada que medir desde aquí.
    //
    //    El reescalado de `detail: "high"` (lado corto topado en 768 px) hace
    //    que una foto de móvil de 4032x3024 llegue al modelo como 1024x768, es
    //    decir ~88 DPI sobre un A4. A esa resolución los dígitos pequeños de
    //    una tabla de líneas se confunden, que es exactamente el error de
    //    MR FRIOSAT (591,33 leído como 585,33). Dejarlo en el log convierte esa
    //    sospecha en un número por documento. Solo mide y avisa: no toca la
    //    imagen (en Deno no hay canvas, y recortar hay que hacerlo antes de
    //    subir).
    if (!isPdf) {
      try {
        // Basta la cabecera: ~64 KB de base64 sobran para el SOF de un JPEG.
        const cabecera = atob(b64.slice(0, 65536));
        const bytes = new Uint8Array(cabecera.length);
        for (let i = 0; i < cabecera.length; i++) bytes[i] = cabecera.charCodeAt(i);
        const diag = diagnosticoResolucion(bytes);
        if (diag) console.log(diag);
      } catch {
        // Medir es informativo: si falla, no puede impedir el procesado.
      }
    }

    const contentBlock = isPdf
      ? { type: "file", file: { filename: archivo.nombre || "document.pdf", file_data: `data:application/pdf;base64,${b64}` } }
      : { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}`, detail: "high" } };

    // 2) Extracción con reintento correctivo (ver `extraerConCuadre`)
    const extraccion = await extraerConCuadre(contentBlock);

    // 2b) Deducción aritmética del total que el documento no imprime.
    //
    //     Va DESPUÉS de `extraerConCuadre` a propósito, y eso es lo que la
    //     separa de la defensa contra el modelo: cuando se llega aquí, la
    //     relectura ya se ha pedido, ya se ha comparado con
    //     `contarCambiosNumericos` y ya se ha aceptado o descartado. Esto no
    //     participa en esa decisión, no relaja ningún umbral y no habla con
    //     OpenAI: es aritmética nuestra sobre números que el modelo ya leyó, y
    //     solo rellena huecos (`null`). Nunca toca un importe leído, así que
    //     no puede silenciar ningún descuadre de `comprobarCuadre`.
    //
    //     Qué es deducible y qué no (subtotal e IVA NUNCA lo son): ver el
    //     bloque 4 de esquema.ts.
    //     Antes de deducir nada hay que quitar lo que no se ha leido: si el
    //     modelo trae un importe del pie que no puede CITAR de la imagen, ese
    //     importe lo ha calculado el, y se retira. Ver el bloque 3b de
    //     esquema.ts (caso Osborne 40295280).
    //     La segunda lectura del pie solo tiene sentido si hay algun importe
    //     que verificar: un albaran sin precios no tiene pie que mirar.
    const hayImportes = !extraccion.documento.sin_importes && (
      extraccion.documento.total !== null ||
      extraccion.documento.subtotal !== null ||
      extraccion.documento.iva !== null
    );
    const verificacion = hayImportes ? await verificarPie(contentBlock) : null;

    const { datos: citado, retiradas, discordancias } =
      retirarImportesNoImpresos(extraccion.documento, verificacion);
    for (const r of retiradas) {
      console.warn(
        `[cita] ${extraccion.documento.tipo} ${extraccion.documento.numero_documento}: se retira ` +
        `${r.campo} = ${r.valor}; el modelo no cita los caracteres impresos.`,
      );
    }

    // Si el documento no imprime NI base, NI IVA, NI total, su total solo puede
    // salir de sumar las lineas — y entonces una linea que falta es un total
    // que miente. Ese es el UNICO sitio donde se paga una segunda lectura para
    // contar las filas: ver el bloque 3d de esquema.ts (caso Luga ML/101511,
    // 54 filas impresas y 10 extraidas diciendo que la tabla tenia 10).
    const totalSaldriaDeLasLineas = !citado.sin_importes &&
      citado.subtotal === null && citado.iva === null && citado.total === null &&
      (citado.productos?.length ?? 0) > 0;
    const recuento = totalSaldriaDeLasLineas ? await contarFilas(contentBlock) : null;
    const { datos: contado, alerta: alertaRecuento } = aplicarRecuentoVerificado(citado, recuento);
    if (alertaRecuento) {
      console.warn(
        `[contador-filas] ${contado.tipo} ${contado.numero_documento}: el contador ve ` +
        `${alertaRecuento.detalle.filas_contadas} filas y la extraccion trae ` +
        `${alertaRecuento.detalle.lineas_extraidas}. NO se deducira ningun total de la suma.`,
      );
    }

    const { datos: documento, deduccion } = deducirImportes(contado);
    const datos = normalizarDatos(documento);

    // Procedencia del importe que se va a guardar en `facturas.total`:
    // 'leido' = lo puso el modelo leyendo el papel; 'deducido' = lo hemos
    // calculado aquí; null = no hay total. Es la columna que permite pintar
    // el aviso de "calculado, no leído" en el panel.
    const totalOrigen: OrigenImporte | null =
      datos.total === null ? null : deduccion ? "deducido" : "leido";

    const alertasPrevias = [
      ...descuadresComoAlertas(extraccion.descuadres, "pre-guardado"),
      ...retiradas.map((r) => r.alerta),
      ...discordancias,
      ...(alertaRecuento ? [alertaRecuento] : []),
      // El aviso de la deducción ya viene con `detalle.origen = "deduccion"`.
      ...(deduccion ? [deduccion.alerta] : []),
    ];
    if (deduccion && deduccion.metodo === "no_deducible") {
      console.warn(
        `[deduccion] ${datos.tipo} ${datos.numero_documento}: el documento no trae total y la lectura ` +
        `no parece completa. NO se deduce nada: el total se queda vacio con aviso 'total_no_deducible'.`,
      );
    } else if (deduccion) {
      console.warn(
        `[deduccion] ${datos.tipo} ${datos.numero_documento}: el documento no trae total. ` +
        `Calculado ${deduccion.valor} por "${deduccion.metodo}". Se guarda con total_origen='deducido'.`,
      );
    }
    console.log(
      `[extraccion] ${datos.tipo} ${datos.numero_documento}: ${extraccion.intentos} intento(s), ` +
      `${datos.productos.length} linea(s), ${extraccion.descuadres.length} descuadre(s) sin resolver.`,
    );

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
        // Procedencia de `total`. Ver la migración 20260928160000: la columna
        // es lo que impide que un importe calculado por nosotros se confunda
        // con uno impreso en el papel.
        total_origen: totalOrigen,
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

    // Pasos 7-9 (líneas, validación, archivado) + respuesta de éxito, en su
    // propia función para poder compensar si algo de ESO falla: la cabecera
    // (paso 6) ya está insertada en este punto, así que un fallo posterior
    // dejaría una fila en `facturas` sin líneas/validar/archivar si no se
    // deshace. La compensación NUNCA sustituye el error original: se
    // relanza `innerError` tal cual pase lo que pase con la limpieza (ver
    // `compensarFacturaHuerfana`).
    try {
      return await completarFactura(
        supabase, facturaId, datos, archivo, b64, mimeType, alertasPrevias, totalOrigen,
      );
    } catch (innerError) {
      await compensarFacturaHuerfana(supabase, facturaId, innerError);
      throw innerError;
    }
  } catch (error) {
    console.error("[procesar-factura] Error:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }
});
