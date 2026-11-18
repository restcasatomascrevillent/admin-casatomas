// Calidad percibida del chat de facturas (18/11/2026): piezas puras del panel.
//
//  · textoProgreso: lo que se lee mientras se espera la respuesta.
//  · aTextoPlano: «Copiar» y «Compartir» sin ** ni | (listo para WhatsApp).
//  · pasosSiguientes: botones de «qué hacer ahora» bajo la respuesta, en lugar
//    de la pregunta «¿Quieres…?» al final del texto.
//  · pieDeDatos: «Datos hasta 12/11/2026 · sin IVA», solo con lo que dan las herramientas.
//  · textoErrorSubida: el motivo de un fallo de subida en palabras normales.
//  Sin React ni Supabase para poder probarlas con vitest.

/** Texto de espera según los segundos que lleva la consulta (el servidor no manda avisos por herramienta). */
export function textoProgreso(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 4) return "Buscando en las facturas…";
  if (s < 10) return "Calculando…";
  if (s < 20) return "Casi está…";
  if (s < 35) return "Esta consulta es larga, unos segundos más…";
  return "Sigue trabajando. Si prefieres, pulsa «Parar» y pregunta de otra forma.";
}

/** «12 s» desde los 5 segundos (antes solo molesta). */
export function textoSegundos(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return s >= 5 ? `${s} s` : "";
}

// ─── Copiar y compartir en texto plano ───────────────────────────────────────

const esSeparadorTabla = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const esFilaTabla = (l: string) => /^\s*\|.*\|\s*$/.test(l);

/**
 * Markdown de la respuesta → texto legible: sin negritas, cursivas, encabezados,
 * código ni enlaces (queda el texto del enlace); las tablas pasan a una línea por
 * fila con las celdas separadas por « · » y las viñetas, a «• ».
 */
export function aTextoPlano(markdown: string): string {
  const lineas = (markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const salida: string[] = [];
  for (const original of lineas) {
    if (esSeparadorTabla(original)) continue;
    let l = original;
    if (esFilaTabla(l)) {
      l = l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "")
        .join(" · ");
    }
    l = l
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^(\s*)[-*+]\s+/, "$1• ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s+$/g, "");
    salida.push(l);
  }
  return salida.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Pasos siguientes ────────────────────────────────────────────────────────

export interface PasoSiguiente {
  /** Lo que dice el botón. */
  texto: string;
  /** La pregunta que se manda al pulsarlo (ya hecha). */
  pregunta: string;
}

interface HerramientaTraza {
  nombre?: unknown;
  argumentos?: unknown;
  resultado?: unknown;
}

const MAX_PASOS = 3;

const arg = (h: HerramientaTraza, clave: string): string => {
  const a = h.argumentos;
  if (!a || typeof a !== "object") return "";
  const v = (a as Record<string, unknown>)[clave];
  return typeof v === "string" ? v.trim().slice(0, 80) : "";
};

/** Las herramientas de la respuesta que se ejecutaron bien (las no ejecutadas no cuentan). */
const hechas = (traza: unknown): HerramientaTraza[] =>
  (Array.isArray(traza) ? traza : []).filter(
    (h): h is HerramientaTraza => !!h && typeof h === "object" && typeof (h as HerramientaTraza).nombre === "string" && (h as HerramientaTraza).resultado === "completada",
  );

const CON_PASOS = ["compras_producto", "historial_precios", "grafico_precio", "ficha_proveedor", "variacion_precios", "resumen_periodo", "estadisticas_globales", "gasto_por_categoria"];

/**
 * Hasta 3 botones de «paso siguiente» según la herramienta que contestó. Las
 * preguntas van completas con el nombre del producto o proveedor. Sin pasos si
 * la respuesta fue un fallo, un «no hay» (esos llevan sus propios botones) o
 * no hay herramienta conocida.
 */
export function pasosSiguientes(herramientas: unknown, aviso?: "error" | "sin_datos"): PasoSiguiente[] {
  if (aviso) return [];
  const ultima = [...hechas(herramientas)].reverse().find((h) => CON_PASOS.includes(String(h.nombre)));
  if (!ultima) return [];
  const producto = arg(ultima, "producto");
  const proveedor = arg(ultima, "proveedor");
  const pasos: PasoSiguiente[] = [];
  switch (ultima.nombre) {
    case "compras_producto":
    case "historial_precios":
      if (!producto) return [];
      pasos.push(
        { texto: "Ver la factura", pregunta: `Enséñame la última factura de ${producto}` },
        { texto: "Comparar con otro proveedor", pregunta: `¿Qué proveedor me vende ${producto} más barato?` },
        { texto: "Evolución del precio", pregunta: `Enséñame la gráfica del precio de ${producto}` },
      );
      break;
    case "grafico_precio":
      if (!producto) return [];
      pasos.push(
        { texto: "Ver la factura", pregunta: `Enséñame la última factura de ${producto}` },
        { texto: "Comparar con otro proveedor", pregunta: `¿Qué proveedor me vende ${producto} más barato?` },
      );
      break;
    case "ficha_proveedor":
      if (!proveedor) return [];
      pasos.push(
        { texto: "Gasto por mes", pregunta: `¿Cuánto le he comprado a ${proveedor} cada mes?` },
        { texto: "Qué ha subido", pregunta: `¿Qué ha subido de precio de ${proveedor}?` },
      );
      break;
    case "variacion_precios":
      pasos.push(
        { texto: "Quién lo vende más barato", pregunta: "De lo que más ha subido, ¿qué proveedor lo vende más barato?" },
        { texto: "Mayores proveedores", pregunta: "¿Cuáles son mis mayores proveedores?" },
      );
      break;
    default:
      pasos.push(
        { texto: "Mayores proveedores", pregunta: "¿Cuáles son mis mayores proveedores?" },
        { texto: "Qué ha subido de precio", pregunta: "¿Qué productos han subido de precio?" },
      );
  }
  return pasos.slice(0, MAX_PASOS);
}

/** «No lo encuentro con ese nombre»: cada nombre parecido es un botón que pregunta su precio. */
export function pasosDeCoincidencias(nombres: unknown): PasoSiguiente[] {
  if (!Array.isArray(nombres)) return [];
  const vistos = new Set<string>();
  const salida: PasoSiguiente[] = [];
  for (const n of nombres) {
    if (typeof n !== "string") continue;
    const nombre = n.replace(/\s+/g, " ").trim().slice(0, 80);
    const clave = nombre.toLowerCase();
    if (!nombre || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ texto: nombre, pregunta: `¿A cuánto compro ${nombre}?` });
    if (salida.length >= MAX_PASOS) break;
  }
  return salida;
}

// ─── Pie «de dónde sale el dato» ─────────────────────────────────────────────

/** Herramientas cuyas cifras son de LÍNEAS de producto (sin IVA, como dice el prompt). */
const SIN_IVA = new Set(["compras_producto", "historial_precios", "grafico_precio", "variacion_precios", "volumen_comprado", "gasto_por_categoria"]);

const fechaCorta = (iso: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

export interface AyudaRespuesta {
  /** Nombres parecidos que dio la búsqueda cuando no encontró el producto. */
  sugerencias?: string[];
  /** Fecha (ISO) de la última factura subida, si alguna herramienta la dio. */
  datos_hasta?: string;
}

/** «Datos hasta 12/11/2026 · sin IVA»; vacío si no hay nada que decir (nunca se inventa). */
export function pieDeDatos(herramientas: unknown, ayuda?: AyudaRespuesta | null, aviso?: "error" | "sin_datos"): string {
  if (aviso) return "";
  const partes: string[] = [];
  const hasta = ayuda?.datos_hasta ? fechaCorta(ayuda.datos_hasta) : null;
  if (hasta) partes.push(`Datos hasta ${hasta}`);
  if (hechas(herramientas).some((h) => SIN_IVA.has(String(h.nombre)))) partes.push("sin IVA");
  return partes.join(" · ");
}

/** Lo que la función manda en `ayuda` (o lo guardado con la respuesta), con forma segura. */
export function normalizarAyuda(a: unknown): AyudaRespuesta | undefined {
  if (!a || typeof a !== "object") return undefined;
  const { sugerencias, datos_hasta } = a as { sugerencias?: unknown; datos_hasta?: unknown };
  const s = Array.isArray(sugerencias) ? sugerencias.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 5) : [];
  const d = typeof datos_hasta === "string" && /^\d{4}-\d{2}-\d{2}/.test(datos_hasta) ? datos_hasta.slice(0, 10) : undefined;
  if (s.length === 0 && !d) return undefined;
  return { ...(s.length ? { sugerencias: s } : {}), ...(d ? { datos_hasta: d } : {}) };
}

// ─── Errores en palabras normales ────────────────────────────────────────────

/**
 * El motivo de un fallo de subida sin texto de base de datos («statement
 * timeout», «insert factura: …»): qué pasó y qué hacer, en una frase.
 */
export function textoErrorSubida(error: string | null | undefined): string {
  const e = (error ?? "").trim();
  if (!e) return "No se ha podido leer el documento. Pulsa «Reintentar».";
  if (/statement timeout|canceling statement|timeout/i.test(e)) {
    return "El guardado ha tardado demasiado. Pulsa «Reintentar»: la factura ya está leída y no se paga otra vez.";
  }
  if (/\b429\b|cr[eé]dito|quota|saturad/i.test(e)) {
    return "El servicio de lectura está saturado ahora mismo. Espera un momento y pulsa «Reintentar».";
  }
  if (/duplicate key|duplicad|unique constraint|23505/i.test(e)) {
    return "Esta factura ya estaba guardada, así que no se ha duplicado.";
  }
  if (/network|failed to fetch|fetch failed|conexi[oó]n|offline/i.test(e)) {
    return "Se ha cortado la conexión. Comprueba la red y pulsa «Reintentar».";
  }
  // Texto técnico (consultas, columnas, códigos de error): nunca se enseña tal cual.
  if (/insert |update |select |relation |column |violates |constraint|postgres|pgrst|\bsql\b|\brpc\b|edge function|non-2xx|\b[0-9]{5}\b|\bat \w+\.\w+/i.test(e)) {
    return "No se ha podido guardar la factura. Pulsa «Reintentar»; si vuelve a fallar, avisa a quien lleve el panel.";
  }
  // Lista blanca: solo se enseñan tal cual las frases que el propio panel o las funciones escriben para la persona.
  // Cualquier otra cosa («permission denied…», «invalid input syntax…», «OpenAI 400…», «TypeError…») va al texto genérico.
  if (e.length <= 200 && FRASES_PARA_PERSONA.some((r) => r.test(e)) && !JERGA_TECNICA.test(e)) return e;
  return TEXTO_GENERICO_SUBIDA;
}

/** Texto cuando no se sabe qué pasó: nunca se enseña el mensaje original. */
const TEXTO_GENERICO_SUBIDA = "No se ha podido leer el documento. Pulsa «Reintentar»; si vuelve a fallar, avisa a quien lleve el panel.";

/** Frases ya escritas para la persona (lista blanca; se amplía a mano, nunca con un «lo demás»). */
const FRASES_PARA_PERSONA: RegExp[] = [
  /^El servidor ya no tiene el documento/i,
  /^Elige al menos dos fotos/i,
  /^Solo se pueden unir fotos/i,
  /^Como mucho \d+ páginas por documento/i,
  /^Ese trabajo pertenece a otro usuario/i,
  /^No autorizado$/i,
  /^Usuario no autenticado$/i,
  /^No se pudo leer el archivo$/i,
  /^No se ha podido (leer|guardar) (el documento|la factura)b/i,
  /^El modelo rechazó procesar el documento/i,
  /^Caducado sin decidir/i,
  /^Esta factura ya estaba guardada/i,
];

/** Rastros de texto de máquina que invalidan incluso una frase de la lista blanca. */
const JERGA_TECNICA = /\b(error|exception|denied|invalid|syntax|typeerror|undefined|null|openai|supabase|stack|trace|jwt|token|uuid)\b|[{}<>]|\bat \w+\.\w+/i;

/**
 * Error del chat o del tablero (mensaje de la base de datos, de OpenAI o de JavaScript) en palabras normales: nunca el
 * texto original. Mismos casos que la subida y, por defecto, una frase genérica.
 */
export function textoErrorChat(error: string | null | undefined): string {
  const e = (error ?? "").trim();
  if (/statement timeout|canceling statement|timeout|aborted/i.test(e)) return "La consulta ha tardado demasiado. Pulsa «Reintentar» o prueba con una pregunta más concreta.";
  if (/\b429\b|cr[eé]dito|quota|saturad/i.test(e)) return "El servicio de IA está saturado ahora mismo. Espera unos segundos y pulsa «Reintentar».";
  if (/network|failed to fetch|fetch failed|conexi[oó]n|offline/i.test(e)) return "Se ha cortado la conexión. Comprueba la red y pulsa «Reintentar».";
  return "Ha habido un problema del servicio. Pulsa «Reintentar»; si vuelve a fallar, avisa a quien lleve el panel.";
}
