/**
 * Errores de la Graph API de Meta traducidos a castellano, con un «cómo
 * arreglarlo» para cada caso.
 *
 * Las respuestas de error de Meta tienen la forma
 *   { error: { message, type, code, error_subcode, fbtrace_id } }
 * La tabla de códigos sale de la documentación oficial de Content Publishing
 * y de Graph API (errores 190, 10/200-299, 4/17/32/613/80002, 2207xxx…).
 *
 * Todo el texto que viene de Meta se sanea antes de guardarlo.
 */
import { sanear } from "./secretos.js";

export type TipoErrorInstagram =
  | "token"
  | "sesion"
  | "permisos"
  | "cuenta_no_profesional"
  | "limite_llamadas"
  | "limite_publicacion"
  | "spam"
  | "cuenta_restringida"
  | "imagen_demasiado_grande"
  | "formato_imagen"
  | "relacion_aspecto"
  | "caption_demasiado_largo"
  | "url_no_descargable"
  | "contenedor_no_listo"
  | "contenedor_inexistente"
  | "contenedor_error"
  | "contenedor_caducado"
  | "contenedor_ya_publicado"
  | "contenedor_tiempo_agotado"
  | "medio_caducado"
  | "peticion_invalida"
  | "transitorio"
  | "red"
  | "tiempo_agotado"
  | "respuesta_inesperada"
  | "desconocido";

interface Texto {
  mensaje: string;
  comoArreglarlo: string;
  reintentable: boolean;
}

const REGENERAR_TOKEN =
  "Genera un token nuevo en Meta Business Suite → Configuración del negocio → Usuarios → Usuarios del sistema → (tu usuario) → «Generar token»: elige la app, marca instagram_basic e instagram_content_publish y caducidad «Nunca». Cámbialo en Vercel → admin-casatomas → Settings → Environment Variables (IG_ACCESS_TOKEN, Production y Preview, marcada como Sensitive), vuelve a desplegar y pulsa «Comprobar conexión» en Marketing → Instagram. Detalle en docs/instagram.md.";

const TEXTOS: Record<TipoErrorInstagram, Texto> = {
  token: {
    mensaje: "El token de acceso no es válido",
    comoArreglarlo: REGENERAR_TOKEN,
    reintentable: false,
  },
  sesion: {
    mensaje: "La sesión del token no es válida (error 102)",
    comoArreglarlo: REGENERAR_TOKEN,
    reintentable: false,
  },
  permisos: {
    mensaje: "Al token le faltan permisos para esta operación",
    comoArreglarlo:
      "Regenera el token del usuario del sistema marcando instagram_basic e instagram_content_publish (y pages_show_list / pages_read_engagement / business_management si usas la ruta de páginas). Comprueba también que la cuenta de Instagram está asignada como activo a ese usuario del sistema con control total.",
    reintentable: false,
  },
  cuenta_no_profesional: {
    mensaje: "La cuenta de Instagram no es profesional (empresa o creador)",
    comoArreglarlo:
      "En la app de Instagram: Configuración → Tipo de cuenta y herramientas → Cambiar a cuenta profesional (Empresa). Después vuelve a asignarla en Configuración del negocio.",
    reintentable: false,
  },
  limite_llamadas: {
    mensaje: "Se ha superado el límite de llamadas a la API",
    comoArreglarlo:
      "Espera antes de reintentar (mira el tiempo estimado indicado). No repitas la acción en bucle. Si se repite, revisa el panel de la app en developers.facebook.com → Panel → Uso de la API.",
    reintentable: false,
  },
  limite_publicacion: {
    mensaje: "Se ha alcanzado el límite de publicaciones de la cuenta en 24 h",
    comoArreglarlo:
      "Espera a que pase la ventana de 24 h («Comprobar conexión» en el panel muestra el uso actual: quota_usage / quota_total). Los contenedores ya creados caducan a las 24 h.",
    reintentable: false,
  },
  spam: {
    mensaje: "Instagram ha marcado la acción como posible spam",
    comoArreglarlo:
      "Deja de publicar durante unas horas, evita textos o imágenes repetidos y revisa en la app de Instagram si hay avisos en la cuenta.",
    reintentable: false,
  },
  cuenta_restringida: {
    mensaje: "La cuenta de Instagram está restringida o bloqueada para publicar",
    comoArreglarlo:
      "Entra en la app de Instagram con la cuenta y resuelve el aviso (verificación, apelación, etc.). Mientras siga restringida la API no puede publicar.",
    reintentable: false,
  },
  imagen_demasiado_grande: {
    mensaje: "La imagen supera los 8 MB",
    comoArreglarlo: "Reexporta la imagen en JPEG con menos calidad o menos resolución (ancho máximo 1440 px).",
    reintentable: false,
  },
  formato_imagen: {
    mensaje: "Formato de imagen no admitido",
    comoArreglarlo: "Instagram solo acepta JPEG por la API. Convierte la imagen a .jpg en sRGB.",
    reintentable: false,
  },
  relacion_aspecto: {
    mensaje: "La relación de aspecto de la imagen no es válida",
    comoArreglarlo: "Feed: entre 4:5 (vertical, p. ej. 1080×1350) y 1,91:1 (horizontal). Story: 9:16 (1080×1920).",
    reintentable: false,
  },
  caption_demasiado_largo: {
    mensaje: "El texto (caption) es demasiado largo",
    comoArreglarlo: "Máximo 2200 caracteres, 30 hashtags y 20 menciones.",
    reintentable: false,
  },
  url_no_descargable: {
    mensaje: "Meta no ha podido descargar la imagen desde la URL pública",
    comoArreglarlo:
      "Abre la URL pública en una ventana privada: debe descargar la imagen sin iniciar sesión. Si da error, haz público el bucket de Supabase Storage (Storage → bucket → Edit bucket → Public).",
    reintentable: false,
  },
  contenedor_no_listo: {
    mensaje: "El contenedor todavía no está listo (no está en FINISHED)",
    comoArreglarlo: "Espera a que el estado sea FINISHED antes de publicar; el panel lo hace solo. Si persiste, vuelve a intentarlo en unos minutos.",
    reintentable: false,
  },
  contenedor_inexistente: {
    mensaje: "El contenedor no existe o ha caducado",
    comoArreglarlo: "Los contenedores caducan a las 24 h. Vuelve a lanzar la publicación para crear uno nuevo.",
    reintentable: true,
  },
  contenedor_error: {
    mensaje: "Instagram no ha podido procesar la imagen (estado ERROR)",
    comoArreglarlo:
      "Revisa que la imagen sea JPEG sRGB, ≤ 8 MB, ancho 320–1440 y relación 4:5–1,91:1 (story 9:16), y que la URL pública se descargue sin sesión. Después vuelve a publicar.",
    reintentable: false,
  },
  contenedor_caducado: {
    mensaje: "El contenedor ha caducado (estado EXPIRED)",
    comoArreglarlo: "Los contenedores caducan a las 24 h. Vuelve a lanzar la publicación.",
    reintentable: false,
  },
  contenedor_ya_publicado: {
    mensaje: "Ese contenedor ya se publicó (estado PUBLISHED)",
    comoArreglarlo: "No hace falta hacer nada; si quieres publicar otra vez, crea un contenedor nuevo.",
    reintentable: false,
  },
  contenedor_tiempo_agotado: {
    mensaje: "El contenedor no llegó a FINISHED en el tiempo máximo de espera",
    comoArreglarlo:
      "Puede que Instagram vaya lento. Vuelve a intentarlo más tarde o sube el tiempo máximo de espera. El contenedor sigue vivo hasta 24 h.",
    reintentable: false,
  },
  medio_caducado: {
    mensaje: "El medio ha caducado",
    comoArreglarlo: "Vuelve a subir la imagen y a crear el contenedor.",
    reintentable: false,
  },
  peticion_invalida: {
    mensaje: "Petición no válida o el objeto no existe / no tienes acceso",
    comoArreglarlo:
      "Comprueba IG_USER_ID (debe ser el ID numérico de la cuenta profesional de Instagram, pulsa «Comprobar conexión» en el panel para ver los que ve el token) y que la cuenta está asignada al usuario del sistema.",
    reintentable: false,
  },
  transitorio: {
    mensaje: "Error temporal de Meta",
    comoArreglarlo: "Se reintenta automáticamente. Si sigue fallando, espera unos minutos y vuelve a intentarlo desde el panel.",
    reintentable: true,
  },
  red: {
    mensaje: "No se pudo conectar con la Graph API",
    comoArreglarlo: "Revisa la conexión a internet o un posible proxy/cortafuegos y vuelve a intentarlo.",
    reintentable: true,
  },
  tiempo_agotado: {
    mensaje: "La petición a la Graph API tardó demasiado",
    comoArreglarlo: "Vuelve a intentarlo; si se repite, revisa la conexión.",
    reintentable: true,
  },
  respuesta_inesperada: {
    mensaje: "Respuesta inesperada de la Graph API",
    comoArreglarlo: "Comprueba META_API_VERSION (por defecto v26.0) y vuelve a intentarlo. Si persiste, revisa el changelog de Graph API.",
    reintentable: false,
  },
  desconocido: {
    mensaje: "Error no catalogado de la Graph API",
    comoArreglarlo: "Lee el mensaje de Meta y el código; busca el código en developers.facebook.com/docs/instagram-platform/content-publishing (sección de errores).",
    reintentable: false,
  },
};

/** Detalle de los subcódigos del error 190. */
const SUBCODIGOS_TOKEN: Record<number, { detalle: string; arreglo?: string }> = {
  458: {
    detalle: "la app ya no está autorizada (se quitó del portfolio o del usuario del sistema)",
    arreglo:
      "En Configuración del negocio → Usuarios del sistema → (usuario) → Asignar activos, vuelve a asignar la app y la cuenta de Instagram; después regenera el token.",
  },
  459: { detalle: "la cuenta tiene un punto de control de seguridad pendiente", arreglo: "Entra en Facebook/Instagram con la cuenta administradora, resuelve el punto de control y regenera el token." },
  460: { detalle: "se cambió la contraseña y el token quedó invalidado" },
  463: { detalle: "el token ha caducado" },
  464: { detalle: "el usuario no está confirmado o tiene un punto de control", arreglo: "Resuelve el aviso en Facebook/Instagram y regenera el token." },
  467: { detalle: "el token no es válido (revocado o reasignado el activo)" },
  492: {
    detalle: "el usuario no tiene rol sobre la página o la cuenta",
    arreglo: "Asigna la cuenta de Instagram (y la página, si aplica) como activo al usuario del sistema y regenera el token.",
  },
};

export interface DatosErrorGraph {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
}

export interface UsoCasoNegocio {
  /** Máximo de call_count / total_cputime / total_time (en %). */
  porcentajeMax: number;
  /** Minutos estimados para recuperar el acceso (0 si no hay bloqueo). */
  minutosParaRecuperar: number | null;
}

export interface ParametrosErrorInstagram {
  tipo: TipoErrorInstagram;
  mensaje?: string;
  comoArreglarlo?: string;
  reintentable?: boolean;
  codigo?: number | null;
  subcodigo?: number | null;
  estadoHttp?: number | null;
  fbtraceId?: string | null;
  detalleMeta?: string | null;
  usoCasoNegocio?: UsoCasoNegocio | null;
}

export class ErrorInstagram extends Error {
  readonly name = "ErrorInstagram";
  readonly tipo: TipoErrorInstagram;
  readonly comoArreglarlo: string;
  readonly reintentable: boolean;
  readonly codigo: number | null;
  readonly subcodigo: number | null;
  readonly estadoHttp: number | null;
  readonly fbtraceId: string | null;
  /** Texto original de Meta, ya saneado. */
  readonly detalleMeta: string | null;
  readonly usoCasoNegocio: UsoCasoNegocio | null;

  constructor(p: ParametrosErrorInstagram) {
    const base = TEXTOS[p.tipo];
    super(sanear(p.mensaje ?? base.mensaje));
    this.tipo = p.tipo;
    this.comoArreglarlo = sanear(p.comoArreglarlo ?? base.comoArreglarlo);
    this.reintentable = p.reintentable ?? base.reintentable;
    this.codigo = p.codigo ?? null;
    this.subcodigo = p.subcodigo ?? null;
    this.estadoHttp = p.estadoHttp ?? null;
    this.fbtraceId = p.fbtraceId ?? null;
    this.detalleMeta = p.detalleMeta ? sanear(p.detalleMeta) : null;
    this.usoCasoNegocio = p.usoCasoNegocio ?? null;
  }

  /** Texto completo para mostrar en consola (ya saneado). */
  describir(): string {
    const lineas = [`✖ ${this.message}`];
    if (this.codigo !== null) {
      lineas.push(`  Código Meta: ${this.codigo}${this.subcodigo !== null ? ` / subcódigo ${this.subcodigo}` : ""}`);
    }
    if (this.fbtraceId) lineas.push(`  fbtrace_id: ${this.fbtraceId}`);
    lineas.push(`  Cómo arreglarlo: ${this.comoArreglarlo}`);
    return sanear(lineas.join("\n"));
  }
}

/** Lee la cabecera X-Business-Use-Case-Usage y se queda con las entradas type=instagram. */
export function leerUsoCasoNegocio(cabeceras: Headers | null | undefined): UsoCasoNegocio | null {
  const crudo = cabeceras?.get("x-business-use-case-usage");
  if (!crudo) return null;
  try {
    const datos = JSON.parse(crudo) as Record<string, Array<Record<string, unknown>>>;
    let porcentajeMax = 0;
    let minutos: number | null = null;
    let hay = false;
    for (const lista of Object.values(datos)) {
      if (!Array.isArray(lista)) continue;
      for (const uso of lista) {
        if (uso.type !== "instagram") continue;
        hay = true;
        for (const campo of ["call_count", "total_cputime", "total_time"]) {
          const v = Number(uso[campo]);
          if (Number.isFinite(v)) porcentajeMax = Math.max(porcentajeMax, v);
        }
        const espera = Number(uso.estimated_time_to_regain_access);
        if (Number.isFinite(espera)) minutos = Math.max(minutos ?? 0, espera);
      }
    }
    return hay ? { porcentajeMax, minutosParaRecuperar: minutos } : null;
  } catch {
    return null;
  }
}

const TRANSITORIOS_SUB = new Set([2207001, 2207003, 2207032]);

/** Clasifica un código/subcódigo de Meta en un tipo de error. */
export function clasificarError(
  codigo: number | null,
  subcodigo: number | null,
  mensaje: string,
  estadoHttp: number | null,
): TipoErrorInstagram {
  const c = codigo;
  const s = subcodigo;
  // Primero los subcódigos específicos de publicación (2207xxx), que pueden venir con códigos genéricos.
  if (s === 2207042 || c === 9) return "limite_publicacion";
  if (s === 2207051) return "spam";
  if (s === 2207050 || c === 25) return "cuenta_restringida";
  if (s === 2207004 || c === 36000) return "imagen_demasiado_grande";
  if (s === 2207005 || c === 36001) return "formato_imagen";
  if (s === 2207009 || c === 36003) return "relacion_aspecto";
  if (s === 2207010 || c === 36004) return "caption_demasiado_largo";
  if (s === 2207052 || c === 9004) return "url_no_descargable";
  if (s === 2207027 || c === 9007) return "contenedor_no_listo";
  if (s === 2207008 || c === 24) return "contenedor_inexistente";
  if (s === 2207020) return "medio_caducado";
  if ((s !== null && TRANSITORIOS_SUB.has(s)) || c === -1 || c === -2 || c === 1 || c === 2) return "transitorio";
  if (c === 190) return "token";
  if (c === 102) return "sesion";
  if (c === 10 && /not\s+(a\s+)?(business|creator)|business or creator|professional account|cuenta profesional/i.test(mensaje)) {
    return "cuenta_no_profesional";
  }
  if (c === 10 || (c !== null && c >= 200 && c <= 299)) return "permisos";
  if (c === 4 || c === 17 || c === 32 || c === 613 || (c !== null && c >= 80000 && c <= 80099)) return "limite_llamadas";
  if (c === 100) return "peticion_invalida";
  if (estadoHttp !== null && estadoHttp >= 500) return "transitorio";
  return "desconocido";
}

/** Convierte una respuesta de error de la Graph API en ErrorInstagram. */
export function mapearErrorGraph(entrada: {
  estadoHttp: number;
  cuerpo: unknown;
  cabeceras?: Headers | null;
}): ErrorInstagram {
  const cuerpo = entrada.cuerpo as { error?: DatosErrorGraph } | null | undefined;
  const e: DatosErrorGraph = (cuerpo && typeof cuerpo === "object" && cuerpo.error) || {};
  const codigo = typeof e.code === "number" ? e.code : null;
  const subcodigo = typeof e.error_subcode === "number" ? e.error_subcode : null;
  const mensajeMeta = [e.message, e.error_user_msg].filter(Boolean).join(" — ");
  const tipo = clasificarError(codigo, subcodigo, mensajeMeta, entrada.estadoHttp);
  const base = TEXTOS[tipo];
  const uso = leerUsoCasoNegocio(entrada.cabeceras);

  let mensaje = base.mensaje;
  let comoArreglarlo = base.comoArreglarlo;
  if (tipo === "token" && subcodigo !== null && SUBCODIGOS_TOKEN[subcodigo]) {
    const sub = SUBCODIGOS_TOKEN[subcodigo];
    mensaje = `${mensaje}: ${sub.detalle}`;
    if (sub.arreglo) comoArreglarlo = `${sub.arreglo} ${REGENERAR_TOKEN}`;
  }
  if (tipo === "limite_llamadas" && uso?.minutosParaRecuperar) {
    comoArreglarlo = `Espera unos ${uso.minutosParaRecuperar} min (estimated_time_to_regain_access de Meta) antes de reintentar. ${comoArreglarlo}`;
  }
  // «contenedor_inexistente» y «transitorio» son reintentables: el cliente los repite con espera creciente.
  const textoMeta = mensajeMeta ? sanear(mensajeMeta).slice(0, 400) : null;
  const sufijo = textoMeta ? ` — Meta dice: «${textoMeta}»` : entrada.estadoHttp ? ` (HTTP ${entrada.estadoHttp})` : "";
  const reintentable = tipo === "desconocido" && e.is_transient === true ? true : base.reintentable;

  return new ErrorInstagram({
    tipo,
    mensaje: `${mensaje}${sufijo}`,
    comoArreglarlo,
    reintentable,
    codigo,
    subcodigo,
    estadoHttp: entrada.estadoHttp,
    fbtraceId: e.fbtrace_id ?? null,
    detalleMeta: textoMeta,
    usoCasoNegocio: uso,
  });
}

/** Busca un subcódigo 2207xxx dentro del texto de `status` de un contenedor en ERROR. */
export function tipoDesdeTextoEstado(texto: string | undefined): TipoErrorInstagram | null {
  const m = /\b(2207\d{3})\b/.exec(texto ?? "");
  if (!m) return null;
  const tipo = clasificarError(null, Number(m[1]), texto ?? "", null);
  return tipo === "desconocido" ? null : tipo;
}

export function textoDeTipo(tipo: TipoErrorInstagram): Readonly<Texto> {
  return TEXTOS[tipo];
}

/** Cuerpo JSON (saneado) de un ErrorInstagram para las respuestas de las funciones. */
export function errorInstagramAJson(e: ErrorInstagram): {
  error: string;
  tipo: TipoErrorInstagram;
  comoArreglarlo: string;
  codigo: number | null;
  subcodigo: number | null;
  fbtraceId: string | null;
} {
  return {
    error: sanear(e.message),
    tipo: e.tipo,
    comoArreglarlo: sanear(e.comoArreglarlo),
    codigo: e.codigo,
    subcodigo: e.subcodigo,
    fbtraceId: e.fbtraceId,
  };
}

/** Estado HTTP con el que la función responde a un error de Meta. */
export function estadoHttpDeError(e: ErrorInstagram): number {
  switch (e.tipo) {
    case "limite_publicacion":
    case "limite_llamadas":
    case "spam":
      return 429;
    case "imagen_demasiado_grande":
    case "formato_imagen":
    case "relacion_aspecto":
    case "caption_demasiado_largo":
    case "url_no_descargable":
    case "contenedor_error":
      return 422;
    case "transitorio":
    case "red":
    case "tiempo_agotado":
      return 503;
    default:
      return 502;
  }
}
