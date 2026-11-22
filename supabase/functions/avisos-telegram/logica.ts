// ============================================================================
//  avisos-telegram · lógica pura (sin Deno ni red), probada con vitest en
//  supabase/functions/avisos-telegram/__tests__/
// ----------------------------------------------------------------------------
//  22/11/2026 (petición del dueño): cuatro chats, uno por canal, para que uno no se llene con lo de otro
//  (canalDeTipo, chatDe), y mensajes de UNA línea con emoji (lineaAviso). El resumen diario es una línea por
//  tipo con el número y los dos casos principales, sin repetir lo que ya llegó al momento.
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
 * ¿Se debe mandar el aviso de una reserva? Sin nombres de clientes en Telegram (RGPD) y sin ruido:
 *  · «nueva»: espera mientras la reserva sigue pendiente de verificar (el cliente aún no confirmó el correo);
 *    no sale si ya está cancelada o la borraron.
 *  · «cancelada»: no sale si la canceló el restaurante desde el panel (ya lo sabe quien lo hizo).
 * Sin las reservas cargadas (reservas = null) no se filtra nada.
 */
export function visibilidadReserva(a: Aviso, reservas: Map<string, ReservaInfo> | null | undefined): "si" | "espera" | "no" {
  if (!esReserva(a) || !reservas) return "si";
  const r = a.referencia_id ? reservas.get(a.referencia_id) : undefined;
  if (a.tipo === "reserva_nueva") {
    if (!r || r.estado === "cancelada" || r.estado === "no_show") return "no";
    return r.estado === "pendiente" ? "espera" : "si";
  }
  return r?.cancelada_por === "restaurante" ? "no" : "si";
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

/** ¿Cuenta como «al momento»? Tipo marcado, o reserva nueva/cancelada para hoy o mañana (reservas_al_momento). */
function alMomento(a: Aviso, cfg: Pick<ConfigTelegram, "tipos_al_momento" | "reservas_al_momento">, ahora: Date, reservas: Map<string, ReservaInfo> | null | undefined): boolean {
  if (cfg.tipos_al_momento.includes(a.tipo)) return true;
  if (cfg.reservas_al_momento === false || !esReserva(a) || !reservas) return false;
  const r = a.referencia_id ? reservas.get(a.referencia_id) : undefined;
  if (!r) return false;
  const hoy = diaMadrid(ahora);
  return r.fecha === hoy || r.fecha === diaSiguiente(hoy);
}

export interface Evaluacion {
  enviar: Aviso[];
  /** Avisos que no se mandarán nunca (se registran como consumidos para no repetir la cuenta cada 5 min). */
  descartar: { aviso: Aviso; motivo: string }[];
}

/**
 * Avisos que hay que mandar al momento: tipo marcado (o reserva de hoy/mañana), cuyo canal tiene chat, de las
 * últimas 24 h y posteriores a la activación, sin caducar, no excluidos, con campana, sin envío correcto y con
 * menos de MAX_FALLOS fallos. Orden: más antiguo primero. Misma regla que avisos_telegram_hay_pendientes (SQL),
 * salvo `descartar` (unidades dudosas, reservas que no valen), que solo conoce esta función.
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
    .filter((a) => alMomento(a, cfg, ahora, ctx.reservas))
    .filter((a) => Date.parse(a.created_at) > desde)
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .filter((a) => !tipoExcluido(a.tipo) && !campanaApagada(a))
    .filter((a) => !enviados.has(a.id) && (fallos.get(a.id) ?? 0) < MAX_FALLOS)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const enviar: Aviso[] = [];
  const descartar: Evaluacion["descartar"] = [];
  for (const a of candidatos) {
    const sospechoso = motivoSospechoso(a);
    if (sospechoso) {
      descartar.push({ aviso: a, motivo: `descartado: ${sospechoso}` });
      continue;
    }
    const vis = visibilidadReserva(a, ctx.reservas);
    if (vis === "no") descartar.push({ aviso: a, motivo: "descartado: reserva cancelada por el restaurante o ya no válida" });
    else if (vis === "si") enviar.push(a);
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

/** Línea para los avisos que no caben por el tope. */
export function notaTope(restantes: number, panelUrl?: string | null): string {
  const url = enlacePanel(panelUrl, "/avisos");
  return `➕ ${restantes} ${restantes === 1 ? "aviso más" : "avisos más"} (demasiados seguidos), en el panel${url ? `\n${url}` : "."}`;
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
 * Texto de un aviso suelto (al momento): una línea con emoji y, debajo, el enlace solo si sirve para actuar
 * (los de Facturas; con un precio sugerido aplicable, el de «Aplicar el precio»). Las reservas, sin enlace.
 */
export function mensajeAviso(a: Aviso, panelUrl?: string | null, sug?: Sugerencia | null, op: OpcionesLinea = {}): string {
  const linea = `${emojiTipo(a.tipo)} ${lineaAviso(a, { ...op, sug })}`;
  if (canalDeTipo(a.tipo) === "reservas") return linea;
  const aplicar = a.tipo === "facturas_margen_bajo" && sugerenciaAplicable(sug) ? enlacePanel(panelUrl, rutaAplicarPrecio(a.id)) : null;
  const url = aplicar ?? enlacePanel(panelUrl, rutaPanel(a));
  return url ? `${linea}\n${url}` : linea;
}

/**
 * Agrupa textos en mensajes de hasta `max` caracteres, separados por una línea en blanco.
 * Devuelve qué índices van en cada mensaje (para registrar cada aviso con su envío).
 */
export function agruparEnMensajes(textos: string[], max = LIMITE_TELEGRAM): { texto: string; indices: number[] }[] {
  const salida: { texto: string; indices: number[] }[] = [];
  for (let i = 0; i < textos.length; i++) {
    const t = recortar(textos[i], max);
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.texto.length + 2 + t.length <= max) {
      ultimo.texto += `\n\n${t}`;
      ultimo.indices.push(i);
    } else {
      salida.push({ texto: t, indices: [i] });
    }
  }
  return salida;
}

/** «23/11» en Madrid. */
function diaMes(fecha: Date): string {
  const d = diaMadrid(fecha);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

// ─── Resumen diario ─────────────────────────────────────────────────────────

export interface Resumen {
  /** Vacío si no hay nada que contar: entonces no se manda mensaje. */
  texto: string;
  total: number;
  /** «Por revisar» al terminar este resumen (para guardarlo en config.resumen_revision si se envía). */
  revision: Record<string, EstadoRevision>;
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
      const nombre = recortar(limpio(d.nombre), 30);
      if (nombre && v !== null) return d.canal === "plato" ? `${nombre} ${n0.format(v)} %` : `${nombre} ×${nCorto.format(v)}`;
      break;
    }
    case "facturas_precio_sube":
    case "facturas_precio_baja":
      if (limpio(d.producto) && pct !== null) return `${producto(d.producto, 30)} ${pctConSigno(pct)}`;
      break;
    case "facturas_precio_mejor":
      if (limpio(d.producto) && numero(d.diferencia_pct) !== null) return `${producto(d.producto, 30)} −${n0.format(numero(d.diferencia_pct) as number)} %`;
      break;
    case "facturas_precio_proveedor":
      if (limpio(d.proveedor)) return `${proveedorCorto(d.proveedor, 24)}${numero(d.productos) !== null ? ` (${numero(d.productos)})` : ""}`;
      break;
    case "facturas_familia_gasto":
      if (limpio(d.familia) && pct !== null) return `${recortar(limpio(d.familia), 30)} ${pctConSigno(pct)}`;
      break;
    case "facturas_albaran_sin_factura":
    case "facturas_importe_inusual":
    case "facturas_proveedor_nuevo":
      if (limpio(d.proveedor)) return `${proveedorCorto(d.proveedor, 24)}${imp !== null ? ` ${eur0(imp)}` : ""}`;
      break;
  }
  return recortar(limpio(a.titulo) || limpio(a.mensaje) || etiquetaTipo(a.tipo), 40);
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

/**
 * Resumen diario: los avisos de las últimas 24 h que NO llegaron ya al momento (sin los excluidos, caducados, con
 * la campana apagada, de unidades dudosas ni reservas que no valen). Una línea por tipo, el más numeroso primero:
 *   «⚠️ Margen bajo (2): Chuletón 41 %, Entrecot 38 %»
 * con los CASOS_POR_TIPO más importantes y «y N más». «Por revisar» va en su línea con la diferencia
 * («📋 Por revisar: 190 docs (+12)»). Sin nada que contar, `texto` va vacío (no se manda «sin avisos»).
 */
export function construirResumen(avisos: Aviso[], ahora: Date, panelUrl?: string | null, ctx: ContextoAvisos = {}): Resumen {
  const desde = ahora.getTime() - 24 * 3600_000;
  const hoy = diaMadrid(ahora);
  const previa = ctx.revision ?? {};
  const revision: Record<string, EstadoRevision> = { ...previa };
  const base = avisos
    .filter((a) => Date.parse(a.created_at) > desde && Date.parse(a.created_at) <= ahora.getTime())
    .filter((a) => !tipoExcluido(a.tipo) && !campanaApagada(a))
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .filter((a) => !ctx.enviados?.has(a.id))
    .filter((a) => !motivoSospechoso(a))
    .filter((a) => visibilidadReserva(a, ctx.reservas) === "si")
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
    if (cuantos !== null) {
      revision[clase] = { n: cuantos, dia: hoy };
      const p = previa[clase];
      const dif = p ? cuantos - p.n : 0;
      const que = clase === "duplicados" ? "Posibles duplicados" : "Por revisar";
      lineasRevision.push(`${emojiTipo(a.tipo)} ${que}: ${milesEnteros.format(cuantos)} docs${dif ? ` (${dif > 0 ? "+" : "−"}${milesEnteros.format(Math.abs(dif))})` : ""}`);
    } else {
      lineasRevision.push(`${emojiTipo(a.tipo)} ${recortar(limpio(a.titulo) || "Documentos por revisar", 60)}`);
    }
    return true;
  });
  if (validos.length === 0) return { texto: "", total: 0, revision: previa };

  const op: OpcionesLinea = { ahora, reservas: ctx.reservas };
  const grupos = new Map<string, Aviso[]>();
  for (const a of validos) if (a.tipo !== "facturas_revision") grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const ordenados = [...grupos.entries()].sort((x, y) => y[1].length - x[1].length || etiquetaTipo(x[0]).localeCompare(etiquetaTipo(y[0]), "es"));
  const lineas = ordenados.map(([tipo, lista]) => {
    const principales = [...lista].sort((x, y) => peso(y) - peso(x) || Date.parse(y.created_at) - Date.parse(x.created_at)).slice(0, CASOS_POR_TIPO);
    const resto = lista.length - principales.length;
    const casos = principales.map((a) => casoCorto(a, op)).join(", ");
    return `${emojiTipo(tipo)} ${etiquetaTipo(tipo)} (${lista.length}): ${casos}${resto > 0 ? ` y ${resto} más` : ""}`;
  });
  const url = enlacePanel(panelUrl, "/avisos");
  const cabecera = `Resumen ${diaMes(ahora)} · ${validos.length} ${validos.length === 1 ? "aviso" : "avisos"}`;
  return { texto: componer(cabecera, [...lineas, ...lineasRevision], url ? [url] : []), total: validos.length, revision };
}

/** Cabecera, líneas y pie en ≤ LIMITE_TELEGRAM: si no caben todas las líneas, corta y lo dice («…y N tipos más»). */
function componer(cabecera: string, lineas: string[], pie: string[]): string {
  const finales = pie.join("\n");
  let cuerpo = cabecera;
  for (let i = 0; i < lineas.length; i++) {
    const quedan = lineas.length - i - 1;
    const corte = `\n…y ${lineas.length - i} más, en el panel`;
    const reserva = (quedan > 0 ? corte.length : 0) + (finales ? finales.length + 1 : 0);
    const l = `\n${recortar(lineas[i], 400)}`;
    if (cuerpo.length + l.length + reserva > LIMITE_TELEGRAM) {
      cuerpo += corte;
      break;
    }
    cuerpo += l;
  }
  return recortar(finales ? `${cuerpo}\n${finales}` : cuerpo, LIMITE_TELEGRAM);
}

// ─── Resumen semanal para el dueño (lunes por la mañana) ────────────────────

/** Lo que devuelve la RPC avisos_telegram_datos_semanal (20261209400000). */
export interface DatosSemanales {
  vinos?: { limite?: number; bajo?: number; total?: number; peor?: { nombre: string; multiplicador: number }[] };
  tienda?: { activa?: boolean; limite?: number; bajo?: number; total?: number; bajo_coste?: number; peor?: { nombre: string; multiplicador: number }[] };
  facturas?: { documentos?: number; importe?: number; mayores?: { proveedor: string | null; total: number; fecha: string | null }[] };
  albaranes?: { total_n?: number; total_proveedores?: number; total_importe?: number; n?: number; proveedores?: number; importe?: number; mayores?: { proveedor: string | null; importe: number; n: number }[] };
}

/** «peores: Vino A ×1,2, Vino B ×1,5» (los 2 primeros). */
const peores = (l: { nombre: string; multiplicador: number }[] | undefined): string => {
  const x = (l ?? []).slice(0, 2).map((p) => `${recortar(limpio(p.nombre), 28)} ×${nCorto.format(p.multiplicador)}`);
  return x.length ? ` · peores: ${x.join(", ")}` : "";
};

/**
 * Resumen semanal, una línea por cosa: vinos de la carta y tienda bajo el mínimo (con los 2 peores), facturas por
 * verificar y albaranes sin factura de más de 35 días (con el total de todos si hay más), y los enlaces al panel.
 * Vacío si no hay nada que decir.
 */
export function construirSemanal(d: DatosSemanales, ahora: Date, panelUrl?: string | null): { texto: string; secciones: number } {
  const lineas: string[] = [];
  let margenes = false;
  let docs = false;
  const v = d.vinos;
  if (v && (v.bajo ?? 0) > 0) {
    margenes = true;
    lineas.push(`🍷 Vinos bajo ×${nCorto.format(v.limite ?? 2.3)}: ${v.bajo}${v.total ? ` de ${v.total}` : ""}${peores(v.peor)}`);
  }
  const t = d.tienda;
  if (t && t.activa !== false && (t.bajo ?? 0) > 0) {
    margenes = true;
    lineas.push(`🛒 Tienda bajo ×${nCorto.format(t.limite ?? 1.5)}: ${t.bajo}${t.total ? ` de ${t.total}` : ""}${(t.bajo_coste ?? 0) > 0 ? ` (${t.bajo_coste} bajo coste)` : ""}${peores(t.peor)}`);
  }
  const f = d.facturas;
  if (f && (f.documentos ?? 0) > 0) {
    docs = true;
    const mayor = f.mayores?.[0];
    lineas.push(`📋 Facturas por verificar: ${milesEnteros.format(f.documentos ?? 0)} (${eur0(f.importe ?? 0)})${mayor ? ` · mayor: ${proveedorCorto(mayor.proveedor) || "sin proveedor"} ${eur0(mayor.total)}` : ""}`);
  }
  const al = d.albaranes;
  if (al && (al.n ?? 0) > 0) {
    docs = true;
    const total = (al.total_n ?? 0) > (al.n ?? 0) ? ` · en total ${al.total_n} (${eur0(al.total_importe ?? 0)})` : "";
    const provs = al.proveedores ?? "?";
    lineas.push(`🧾 Albaranes sin factura +35 días: ${eur0(al.importe ?? 0)} en ${provs} ${provs === 1 ? "proveedor" : "proveedores"}${total}`);
  }
  if (lineas.length === 0) return { texto: "", secciones: 0 };
  const urlMargenes = margenes ? enlacePanel(panelUrl, "/facturas?tab=margenes") : null;
  const urlDocs = docs ? enlacePanel(panelUrl, "/facturas?tab=compras&modo=documentos") : null;
  const pie = [urlMargenes && `Márgenes: ${urlMargenes}`, urlDocs && `Facturas: ${urlDocs}`].filter(Boolean) as string[];
  return { texto: componer(`📅 Semana ${diaMes(ahora)}`, lineas, pie), secciones: lineas.length };
}

/** Quita el token de cualquier texto de error (la URL de la API lo lleva). */
export function errorSaneado(texto: string): string {
  return texto.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot…").slice(0, 300);
}

/** Cuerpo de sendMessage: texto plano (sin parse_mode, no hay nada que escapar) y sin vista previa. */
export function cuerpoSendMessage(chatId: string, texto: string): Record<string, unknown> {
  return { chat_id: chatId, text: recortar(texto, LIMITE_TELEGRAM), link_preview_options: { is_disabled: true } };
}

export type Accion = "pendientes" | "resumen" | "probar" | "fallos" | "semanal";
export const esAccion = (v: unknown): v is Accion => v === "pendientes" || v === "resumen" || v === "probar" || v === "fallos" || v === "semanal";

/** Tipo de la fila de avisos_telegram_envios de cada acción (el CHECK admite 'fallo', no 'fallos'). */
export const tipoRegistro = (accion: Accion): string => (accion === "probar" ? "prueba" : accion === "fallos" ? "fallo" : accion);
