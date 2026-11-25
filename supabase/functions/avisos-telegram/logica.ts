// ============================================================================
//  avisos-telegram · lógica pura (sin Deno ni red), probada con vitest en
//  supabase/functions/avisos-telegram/__tests__/
// ----------------------------------------------------------------------------
//  22/11/2026 (petición del dueño): cuatro chats, uno por canal, para que uno no se llene con lo de otro
//  (canalDeTipo, chatDe), y mensajes de UNA línea con emoji (lineaAviso). El resumen diario es una línea por
//  tipo con el número y los dos casos principales, sin repetir lo que ya llegó al momento.
//  23/11/2026 (dueño: «solo me ha salido reserva nueva, tiene que salir si es petición, si ya ha sido aceptada, si
//  el usuario la ha confirmado…» y «el resumen diario y el semanal me han llegado igual y mal formateados»):
//   · Reservas: un aviso por paso de la reserva (petición, aceptada, confirmada, cancelada; tabla
//     avisos_telegram_reservas, 20261217100000), con el estado y quién lo hizo. Los avisos «Reserva nueva» y
//     «Reserva cancelada» del panel ya no van a Telegram.
//   · Resumen diario: las reservas de hoy y mañana y las peticiones por aceptar; el día del semanal, el semanal va
//     dentro del mismo mensaje (sin repetir «por revisar»).
//   · Formato HTML de Telegram: negritas y enlaces con texto corto (la URL no se ve). Si Telegram no acepta el
//     HTML, la función lo reenvía en texto plano (aTextoPlano).
//  25/11/2026 (dueño: «cuando se suba … si ha subido el precio … enviar a Telegram … con el enlace al Drive de esa
//  factura», «si es marisco o vino … el precio sugerido con el mismo margen» y «al final del día un resumen de las
//  facturas subidas»):
//   · Los avisos de una misma factura van en UN mensaje (mensajeFactura): proveedor, nº y fecha, qué ha pasado
//     (precio anterior → nuevo y %) y los enlaces al original en Drive y al panel.
//   · Subidas de marisco o vino con su vino o plato en la carta: el precio con el mismo margen (sugerenciasCarta).
//   · Las subidas de precio van aunque no suenen en la campana (AVISA_SIEMPRE).
//   · Cierre del día (construirCierre): facturas subidas hoy y avisos del día, en el chat de Resúmenes.
// ============================================================================

/** Límite de Telegram para el texto de sendMessage. */
export const LIMITE_TELEGRAM = 4096;
/** Tras estos fallos, un aviso ya no se reintenta al momento (sale igual en el resumen). */
export const MAX_FALLOS = 3;
/** Casos que se nombran por tipo en el resumen diario («Chuletón 41 %, Entrecot 38 % y 3 más»). */
export const CASOS_POR_TIPO = 2;
/** Tope de avisos «al momento» por hora y por día (configurable: tope_hora y tope_dia). El resto, en el panel. */
export const TOPE_HORA = 10;
export const TOPE_DIA = 30;
/** Tope propio del canal de reservas: no compite con los avisos de precio o margen. */
export const TOPE_RESERVAS_HORA = 20;
export const TOPE_RESERVAS_DIA = 60;
/** «Por revisar»: solo entra en el resumen si cambia en CAMBIO_REVISION documentos o han pasado DIAS_REVISION días. */
export const CAMBIO_REVISION = 5;
export const DIAS_REVISION = 7;
/** Si un precio es ≥ RATIO_UNIDADES veces el otro (o al revés), casi seguro se comparan unidades distintas o hay una lectura mala. */
export const RATIO_UNIDADES = 10;
/** Avisos de reservas (sin nombres de clientes en Telegram; ver lineaReserva). */
export const TIPOS_RESERVA = ["reserva_nueva", "reserva_cancelada"];
export const SIN_CONFIGURAR = "Telegram sin configurar";
export const ZONA = "Europe/Madrid";
/** Largo máximo de la línea de un aviso. */
export const MAX_LINEA = 180;

export interface ConfigTelegram {
  activo: boolean;
  /** Chat general: el de Reservas, Facturas y Resúmenes cuando no tienen el suyo. */
  chat_id: string | null;
  /** 22/11/2026 (20261216100000): un chat por canal. */
  chat_reservas?: string | null;
  chat_facturas?: string | null;
  chat_resumenes?: string | null;
  /** Fallos técnicos (desarrolladores). Sin él, no se envían: nunca van al general. */
  chat_fallos?: string | null;
  hora_resumen: number;
  tipos_al_momento: string[];
  silencio_activo: boolean;
  silencio_desde: number;
  silencio_hasta: number;
  activo_desde: string | null;
  resumen_ultimo_dia: string | null;
  /** 18/11/2026: reservas nuevas/canceladas para hoy y mañana, al momento (por defecto sí). */
  reservas_al_momento?: boolean;
  tope_hora?: number;
  tope_dia?: number;
  /** Último «Por revisar» enviado en el resumen, por clase (avisos / duplicados). */
  resumen_revision?: Record<string, EstadoRevision> | null;
  semanal_activo?: boolean;
  semanal_dia?: number;
  semanal_hora?: number;
  semanal_ultimo_dia?: string | null;
  /** 25/11/2026 (20261222100000): cierre del día con las facturas subidas, a cierre_hora (Madrid). */
  cierre_activo?: boolean;
  cierre_hora?: number;
  cierre_ultimo_dia?: string | null;
}

// ─── Canales (22/11/2026) ───────────────────────────────────────────────────

/** Los cuatro chats. Reservas y Facturas reciben los avisos al momento; Resúmenes, el diario y el semanal. */
export type Canal = "reservas" | "facturas" | "resumenes" | "fallos";
export type CanalAviso = "reservas" | "facturas";
export const CANALES: Canal[] = ["reservas", "facturas", "resumenes", "fallos"];
export const NOMBRE_CANAL: Record<Canal, string> = {
  reservas: "Reservas",
  facturas: "Facturas y márgenes",
  resumenes: "Resúmenes",
  fallos: "Fallos técnicos",
};

/** Canal de un tipo de aviso. Misma regla que avisos_telegram_canal (SQL, 20261216100000). */
export const canalDeTipo = (tipo: string): CanalAviso =>
  tipo.startsWith("reserva_") || tipo === "solicitud_pendiente" ? "reservas" : "facturas";

const chatLimpio = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Chat de un canal: el suyo o, salvo Fallos técnicos, el general. null si no hay a dónde mandarlo. */
export function chatDe(cfg: Pick<ConfigTelegram, "chat_id" | "chat_reservas" | "chat_facturas" | "chat_resumenes" | "chat_fallos">, canal: Canal): string | null {
  if (canal === "fallos") return chatLimpio(cfg.chat_fallos);
  const propio = canal === "reservas" ? cfg.chat_reservas : canal === "facturas" ? cfg.chat_facturas : cfg.chat_resumenes;
  return chatLimpio(propio) ?? chatLimpio(cfg.chat_id);
}

/** Los chats distintos a los que se manda algo, con los canales que recibe cada uno (para la prueba). */
export function destinos(cfg: Parameters<typeof chatDe>[0]): { chat: string; canales: Canal[] }[] {
  const porChat = new Map<string, Canal[]>();
  for (const c of CANALES) {
    const chat = chatDe(cfg, c);
    if (chat) porChat.set(chat, [...(porChat.get(chat) ?? []), c]);
  }
  return [...porChat.entries()].map(([chat, canales]) => ({ chat, canales }));
}

/** Texto de la prueba de un chat: qué canales llegarán ahí. */
export function textoPrueba(canales: Canal[]): string {
  const nombres = canales.map((c) => NOMBRE_CANAL[c]);
  const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}` : nombres[0] ?? "";
  return `✅ Prueba de avisos de Casa Tomás. Aquí llegará: ${lista}.`;
}

export interface EstadoRevision {
  n: number;
  dia: string;
}

/** Lo que el panel sabe de una reserva (para no mandar nombres ni avisar de lo que aún no vale). */
export interface ReservaInfo {
  id: string;
  fecha: string;
  hora: string | null;
  numero_comensales: number | null;
  canal: string | null;
  estado: string;
  cancelada_por?: string | null;
}

/** Datos de fuera de los avisos que hacen falta para decidir y escribir. */
export interface ContextoAvisos {
  /** Reservas por id (referencia_id del aviso). Sin él no se filtra por estado y se quita el nombre del texto. */
  reservas?: Map<string, ReservaInfo> | null;
  /** «Por revisar» ya mandado (config.resumen_revision). */
  revision?: Record<string, EstadoRevision> | null;
  /** Canales con chat: los avisos de un canal sin chat no se consideran (ni se dan por consumidos). */
  canales?: ReadonlySet<CanalAviso> | null;
  /** Avisos ya enviados al momento (no se repiten en el resumen). */
  enviados?: ReadonlySet<string> | null;
  /** Resumen diario: reservas vivas de hoy en adelante (para «hoy / mañana» y las peticiones por aceptar). */
  proximas?: ReservaInfo[] | null;
  /** Resumen diario del día del semanal: las cifras del semanal, que van dentro del mismo mensaje. */
  semanal?: DatosSemanales | null;
}

export interface Aviso {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  referencia_tipo: string | null;
  referencia_id?: string | null;
  created_at: string;
  caduca_en?: string | null;
  datos?: Record<string, unknown> | null;
}

export interface Envio {
  aviso_id: string | null;
  ok: boolean;
}

/** Nombre de cada tipo de aviso (mismas etiquetas que src/lib/avisos.ts y src/lib/facturas/alertas.ts). */
export const ETIQUETA_TIPO: Record<string, string> = {
  reserva_nueva: "Reservas nuevas",
  reserva_cancelada: "Reservas canceladas",
  solicitud_pendiente: "Solicitudes sin resolver",
  facturas_subida: "Subidas de facturas",
  subida_precio: "Subidas de precio (producto)",
  original_sin_drive: "Originales sin Drive",
  facturas_precio_sube: "Suben de precio",
  facturas_precio_mejor: "Más barato en otro proveedor",
  facturas_familia_gasto: "Gasto alto de una familia",
  facturas_albaran_sin_factura: "Albaranes sin factura",
  facturas_proveedor_nuevo: "Proveedores nuevos",
  facturas_importe_inusual: "Importes inusuales",
  facturas_revision: "Por revisar",
  facturas_precio_baja: "Bajan de precio",
  facturas_precio_proveedor: "Un proveedor sube varias cosas",
  facturas_precio_pactado: "Precio pactado roto",
  facturas_abreviatura: "Abreviaturas por confirmar",
  peticion_urgente: "Peticiones urgentes",
  reserva_modificada: "Reservas modificadas",
  facturas_margen_bajo: "Margen bajo",
  instagram_encargo: "Encargos de Instagram",
  sistema: "Sistema",
};

export const etiquetaTipo = (tipo: string): string => ETIQUETA_TIPO[tipo] ?? tipo.replace(/_/g, " ");

/** Emoji de cada tipo: abre la línea del aviso y la del resumen. */
export const EMOJI_TIPO: Record<string, string> = {
  reserva_nueva: "🟢",
  reserva_cancelada: "🔴",
  reserva_modificada: "🟠",
  solicitud_pendiente: "🟡",
  facturas_margen_bajo: "⚠️",
  facturas_precio_sube: "📈",
  subida_precio: "📈",
  facturas_precio_proveedor: "📈",
  facturas_precio_baja: "📉",
  facturas_precio_mejor: "💡",
  facturas_precio_pactado: "📌",
  facturas_familia_gasto: "💸",
  facturas_albaran_sin_factura: "🧾",
  facturas_proveedor_nuevo: "🆕",
  facturas_importe_inusual: "❗",
  facturas_revision: "📋",
  facturas_subida: "📤",
  original_sin_drive: "📁",
  facturas_abreviatura: "🔤",
  peticion_urgente: "🚨",
  instagram_encargo: "📸",
  sistema: "ℹ️",
};
export const emojiTipo = (tipo: string): string => EMOJI_TIPO[tipo] ?? "🔔";

/** Tipos que nunca van a Telegram: retirados y los técnicos de super admin (modelos de IA). */
export const tipoExcluido = (tipo: string): boolean => tipo === "reserva_sin_asignar" || tipo.startsWith("ia_modelo");

/** Hora (0–23) en Madrid. */
export function horaMadrid(fecha: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hourCycle: "h23" }).format(fecha);
  return Number(h) % 24;
}

/** Día (AAAA-MM-DD) en Madrid. */
export function diaMadrid(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

/** ¿Es hora de silencio? desde = hasta → nunca. Igual que avisos_telegram_en_silencio (SQL). */
export function enSilencio(hora: number, desde: number, hasta: number): boolean {
  if (desde === hasta) return false;
  if (desde > hasta) return hora >= desde || hora < hasta;
  return hora >= desde && hora < hasta;
}

export function silencioAhora(cfg: Pick<ConfigTelegram, "silencio_activo" | "silencio_desde" | "silencio_hasta">, ahora: Date): boolean {
  return cfg.silencio_activo && enSilencio(horaMadrid(ahora), cfg.silencio_desde, cfg.silencio_hasta);
}

const campanaApagada = (a: Aviso): boolean => a.datos?.campana === false;
/**
 * 25/11/2026 (dueño: «cuando se suba … si ha subido el precio … se tiene que enviar»): las subidas de precio van a
 * Telegram aunque no suenen en la campana (impacto pequeño o agrupadas por proveedor). Misma regla que
 * avisos_telegram_hay_pendientes (SQL, 20261222100000).
 */
export const AVISA_SIEMPRE = ["facturas_precio_sube"];
const campanaApagadaTelegram = (a: Aviso): boolean => campanaApagada(a) && !AVISA_SIEMPRE.includes(a.tipo);
const esReserva = (a: Aviso): boolean => TIPOS_RESERVA.includes(a.tipo);

/** Día siguiente (AAAA-MM-DD) de un día AAAA-MM-DD. */
function diaSiguiente(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Días enteros entre dos AAAA-MM-DD (b − a). */
function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Motivo por el que un aviso de precio no es de fiar (null si está bien): si el precio nuevo y el de
 * comparación se llevan ≥ RATIO_UNIDADES (p. ej. «1,58 € → 70 €» en una hueva de mújol), casi seguro se
 * comparan unidades distintas o la lectura es mala. No se manda a Telegram; en el panel sigue.
 */
export function motivoSospechoso(a: Aviso): string | null {
  const pares: [string, string][] =
    a.tipo === "facturas_margen_bajo" ? [["coste", "coste_antes"], ["eur", "eur_antes"]]
    : a.tipo === "facturas_precio_sube" || a.tipo === "facturas_precio_baja" ? [["precio", "precio_ref"]]
    : a.tipo === "facturas_precio_mejor" ? [["precio", "precio_otro"]]
    : [];
  for (const [k1, k2] of pares) {
    const x = numero(a.datos?.[k1]);
    const y = numero(a.datos?.[k2]);
    if (x !== null && y !== null && x > 0 && y > 0 && (x / y >= RATIO_UNIDADES || y / x >= RATIO_UNIDADES)) {
      return `unidades dudosas (${k1} ${x} frente a ${y})`;
    }
  }
  return null;
}

/** Avisos del panel de reservas («Reserva nueva», «Reserva cancelada»…): a Telegram van por avisos_telegram_reservas. */
const esAvisoDeReserva = (tipo: string): boolean => tipo.startsWith("reserva_");

export interface Evaluacion {
  enviar: Aviso[];
  /** Avisos que no se mandarán nunca (se registran como consumidos para no repetir la cuenta cada 5 min). */
  descartar: { aviso: Aviso; motivo: string }[];
}

/**
 * Avisos del panel que hay que mandar al momento: tipo marcado, cuyo canal tiene chat, de las últimas 24 h y
 * posteriores a la activación, sin caducar, no excluidos, con campana, sin envío correcto y con menos de MAX_FALLOS
 * fallos. Orden: más antiguo primero. Los de reservas no (van por avisos_telegram_reservas). Misma regla que
 * avisos_telegram_hay_pendientes (SQL), salvo `descartar` (unidades dudosas), que solo conoce esta función.
 */
export function evaluarPendientes(
  avisos: Aviso[], envios: Envio[], cfg: Pick<ConfigTelegram, "tipos_al_momento" | "activo_desde" | "reservas_al_momento">, ahora: Date, ctx: ContextoAvisos = {},
): Evaluacion {
  const desde = Math.max(ahora.getTime() - 24 * 3600_000, cfg.activo_desde ? Date.parse(cfg.activo_desde) : ahora.getTime());
  const enviados = new Set<string>();
  const fallos = new Map<string, number>();
  for (const e of envios) {
    if (!e.aviso_id) continue;
    if (e.ok) enviados.add(e.aviso_id);
    else fallos.set(e.aviso_id, (fallos.get(e.aviso_id) ?? 0) + 1);
  }
  const candidatos = avisos
    .filter((a) => !ctx.canales || ctx.canales.has(canalDeTipo(a.tipo)))
    .filter((a) => !esAvisoDeReserva(a.tipo) && cfg.tipos_al_momento.includes(a.tipo))
    .filter((a) => Date.parse(a.created_at) > desde)
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .filter((a) => !tipoExcluido(a.tipo) && !campanaApagadaTelegram(a))
    .filter((a) => !enviados.has(a.id) && (fallos.get(a.id) ?? 0) < MAX_FALLOS)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const enviar: Aviso[] = [];
  const descartar: Evaluacion["descartar"] = [];
  for (const a of candidatos) {
    const sospechoso = motivoSospechoso(a);
    if (sospechoso) descartar.push({ aviso: a, motivo: `descartado: ${sospechoso}` });
    else enviar.push(a);
  }
  return { enviar, descartar };
}

/** Solo los avisos por mandar (ver evaluarPendientes). */
export function pendientesDeEnvio(
  avisos: Aviso[], envios: Envio[], cfg: Pick<ConfigTelegram, "tipos_al_momento" | "activo_desde" | "reservas_al_momento">, ahora: Date, ctx: ContextoAvisos = {},
): Aviso[] {
  return evaluarPendientes(avisos, envios, cfg, ahora, ctx).enviar;
}

/**
 * Topes contra la inundación: a lo sumo `topes.hora` avisos por hora y `topes.dia` por día (contando lo ya
 * mandado). Lo que sobra no se manda suelto: va en una línea «…y N más, en el panel».
 */
export function aplicarTopes<T>(lista: T[], usados: { hora: number; dia: number }, topes: { hora: number; dia: number }): { enviar: T[]; resto: T[] } {
  const libres = Math.max(0, Math.min(topes.hora - usados.hora, topes.dia - usados.dia));
  return { enviar: lista.slice(0, libres), resto: lista.slice(libres) };
}

/** Topes de cada canal de avisos: Reservas tiene los suyos; Facturas, los configurables (tope_hora y tope_dia). */
export function topesDeCanal(canal: CanalAviso, cfg: Pick<ConfigTelegram, "tope_hora" | "tope_dia">): { hora: number; dia: number } {
  return canal === "reservas" ? { hora: TOPE_RESERVAS_HORA, dia: TOPE_RESERVAS_DIA } : { hora: cfg.tope_hora ?? TOPE_HORA, dia: cfg.tope_dia ?? TOPE_DIA };
}

/** Línea (HTML) para los avisos que no caben por el tope. */
export function notaTope(restantes: number, panelUrl?: string | null): string {
  const url = enlacePanel(panelUrl, "/avisos");
  return `➕ ${restantes} ${restantes === 1 ? "aviso más" : "avisos más"} (demasiados seguidos), en el panel${url ? ` · ${enlaceHtml(url, "Ver")}` : "."}`;
}

// ─── HTML de Telegram ───────────────────────────────────────────────────────
/** Escapa texto para el modo HTML de Telegram (&, < y >). */
export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => esc(s).replace(/"/g, "&quot;");
/** Enlace con un texto corto: la URL no se ve. */
export const enlaceHtml = (url: string, texto: string): string => `<a href="${escAttr(url)}">${esc(texto)}</a>`;
/** El mismo mensaje en texto plano, por si Telegram no acepta el HTML (los enlaces quedan como «texto: url»). */
export function aTextoPlano(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, (_m, url: string, texto: string) => `${texto}: ${url}`)
    .replace(/<\/?(b|i)>/g, "")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Recorta a `max` caracteres (contando como Telegram, en UTF-16) con «…» al final. */
export function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

const limpio = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

const n2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
/** Hasta 2 decimales, sin ceros de sobra: 1,92 · 2 · 2,3. */
const nCorto = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const eur = (v: number) => `${n2.format(v)} €`;
/** Euros sin decimales con miles («3.945 €»): para el resumen. */
const milesEnteros = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" as unknown as boolean });
const eur0 = (v: number) => `${milesEnteros.format(v)} €`;
/** «+10 %» / «−16 %» (signo menos tipográfico). */
const pctConSigno = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${n0.format(Math.abs(v))} %`;

/** «BERBERECHO» → «Berberecho» (los nombres de las facturas vienen a menudo en mayúsculas). */
function frase(s: string): string {
  return /[a-záéíóúñ]/.test(s) ? s : s.charAt(0) + s.slice(1).toLowerCase();
}
/** Recorta por palabras completas («Distribuciones Gastronómicas…»); si la primera ya no cabe, como recortar. */
function recortarPalabras(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max).lastIndexOf(" ");
  return corte > 0 ? `${texto.slice(0, corte).replace(/[\s,;:·-]+$/, "")}…` : recortar(texto, max);
}
/** Nombre de proveedor corto: sin «S.L.», «S.A.U.»…, con mayúsculas solo al principio de cada palabra si venía en MAYÚSCULAS. */
export function proveedorCorto(s: unknown, max = 30): string {
  let p = limpio(s).replace(/[,\s]+(s\.?\s?[alrc]\.?\s?[lu]?\.?\s?u?\.?|sau|slu|c\.?\s?b\.?)$/i, "").trim();
  if (p && !/[a-záéíóúñ]/.test(p)) p = p.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
  return recortarPalabras(p, max);
}
const producto = (s: unknown, max = 40) => recortarPalabras(frase(limpio(s)), max);

/** Precio sugerido para un aviso «Margen bajo» (RPC avisos_precio_sugerido, 20261130160000). */
export interface Sugerencia {
  precio_actual: number | null;
  precio_sugerido: number | null;
  aplicado?: unknown;
}

/** Primera frase de un texto (hasta el primer «. » seguido de mayúscula), recortada a `max`. */
export function primeraFrase(texto: string, max = MAX_LINEA): string {
  const t = limpio(texto);
  // Corta en «. » + Mayúscula que no abre una palabra en MAYÚSCULAS: no ante un nombre en MAYÚSCULAS («… 32,00 €/kg. CASIMIRO PEREZ …»).
  const m = t.match(/^(.+?[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«](?![A-ZÁÉÍÓÚÑ]{2}))/);
  return recortar(m ? m[1] : t, max);
}

/** ¿Hay un precio sugerido que se pueda aplicar (y no se ha aplicado ya)? */
export const sugerenciaAplicable = (s: Sugerencia | null | undefined): s is Sugerencia & { precio_sugerido: number } =>
  !!s && typeof s.precio_sugerido === "number" && s.precio_sugerido > 0 && !s.aplicado;

const CANALES_RESERVA: Record<string, string> = { web: "web", telefono: "teléfono", manual: "manual", presencial: "en el local" };

/** «hoy», «mañana» o «jue 20/11» (Madrid). */
function cuandoReserva(fecha: string, ahora: Date): string {
  const hoy = diaMadrid(ahora);
  if (fecha === hoy) return "hoy";
  if (fecha === diaSiguiente(hoy)) return "mañana";
  const [y, m, d] = fecha.split("-").map(Number);
  const dia = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short" }).format(new Date(Date.UTC(y, m - 1, d))).replace(".", "");
  return `${dia} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/**
 * Línea de una reserva SIN nombre ni teléfono del cliente (los avisos del panel los llevan; a Telegram no).
 *   nueva:     «Reserva hoy 21:00 · 4 pax · web»
 *   cancelada: «Cancelada mañana 14:00 · 2 pax · la canceló el cliente»
 * Sin los datos de la reserva, se quita el nombre del texto del aviso («Nombre · 12/11 15:00 · 8 pers. · web»).
 */
export function lineaReserva(a: Aviso, r: ReservaInfo | null | undefined, ahora: Date): string {
  const cancelada = a.tipo === "reserva_cancelada";
  const base = cancelada ? "Cancelada" : "Reserva";
  if (r) {
    const hora = (r.hora ?? "").slice(0, 5);
    const partes = [
      `${base} ${cuandoReserva(r.fecha, ahora)}${hora ? ` ${hora}` : ""}`,
      `${r.numero_comensales ?? "?"} pax`,
      ...(cancelada ? (r.cancelada_por === "cliente" ? ["la canceló el cliente"] : []) : [CANALES_RESERVA[r.canal ?? ""]].filter(Boolean)),
    ];
    return partes.join(" · ");
  }
  const partes = limpio(a.mensaje).split(" · ").slice(1).filter((x) => !/^la cancel/.test(x));
  return partes.length ? `${base}: ${partes.join(" · ")}` : base;
}

/** Opciones de las líneas: ahora (para «hoy»/«mañana») y las reservas conocidas. */
export interface OpcionesLinea extends ContextoAvisos {
  ahora?: Date;
}

/** «Margen bajo» en una línea: el artículo, la cifra frente al límite y, si hay, el precio que lo arregla. */
function lineaMargen(d: Record<string, unknown>, sug: Sugerencia | null | undefined): string | null {
  const valor = numero(d.valor);
  const limite = numero(d.limite);
  const nombre = recortar(limpio(d.nombre), 50);
  if (valor === null || limite === null || !nombre) return null;
  const arreglo = sugerenciaAplicable(sug) ? ` → súbelo a ${eur(sug.precio_sugerido)}` : "";
  if (d.canal === "plato") {
    const antes = numero(d.eur_antes);
    const ahora = numero(d.eur);
    const prod = producto(d.producto, 30);
    const sube = !arreglo && prod && antes !== null && ahora !== null && ahora > antes ? ` · sube ${prod} (${n2.format(antes)} → ${eur(ahora)})` : "";
    return `${nombre}: coste ${n0.format(valor)} % (máx. ${n0.format(limite)} %)${arreglo}${sube}`;
  }
  if (d.canal === "vino" || d.canal === "tienda" || d.canal === "peso") {
    const coste = numero(d.coste);
    const antes = numero(d.coste_antes);
    const cuesta = !arreglo && coste !== null
      ? ` · coste ${eur(coste)}${d.canal === "peso" ? "/kg" : ""}${antes !== null ? ` (antes ${n2.format(antes)})` : ""}`
      : "";
    return `${nombre}: cobras ×${nCorto.format(valor)} (mín. ×${nCorto.format(limite)})${d.canal === "tienda" ? " en tienda" : ""}${arreglo}${cuesta}`;
  }
  return null;
}

const medidaDe = (d: Record<string, unknown>): string => (typeof d.medida === "string" && /^(kg|l|ud|caja)$/.test(d.medida) ? `/${d.medida}` : "");

/** Variación en % de un aviso de precio (la guardada o, si no, la calculada). */
function variacion(d: Record<string, unknown>): number | null {
  const v = numero(d.variacion_pct);
  if (v !== null) return v;
  const p = numero(d.precio);
  const r = numero(d.precio_ref);
  return p !== null && r !== null && r > 0 ? ((p - r) / r) * 100 : null;
}

/** Línea propia de los avisos de Facturas con datos conocidos; null → la genérica (título). */
function lineaFacturas(a: Aviso, d: Record<string, unknown>, sug: Sugerencia | null | undefined): string | null {
  switch (a.tipo) {
    case "facturas_margen_bajo":
      return lineaMargen(d, sug);
    case "facturas_precio_sube":
    case "facturas_precio_baja": {
      const prod = producto(d.producto);
      const precio = numero(d.precio);
      const ref = numero(d.precio_ref);
      const pct = variacion(d);
      if (!prod || precio === null || ref === null || pct === null) return null;
      const prov = proveedorCorto(d.proveedor);
      return `${prod}: ${pctConSigno(pct)} (${n2.format(ref)} → ${eur(precio)}${medidaDe(d)})${prov ? ` · ${prov}` : ""}`;
    }
    case "facturas_precio_mejor": {
      const prod = producto(d.producto);
      const otro = proveedorCorto(d.proveedor_otro);
      const precio = numero(d.precio);
      const precioOtro = numero(d.precio_otro);
      if (!prod || !otro || precio === null || precioOtro === null) return null;
      const pct = numero(d.diferencia_pct);
      return `${prod}: ${otro} a ${eur(precioOtro)}${medidaDe(d)} (tú ${n2.format(precio)}${pct !== null ? `, −${n0.format(pct)} %` : ""})`;
    }
    case "facturas_precio_proveedor": {
      const prov = proveedorCorto(d.proveedor);
      const n = numero(d.productos);
      if (!prov || n === null) return null;
      const pct = numero(d.variacion_pct);
      const impacto = numero(d.impacto_mes);
      const extras = [pct !== null ? `${pctConSigno(pct)} de media` : null, impacto !== null && impacto > 0 ? `~${eur0(impacto)}/mes` : null].filter(Boolean);
      return `${prov} sube ${n} productos${extras.length ? ` (${extras.join(", ")})` : ""}`;
    }
    case "facturas_familia_gasto": {
      const fam = limpio(d.familia);
      const pct = numero(d.variacion_pct);
      if (!fam || pct === null) return null;
      const valor = numero(d.valor);
      const media = numero(d.media);
      return `${fam}: ${pctConSigno(pct)} este mes${valor !== null && media !== null ? ` (~${eur0(valor)}, media ${eur0(media)})` : ""}`;
    }
    case "facturas_albaran_sin_factura": {
      const prov = proveedorCorto(d.proveedor, 34);
      const n = numero(d.albaranes);
      if (!prov || n === null) return null;
      const imp = numero(d.importe);
      return `${prov}: ${n} ${n === 1 ? "albarán" : "albaranes"} sin factura${imp !== null ? ` (${eur(imp)})` : ""}`;
    }
    case "facturas_proveedor_nuevo": {
      const prov = proveedorCorto(d.proveedor, 34);
      if (!prov) return null;
      const imp = numero(d.importe);
      return `Proveedor nuevo: ${prov}${imp !== null ? ` (${eur(imp)})` : ""}`;
    }
    case "facturas_importe_inusual": {
      const prov = proveedorCorto(d.proveedor);
      const imp = numero(d.importe);
      if (!prov || imp === null) return null;
      const veces = numero(d.veces);
      return `${prov}: factura de ${eur(imp)}${veces !== null ? ` (×${nCorto.format(veces)} su media)` : ""}`;
    }
    case "facturas_revision": {
      const n = numero(d.cuantos);
      if (n === null) return null;
      return `${milesEnteros.format(n)} documentos ${d.resumen === "duplicados" ? "posiblemente duplicados" : "por revisar"}`;
    }
    default:
      return null;
  }
}

/**
 * Un aviso en UNA línea (sin el emoji): qué ha pasado, con la cifra que importa y, si se sabe, qué hacer.
 *   «Chuletón: coste 41 % (máx. 35 %) → súbelo a 24,50 €»
 *   «Berberecho: +10 % (29,00 → 32,00 €/ud) · Casimiro Perez Rodriguez»
 *   «Reserva hoy 21:00 · 4 pax · web»
 * Sin datos para una línea propia, el título del aviso (o la primera frase de su texto).
 */
export function lineaAviso(a: Aviso, op: OpcionesLinea & { sug?: Sugerencia | null } = {}): string {
  // Datos personales: nunca el texto del aviso de una reserva o solicitud (lleva nombre y teléfono del cliente).
  if (esReserva(a)) return recortar(lineaReserva(a, a.referencia_id ? op.reservas?.get(a.referencia_id) : null, op.ahora ?? new Date()), MAX_LINEA);
  if (a.tipo === "solicitud_pendiente") return recortar(limpio(a.titulo) || etiquetaTipo(a.tipo), MAX_LINEA);
  const propia = a.datos ? lineaFacturas(a, a.datos, op.sug) : null;
  if (propia) return recortar(propia, MAX_LINEA);
  const titulo = limpio(a.titulo);
  if (titulo) return recortar(titulo, MAX_LINEA);
  const texto = limpio(a.datos?.texto_telegram) || limpio(a.mensaje);
  return texto ? primeraFrase(texto) : etiquetaTipo(a.tipo);
}

/** Ruta del panel para aplicar el precio sugerido de un aviso (pide sesión y permiso de carta). */
export const rutaAplicarPrecio = (avisoId: string) => `/aplicar-precio/${encodeURIComponent(avisoId)}`;

/** Ruta del panel para un aviso (subconjunto de rutaDeAviso en src/lib/avisos.ts). */
export function rutaPanel(a: Pick<Aviso, "tipo" | "referencia_tipo" | "datos">): string {
  const enlace = typeof a.datos?.enlace === "string" ? a.datos.enlace : null;
  if (enlace && enlace.startsWith("?") && (a.tipo.startsWith("facturas_") || a.referencia_tipo === "facturas_alerta")) return `/facturas${enlace}`;
  if (enlace && enlace.startsWith("/facturas")) return enlace;
  if (a.tipo === "reserva_nueva" || a.tipo === "reserva_cancelada") return "/reservas?tab=reservas";
  if (a.tipo === "solicitud_pendiente") return "/reservas?tab=reservas&status=solicitudes";
  return "/avisos";
}

/** URL absoluta del panel, o null si no hay PANEL_URL válida. */
export function enlacePanel(base: string | null | undefined, ruta: string): string | null {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/i.test(b)) return null;
  return `${b}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;
}

/**
 * Texto (HTML) de un aviso suelto (al momento): una línea con emoji y, al final, el enlace con un texto corto solo si
 * sirve para actuar («Abrir»; con un precio sugerido aplicable, «Aplicar precio»).
 */
export function mensajeAviso(a: Aviso, panelUrl?: string | null, sug?: Sugerencia | null, op: OpcionesLinea = {}): string {
  const linea = `${emojiTipo(a.tipo)} ${esc(lineaAviso(a, { ...op, sug }))}`;
  if (canalDeTipo(a.tipo) === "reservas") return linea;
  const aplicar = a.tipo === "facturas_margen_bajo" && sugerenciaAplicable(sug) ? enlacePanel(panelUrl, rutaAplicarPrecio(a.id)) : null;
  const url = aplicar ?? enlacePanel(panelUrl, rutaPanel(a));
  return url ? `${linea} · ${enlaceHtml(url, aplicar ? "Aplicar precio" : "Abrir")}` : linea;
}

/**
 * Agrupa textos en mensajes de hasta `max` caracteres, separados por `sep` (una línea por aviso; una línea en blanco
 * entre los avisos de reserva, que ocupan dos). Devuelve qué índices van en cada mensaje (para registrar cada envío).
 */
export function agruparEnMensajes(textos: string[], max = LIMITE_TELEGRAM, sep = "\n"): { texto: string; indices: number[] }[] {
  const salida: { texto: string; indices: number[] }[] = [];
  for (let i = 0; i < textos.length; i++) {
    const t = recortar(textos[i], max);
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.texto.length + sep.length + t.length <= max) {
      ultimo.texto += `${sep}${t}`;
      ultimo.indices.push(i);
    } else {
      salida.push({ texto: t, indices: [i] });
    }
  }
  return salida;
}

// ─── Reservas: un aviso por paso (23/11/2026) ───────────────────────────────

/** Un paso de una reserva (tabla avisos_telegram_reservas, 20261217100000). */
export interface PasoReserva {
  id: number;
  reserva_id: string;
  evento: string;
  quien: string | null;
  estado: string | null;
  created_at: string;
}

/** Ruta del panel donde se aceptan las peticiones (Reservas › Avisos). */
export const RUTA_ACEPTAR = "/reservas?avisos=reservas";

/**
 * Agrupa los pasos por reserva, en el orden en que llegaron: una línea por reserva con su último paso (si en la
 * misma vuelta llegan «nueva» y «aceptada», sale una sola línea «Aceptada · …, reserva nueva»).
 */
export function agruparPasos(pasos: PasoReserva[]): { reserva_id: string; ultimo: PasoReserva; ids: number[]; nueva: boolean }[] {
  const porReserva = new Map<string, PasoReserva[]>();
  for (const p of [...pasos].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)) {
    porReserva.set(p.reserva_id, [...(porReserva.get(p.reserva_id) ?? []), p]);
  }
  return [...porReserva.entries()].map(([reserva_id, l]) => ({
    reserva_id, ultimo: l[l.length - 1], ids: l.map((p) => p.id), nueva: l.some((p) => p.evento === "nueva"),
  }));
}

/** «mar 24/11 14:00 · 4 pax · web» (sin nombre ni teléfono del cliente). */
export function detalleReserva(r: ReservaInfo, ahora: Date): string {
  const hora = (r.hora ?? "").slice(0, 5);
  return [`${cuandoReserva(r.fecha, ahora)}${hora ? ` ${hora}` : ""}`, `${r.numero_comensales ?? "?"} pax`, CANALES_RESERVA[r.canal ?? ""]]
    .filter(Boolean).join(" · ");
}

/**
 * Aviso (HTML) del paso de una reserva, con su estado de ahora, en dos líneas (qué pasa / cuándo y cuántos):
 *   «🟡 Petición de reserva · por aceptar» / «mar 24/11 14:00 · 4 pax · web · Aceptar»
 *   «✅ Aceptada · falta que confirme el cliente» / «vie 27/11 15:30 · 6 pax · web»
 *   «🟢 Confirmada por el cliente» / «vie 27/11 15:30 · 6 pax · web»
 *   «🔴 Cancelada por el cliente» / «vie 27/11 22:00 · 2 pax · web»
 */
export function lineaPasoReserva(
  g: { ultimo: PasoReserva; nueva: boolean }, r: ReservaInfo | null | undefined, ahora: Date, panelUrl?: string | null,
): string {
  const estado = r?.estado ?? g.ultimo.estado ?? "";
  const quien = g.ultimo.quien;
  let emoji = "🔔";
  let titulo = "Reserva";
  let nota = "";
  let aceptar = false;
  switch (g.ultimo.evento) {
    case "nueva":
      if (estado === "pendiente") {
        [emoji, titulo, nota, aceptar] = ["🟡", "Petición de reserva", "por aceptar", true];
      } else {
        [emoji, titulo, nota] = ["🆕", "Reserva nueva", estado === "confirmada" ? "ya confirmada" : estado === "cancelada" ? "ya cancelada" : "ya aceptada"];
      }
      break;
    case "aceptada":
      [emoji, titulo] = ["✅", "Aceptada"];
      nota = estado === "verificada" ? "falta que confirme el cliente" : estado === "confirmada" ? "ya confirmada" : "";
      break;
    case "confirmada":
      [emoji, titulo] = ["🟢", quien === "cliente" ? "Confirmada por el cliente" : "Confirmada desde el panel"];
      break;
    case "cancelada":
      [emoji, titulo] = ["🔴", quien === "cliente" ? "Cancelada por el cliente" : quien === "restaurante" ? "Cancelada por el restaurante" : "Cancelada"];
      break;
  }
  if (g.nueva && g.ultimo.evento !== "nueva") nota = ["reserva nueva", nota].filter(Boolean).join(", ");
  const url = aceptar ? enlacePanel(panelUrl, RUTA_ACEPTAR) : null;
  const primera = `${emoji} <b>${esc(titulo)}</b>${nota ? ` · ${esc(nota)}` : ""}`;
  const segunda = [r ? esc(detalleReserva(r, ahora)) : "reserva borrada", ...(url ? [enlaceHtml(url, "Aceptar")] : [])].join(" · ");
  return `${primera}\n${segunda}`;
}

/** «lunes 23/11» en Madrid. */
function fechaLarga(fecha: Date): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, weekday: "long", day: "2-digit", month: "2-digit" }).format(fecha).replace(",", "");
}

/** «23/11» en Madrid. */
function diaMes(fecha: Date): string {
  const d = diaMadrid(fecha);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) en Madrid. */
export function diaSemanaMadrid(fecha: Date): number {
  const d = new Date(`${diaMadrid(fecha)}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// ─── Resumen diario ─────────────────────────────────────────────────────────

export interface Resumen {
  /** HTML. Vacío si no hay nada que contar: entonces no se manda mensaje. */
  texto: string;
  /** Avisos del panel contados (sin las reservas). */
  total: number;
  /** «Por revisar» al terminar este resumen (para guardarlo en config.resumen_revision si se envía). */
  revision: Record<string, EstadoRevision>;
  /** Lleva dentro el semanal (para apuntar semanal_ultimo_dia si se envía). */
  conSemanal: boolean;
}

/** Clase de un aviso «Por revisar»: avisos de lectura o duplicados. */
const claseRevision = (a: Aviso): string => (typeof a.datos?.resumen === "string" && a.datos.resumen ? a.datos.resumen : "avisos");

/**
 * ¿Entra el «Por revisar» en el resumen? La primera vez; si el número ha cambiado en CAMBIO_REVISION documentos o más;
 * o si hace DIAS_REVISION días o más que no se manda. Así no repite cada día «190 documentos por revisar».
 */
export function incluirRevision(cuantos: number | null, previo: EstadoRevision | undefined, hoy: string): boolean {
  if (!previo) return true;
  if (diasEntre(previo.dia, hoy) >= DIAS_REVISION) return true;
  return cuantos !== null && Math.abs(cuantos - previo.n) >= CAMBIO_REVISION;
}

/** Un caso en pocas palabras para la línea de su tipo en el resumen («Chuletón 41 %», «Makro 340 €»). */
export function casoCorto(a: Aviso, op: OpcionesLinea = {}): string {
  const d = a.datos ?? {};
  if (esReserva(a)) {
    const r = a.referencia_id ? op.reservas?.get(a.referencia_id) : null;
    if (r) return `${cuandoReserva(r.fecha, op.ahora ?? new Date())}${r.hora ? ` ${r.hora.slice(0, 5)}` : ""} (${r.numero_comensales ?? "?"} pax)`;
    return recortar(lineaReserva(a, null, op.ahora ?? new Date()).replace(/^(Reserva|Cancelada):?\s*/, ""), 30) || "sin datos";
  }
  const pct = variacion(d);
  const imp = numero(d.importe);
  switch (a.tipo) {
    case "facturas_margen_bajo": {
      const v = numero(d.valor);
      const nombre = recortarPalabras(limpio(d.nombre), 32);
      if (nombre && v !== null) return d.canal === "plato" ? `${nombre} ${n0.format(v)} %` : `${nombre} ×${nCorto.format(v)}`;
      break;
    }
    case "facturas_precio_sube":
    case "facturas_precio_baja":
      if (limpio(d.producto) && pct !== null) return `${producto(d.producto, 32)} ${pctConSigno(pct)}`;
      break;
    case "facturas_precio_mejor":
      if (limpio(d.producto) && numero(d.diferencia_pct) !== null) return `${producto(d.producto, 32)} −${n0.format(numero(d.diferencia_pct) as number)} %`;
      break;
    case "facturas_precio_proveedor":
      if (limpio(d.proveedor)) return `${proveedorCorto(d.proveedor)}${numero(d.productos) !== null ? ` (${numero(d.productos)})` : ""}`;
      break;
    case "facturas_familia_gasto":
      if (limpio(d.familia) && pct !== null) return `${recortarPalabras(limpio(d.familia), 32)} ${pctConSigno(pct)}`;
      break;
    case "facturas_albaran_sin_factura":
    case "facturas_importe_inusual":
    case "facturas_proveedor_nuevo":
      if (limpio(d.proveedor)) return `${proveedorCorto(d.proveedor)}${imp !== null ? ` ${eur0(imp)}` : ""}`;
      break;
  }
  // Sin datos propios: el título, sin repetir el nombre del tipo («Petición urgente: No imprime…» → «No imprime…»).
  const titulo = limpio(a.titulo).replace(/^(petición urgente|subida de precio|precio pactado roto)\s*:\s*/i, "");
  return recortarPalabras(titulo || limpio(a.mensaje) || etiquetaTipo(a.tipo), 48);
}

/** Cuánto importa un aviso para elegir los casos del resumen (mayor = antes). */
function peso(a: Aviso): number {
  const d = a.datos ?? {};
  const v = numero(d.valor);
  const l = numero(d.limite);
  switch (a.tipo) {
    case "facturas_margen_bajo":
      if (v && l) return d.canal === "plato" ? v / l : l / v;
      return 0;
    case "facturas_precio_sube":
    case "facturas_precio_baja":
    case "facturas_precio_proveedor":
      return numero(d.impacto_mes) ?? Math.abs(variacion(d) ?? 0);
    case "facturas_precio_mejor":
      return numero(d.ahorro) ?? numero(d.diferencia_pct) ?? 0;
    case "facturas_familia_gasto":
      return numero(d.variacion_pct) ?? 0;
    default:
      return numero(d.importe) ?? 0;
  }
}

const VIVAS = ["pendiente", "verificada", "confirmada"];

/** «4 reservas (14 pax)» o «sin reservas». */
const cuentaReservas = (l: ReservaInfo[]): string =>
  l.length ? `${l.length} ${l.length === 1 ? "reserva" : "reservas"} (${l.reduce((s, r) => s + (r.numero_comensales ?? 0), 0)} pax)` : "sin reservas";

/** Máximo de elementos en cada lista del resumen (el resto, «• y N más»). */
const MAX_LISTA = 5;

/** Sección del resumen: título en negrita (con su cifra) y, debajo, una lista con «•». */
function seccion(titulo: string, items: string[] = [], extra = ""): string {
  return [`<b>${titulo}</b>${extra}`, ...items.map((x) => `• ${x}`)].join("\n");
}

/**
 * Secciones de reservas del resumen (HTML): las de hoy y mañana, y las peticiones por aceptar de cualquier fecha con
 * el enlace para aceptarlas. Vacío si no hay ninguna reserva viva de hoy en adelante.
 */
export function bloqueReservas(proximas: ReservaInfo[] | null | undefined, ahora: Date, panelUrl?: string | null): string[] {
  const hoy = diaMadrid(ahora);
  const manana = diaSiguiente(hoy);
  const vivas = (proximas ?? []).filter((r) => VIVAS.includes(r.estado) && r.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora ?? "").localeCompare(b.hora ?? ""));
  if (vivas.length === 0) return [];
  const bloques = [
    [`<b>📅 Reservas</b>`, `Hoy: ${cuentaReservas(vivas.filter((r) => r.fecha === hoy))}`, `Mañana: ${cuentaReservas(vivas.filter((r) => r.fecha === manana))}`].join("\n"),
  ];
  const pend = vivas.filter((r) => r.estado === "pendiente");
  if (pend.length) {
    const url = enlacePanel(panelUrl, RUTA_ACEPTAR);
    const items = pend.slice(0, MAX_LISTA).map((r) => esc(`${cuandoReserva(r.fecha, ahora)}${r.hora ? ` ${r.hora.slice(0, 5)}` : ""} · ${r.numero_comensales ?? "?"} pax`));
    if (pend.length > MAX_LISTA) items.push(`y ${pend.length - MAX_LISTA} más`);
    bloques.push(seccion(`🟡 Peticiones por aceptar: ${pend.length}`, items, url ? ` · ${enlaceHtml(url, "Aceptar")}` : ""));
  }
  return bloques;
}

/**
 * Resumen diario (HTML):
 *   «📊 Resumen · lunes 23/11»
 *   las reservas de hoy y mañana y las peticiones por aceptar;
 *   una línea por tipo de aviso de las últimas 24 h que NO llegó ya al momento (sin los de reservas, excluidos,
 *   caducados, con la campana apagada ni de unidades dudosas), con el número y los CASOS_POR_TIPO más importantes;
 *   «Documentos con avisos sin revisar» (solo si cambia o toca la semana);
 *   el día del semanal, el semanal dentro («━━ La semana ━━»), y entonces sin la línea de «por revisar»;
 *   cada cosa en su sección: título en negrita con la cifra y, debajo, una lista con «•» (se lee mejor en el móvil);
 *   los enlaces al panel, con texto corto.
 * Sin nada que contar, `texto` va vacío (no se manda «sin avisos»).
 */
export function construirResumen(avisos: Aviso[], ahora: Date, panelUrl?: string | null, ctx: ContextoAvisos = {}): Resumen {
  const desde = ahora.getTime() - 24 * 3600_000;
  const hoy = diaMadrid(ahora);
  const previa = ctx.revision ?? {};
  const revision: Record<string, EstadoRevision> = { ...previa };
  const base = avisos
    .filter((a) => Date.parse(a.created_at) > desde && Date.parse(a.created_at) <= ahora.getTime())
    .filter((a) => !esAvisoDeReserva(a.tipo) && !tipoExcluido(a.tipo) && !campanaApagada(a))
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .filter((a) => !ctx.enviados?.has(a.id))
    .filter((a) => !motivoSospechoso(a))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  // «Por revisar»: solo el más reciente de cada clase, y solo si cambia o toca la semanal.
  const vistos = new Set<string>();
  const lineasRevision: string[] = [];
  const validos = base.filter((a) => {
    if (a.tipo !== "facturas_revision") return true;
    const clase = claseRevision(a);
    if (vistos.has(clase)) return false;
    vistos.add(clase);
    const cuantos = numero(a.datos?.cuantos);
    if (!incluirRevision(cuantos, previa[clase], hoy)) return false;
    const que = clase === "duplicados" ? "Posibles duplicados" : "Documentos con avisos sin revisar";
    if (cuantos !== null) {
      revision[clase] = { n: cuantos, dia: hoy };
      const p = previa[clase];
      const dif = p ? cuantos - p.n : 0;
      lineasRevision.push(seccion(`📋 ${que}: ${milesEnteros.format(cuantos)}`, [], dif ? ` (${dif > 0 ? "+" : "−"}${milesEnteros.format(Math.abs(dif))} desde el ${p!.dia.slice(8, 10)}/${p!.dia.slice(5, 7)})` : ""));
    } else {
      lineasRevision.push(seccion(`📋 ${que}`));
    }
    return true;
  });

  const grupos = new Map<string, Aviso[]>();
  for (const a of validos) if (a.tipo !== "facturas_revision") grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const ordenados = [...grupos.entries()].sort((x, y) => y[1].length - x[1].length || etiquetaTipo(x[0]).localeCompare(etiquetaTipo(y[0]), "es"));
  const lineasTipos = ordenados.map(([tipo, lista]) => {
    const principales = [...lista].sort((x, y) => peso(y) - peso(x) || Date.parse(y.created_at) - Date.parse(x.created_at)).slice(0, CASOS_POR_TIPO);
    const resto = lista.length - principales.length;
    return seccion(`${emojiTipo(tipo)} ${esc(etiquetaTipo(tipo))}: ${lista.length}`, [...principales.map((a) => esc(casoCorto(a))), ...(resto > 0 ? [`y ${resto} más`] : [])]);
  });

  const reservas = bloqueReservas(ctx.proximas, ahora, panelUrl);
  const semanal = ctx.semanal ? bloqueSemanal(ctx.semanal, panelUrl) : null;
  const bloques = [
    ...reservas,
    ...lineasTipos,
    ...(semanal ? [] : lineasRevision),
    ...(semanal ? ["<b>━━ La semana ━━</b>", ...semanal.lineas] : []),
  ];
  if (bloques.length === 0) return { texto: "", total: 0, revision: previa, conSemanal: false };
  const avisosUrl = lineasTipos.length || (lineasRevision.length && !semanal) ? enlacePanel(panelUrl, "/avisos") : null;
  const pie = [...(avisosUrl ? [enlaceHtml(avisosUrl, "Ver avisos")] : []), ...(semanal?.enlaces ?? [])].join(" · ");
  return { texto: componer(`<b>📊 Resumen · ${fechaLarga(ahora)}</b>`, bloques, pie), total: validos.length, revision, conSemanal: !!semanal };
}

/**
 * Cabecera, bloques (separados por una línea en blanco) y pie en ≤ LIMITE_TELEGRAM. Si no cabe todo, mete las líneas
 * que quepan (nunca corta una línea a medias, que podría romper el HTML) y lo dice: «…y más en el panel».
 */
function componer(cabecera: string, bloques: string[], pie: string): string {
  const fin = pie ? `\n\n${pie}` : "";
  const corte = "\n…y más en el panel";
  let cuerpo = cabecera;
  for (const [ib, bloque] of bloques.entries()) {
    const lineas = bloque.split("\n");
    for (const [il, linea] of lineas.entries()) {
      const trozo = `${il === 0 ? "\n\n" : "\n"}${linea}`;
      const ultima = ib === bloques.length - 1 && il === lineas.length - 1;
      if (cuerpo.length + trozo.length + (ultima ? 0 : corte.length) + fin.length > LIMITE_TELEGRAM) return cuerpo + corte + fin;
      cuerpo += trozo;
    }
  }
  return cuerpo + fin;
}

// ─── Resumen semanal para el dueño (lunes por la mañana) ────────────────────

/** Lo que devuelve la RPC avisos_telegram_datos_semanal (20261209400000). */
export interface DatosSemanales {
  vinos?: { limite?: number; bajo?: number; total?: number; peor?: { nombre: string; multiplicador: number }[] };
  tienda?: { activa?: boolean; limite?: number; bajo?: number; total?: number; bajo_coste?: number; peor?: { nombre: string; multiplicador: number }[] };
  facturas?: { documentos?: number; importe?: number; mayores?: { proveedor: string | null; total: number; fecha: string | null }[] };
  albaranes?: { total_n?: number; total_proveedores?: number; total_importe?: number; n?: number; proveedores?: number; importe?: number; mayores?: { proveedor: string | null; importe: number; n: number }[] };
}

/** Los 2 peores, uno por línea y sin cortar el nombre a medias: «Léon Beyer Gewurztraminer 2021 ×1,37». */
const peores = (l: { nombre: string; multiplicador: number }[] | undefined): string[] =>
  (l ?? []).slice(0, 2).map((p) => esc(`${recortarPalabras(limpio(p.nombre), 45)} ×${n2.format(p.multiplicador)}`));

/**
 * Las secciones (HTML) del semanal, cada una con su título y una lista: vinos de la carta y tienda bajo el mínimo (con
 * los 2 peores), facturas por verificar (y la mayor) y albaranes sin factura de más de 35 días (con el total de todos
 * si hay más), y sus enlaces. null si no hay nada que decir. `lineas` son las secciones (se separan con una línea en blanco).
 */
export function bloqueSemanal(d: DatosSemanales, panelUrl?: string | null): { lineas: string[]; enlaces: string[] } | null {
  const lineas: string[] = [];
  let margenes = false;
  let docs = false;
  const v = d.vinos;
  if (v && (v.bajo ?? 0) > 0) {
    margenes = true;
    lineas.push(seccion(`🍷 Vinos con margen bajo: ${v.bajo}${v.total ? ` de ${v.total}` : ""}`, peores(v.peor), ` (mín. ×${nCorto.format(v.limite ?? 2.3)})`));
  }
  const t = d.tienda;
  if (t && t.activa !== false && (t.bajo ?? 0) > 0) {
    margenes = true;
    const items = [...((t.bajo_coste ?? 0) > 0 ? [`${t.bajo_coste} por debajo del coste`] : []), ...peores(t.peor)];
    lineas.push(seccion(`🛒 Tienda con margen bajo: ${t.bajo}${t.total ? ` de ${t.total}` : ""}`, items, ` (mín. ×${nCorto.format(t.limite ?? 1.5)})`));
  }
  const f = d.facturas;
  if (f && (f.documentos ?? 0) > 0) {
    docs = true;
    const mayor = f.mayores?.[0];
    lineas.push(seccion(`📋 Facturas por verificar: ${milesEnteros.format(f.documentos ?? 0)}`, [
      `${eur0(f.importe ?? 0)} en total`,
      ...(mayor ? [esc(`la mayor: ${proveedorCorto(mayor.proveedor) || "sin proveedor"}, ${eur0(mayor.total)}`)] : []),
    ]));
  }
  const al = d.albaranes;
  if (al && (al.n ?? 0) > 0) {
    docs = true;
    const provs = al.proveedores ?? "?";
    lineas.push(seccion(`🧾 Albaranes sin factura (+35 días): ${eur0(al.importe ?? 0)}`, [
      `de ${provs} ${provs === 1 ? "proveedor" : "proveedores"}`,
      ...((al.total_n ?? 0) > (al.n ?? 0) ? [`${al.total_n} en total contando los recientes (${eur0(al.total_importe ?? 0)})`] : []),
    ]));
  }
  if (lineas.length === 0) return null;
  const urlMargenes = margenes ? enlacePanel(panelUrl, "/facturas?tab=margenes") : null;
  const urlDocs = docs ? enlacePanel(panelUrl, "/facturas?tab=compras&modo=documentos") : null;
  return { lineas, enlaces: [urlMargenes && enlaceHtml(urlMargenes, "Márgenes"), urlDocs && enlaceHtml(urlDocs, "Facturas")].filter(Boolean) as string[] };
}

/** Resumen semanal suelto (HTML; cuando no va dentro del diario). Vacío si no hay nada que decir. */
export function construirSemanal(d: DatosSemanales, ahora: Date, panelUrl?: string | null): { texto: string; secciones: number } {
  const b = bloqueSemanal(d, panelUrl);
  if (!b) return { texto: "", secciones: 0 };
  return { texto: componer(`<b>📅 Resumen de la semana · ${diaMes(ahora)}</b>`, b.lineas, b.enlaces.join(" · ")), secciones: b.lineas.length };
}

/** Quita el token de cualquier texto de error (la URL de la API lo lleva). */
export function errorSaneado(texto: string): string {
  return texto.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot…").slice(0, 300);
}

/** Cuerpo de sendMessage, sin vista previa de enlaces: HTML (negritas y enlaces cortos) o texto plano (fallos técnicos). */
export function cuerpoSendMessage(chatId: string, texto: string, html = true): Record<string, unknown> {
  return { chat_id: chatId, text: recortar(texto, LIMITE_TELEGRAM), ...(html ? { parse_mode: "HTML" } : {}), link_preview_options: { is_disabled: true } };
}

export type Accion = "pendientes" | "resumen" | "probar" | "fallos" | "semanal" | "informes" | "cierre";
export const esAccion = (v: unknown): v is Accion =>
  v === "pendientes" || v === "resumen" || v === "probar" || v === "fallos" || v === "semanal" || v === "informes" || v === "cierre";

/**
 * Tipo de la fila de avisos_telegram_envios de cada acción (el CHECK admite 'fallo', no 'fallos'). Los informes
 * mensuales van al chat de Resúmenes y se apuntan como 'resumen' (el CHECK no tiene un tipo propio para ellos).
 */
export const tipoRegistro = (accion: Accion): string => (accion === "probar" ? "prueba" : accion === "fallos" ? "fallo" : accion === "informes" ? "resumen" : accion);

// ─── Informes mensuales (tarea programada del último jueves, 25/11/2026) ────
export interface EnlaceInforme {
  titulo: string;
  url: string;
}
export interface DatosInformesMensuales {
  /** «AAAA-MM». */
  mes: string;
  carpetaUrl: string | null;
  informes: EnlaceInforme[];
  /** Informes que no tienen datos ese mes (no hay PDF). */
  sinDatos: string[];
  /** Informes que no se pudieron sacar o subir. */
  fallidos: string[];
}

const MESES_TEXTO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** Solo enlaces de Google Drive: el mensaje no puede llevar a otro sitio. */
export const esUrlDrive = (v: unknown): v is string => typeof v === "string" && /^https:\/\/drive\.google\.com\/[A-Za-z0-9/_?=.&-]{1,300}$/.test(v);
const textoCorto = (v: unknown): string => recortar(limpio(v), 90);

/** Valida el cuerpo de la acción «informes» (lo manda la tarea programada). null si no vale. */
export function leerDatosInformes(body: Record<string, unknown>): DatosInformesMensuales | null {
  const mes = typeof body.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.mes) ? body.mes : null;
  if (!mes || !Array.isArray(body.informes)) return null;
  const informes = (body.informes as unknown[])
    .slice(0, 40)
    .map((i) => i as { titulo?: unknown; url?: unknown })
    .filter((i) => textoCorto(i?.titulo) && esUrlDrive(i?.url))
    .map((i) => ({ titulo: textoCorto(i.titulo), url: i.url as string }));
  const lista = (v: unknown) => (Array.isArray(v) ? v.slice(0, 40).map(textoCorto).filter(Boolean) : []);
  return { mes, carpetaUrl: esUrlDrive(body.carpeta_url) ? body.carpeta_url : null, informes, sinDatos: lista(body.sin_datos), fallidos: lista(body.fallidos) };
}

/** El mensaje (HTML) con los enlaces a los PDF del mes en Drive. */
export function mensajeInformes(d: DatosInformesMensuales): string {
  const [anio, m] = d.mes.split("-");
  const lineas = [`📊 <b>Informes de ${MESES_TEXTO[Number(m) - 1]} de ${anio}</b>${d.carpetaUrl ? ` · ${enlaceHtml(d.carpetaUrl, "Carpeta en Drive")}` : ""}`];
  for (const i of d.informes) lineas.push(`• ${enlaceHtml(i.url, i.titulo)}`);
  if (d.informes.length === 0) lineas.push("No se ha podido subir ningún PDF.");
  if (d.sinDatos.length) lineas.push(`⚪ Sin datos este mes: ${esc(d.sinDatos.join(", "))}`);
  if (d.fallidos.length) lineas.push(`⚠️ No se han podido sacar: ${esc(d.fallidos.join(", "))}`);
  return lineas.join("\n");
}

// ─── Facturas: un mensaje por factura y cierre del día (25/11/2026) ─────────
// Petición del dueño: «cuando se suba un aviso, si ha subido el precio, si hay algo que destacar de esa factura, se
// tiene que enviar automáticamente a Telegram con lo que ha pasado de forma explícita y el enlace al Drive de esa
// factura; además, si se trata de marisco o vino (carta a 20 € con IVA, lo compraba a 10 y me lo suben a 15), que me
// diga el precio sugerido con el mismo margen … y que al final del día mande un aviso con el resumen de facturas que
// se han subido ese día. Sencillo, breve, conciso y bien explicado».

/** Tipos de aviso que hablan de UNA factura (datos.factura_id): van juntos en el mensaje de esa factura. */
export const TIPOS_DE_FACTURA = [
  "facturas_precio_sube", "facturas_precio_baja", "facturas_precio_pactado", "facturas_precio_mejor", "facturas_precio_proveedor",
  "facturas_importe_inusual", "facturas_proveedor_nuevo", "facturas_margen_bajo",
];
/** Como mucho estos avisos por mensaje de factura (el resto, «➕ N más en el panel»). */
export const MAX_AVISOS_FACTURA = 12;
/** Como mucho estos platos o vinos con precio sugerido por subida. */
export const MAX_SUGERENCIAS = 3;
/** Minutos que se espera al enlace de Drive de una factura recién subida antes de mandarla sin él. */
export const ESPERA_DRIVE_MIN = 20;
/** Importes con separador de miles también en 4 cifras («1.234,50 €»). */
const nMiles = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" as unknown as boolean });
const eurMiles = (v: number) => `${nMiles.format(v)} €`;
/** Redondeo del precio sugerido: hacia arriba, a 0,50 € (como avisos_precio_sugerido). */
export const PASO_PRECIO = 0.5;
/** Facturas nombradas en el cierre del día (el resto, «y N más»). */
export const MAX_FACTURAS_CIERRE = 8;
/** Casos por tipo de aviso en el cierre del día. */
export const CASOS_CIERRE = 3;

/** Lo que hace falta de una factura (tabla facturas) para su mensaje y para el cierre del día. */
export interface FacturaInfo {
  id: number;
  tipo?: string | null;
  proveedor?: string | null;
  numero_documento?: string | null;
  fecha?: string | null;
  total?: number | string | null;
  drive_url?: string | null;
  /** timestamp sin zona (UTC). */
  created_at?: string | null;
  local?: string | null;
}

const enteroPositivo = (v: unknown): number | null => {
  const x = numero(v);
  return x !== null && Number.isInteger(x) && x > 0 ? x : null;
};

/** Instante de un timestamp de la base; los «timestamp» sin zona son UTC. null si no se entiende. */
export function instanteUtc(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t : null;
}

/** Enlace de Drive del original, o null si no lo hay (o no es de Google Drive). */
export const urlDrive = (v: unknown): string | null =>
  typeof v === "string" && /^https:\/\/(drive|docs)\.google\.com\/\S+$/.test(v.trim()) ? v.trim() : null;

/** Factura de un aviso (datos.factura_id), solo en los tipos que hablan de una factura. */
export const facturaDeAviso = (a: Aviso): number | null => (TIPOS_DE_FACTURA.includes(a.tipo) ? enteroPositivo(a.datos?.factura_id) : null);

/** Un mensaje: los avisos de una factura juntos, o un aviso suelto (factura_id null). */
export interface GrupoAvisos {
  factura_id: number | null;
  avisos: Aviso[];
}

/** Agrupa los avisos por factura, en el orden en que llega el primero de cada una; los que no son de una factura, sueltos. */
export function agruparPorFactura(avisos: Aviso[]): GrupoAvisos[] {
  const salida: GrupoAvisos[] = [];
  const porFactura = new Map<number, GrupoAvisos>();
  for (const a of avisos) {
    const f = facturaDeAviso(a);
    if (f === null) {
      salida.push({ factura_id: null, avisos: [a] });
      continue;
    }
    const g = porFactura.get(f);
    if (g) g.avisos.push(a);
    else {
      const nuevo = { factura_id: f, avisos: [a] };
      porFactura.set(f, nuevo);
      salida.push(nuevo);
    }
  }
  return salida;
}

/** ¿Se espera al enlace de Drive? Solo si la factura aún no lo tiene y se subió hace menos de ESPERA_DRIVE_MIN. */
export function esperarDrive(f: FacturaInfo | null | undefined, ahora: Date): boolean {
  if (!f || urlDrive(f.drive_url)) return false;
  const t = instanteUtc(f.created_at);
  return t !== null && ahora.getTime() - t < ESPERA_DRIVE_MIN * 60_000;
}

// ─── Precio sugerido con el mismo margen (marisco y vino) ───────────────────

/**
 * Precio de carta que mantiene el MISMO margen multiplicativo cuando sube el coste: PVP × coste nuevo / coste anterior,
 * redondeado hacia arriba a `paso`. El PVP de la carta lleva IVA y el coste de la factura no, pero el IVA multiplica
 * igual antes y después, así que el multiplicador sin IVA (venta ÷ coste) queda igual.
 * Ej.: carta 20 € con IVA, lo comprabas a 10 y ahora a 15 → 30 €. null si no sube o los datos no sirven.
 */
export function precioMismoMargen(pvp: number, costeAntes: number, costeAhora: number, paso = PASO_PRECIO): number | null {
  if (!(pvp > 0) || !(costeAntes > 0) || !(costeAhora > costeAntes)) return null;
  const ratio = costeAhora / costeAntes;
  if (ratio >= RATIO_UNIDADES) return null; // casi seguro, unidades distintas
  return Math.round(Math.ceil((pvp * ratio) / paso - 1e-9) * paso * 100) / 100;
}

/** Un vino o plato de la carta (restaurante) que se vende tal cual a partir de un producto de factura. */
export interface ArticuloCarta {
  tipo: "vino" | "plato";
  id: string;
  nombre: string;
  /** PVP con IVA (precio_eur). */
  precio: number;
  /** Vinos: PVP de la copa (precio_copa_eur), si se vende por copas. */
  copa?: number | null;
}

/** La carta de un producto: si es marisco, y los vinos y platos que lo venden tal cual. */
export interface CartaDeProducto {
  marisco: boolean;
  articulos: ArticuloCarta[];
}

/** Filas que lee la función para saber qué vinos y platos venden cada producto. */
export interface FilasCarta {
  productos: { id: number; categoria_id: number | null }[];
  categorias: { id: number; nombre: string }[];
  vinoProducto: { vino_id: string; producto_id: number }[];
  vinos: { id: string; nombre: string; precio_eur: number | string | null; precio_copa_eur?: number | string | null; activado?: boolean | null; restaurante?: boolean | null }[];
  /** Escandallos de los platos que usan alguno de los productos (TODAS sus líneas, para saber si llevan algo más). */
  escandallo: { plato_id: string; producto_id: number | null }[];
  platos: { id: string; nombre: string; precio_eur: number | string | null; activado?: boolean | null; restaurante?: boolean | null }[];
}

/** «Marisco» o «Pescado y marisco» (la familia del propio producto; «Pescado» no). */
export const esFamiliaMarisco = (nombre: string | null | undefined): boolean => /marisco/i.test(nombre ?? "");

/**
 * La carta de cada producto: los vinos enlazados (vino_producto) y los platos cuyo escandallo es SOLO ese producto
 * (marisco al peso o por unidad: «Gamba roja», «Ostras»). Un plato con más ingredientes no: su coste no sube en la
 * misma proporción. Solo lo activo en la carta del restaurante y con precio.
 */
export function cartaPorProducto(f: FilasCarta): Map<number, CartaDeProducto> {
  const categoria = new Map(f.categorias.map((c) => [c.id, c.nombre]));
  const vinos = new Map(f.vinos.filter((v) => v.activado !== false && v.restaurante !== false).map((v) => [v.id, v]));
  const platos = new Map(f.platos.filter((p) => p.activado !== false && p.restaurante !== false).map((p) => [p.id, p]));
  const ingredientes = new Map<string, Set<number>>();
  for (const e of f.escandallo) {
    if (e.producto_id === null) continue;
    ingredientes.set(e.plato_id, (ingredientes.get(e.plato_id) ?? new Set()).add(e.producto_id));
  }
  const salida = new Map<number, CartaDeProducto>();
  for (const p of f.productos) {
    const articulos: ArticuloCarta[] = [];
    for (const vp of f.vinoProducto.filter((x) => x.producto_id === p.id)) {
      const v = vinos.get(vp.vino_id);
      const precio = numero(v?.precio_eur);
      if (v && precio !== null && precio > 0) articulos.push({ tipo: "vino", id: v.id, nombre: limpio(v.nombre), precio, copa: numero(v.precio_copa_eur) });
    }
    for (const [platoId, prods] of ingredientes) {
      if (prods.size !== 1 || !prods.has(p.id)) continue;
      const pl = platos.get(platoId);
      const precio = numero(pl?.precio_eur);
      if (pl && precio !== null && precio > 0) articulos.push({ tipo: "plato", id: pl.id, nombre: limpio(pl.nombre), precio });
    }
    salida.set(p.id, { marisco: esFamiliaMarisco(p.categoria_id !== null ? categoria.get(p.categoria_id) : null), articulos });
  }
  return salida;
}

/** Precio sugerido de un vino o plato tras una subida. */
export interface SugerenciaCarta {
  tipo: "vino" | "plato";
  nombre: string;
  antes: number;
  sugerido: number;
  copa?: { antes: number; sugerido: number } | null;
}

/**
 * Precios sugeridos (mismo margen) de una subida de precio de MARISCO o VINO: los vinos enlazados al producto y, si
 * el producto es marisco, los platos que lo venden tal cual. Vacío en el resto de casos.
 */
export function sugerenciasCarta(a: Aviso, carta: CartaDeProducto | null | undefined): SugerenciaCarta[] {
  if (a.tipo !== "facturas_precio_sube" || !carta || motivoSospechoso(a)) return [];
  const precio = numero(a.datos?.precio);
  const ref = numero(a.datos?.precio_ref);
  if (precio === null || ref === null) return [];
  const salida: SugerenciaCarta[] = [];
  for (const art of carta.articulos) {
    if (art.tipo === "plato" && !carta.marisco) continue;
    const sugerido = precioMismoMargen(art.precio, ref, precio);
    if (sugerido === null) continue;
    const copa = art.copa && art.copa > 0 ? precioMismoMargen(art.copa, ref, precio) : null;
    salida.push({ tipo: art.tipo, nombre: art.nombre, antes: art.precio, sugerido, copa: copa !== null && art.copa ? { antes: art.copa, sugerido: copa } : null });
  }
  return salida.slice(0, MAX_SUGERENCIAS);
}

/** «↳ Gamba roja: carta 28,00 → 36,50 € (mismo margen)» (HTML; vinos con copa: «botella …, copa …»). */
export function lineaSugerencia(s: SugerenciaCarta): string {
  const nombre = esc(recortarPalabras(s.nombre, 40));
  const botella = `${s.copa ? "botella" : "carta"} ${n2.format(s.antes)} → <b>${esc(eur(s.sugerido))}</b>`;
  const copa = s.copa ? `, copa ${n2.format(s.copa.antes)} → <b>${esc(eur(s.copa.sugerido))}</b>` : "";
  return `   ↳ ${nombre}: ${botella}${copa} (mismo margen)`;
}

// ─── Mensaje de una factura ─────────────────────────────────────────────────

const ETIQUETA_DOC: Record<string, string> = { factura: "Factura", albaran: "Albarán", ticket: "Ticket", abono: "Abono" };

/** «dd/mm» de un AAAA-MM-DD. */
const ddmm = (f: unknown): string => (typeof f === "string" && /^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");

/** Cabecera (HTML) de la factura: «🧾 Nicolás y Valero · Factura F-123 del 09/10 · 1.234,56 €». */
export function cabeceraFactura(f: FacturaInfo | null | undefined, avisos: Aviso[] = []): string {
  const d = avisos[0]?.datos ?? {};
  const prov = proveedorCorto(f?.proveedor ?? d.proveedor, 48) || "Proveedor sin nombre";
  const doc = ETIQUETA_DOC[limpio(f?.tipo).toLowerCase()] ?? "Factura";
  const num = limpio(f?.numero_documento);
  const fecha = ddmm(f?.fecha ?? d.fecha);
  const total = numero(f?.total);
  const partes = [`${doc}${num ? ` ${recortar(num, 30)}` : ""}${fecha ? ` del ${fecha}` : ""}`, ...(total !== null ? [eurMiles(total)] : [])];
  return `🧾 <b>${esc(prov)}</b> · ${esc(partes.join(" · "))}`;
}

/**
 * Lo que ha pasado, sin el proveedor (ya va en la cabecera):
 *   «Gamba roja N1 de Alicante: 136,00 → 178,00 €/kg (+31 %)»
 *   «Aceite de oliva: 4,90 €/l, pactado 4,50 € (+9 %)»
 *   «Importe inusual: 1.234,00 € (×3 su media)»
 * El resto, como el aviso suelto (lineaAviso).
 */
export function lineaEnFactura(a: Aviso, sug?: Sugerencia | null): string {
  const d = a.datos ?? {};
  // El nombre del catálogo («Gamba roja N1 de Alicante») va en el título de la subida («… sube un 31 % en …»).
  const delTitulo = a.tipo === "facturas_precio_sube" ? /^(.+?) sube un /.exec(limpio(a.titulo))?.[1] : null;
  const prod = delTitulo ? recortarPalabras(delTitulo, 40) : producto(d.producto);
  const precio = numero(d.precio);
  const ref = numero(d.precio_ref);
  const pct = variacion(d);
  switch (a.tipo) {
    case "facturas_precio_sube":
    case "facturas_precio_baja":
      if (prod && precio !== null && ref !== null && pct !== null) {
        return recortar(`${prod}: ${n2.format(ref)} → ${eur(precio)}${medidaDe(d)} (${pctConSigno(pct)})`, MAX_LINEA);
      }
      break;
    case "facturas_precio_pactado":
      if (prod && precio !== null && ref !== null && pct !== null) {
        return recortar(`${prod}: ${eur(precio)}${medidaDe(d)}, pactado ${eur(ref)} (${pctConSigno(pct)})`, MAX_LINEA);
      }
      break;
    case "facturas_importe_inusual": {
      const imp = numero(d.importe);
      const veces = numero(d.veces);
      if (imp !== null) return `Importe inusual: ${eurMiles(imp)}${veces !== null ? ` (×${nCorto.format(veces)} su media)` : ""}`;
      break;
    }
    case "facturas_proveedor_nuevo":
      return "Proveedor nuevo: primera factura suya";
  }
  return lineaAviso(a, { sug });
}

/** Lo que más importa primero: subidas (la mayor antes), margen bajo y el resto en su orden. */
function ordenEnFactura(a: Aviso): number {
  return a.tipo === "facturas_precio_sube" ? 0 : a.tipo === "facturas_margen_bajo" ? 1 : a.tipo === "facturas_precio_pactado" ? 2 : 3;
}

export interface OpcionesFactura {
  panelUrl?: string | null;
  /** Precio sugerido de los avisos «Margen bajo» (RPC avisos_precio_sugerido), por id de aviso. */
  sugerencias?: Map<string, Sugerencia | null> | null;
  /** La carta de cada producto (para el precio con el mismo margen). */
  carta?: Map<number, CartaDeProducto> | null;
}

/**
 * Mensaje (HTML) de UNA factura con todo lo que hay que destacar de ella:
 *   🧾 Nicolás y Valero · Factura F-123 del 09/10 · 1.234,56 €
 *   📈 Gamba roja N1 de Alicante: 136,00 → 178,00 €/kg (+31 %)
 *      ↳ Gamba roja: carta 28,00 → 36,50 € (mismo margen)
 *   ⚠️ Chuletón: coste 41 % (máx. 35 %) → súbelo a 24,50 € · Aplicar precio
 *   📄 Original en Drive · Abrir en el panel
 */
export function mensajeFactura(f: FacturaInfo | null | undefined, avisos: Aviso[], op: OpcionesFactura = {}): string {
  const lista = [...avisos].sort((x, y) => ordenEnFactura(x) - ordenEnFactura(y) || (variacion(y.datos ?? {}) ?? 0) - (variacion(x.datos ?? {}) ?? 0));
  const lineas: string[] = [cabeceraFactura(f, lista)];
  for (const a of lista.slice(0, MAX_AVISOS_FACTURA)) {
    const sug = op.sugerencias?.get(a.id) ?? null;
    const aplicar = a.tipo === "facturas_margen_bajo" && sugerenciaAplicable(sug) ? enlacePanel(op.panelUrl, rutaAplicarPrecio(a.id)) : null;
    lineas.push(`${emojiTipo(a.tipo)} ${esc(lineaEnFactura(a, sug))}${aplicar ? ` · ${enlaceHtml(aplicar, "Aplicar precio")}` : ""}`);
    const prod = enteroPositivo(a.datos?.producto_id);
    for (const s of sugerenciasCarta(a, prod !== null ? op.carta?.get(prod) : null)) lineas.push(lineaSugerencia(s));
  }
  const resto = lista.length - MAX_AVISOS_FACTURA;
  if (resto > 0) lineas.push(`➕ ${resto} ${resto === 1 ? "aviso más" : "avisos más"} de esta factura, en el panel`);
  const id = f?.id ?? facturaDeAviso(lista[0]);
  const drive = urlDrive(f?.drive_url);
  const panel = id !== null && id !== undefined ? enlacePanel(op.panelUrl, `/facturas?tab=compras&modo=documentos&doc=${id}`) : null;
  const enlaces = [drive ? enlaceHtml(drive, "Original en Drive") : "Original aún sin Drive", panel ? enlaceHtml(panel, "Abrir en el panel") : null];
  lineas.push(`📄 ${enlaces.filter(Boolean).join(" · ")}`);
  return lineas.join("\n");
}

// ─── Cierre del día ─────────────────────────────────────────────────────────

/** Cuántos mensajes de Telegram distintos hay en unos envíos (los avisos de una factura comparten mensaje_id). */
export function mensajesDistintos(envios: { mensaje_id?: number | null }[]): number {
  const ids = new Set<number>();
  let sueltos = 0;
  for (const e of envios) {
    if (typeof e.mensaje_id === "number") ids.add(e.mensaje_id);
    else sueltos++;
  }
  return ids.size + sueltos;
}

/** ¿Es este aviso de hoy (Madrid) y cuenta en el cierre? Facturas y márgenes, sin «por revisar» ni lo dudoso. */
function avisoDelCierre(a: Aviso, hoy: string, ahora: Date): boolean {
  return diaMadrid(new Date(a.created_at)) === hoy && Date.parse(a.created_at) <= ahora.getTime()
    && canalDeTipo(a.tipo) === "facturas" && a.tipo !== "facturas_revision"
    && !tipoExcluido(a.tipo) && !campanaApagadaTelegram(a) && !motivoSospechoso(a)
    && (!a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime());
}

/**
 * Cierre del día (HTML), en el chat de Resúmenes a la hora configurada (cierre_hora, por defecto 22:00 de Madrid):
 *   🌙 Cierre del día · martes 25/11
 *   🧾 Facturas subidas hoy: 3 · 1.530,40 €
 *   • Nicolás y Valero · 912,00 €
 *   …
 *   📈 Suben de precio: 2
 *   • Gamba roja N1 de Alicante +31 %
 *   …
 *   Facturas · Avisos
 * Las facturas subidas hoy (de la mayor a la menor) y los avisos de Facturas y márgenes de hoy, por tipo. Vacío si no
 * hay nada (no se manda).
 */
export function construirCierre(facturas: FacturaInfo[], avisos: Aviso[], ahora: Date, panelUrl?: string | null): { texto: string; facturas: number; avisos: number } {
  const hoy = diaMadrid(ahora);
  const deHoy = facturas.filter((f) => {
    const t = instanteUtc(f.created_at);
    return t !== null && t <= ahora.getTime() && diaMadrid(new Date(t)) === hoy;
  }).sort((a, b) => (numero(b.total) ?? 0) - (numero(a.total) ?? 0));
  const validos = avisos.filter((a) => avisoDelCierre(a, hoy, ahora));
  if (deHoy.length === 0 && validos.length === 0) return { texto: "", facturas: 0, avisos: 0 };

  const bloques: string[] = [];
  const suma = deHoy.reduce((s, f) => s + (numero(f.total) ?? 0), 0);
  const items = deHoy.slice(0, MAX_FACTURAS_CIERRE).map((f) => {
    const doc = limpio(f.tipo).toLowerCase();
    const total = numero(f.total);
    return esc([proveedorCorto(f.proveedor, 34) || "Sin proveedor", ...(doc && doc !== "factura" ? [(ETIQUETA_DOC[doc] ?? doc).toLowerCase()] : []), ...(total !== null ? [eurMiles(total)] : [])].join(" · "));
  });
  if (deHoy.length > MAX_FACTURAS_CIERRE) items.push(`y ${deHoy.length - MAX_FACTURAS_CIERRE} más`);
  bloques.push(seccion(deHoy.length ? `🧾 Facturas subidas hoy: ${deHoy.length} · ${esc(eurMiles(suma))}` : "🧾 Facturas subidas hoy: ninguna", items));

  const grupos = new Map<string, Aviso[]>();
  for (const a of validos) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const ordenados = [...grupos.entries()].sort((x, y) => y[1].length - x[1].length || etiquetaTipo(x[0]).localeCompare(etiquetaTipo(y[0]), "es"));
  for (const [tipo, lista] of ordenados) {
    const principales = [...lista].sort((x, y) => peso(y) - peso(x) || Date.parse(y.created_at) - Date.parse(x.created_at)).slice(0, CASOS_CIERRE);
    const resto = lista.length - principales.length;
    bloques.push(seccion(`${emojiTipo(tipo)} ${esc(etiquetaTipo(tipo))}: ${lista.length}`, [...principales.map((a) => esc(casoCorto(a))), ...(resto > 0 ? [`y ${resto} más`] : [])]));
  }
  if (validos.length === 0) bloques.push("Sin avisos de precios ni márgenes hoy.");

  const urlFacturas = deHoy.length ? enlacePanel(panelUrl, "/facturas?tab=compras&modo=documentos") : null;
  const urlAvisos = validos.length ? enlacePanel(panelUrl, "/avisos") : null;
  const pie = [urlFacturas && enlaceHtml(urlFacturas, "Facturas"), urlAvisos && enlaceHtml(urlAvisos, "Avisos")].filter(Boolean).join(" · ");
  return { texto: componer(`<b>🌙 Cierre del día · ${fechaLarga(ahora)}</b>`, bloques, pie), facturas: deHoy.length, avisos: validos.length };
}
