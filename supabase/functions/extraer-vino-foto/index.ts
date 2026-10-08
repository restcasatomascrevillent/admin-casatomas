// extraer-vino-foto
// ---------------------------------------------------------------------------
// Lee la etiqueta de una botella de vino a partir de una foto y devuelve los
// datos para PRECARGAR el formulario de alta de vino del panel (VinoForm).
//
// - Nunca escribe en la base de datos: el usuario revisa y guarda desde el
//   panel (crearVino en useVinos.ts, que además traduce al guardar).
// - Devuelve los campos de la tabla `Vinos` y, aparte, una SUGERENCIA de
//   precio (precio_sugerido + precio_razon) calculada con los precios de la
//   propia carta: el cliente la muestra, nunca rellena `precio` sola.
// - categoria: siempre una de las categorías reales de `Vinos` (enum en el
//   structured output) o null.
// - recorte: caja de la botella en coordenadas 0-1 sobre la imagen recibida.
// - Modelo: env VINO_FOTO_MODELO (por defecto gpt-4.1), detail "high".
//   Tres llamadas: visión (lectura) + búsqueda web (Responses API, herramienta
//   `web_search`, env VINO_BUSQUEDA_MODELO, por defecto gpt-4.1-mini: precio
//   en tiendas online españolas + ficha técnica → descripción rica) + texto
//   corto (precio de carta a partir del de mercado y de la carta).
//   La búsqueda tiene 20 s de tope (AbortController): si falla o tarda, se
//   sigue con la lectura básica y la descripción prudente.
// - Lecturas de BD con el cliente del usuario (RLS); si fallan, se sigue sin
//   ellas (categorías del body, sin ejemplos, sin precio).
// - Auth: verify_jwt (config.toml) + permiso de ESCRITURA en `gestor_carta`
//   (misma función que la RLS de la carta, resuelta con el JWT del usuario).
// - Mismo secreto que traducir-contenido: OPENAI_API_KEY.
//
// Body: { imagen: "<base64 JPEG, con o sin prefijo data:>", categorias?: string[] }
// Respuesta: { ok: true, vino: {nombre, categoria, descripcion, ingredientes,
//   denominacion_origen, ubicacion_region, ubicacion_pais, contiene_sulfitos,
//   precio_sugerido, precio_razon, precio_mercado, precio_mercado_fuentes:
//   {tienda,url,precio}[], recorte} } | { ok: false, error }
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { comprobarPermisoSeccion, type ClientePermiso } from "../_shared/permiso-marketing.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCION = "extraer-vino-foto";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = (Deno.env.get("VINO_FOTO_MODELO") ?? "").trim() || "gpt-4.1";
const MODELO_BUSQUEDA = (Deno.env.get("VINO_BUSQUEDA_MODELO") ?? "").trim() || "gpt-4.1-mini";
const BUSQUEDA_MS = 20_000;
// ia_uso solo guarda tokens; la tarifa por llamada de búsqueda (~0,01 $) se
// registra como un "modelo" aparte con 1.000 tokens ficticios por llamada y
// tarifa 10 $/1M en ia_precios (migración 20261008210000).
const MODELO_LLAMADA_BUSQUEDA = "openai-web-search-call";
const TOKENS_POR_LLAMADA_BUSQUEDA = 1000;
// ~1024px JPEG 0.8 en base64 ronda 150-400 KB; 4 MB de margen sobra.
const MAX_BASE64 = 4_000_000;
const MAX_BASE_PRECIOS = 25;

const CAMPOS_TEXTO = [
  "nombre",
  "descripcion",
  "ingredientes",
  "denominacion_origen",
  "ubicacion_region",
  "ubicacion_pais",
] as const;

type Cliente = ReturnType<typeof createClientBase>;

interface VinoCarta {
  nombre: string;
  categoria: string | null;
  denominacion_origen: string | null;
  precio_eur: number | null;
  descripcion: string | null;
}

interface Recorte {
  x: number;
  y: number;
  w: number;
  h: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function textoONull(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// "D.O.Ca. Rioja" / "D.O. Rías Baixas (estimado)" → "rioja" / "rias baixas"
function normalizarDO(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/^(d\.?o\.?p?\.?(ca\.?|q\.?)?|aop|aoc|igp|vt|wo|docg|doc)\s+/i, "")
    .replace(/^vino de pago\s+/, "")
    .trim();
}

// Toda la carta de vinos en UNA lectura (columnas mínimas): de aquí salen
// categorías, ejemplos de nombre, ejemplos de tono y la base de precios.
async function leerCarta(cliente: Cliente): Promise<VinoCarta[]> {
  try {
    const { data, error } = await cliente
      .from("Vinos")
      .select("nombre, categoria, denominacion_origen, precio_eur, descripcion")
      .limit(1000);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>)
      .filter((f) => typeof f.nombre === "string" && f.nombre.trim() !== "")
      .map((f) => ({
        nombre: String(f.nombre).trim(),
        categoria: typeof f.categoria === "string" && f.categoria.trim() ? f.categoria.trim() : null,
        denominacion_origen: typeof f.denominacion_origen === "string" ? f.denominacion_origen : null,
        precio_eur: typeof f.precio_eur === "number" ? f.precio_eur : null,
        descripcion: typeof f.descripcion === "string" ? f.descripcion.trim() : null,
      }));
  } catch {
    return [];
  }
}

function ejemplosTono(carta: VinoCarta[]): string[] {
  const textos = carta.map((v) => v.descripcion ?? "").filter((t) => t.length >= 40);
  return [...new Set(textos)].sort((a, b) => b.length - a.length).slice(0, 4).map((t) => t.slice(0, 400));
}

// Muestra variada de nombres reales (con y sin añada) para el formato.
function ejemplosNombre(carta: VinoCarta[]): string[] {
  const conAnada = carta.filter((v) => /\b(19|20)\d{2}\b/.test(v.nombre)).slice(0, 5);
  const sinAnada = carta.filter((v) => !/\b(19|20)\d{2}\b/.test(v.nombre)).slice(0, 7);
  return [...conAnada, ...sinAnada].map((v) => `${v.nombre} [${v.denominacion_origen ?? "-"}]`);
}

// Resumen por categoría (qué D.O. suele llevar) para que el modelo elija bien.
function resumenCategorias(carta: VinoCarta[], categorias: string[]): string[] {
  return categorias.map((c) => {
    const dos = new Map<string, number>();
    for (const v of carta) {
      if (v.categoria !== c || !v.denominacion_origen) continue;
      dos.set(v.denominacion_origen, (dos.get(v.denominacion_origen) ?? 0) + 1);
    }
    const top = [...dos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d);
    return `- ${c}${top.length ? ` (D.O. habituales: ${top.join(", ")})` : ""}`;
  });
}

function buildSystem(categorias: string[], resumenCat: string[], nombres: string[], ejemplos: string[]): string {
  return [
    "Eres un sumiller que lee etiquetas de botellas de vino a partir de una foto para dar de alta el vino en la carta de un restaurante gallego.",
    "Lee con mucha atención TODA la etiqueta (frontal, cápsula, collarín): nombre comercial, bodega, añada, D.O., tipo (blanco/tinto/rosado/espumoso) y variedad de uva.",
    "",
    "CAMPOS:",
    "- nombre: nombre del vino en formato de carta: nombre comercial (con la bodega solo si forma parte del nombre por el que se conoce) + variante si la hay (Crianza, Reserva, Blanco, Barrica…) + añada si se lee en la etiqueta. Sin 'D.O.', sin 'Bodegas', sin comillas. Respeta tildes y mayúsculas normales (no todo en mayúsculas aunque la etiqueta lo esté).",
    ...(nombres.length ? ["  Ejemplos reales de nombres de esta carta [D.O.]:", ...nombres.map((n) => `  · ${n}`)] : []),
    "- denominacion_origen: con el prefijo que usa la carta: 'D.O. Rías Baixas', 'D.O.Ca. Rioja', 'D.O. Ribera del Duero', 'AOC Champagne', 'IGP Castilla y León'… o null si no se lee ni se deduce con seguridad.",
    "- ingredientes: variedad/es de uva ('Albariño', 'Mencía, Garnacha'). Si la etiqueta no la dice pero el vino concreto o su D.O. y tipo la hacen muy probable, rellénala (Rioja blanco → 'Viura'; Rías Baixas → 'Albariño'; Rueda → 'Verdejo'; Ribera del Duero tinto → 'Tempranillo'). Si no hay certeza razonable: null.",
    "- ubicacion_region / ubicacion_pais: región y país en español, deducibles de la D.O. ('Galicia', 'España').",
    "- contiene_sulfitos: true solo si la etiqueta dice 'contiene sulfitos'/'contains sulphites'.",
    "- categoria: OBLIGATORIO elegir una de la lista exacta según tipo + D.O. + uva. Si es un blanco de una D.O. sin categoría propia → la de 'OTRAS DENOMINACIONES' del mismo tipo. Solo null si no es posible saber ni el tipo de vino.",
    ...(categorias.length ? ["  Categorías de la carta:", ...resumenCat] : ["  No hay categorías: categoria = null."]),
    "- recorte: caja que encierra la botella completa (incluida la cápsula) en coordenadas normalizadas 0-1 sobre la imagen recibida: x,y = esquina superior izquierda, w,h = ancho y alto. Deja un pequeño margen. null si no hay una botella clara.",
    "- descripcion: ver REGLAS DE LA DESCRIPCIÓN.",
    "Nombre, D.O. y sulfitos: solo lo que se lea con claridad o se deduzca con seguridad. Nunca incluyas precio.",
    "",
    "REGLAS DE LA DESCRIPCIÓN:",
    "- Tras leer la etiqueta, usa lo que SABES de ese vino, su bodega y su D.O. para escribir como un sumiller en la carta de un restaurante.",
    "- Español, 2-3 frases, unos 200-300 caracteres: estilo/elaboración (joven, crianza, barrica, lías…), notas de cata (nariz y boca) y un maridaje breve.",
    "- NO repitas el nombre del vino ni la ficha literal ('Vino blanco de la bodega X con D.O. Y'): el nombre ya aparece encima en la carta.",
    "- Tono cálido y elegante. Sin tópicos vacíos ('un vino único', 'toda una experiencia') ni superlativos exagerados.",
    "- Si no conoces ese vino concreto, describe con prudencia lo típico de ese tipo + D.O. + uva.",
    "- Nunca inventes premios, puntuaciones, añadas, meses exactos de crianza ni otros datos concretos que no conozcas con seguridad.",
    ...(ejemplos.length
      ? ["", "Ejemplos de descripciones de esta carta (imita su tono y longitud, no su contenido):", ...ejemplos.map((e) => `- ${e}`)]
      : []),
  ].join("\n");
}

function schemaLectura(categorias: string[]) {
  const texto = { type: ["string", "null"] };
  return {
    type: "json_schema",
    json_schema: {
      name: "vino_etiqueta",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "nombre", "categoria", "descripcion", "ingredientes", "denominacion_origen",
          "ubicacion_region", "ubicacion_pais", "contiene_sulfitos", "recorte",
        ],
        properties: {
          nombre: texto,
          categoria: categorias.length ? { type: ["string", "null"], enum: [...categorias, null] } : { type: "null" },
          descripcion: texto,
          ingredientes: texto,
          denominacion_origen: texto,
          ubicacion_region: texto,
          ubicacion_pais: texto,
          contiene_sulfitos: { type: "boolean" },
          recorte: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "w", "h"],
                properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
              },
              { type: "null" },
            ],
          },
        },
      },
    },
  };
}

const SCHEMA_PRECIO = {
  type: "json_schema",
  json_schema: {
    name: "precio_vino",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["precio_sugerido", "precio_razon"],
      properties: {
        precio_sugerido: { type: ["number", "null"] },
        precio_razon: { type: ["string", "null"] },
      },
    },
  },
};

function limpiarRecorte(v: unknown): Recorte | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const nums = [r.x, r.y, r.w, r.h].map((n) => (typeof n === "number" && Number.isFinite(n) ? n : NaN));
  if (nums.some(Number.isNaN)) return null;
  // Algunos modelos devuelven 0-100 o 0-1000: se reescala si todo encaja.
  const maximo = Math.max(...nums);
  const escala = maximo > 1.5 ? (maximo <= 100 ? 100 : 1000) : 1;
  let [x, y, w, h] = nums.map((n) => n / escala);
  x = Math.min(Math.max(x, 0), 1);
  y = Math.min(Math.max(y, 0), 1);
  w = Math.min(Math.max(w, 0), 1 - x);
  h = Math.min(Math.max(h, 0), 1 - y);
  if (w < 0.05 || h < 0.05) return null;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r4(x), y: r4(y), w: r4(w), h: r4(h) };
}

// Hasta 25 vinos con precio > 0: primero misma categoría + misma D.O., luego
// misma categoría, luego misma D.O. en otras categorías.
function basePrecios(carta: VinoCarta[], categoria: string | null, dOrigen: string | null): VinoCarta[] {
  const doN = normalizarDO(dOrigen);
  const conPrecio = carta.filter((v) => (v.precio_eur ?? 0) > 0);
  const mismaDO = (v: VinoCarta) => doN !== "" && normalizarDO(v.denominacion_origen) === doN;
  const grupos = [
    conPrecio.filter((v) => categoria && v.categoria === categoria && mismaDO(v)),
    conPrecio.filter((v) => categoria && v.categoria === categoria && !mismaDO(v)),
    conPrecio.filter((v) => v.categoria !== categoria && mismaDO(v)),
  ];
  const out: VinoCarta[] = [];
  for (const g of grupos) {
    for (const v of g) {
      if (out.length >= MAX_BASE_PRECIOS) return out;
      out.push(v);
    }
  }
  return out;
}

async function llamarOpenAI(body: Record<string, unknown>, uso: AcumuladorUso, ms: number): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: MODEL, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) {
      uso.sumar(null);
      const errText = await res.text();
      console.error(`[${FUNCION}] OpenAI ${res.status}: ${errText.slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    uso.sumar(data?.usage);
    const content = data?.choices?.[0]?.message?.content;
    try {
      return JSON.parse(String(content ?? "{}").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function sugerirPrecio(
  vino: Record<string, unknown>,
  base: VinoCarta[],
  precioMercado: number | null,
  uso: AcumuladorUso,
): Promise<{ precio_sugerido: number | null; precio_razon: string | null }> {
  const nada = { precio_sugerido: null, precio_razon: null };
  if (!base.length && precioMercado === null) return nada;
  const lista = base.map((v) => `- ${v.nombre} | ${v.denominacion_origen ?? "-"} | ${v.categoria ?? "-"} | ${v.precio_eur} €`);
  const ficha = [
    `Nombre: ${vino.nombre ?? "?"}`,
    `Categoría: ${vino.categoria ?? "?"}`,
    `D.O.: ${vino.denominacion_origen ?? "?"}`,
    `Uva: ${vino.ingredientes ?? "?"}`,
    `Precio en tienda (mediana de tiendas online españolas, 75 cl): ${precioMercado !== null ? `${precioMercado} €` : "desconocido"}`,
  ].join("\n");
  try {
    const raw = await llamarOpenAI({
      temperature: 0.2,
      max_tokens: 150,
      response_format: SCHEMA_PRECIO,
      messages: [
        {
          role: "system",
          content: [
            "Eres el sumiller de un restaurante y fijas precios de carta (precio por botella en restaurante, IVA incluido).",
            "Si se conoce el PRECIO EN TIENDA, es la base: precio de carta = precio en tienda × multiplicador.",
            "  - El multiplicador sale de ESTA carta: compara vinos de la misma categoría/D.O. y el precio de tienda que sepas de ellos para inferir el margen típico de la casa, y mantén la coherencia con esos precios.",
            "  - Si la carta no da base para inferirlo, usa un multiplicador de restaurante razonable (2,5-3×) y dilo en la razón.",
            "Si NO se conoce el precio en tienda, sugiere un precio coherente con los vinos comparables de la carta y con lo que sepas de su precio de mercado.",
            "Ten en cuenta formatos: una Magnum cuesta aprox. el doble que la botella de 75 cl.",
            "precio_razon: UNA frase corta en español (máx. 110 caracteres), p. ej. 'Tienda ~14,90 € × 2,7, como otros Rioja blancos de la carta (35-42 €)'.",
            "Si no hay base razonable, ambos null.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `VINO NUEVO:\n${ficha}\n\nVINOS DE LA CARTA (nombre | D.O. | categoría | precio):\n${lista.length ? lista.join("\n") : "(ninguno comparable)"}`,
        },
      ],
    }, uso, 20000);
    if (!raw) return nada;
    const p = typeof raw.precio_sugerido === "number" && Number.isFinite(raw.precio_sugerido) ? raw.precio_sugerido : null;
    if (p === null || p <= 0 || p > 5000) return nada;
    return { precio_sugerido: Math.round(p * 2) / 2, precio_razon: textoONull(raw.precio_razon, 180) };
  } catch (e) {
    console.error(`[${FUNCION}] precio:`, e instanceof Error ? e.message : e);
    return nada;
  }
}

// ---------------------------------------------------------------------------
// Búsqueda web: precio de mercado + ficha técnica (una sola llamada)
// ---------------------------------------------------------------------------

interface FuentePrecio {
  tienda: string;
  url: string;
  precio: number;
}

interface FichaMercado {
  precio_mercado: number | null;
  precio_mercado_fuentes: FuentePrecio[];
  descripcion: string | null;
  ingredientes: string | null;
  denominacion_origen: string | null;
}

const EJEMPLO_DUENO =
  "Vino elaborado en la bodega de Hervías, perteneciente a Señorío de Villarrica, en plena Rioja Alta. " +
  "Fermenta en ovum de barro artesanal, un método ancestral, y después permanece seis meses sobre sus propias lías en el mismo ovum. " +
  "Esa es su gran peculiaridad: el barro, por su estructura microporosa, absorbe, refresca y deja una oxigenación lenta, " +
  "y la evaporación concentra el vino.";

const SCHEMA_FICHA = {
  type: "json_schema",
  name: "ficha_vino_mercado",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ficha_encontrada", "descripcion", "ingredientes", "denominacion_origen", "ofertas"],
    properties: {
      ficha_encontrada: { type: "boolean" },
      descripcion: { type: ["string", "null"] },
      ingredientes: { type: ["string", "null"] },
      denominacion_origen: { type: ["string", "null"] },
      ofertas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tienda", "url", "precio", "formato_cl"],
          properties: {
            tienda: { type: "string" },
            url: { type: "string" },
            precio: { type: "number" },
            formato_cl: { type: ["number", "null"] },
          },
        },
      },
    },
  },
};

function promptBusqueda(ejemplos: string[]): string {
  return [
    "Eres el sumiller de un restaurante gallego. Busca en internet el vino indicado (ese vino concreto, de esa bodega).",
    "",
    "1) PRECIO DE VENTA EN TIENDA: busca su precio de venta al público en tiendas online españolas (Vinoselección, Uvinum, Bodeboca, Lavinia, El Corte Inglés, Decántalo, Vila Viniteca, la tienda de la propia bodega…).",
    "   - ofertas: hasta 6, cada una con tienda (nombre corto), url EXACTA de la página del producto donde viste el precio, precio en € (IVA incluido, una botella) y formato_cl (75, 150…; null si no consta).",
    "   - Solo precios que hayas visto de verdad en una página. Prioriza la misma añada si se conoce; si no, la más parecida. Sin ofertas → lista vacía.",
    "",
    "2) FICHA TÉCNICA: busca la ficha técnica o nota de cata oficial (web de la bodega o fichas de tiendas) y escribe `descripcion` para la carta:",
    "   - Español, prosa de carta, 450-700 caracteres, redactada con tus palabras (NO copies frases literales de las webs).",
    "   - Contenido, en este orden y solo si aparece en las fuentes o en la ficha de la etiqueta: bodega y zona; elaboración (fermentación, depósito/barrica/ánfora/huevo, tiempo sobre lías o de crianza); qué lo hace peculiar; notas de cata (vista, nariz, boca); maridaje breve.",
    "   - NO empieces repitiendo el nombre del vino. Sin tópicos vacíos ni superlativos. Nunca inventes premios, puntuaciones, meses o datos que no estén en las fuentes.",
    "   - Si NO encuentras la ficha de ese vino concreto: ficha_encontrada = false y descripcion = null.",
    "   Ejemplo del nivel de detalle que busca el dueño (de otro vino; imita detalle y tono, no el contenido):",
    `   «${EJEMPLO_DUENO}»`,
    ...(ejemplos.length ? ["   Ejemplos de tono de la carta actual:", ...ejemplos.map((e) => `   - ${e}`)] : []),
    "",
    "3) ingredientes (uva/s, p. ej. 'Viura, Malvasía') y denominacion_origen (con prefijo: 'D.O.Ca. Rioja', 'D.O. Rías Baixas'…): rellénalos SOLO si las fuentes los dan con claridad; si no, null.",
    "",
    "Responde únicamente con el JSON pedido.",
  ].join("\n");
}

function hostDe(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function mediana(nums: number[]): number | null {
  if (!nums.length) return null;
  const o = [...nums].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Extrae el JSON de la respuesta de la Responses API y las URLs consultadas/citadas. */
function leerRespuestaBusqueda(data: Record<string, unknown>): { json: Record<string, unknown> | null; hosts: Set<string>; llamadas: number } {
  const hosts = new Set<string>();
  let llamadas = 0;
  let texto = "";
  const output = Array.isArray(data.output) ? (data.output as Array<Record<string, unknown>>) : [];
  for (const item of output) {
    if (item?.type === "web_search_call") {
      llamadas++;
      const fuentes = (item.action as Record<string, unknown> | undefined)?.sources;
      if (Array.isArray(fuentes)) {
        for (const f of fuentes) {
          const h = typeof f?.url === "string" ? hostDe(f.url) : null;
          if (h) hosts.add(h);
        }
      }
    } else if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content as Array<Record<string, unknown>>) {
        if (c?.type !== "output_text" || typeof c.text !== "string") continue;
        texto += c.text;
        if (Array.isArray(c.annotations)) {
          for (const a of c.annotations as Array<Record<string, unknown>>) {
            const h = typeof a?.url === "string" ? hostDe(a.url) : null;
            if (h) hosts.add(h);
          }
        }
      }
    }
  }
  const limpio = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const ini = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  let json: Record<string, unknown> | null = null;
  if (ini >= 0 && fin > ini) {
    try {
      json = JSON.parse(limpio.slice(ini, fin + 1));
    } catch {
      json = null;
    }
  }
  return { json, hosts, llamadas };
}

function limpiarFicha(raw: Record<string, unknown>, hosts: Set<string>): FichaMercado {
  const ofertas: FuentePrecio[] = [];
  const vistas = new Set<string>();
  for (const o of Array.isArray(raw.ofertas) ? (raw.ofertas as Array<Record<string, unknown>>) : []) {
    const url = typeof o?.url === "string" ? o.url.trim() : "";
    const host = hostDe(url);
    let precio = typeof o?.precio === "number" && Number.isFinite(o.precio) ? o.precio : NaN;
    const formato = typeof o?.formato_cl === "number" && o.formato_cl > 0 ? o.formato_cl : 75;
    if (!host || !(precio > 0)) continue;
    // Si hay fuentes, la URL tiene que ser de un sitio realmente consultado.
    if (hosts.size && !hosts.has(host)) continue;
    if (vistas.has(url)) continue;
    precio = (precio * 75) / formato; // a botella de 75 cl
    if (precio < 2 || precio > 3000) continue;
    vistas.add(url);
    ofertas.push({ tienda: textoONull(o.tienda, 60) ?? host, url: url.slice(0, 500), precio: Math.round(precio * 100) / 100 });
  }
  const med = mediana(ofertas.map((o) => o.precio));
  // Las 3 fuentes más cercanas a la mediana.
  const fuentes = med === null ? [] : [...ofertas].sort((a, b) => Math.abs(a.precio - med) - Math.abs(b.precio - med)).slice(0, 3);
  const desc = raw.ficha_encontrada === true ? textoONull(raw.descripcion, 900) : null;
  return {
    precio_mercado: med === null ? null : Math.round(med * 100) / 100,
    precio_mercado_fuentes: fuentes,
    descripcion: desc && desc.length >= 200 ? desc : null,
    ingredientes: textoONull(raw.ingredientes, 200),
    denominacion_origen: textoONull(raw.denominacion_origen, 200),
  };
}

async function buscarFichaMercado(
  vino: Record<string, unknown>,
  ejemplos: string[],
  uso: AcumuladorUso,
  usoLlamadas: AcumuladorUso,
): Promise<FichaMercado | null> {
  const ficha = [
    `Vino (leído de la etiqueta): ${vino.nombre ?? "?"}`,
    `D.O.: ${vino.denominacion_origen ?? "?"}`,
    `Uva: ${vino.ingredientes ?? "?"}`,
    `Región: ${vino.ubicacion_region ?? "?"} (${vino.ubicacion_pais ?? "?"})`,
  ].join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BUSQUEDA_MS);
  const llamar = (conFormato: boolean) =>
    fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: MODELO_BUSQUEDA,
        temperature: 0.3,
        max_output_tokens: 1500,
        tools: [{ type: "web_search", search_context_size: "medium", user_location: { type: "approximate", country: "ES" } }],
        include: ["web_search_call.action.sources"],
        ...(conFormato ? { text: { format: SCHEMA_FICHA } } : {}),
        input: [
          { role: "system", content: promptBusqueda(ejemplos) },
          {
            role: "user",
            content: conFormato
              ? ficha
              : `${ficha}\n\nDevuelve SOLO un objeto JSON con las claves ficha_encontrada, descripcion, ingredientes, denominacion_origen y ofertas [{tienda,url,precio,formato_cl}].`,
          },
        ],
      }),
      signal: controller.signal,
    });
  try {
    let res = await llamar(true);
    if (res.status === 400) {
      // Por si el modelo no admite structured output junto a web_search.
      uso.sumar(null);
      console.error(`[${FUNCION}] búsqueda 400 con formato: ${(await res.text()).slice(0, 300)}`);
      res = await llamar(false);
    }
    if (!res.ok) {
      uso.sumar(null);
      console.error(`[${FUNCION}] búsqueda ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    uso.sumar(data?.usage);
    const { json: raw, hosts, llamadas } = leerRespuestaBusqueda(data);
    if (llamadas > 0) {
      usoLlamadas.sumar({ input_tokens: llamadas * TOKENS_POR_LLAMADA_BUSQUEDA, output_tokens: 0 });
      usoLlamadas.llamadas += llamadas - 1; // sumar() ya contó una
    }
    if (!raw) return null;
    return limpiarFicha(raw, hosts);
  } catch (e) {
    console.error(`[${FUNCION}] búsqueda:`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  // ---- Auth: usuario del panel con permiso de escritura en la carta ------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autorizado" }, 401);
  const supabaseUser = createClientBase(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const permiso = await comprobarPermisoSeccion(
    supabaseUser as unknown as ClientePermiso,
    "gestor_carta",
    "escribir",
    "No tienes permiso para editar la carta",
  );
  if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);

  // ---- Body ---------------------------------------------------------------
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  let imagen = typeof payload.imagen === "string" ? payload.imagen.trim() : "";
  if (!imagen) return json({ ok: false, error: "Falta la imagen" }, 400);
  if (imagen.length > MAX_BASE64) return json({ ok: false, error: "La imagen es demasiado grande" }, 413);
  if (!imagen.startsWith("data:")) imagen = `data:image/jpeg;base64,${imagen}`;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(imagen)) {
    return json({ ok: false, error: "Formato de imagen no soportado" }, 400);
  }

  if (!OPENAI_KEY) return json({ ok: false, error: "OPENAI_API_KEY no configurada" }, 500);

  // ---- Carta actual (cliente del usuario; si falla, se sigue sin ella) ---
  const carta = await leerCarta(supabaseUser);
  const categoriasBD = [...new Set(carta.map((v) => v.categoria).filter((c): c is string => !!c))].sort();
  const categoriasBody = Array.isArray(payload.categorias)
    ? (payload.categorias as unknown[]).filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim())
    : [];
  const categorias = (categoriasBD.length ? categoriasBD : [...new Set(categoriasBody)]).slice(0, 60);

  const uso = new AcumuladorUso(FUNCION, MODEL, "vision");
  const usoBusqueda = new AcumuladorUso(FUNCION, MODELO_BUSQUEDA, "chat");
  const usoLlamadasBusqueda = new AcumuladorUso(FUNCION, MODELO_LLAMADA_BUSQUEDA, "otro");
  const inicioMs = Date.now();

  try {
    const raw = await llamarOpenAI({
      temperature: 0.3,
      max_tokens: 800,
      response_format: schemaLectura(categorias),
      messages: [
        {
          role: "system",
          content: buildSystem(categorias, resumenCategorias(carta, categorias), ejemplosNombre(carta), ejemplosTono(carta)),
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Lee la etiqueta de esta botella y devuelve el JSON." },
            { type: "image_url", image_url: { url: imagen, detail: "high" } },
          ],
        },
      ],
    }, uso, 45000);

    if (!raw) {
      uso.marcarError();
      return json({ ok: false, error: "No se pudo leer la etiqueta" }, 502);
    }

    const vino: Record<string, unknown> = {};
    for (const campo of CAMPOS_TEXTO) {
      vino[campo] = textoONull(raw[campo], campo === "descripcion" ? 600 : 200);
    }
    const categoria = textoONull(raw.categoria, 100);
    vino.categoria = categoria && categorias.includes(categoria) ? categoria : null;
    vino.contiene_sulfitos = raw.contiene_sulfitos === true;

    // Búsqueda web (precio de tienda + ficha). Si falla, se sigue sin ella.
    const mercado = await buscarFichaMercado(vino, ejemplosTono(carta), usoBusqueda, usoLlamadasBusqueda);
    vino.precio_mercado = mercado?.precio_mercado ?? null;
    vino.precio_mercado_fuentes = mercado?.precio_mercado_fuentes ?? [];
    if (mercado?.descripcion) vino.descripcion = mercado.descripcion;
    if (mercado?.ingredientes) vino.ingredientes = mercado.ingredientes;
    if (mercado?.denominacion_origen) vino.denominacion_origen = mercado.denominacion_origen;

    const precio = await sugerirPrecio(
      vino,
      basePrecios(carta, vino.categoria as string | null, vino.denominacion_origen as string | null),
      vino.precio_mercado as number | null,
      uso,
    );
    vino.precio_sugerido = precio.precio_sugerido;
    vino.precio_razon = precio.precio_razon;
    vino.recorte = limpiarRecorte(raw.recorte);

    return json({ ok: true, vino });
  } catch (error) {
    uso.marcarError();
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error(`[${FUNCION}]`, message);
    return json({ ok: false, error: "No se pudo leer la etiqueta" }, 500);
  } finally {
    await registrarUso([uso, usoBusqueda, usoLlamadasBusqueda], { disparador: `usuario:${permiso.userId}`, duracionMs: Date.now() - inicioMs });
  }
}));
