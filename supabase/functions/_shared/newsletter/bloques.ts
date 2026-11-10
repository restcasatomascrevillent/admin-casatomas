// ============================================================================
// NEWSLETTER · DISEÑO POR BLOQUES — código PURO (sin Deno, sin red, sin secretos)
// ----------------------------------------------------------------------------
// Petición del dueño (10/11/2026): «Mejorar las plantillas de los correos de la
// newsletter siguiendo la estética actual y añadir nuevas y botón para crear
// nuevas con redacción por IA y presentación por IA».
//
// Un correo es una lista de BLOQUES (texto, imagen, caja destacada, lista de
// platos, datos de un evento, botón, cita, separador, firma). Las plantillas
// son bloques de partida; la IA (newsletter-ia) propone bloques; el personal
// los edita en el panel; y enviar-newsletter/plantillas.ts los pinta con la
// estética de Casa Tomás. Nunca hay HTML libre: todo es texto plano que se
// escapa al pintarlo (mismo criterio que emails-reserva/plantillas.ts).
//
// Lo usan: enviar-newsletter (validar y pintar el correo real), newsletter-ia
// (normalizar la propuesta de la IA) y el panel (editor y vista previa). Por
// eso no puede importar nada de https:// ni usar Deno.*.
// ============================================================================

export type TipoNewsletter =
  | "anuncio"
  | "nuevo_menu"
  | "oferta"
  | "menu_temporada"
  | "evento"
  | "novedades_carta"
  | "cheques_regalo"
  | "personalizada";

/** Las tres de siempre primero (el historial y los envíos anteriores las usan). */
export const TIPOS_NEWSLETTER: readonly TipoNewsletter[] = [
  "anuncio",
  "nuevo_menu",
  "oferta",
  "menu_temporada",
  "evento",
  "novedades_carta",
  "cheques_regalo",
  "personalizada",
];

export function esTipoNewsletter(v: unknown): v is TipoNewsletter {
  return typeof v === "string" && (TIPOS_NEWSLETTER as readonly string[]).includes(v);
}

export interface PlatoBloque {
  nombre: string;
  descripcion?: string;
  precio?: string;
}

export type Bloque =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagen"; url: string; alt: string; pie?: string }
  | { tipo: "destacado"; titulo?: string; texto: string }
  | { tipo: "platos"; titulo?: string; platos: PlatoBloque[] }
  | { tipo: "evento"; fecha?: string; hora?: string; lugar?: string; precio?: string }
  | { tipo: "boton"; texto: string; url: string }
  | { tipo: "cita"; texto: string; autor?: string }
  | { tipo: "separador" }
  | { tipo: "firma"; texto: string };

export type TipoBloque = Bloque["tipo"];

export const TIPOS_BLOQUE: readonly TipoBloque[] = ["texto", "imagen", "destacado", "platos", "evento", "boton", "cita", "separador", "firma"];

export const NOMBRE_BLOQUE: Record<TipoBloque, string> = {
  texto: "Texto",
  imagen: "Foto",
  destacado: "Caja destacada",
  platos: "Lista de platos",
  evento: "Fecha y lugar",
  boton: "Botón",
  cita: "Cita",
  separador: "Separador",
  firma: "Firma",
};

// ── Límites ─────────────────────────────────────────────────────────────────

export const LIMITE_TITULO = 150;
export const LIMITE_MENSAJE = 5000;
export const LIMITE_URL = 2000;
export const LIMITE_INSIGNIA = 40;
export const LIMITE_PREHEADER = 150;
export const MAX_BLOQUES = 20;
export const MAX_PLATOS = 12;
export const LIMITE_TEXTO_BLOQUE = 2000;
export const LIMITE_CORTO = 120;
/** Texto total de todos los bloques (un correo más largo no se lee y pesa). */
export const LIMITE_TEXTO_TOTAL = 8000;

export const URL_WEB = "https://restaurantecasatomascrevillente.es";
export const URL_RESERVAR = `${URL_WEB}/reservas`;
export const URL_CHEQUES = `${URL_WEB}/regala`;
export const URL_CARTA = `${URL_WEB}/carta`;

// ── URLs ────────────────────────────────────────────────────────────────────

/** Solo URLs https:// bien formadas; cualquier otra cosa (javascript:, data:, http:, basura) se descarta. */
export function urlHttpsSegura(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (!v || v.length > LIMITE_URL) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Enlace de un botón: https:// o tel: (llamar para reservar). */
export function urlBotonSegura(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (/^tel:\+?[0-9 ]{6,20}$/.test(v)) return v.replace(/ /g, "");
  return urlHttpsSegura(v);
}

/** ¿Es un enlace a la web del restaurante (o un teléfono)? Lo único que puede proponer la IA. */
export function esEnlacePropio(url: string): boolean {
  if (url.startsWith("tel:")) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "restaurantecasatomascrevillente.es" || h.endsWith(".restaurantecasatomascrevillente.es");
  } catch {
    return false;
  }
}

// ── Validación ──────────────────────────────────────────────────────────────

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // Sin caracteres de control (salvo saltos de línea y tabuladores).
  // eslint-disable-next-line no-control-regex
  const limpio = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (limpio.length > max) return null;
  return limpio;
};

const opcional = (v: unknown, max: number): string | undefined | null => {
  if (v === undefined || v === null || v === "") return undefined;
  const t = texto(v, max);
  if (t === null) return null;
  return t || undefined;
};

export type ResultadoBloques = { ok: true; bloques: Bloque[] } | { ok: false; error: string };

/**
 * Valida y limpia una lista de bloques que llega del panel, de la IA o de una
 * plantilla guardada. Devuelve un error en llano (lo lee el personal) si algo
 * no vale; nunca deja pasar HTML (se escapa al pintar) ni enlaces que no sean
 * https:// o tel:.
 */
export function validarBloques(raw: unknown): ResultadoBloques {
  if (!Array.isArray(raw)) return { ok: false, error: "El diseño del correo no es válido" };
  if (raw.length === 0) return { ok: false, error: "El correo no tiene ningún bloque" };
  if (raw.length > MAX_BLOQUES) return { ok: false, error: `El correo no puede tener más de ${MAX_BLOQUES} bloques` };
  const bloques: Bloque[] = [];
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    const n = i + 1;
    if (!r || typeof r !== "object" || typeof r.tipo !== "string" || !(TIPOS_BLOQUE as readonly string[]).includes(r.tipo)) {
      return { ok: false, error: `El bloque ${n} no es válido` };
    }
    const largo = (campo: string) => ({ ok: false as const, error: `El bloque ${n} (${NOMBRE_BLOQUE[r.tipo as TipoBloque].toLowerCase()}): ${campo} es demasiado largo o no es válido` });
    switch (r.tipo as TipoBloque) {
      case "texto":
      case "firma": {
        const t = texto(r.texto, LIMITE_TEXTO_BLOQUE);
        if (t === null) return largo("el texto");
        if (!t) return { ok: false, error: `El bloque ${n} (${NOMBRE_BLOQUE[r.tipo as TipoBloque].toLowerCase()}) está vacío` };
        total += t.length;
        bloques.push({ tipo: r.tipo as "texto" | "firma", texto: t });
        break;
      }
      case "imagen": {
        const url = urlHttpsSegura(typeof r.url === "string" ? r.url : null);
        if (!url) return { ok: false, error: `El bloque ${n} (foto) necesita una imagen https:// válida` };
        const alt = texto(r.alt ?? "", LIMITE_CORTO);
        const pie = opcional(r.pie, LIMITE_CORTO);
        if (alt === null) return largo("el texto alternativo");
        if (pie === null) return largo("el pie de foto");
        bloques.push({ tipo: "imagen", url, alt: alt || "Foto de Casa Tomás", ...(pie ? { pie } : {}) });
        break;
      }
      case "destacado": {
        const t = texto(r.texto, LIMITE_TEXTO_BLOQUE);
        const titulo = opcional(r.titulo, LIMITE_CORTO);
        if (t === null) return largo("el texto");
        if (titulo === null) return largo("el título");
        if (!t) return { ok: false, error: `El bloque ${n} (caja destacada) está vacío` };
        total += t.length + (titulo?.length ?? 0);
        bloques.push({ tipo: "destacado", texto: t, ...(titulo ? { titulo } : {}) });
        break;
      }
      case "platos": {
        if (!Array.isArray(r.platos)) return largo("la lista");
        if (r.platos.length > MAX_PLATOS) return { ok: false, error: `El bloque ${n} (lista de platos) admite hasta ${MAX_PLATOS} platos` };
        const titulo = opcional(r.titulo, LIMITE_CORTO);
        if (titulo === null) return largo("el título");
        const platos: PlatoBloque[] = [];
        for (const p of r.platos as Array<Record<string, unknown> | null>) {
          if (!p || typeof p !== "object") return largo("un plato");
          const nombre = texto(p.nombre, LIMITE_CORTO);
          const descripcion = opcional(p.descripcion, 300);
          const precio = opcional(p.precio, 30);
          if (nombre === null || descripcion === null || precio === null) return largo("un plato");
          if (!nombre) continue; // filas vacías del editor: se ignoran
          total += nombre.length + (descripcion?.length ?? 0);
          platos.push({ nombre, ...(descripcion ? { descripcion } : {}), ...(precio ? { precio } : {}) });
        }
        if (!platos.length) return { ok: false, error: `El bloque ${n} (lista de platos) no tiene ningún plato` };
        bloques.push({ tipo: "platos", platos, ...(titulo ? { titulo } : {}) });
        break;
      }
      case "evento": {
        const campos = { fecha: opcional(r.fecha, 80), hora: opcional(r.hora, 40), lugar: opcional(r.lugar, LIMITE_CORTO), precio: opcional(r.precio, 60) };
        for (const [k, v] of Object.entries(campos)) if (v === null) return largo(k);
        const limpio = Object.fromEntries(Object.entries(campos).filter(([, v]) => v)) as Record<string, string>;
        if (!Object.keys(limpio).length) return { ok: false, error: `El bloque ${n} (fecha y lugar) está vacío` };
        bloques.push({ tipo: "evento", ...limpio });
        break;
      }
      case "boton": {
        const t = texto(r.texto, 40);
        if (t === null || !t) return { ok: false, error: `El bloque ${n} (botón) necesita un texto corto` };
        const url = urlBotonSegura(typeof r.url === "string" ? r.url : null);
        if (!url) return { ok: false, error: `El bloque ${n} (botón) necesita un enlace https:// (o tel:) válido` };
        bloques.push({ tipo: "boton", texto: t, url });
        break;
      }
      case "cita": {
        const t = texto(r.texto, 600);
        const autor = opcional(r.autor, 80);
        if (t === null || !t) return { ok: false, error: `El bloque ${n} (cita) está vacío o es demasiado largo` };
        if (autor === null) return largo("el autor");
        total += t.length;
        bloques.push({ tipo: "cita", texto: t, ...(autor ? { autor } : {}) });
        break;
      }
      case "separador":
        bloques.push({ tipo: "separador" });
        break;
    }
  }
  if (total > LIMITE_TEXTO_TOTAL) return { ok: false, error: `El correo es demasiado largo (máximo ${LIMITE_TEXTO_TOTAL} caracteres de texto)` };
  if (!bloques.some((b) => b.tipo !== "separador")) return { ok: false, error: "El correo no tiene contenido" };
  return { ok: true, bloques };
}

// ── Texto plano (historial, versión de texto y respaldo) ────────────────────

/**
 * Versión de texto del correo: se guarda en el historial (newsletter_envios.mensaje)
 * y el panel la manda también como `mensaje`, para que una versión anterior de
 * enviar-newsletter (que no entiende los bloques) mande al menos el mismo texto.
 */
export function textoPlanoDeBloques(bloques: readonly Bloque[]): string {
  const partes: string[] = [];
  for (const b of bloques) {
    switch (b.tipo) {
      case "texto":
      case "firma":
        partes.push(b.texto);
        break;
      case "destacado":
        partes.push([b.titulo, b.texto].filter(Boolean).join("\n"));
        break;
      case "platos":
        partes.push(
          [b.titulo, ...b.platos.map((p) => `· ${p.nombre}${p.precio ? ` (${p.precio})` : ""}${p.descripcion ? `: ${p.descripcion}` : ""}`)]
            .filter(Boolean)
            .join("\n"),
        );
        break;
      case "evento":
        partes.push(
          [b.fecha && `Fecha: ${b.fecha}`, b.hora && `Hora: ${b.hora}`, b.lugar && `Lugar: ${b.lugar}`, b.precio && `Precio: ${b.precio}`]
            .filter(Boolean)
            .join("\n"),
        );
        break;
      case "boton":
        partes.push(`${b.texto}: ${b.url}`);
        break;
      case "cita":
        partes.push(`«${b.texto}»${b.autor ? ` — ${b.autor}` : ""}`);
        break;
      case "imagen":
        if (b.pie) partes.push(b.pie);
        break;
      case "separador":
        break;
    }
  }
  return partes.filter((p) => p.trim()).join("\n\n").slice(0, LIMITE_MENSAJE);
}

// ── Catálogo de plantillas ──────────────────────────────────────────────────

export interface PlantillaBase {
  tipo: TipoNewsletter;
  nombre: string;
  descripcion: string;
  /** Etiqueta pequeña sobre el título del correo («Menú de temporada»). */
  insignia: string;
  /** Emoji del asunto (vacío = sin emoji). */
  emoji: string;
  titulo: string;
  preheader: string;
  bloques: Bloque[];
}

const FIRMA = "Un abrazo,\nEl equipo de Casa Tomás";

/**
 * Plantillas de partida. Los textos son de ejemplo: el personal los cambia (o
 * la IA los redacta) antes de enviar. Las tres primeras son las de siempre,
 * con el mismo tipo para el historial.
 */
export const PLANTILLAS_BASE: readonly PlantillaBase[] = [
  {
    tipo: "anuncio",
    nombre: "Anuncio",
    descripcion: "Una novedad o un aviso a los clientes",
    insignia: "Novedades",
    emoji: "",
    titulo: "Novedades de Casa Tomás",
    preheader: "Os contamos lo último de Casa Tomás.",
    bloques: [
      { tipo: "texto", texto: "Queridos clientes:\n\nNos complace compartir con vosotros las últimas novedades de Casa Tomás." },
      { tipo: "boton", texto: "Reservar mesa", url: URL_RESERVAR },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "nuevo_menu",
    nombre: "Nuevo menú",
    descripcion: "Presenta platos nuevos de la carta",
    insignia: "Nuevo menú",
    emoji: "🍽️",
    titulo: "Nuevos platos en nuestra carta",
    preheader: "Hemos renovado la carta: estos son los platos nuevos.",
    bloques: [
      { tipo: "texto", texto: "Hemos incorporado nuevos platos a nuestra carta que estamos seguros os van a encantar." },
      {
        tipo: "platos",
        titulo: "Propuesta gastronómica",
        platos: [
          { nombre: "Nombre del primer plato", descripcion: "Una línea que lo describa" },
          { nombre: "Nombre del segundo plato", descripcion: "Una línea que lo describa" },
        ],
      },
      { tipo: "boton", texto: "Reservar mesa", url: URL_RESERVAR },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "oferta",
    nombre: "Oferta especial",
    descripcion: "Una promoción para los suscriptores",
    insignia: "Promoción exclusiva",
    emoji: "🎉",
    titulo: "Una propuesta especial para ti",
    preheader: "Solo para quienes recibís nuestras novedades.",
    bloques: [
      { tipo: "texto", texto: "Tenemos una propuesta especial preparada solo para vosotros." },
      { tipo: "destacado", titulo: "La propuesta", texto: "Describe aquí la oferta: qué incluye, para quién y hasta cuándo." },
      { tipo: "boton", texto: "Reservar con la oferta", url: URL_RESERVAR },
      { tipo: "texto", texto: "Oferta válida según disponibilidad." },
    ],
  },
  {
    tipo: "menu_temporada",
    nombre: "Menú de temporada",
    descripcion: "El menú de otoño, invierno, primavera o verano",
    insignia: "Menú de temporada",
    emoji: "🍂",
    titulo: "Llega el menú de temporada",
    preheader: "Producto de temporada, cocina de siempre.",
    bloques: [
      { tipo: "texto", texto: "Con el cambio de estación cambia también nuestra cocina. Os presentamos el menú de temporada, pensado con el mejor producto del momento." },
      {
        tipo: "platos",
        titulo: "El menú",
        platos: [
          { nombre: "Entrante", descripcion: "Descripción del entrante" },
          { nombre: "Principal", descripcion: "Descripción del principal" },
          { nombre: "Postre", descripcion: "Descripción del postre" },
        ],
      },
      { tipo: "evento", fecha: "Desde el … hasta el …", precio: "… € por persona" },
      { tipo: "boton", texto: "Reservar mesa", url: URL_RESERVAR },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "evento",
    nombre: "Evento o fecha especial",
    descripcion: "Cenas especiales, jornadas, San Valentín, Nochevieja…",
    insignia: "Fecha especial",
    emoji: "🥂",
    titulo: "Os esperamos en una noche especial",
    preheader: "Plazas limitadas: reserva con tiempo.",
    bloques: [
      { tipo: "texto", texto: "Preparamos una velada especial y nos encantaría compartirla con vosotros." },
      { tipo: "evento", fecha: "Día del evento", hora: "Hora", lugar: "Casa Tomás, Crevillente", precio: "Precio por persona" },
      { tipo: "destacado", titulo: "Plazas limitadas", texto: "Las plazas son limitadas. Os recomendamos reservar con antelación." },
      { tipo: "boton", texto: "Reservar plaza", url: URL_RESERVAR },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "novedades_carta",
    nombre: "Novedades de la carta",
    descripcion: "Platos, vinos o postres que acaban de entrar",
    insignia: "Novedades de la carta",
    emoji: "✨",
    titulo: "Lo nuevo en nuestra carta",
    preheader: "Platos y vinos que acaban de llegar a la carta.",
    bloques: [
      { tipo: "texto", texto: "Estas semanas han llegado novedades a la carta que queremos contaros antes que a nadie." },
      {
        tipo: "platos",
        titulo: "Novedades",
        platos: [
          { nombre: "Novedad", descripcion: "Una línea que la describa" },
          { nombre: "Otra novedad", descripcion: "Una línea que la describa" },
        ],
      },
      { tipo: "cita", texto: "Cocina de siempre, con el producto de hoy.", autor: "Casa Tomás" },
      { tipo: "boton", texto: "Ver la carta", url: URL_CARTA },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "cheques_regalo",
    nombre: "Cheques regalo",
    descripcion: "Para regalar una comida o una cena en Casa Tomás",
    insignia: "Cheques regalo",
    emoji: "🎁",
    titulo: "Regala una comida en Casa Tomás",
    preheader: "El regalo perfecto: una mesa en Casa Tomás.",
    bloques: [
      { tipo: "texto", texto: "¿Buscas un regalo especial? Con nuestros cheques regalo puedes invitar a quien quieras a disfrutar de Casa Tomás." },
      { tipo: "destacado", titulo: "Cómo funciona", texto: "Eliges el importe, lo recibes al momento por correo y la persona a quien se lo regalas reserva cuando quiera." },
      { tipo: "boton", texto: "Comprar un cheque regalo", url: URL_CHEQUES },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "personalizada",
    nombre: "En blanco",
    descripcion: "Empieza desde cero con tus propios bloques",
    insignia: "Casa Tomás",
    emoji: "",
    titulo: "",
    preheader: "",
    bloques: [{ tipo: "texto", texto: "" }],
  },
];

export function plantillaBase(tipo: TipoNewsletter): PlantillaBase {
  return PLANTILLAS_BASE.find((p) => p.tipo === tipo) ?? PLANTILLAS_BASE[0];
}

/**
 * Bloques de un envío «de siempre» (título + mensaje + imagen, sin bloques):
 * lo que manda una versión anterior del panel. Se pinta con la estética nueva
 * conservando el contenido y el botón de cada tipo.
 */
export function bloquesDeMensaje(tipo: TipoNewsletter, mensaje: string, imagenUrl: string | null): Bloque[] {
  const bloques: Bloque[] = [];
  if (imagenUrl) bloques.push({ tipo: "imagen", url: imagenUrl, alt: tipo === "oferta" ? "Oferta especial de Casa Tomás" : "Plato de Casa Tomás" });
  if (tipo === "nuevo_menu") {
    bloques.push({ tipo: "destacado", titulo: "Propuesta gastronómica", texto: mensaje });
  } else {
    bloques.push({ tipo: "texto", texto: mensaje });
  }
  if (tipo === "anuncio") {
    bloques.push({ tipo: "firma", texto: "Atentamente,\nLa Dirección de Casa Tomás" });
  } else {
    bloques.push({ tipo: "boton", texto: tipo === "oferta" ? "Aprovechar la oferta" : "Reservar mesa", url: URL_RESERVAR });
  }
  if (tipo === "oferta") bloques.push({ tipo: "texto", texto: "Oferta válida según disponibilidad." });
  return bloques;
}
