// ============================================================================
//  avisos-telegram · lógica pura (sin Deno ni red), probada con vitest en
//  supabase/functions/avisos-telegram/__tests__/logica.test.ts
// ============================================================================

/** Límite de Telegram para el texto de sendMessage. */
export const LIMITE_TELEGRAM = 4096;
/** Tras estos fallos, un aviso ya no se reintenta al momento (sale igual en el resumen). */
export const MAX_FALLOS = 3;
/** Frases por tipo en el resumen. */
export const FRASES_POR_TIPO = 4;
/** Tope de avisos «al momento» por hora y por día (configurable: tope_hora y tope_dia). El resto, en el panel. */
export const TOPE_HORA = 10;
export const TOPE_DIA = 30;
/** «Por revisar»: solo entra en el resumen si cambia en CAMBIO_REVISION documentos o han pasado DIAS_REVISION días. */
export const CAMBIO_REVISION = 5;
export const DIAS_REVISION = 7;
/** Si un precio es ≥ RATIO_UNIDADES veces el otro (o al revés), casi seguro se comparan unidades distintas o hay una lectura mala. */
export const RATIO_UNIDADES = 10;
/** Avisos de reservas (sin nombres de clientes en Telegram; ver fraseReserva). */
export const TIPOS_RESERVA = ["reserva_nueva", "reserva_cancelada"];
export const TEXTO_PRUEBA = "Prueba de avisos de Casa Tomás";
export const SIN_CONFIGURAR = "Telegram sin configurar";
export const ZONA = "Europe/Madrid";

export interface ConfigTelegram {
  activo: boolean;
  chat_id: string | null;
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
  peticion_urgente: "Peticiones urgentes",
  reserva_modificada: "Reservas modificadas",
  facturas_margen_bajo: "Margen bajo",
  instagram_encargo: "Encargos de Instagram",
  sistema: "Sistema",
};

export const etiquetaTipo = (tipo: string): string => ETIQUETA_TIPO[tipo] ?? tipo.replace(/_/g, " ");

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
 * Avisos que hay que mandar al momento: tipo marcado (o reserva de hoy/mañana), de las últimas 24 h y
 * posteriores a la activación, sin caducar, no excluidos, con campana, sin envío correcto y con menos de
 * MAX_FALLOS fallos. Orden: más antiguo primero. Misma regla que avisos_telegram_hay_pendientes (SQL),
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

/** Línea para los avisos que no caben por el tope. */
export function notaTope(restantes: number, panelUrl?: string | null): string {
  const url = enlacePanel(panelUrl, "/avisos");
  return `…y ${restantes} ${restantes === 1 ? "aviso más" : "avisos más"} (hay demasiados seguidos: el resto, en el panel).${url ? `
Ver: ${url}` : ""}`;
}

/** Recorta a `max` caracteres (contando como Telegram, en UTF-16) con «…» al final. */
export function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

const NL = "\n";
const limpio = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

// ─── Plantillas cortas (14/11/2026) ─────────────────────────────────────────
//  Dueño: «todos los avisos deben ser concisos y claros: 2-4 líneas, qué ha pasado con
//  números, y qué hacer». Cada aviso suelto sale así:
//    1. Título (qué es)                         «Margen bajo: Chuletón»
//    2. Qué ha pasado, con números (una frase)  «Los ingredientes ya son el 41 % de lo que cobras (máximo 35 %).»
//    3. Qué hacer                               «Qué hacer: sube la carta de 22,00 € a 24,50 € (con IVA).»
//    4. Enlace                                  «Aplicar el precio: https://…/aplicar-precio/<id>»
//  El resumen diario usa solo la línea 2 de cada aviso.

/** Largo máximo de la línea «qué ha pasado». */
export const MAX_FRASE = 220;

const n2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const eur = (v: number) => `${n2.format(v)} €`;

/** Precio sugerido para un aviso «Margen bajo» (RPC avisos_precio_sugerido, 20261130160000). */
export interface Sugerencia {
  precio_actual: number | null;
  precio_sugerido: number | null;
  aplicado?: unknown;
}

/** Primera frase de un texto (hasta el primer «. » seguido de mayúscula), recortada a `max`. */
export function primeraFrase(texto: string, max = MAX_FRASE): string {
  const t = limpio(texto);
  // Corta en «. » + Mayúscula que no abre una palabra en MAYÚSCULAS: no ante un nombre en MAYÚSCULAS («… 32,00 €/kg. CASIMIRO PEREZ …»).
  const m = t.match(/^(.+?[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«](?![A-ZÁÉÍÓÚÑ]{2}))/);
  return recortar(m ? m[1] : t, max);
}

/** «Qué ha pasado» de un aviso «Margen bajo», con los números de datos. null si faltan datos. */
function fraseMargenBajo(d: Record<string, unknown>, conNombre = false): string | null {
  const canal = d.canal;
  const valor = numero(d.valor);
  const limite = numero(d.limite);
  if (valor === null || limite === null) return null;
  const nombre = limpio(d.nombre);
  // En el resumen no hay título encima: la frase dice de qué artículo habla.
  const quien = conNombre && nombre ? `${recortar(nombre, 50)}: ` : "";
  if (canal === "plato") {
    const antes = numero(d.eur_antes);
    const ahora = numero(d.eur);
    const prod = limpio(d.producto);
    const sube = prod && antes !== null && ahora !== null && ahora > antes ? ` Sube ${prod}: de ${eur(antes)} a ${eur(ahora)}.` : "";
    return `${quien}${quien ? "l" : "L"}os ingredientes ya son el ${n0.format(valor)} % de lo que cobras (máximo ${n0.format(limite)} %).${sube}`;
  }
  if (canal === "vino" || canal === "tienda" || canal === "peso") {
    const coste = numero(d.coste);
    const antes = numero(d.coste_antes);
    const que = canal === "peso" ? "el kilo" : "la botella";
    const cuesta = coste !== null ? ` ${que[0].toUpperCase()}${que.slice(1)} te cuesta ${eur(coste)}${antes !== null ? ` (antes ${eur(antes)})` : ""}.` : "";
    return `${quien}${quien ? "c" : "C"}obras ${n1.format(valor)} veces lo que pagas (mínimo ${n1.format(limite)})${canal === "tienda" ? " en la tienda" : ""}.${cuesta}`;
  }
  return null;
}

const MEDIDAS: Record<string, string> = { kg: "kg", l: "l", ud: "ud", caja: "caja" };

/** «Más barato en otro proveedor»: el dato clave (quién lo vende más barato y a cuánto) va entero. null si faltan datos. */
function frasePrecioMejor(d: Record<string, unknown>): string | null {
  const producto = limpio(d.producto);
  const otro = limpio(d.proveedor_otro);
  const precio = numero(d.precio);
  const precioOtro = numero(d.precio_otro);
  if (!producto || !otro || precio === null || precioOtro === null) return null;
  const medida = typeof d.medida === "string" && MEDIDAS[d.medida] ? `/${MEDIDAS[d.medida]}` : "";
  const habitual = limpio(d.proveedor);
  const pct = numero(d.diferencia_pct);
  const ahorro = numero(d.ahorro);
  return `${producto}: ${otro} lo vendió a ${eur(precioOtro)}${medida}; ${habitual ? `${habitual} te lo cobró` : "tú pagaste"} a ${eur(precio)}${medida}`
    + `${pct !== null ? ` (${n0.format(pct)} % menos)` : ""}${ahorro !== null && ahorro > 0 ? `, unos ${n0.format(ahorro)} € de ahorro en 90 días` : ""}.`;
}

const CANALES: Record<string, string> = { web: "web", telefono: "teléfono", manual: "manual", presencial: "en el local" };

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
 * Frase de una reserva SIN nombre ni teléfono del cliente (los avisos del panel los llevan; a Telegram no).
 * «Reserva de 4 pax a las 21:00 · hoy, web». Sin los datos de la reserva, se quita el nombre del texto del aviso
 * («Nombre · 12/11 15:00 · 8 pers. · web» → «12/11 15:00 · 8 pers. · web»).
 */
export function fraseReserva(a: Aviso, r: ReservaInfo | null | undefined, ahora: Date): string {
  const cancelada = a.tipo === "reserva_cancelada";
  if (r) {
    const hora = (r.hora ?? "").slice(0, 5);
    const cuando = [cuandoReserva(r.fecha, ahora), CANALES[r.canal ?? ""]].filter(Boolean).join(", ");
    const quien = cancelada && r.cancelada_por === "cliente" ? " · la canceló el cliente" : "";
    return `Reserva${cancelada ? " cancelada" : ""} de ${r.numero_comensales ?? "?"} pax${hora ? ` a las ${hora}` : ""} · ${cuando}${quien}`;
  }
  const partes = limpio(a.mensaje).split(" · ").slice(1).filter((x) => !/^la cancel/.test(x));
  const base = cancelada ? "Reserva cancelada" : "Reserva nueva";
  return partes.length ? `${base}: ${partes.join(" · ")}` : base;
}

/** Opciones de las frases: ahora (para «hoy»/«mañana»), reservas conocidas y si va con el nombre del artículo (resumen). */
export interface OpcionesFrase extends ContextoAvisos {
  ahora?: Date;
  nombre?: boolean;
}

/** Línea 2: qué ha pasado, con números (una frase corta). También es la frase del resumen. */
export function fraseAviso(a: Aviso, op: OpcionesFrase = {}): string {
  // Datos personales: nunca el texto del aviso (lleva nombre y teléfono del cliente).
  if (esReserva(a)) return recortar(fraseReserva(a, a.referencia_id ? op.reservas?.get(a.referencia_id) : null, op.ahora ?? new Date()), MAX_FRASE);
  if (a.tipo === "solicitud_pendiente") return recortar(limpio(a.titulo) || etiquetaTipo(a.tipo), MAX_FRASE);
  if (a.tipo === "facturas_margen_bajo" && a.datos) {
    const f = fraseMargenBajo(a.datos, op.nombre);
    if (f) return recortar(f, MAX_FRASE);
  }
  if (a.tipo === "facturas_precio_mejor" && a.datos) {
    const f = frasePrecioMejor(a.datos);
    if (f) return recortar(f, MAX_FRASE);
  }
  const tg = limpio(a.datos?.texto_telegram);
  if (tg) return primeraFrase(tg);
  const titulo = limpio(a.titulo);
  const mensaje = limpio(a.mensaje);
  if (mensaje && mensaje !== titulo) return primeraFrase(mensaje);
  return recortar(titulo || etiquetaTipo(a.tipo), MAX_FRASE);
}

/** Línea 3: qué hacer, por tipo (null si no hay nada que hacer, p. ej. una reserva nueva). */
const QUE_HACER: Record<string, string> = {
  reserva_cancelada: "la mesa queda libre; no hace falta hacer nada.",
  solicitud_pendiente: "llama al cliente y resuélvela en Reservas.",
  facturas_subida: "revisa lo subido en Facturas.",
  subida_precio: "mira si toca subir la carta o buscar otro proveedor.",
  original_sin_drive: "vuelve a subir el original en Facturas.",
  facturas_precio_sube: "mira si toca subir la carta o pedir otro precio.",
  facturas_precio_mejor: "pide precio a ese proveedor (comprueba que es la misma calidad).",
  facturas_familia_gasto: "revisa las compras de ese mes.",
  facturas_albaran_sin_factura: "pide la factura al proveedor o vincúlala si ya la tienes.",
  facturas_proveedor_nuevo: "comprueba que no sea un proveedor repetido.",
  facturas_importe_inusual: "comprueba que el importe esté bien leído.",
  facturas_revision: "revísalos y márcalos como verificados.",
  facturas_precio_baja: "buen momento para comprar más.",
  facturas_precio_proveedor: "habla con el proveedor o busca otro.",
  facturas_precio_pactado: "reclama el precio pactado al proveedor.",
  facturas_margen_bajo: "revisa el precio en Facturas › Márgenes.",
  instagram_encargo: "míralo en RRSS › Encargos.",
  peticion_urgente: "míralo en Peticiones.",
};

/** ¿Hay un precio sugerido que se pueda aplicar (y no se ha aplicado ya)? */
export const sugerenciaAplicable = (s: Sugerencia | null | undefined): s is Sugerencia & { precio_sugerido: number } =>
  !!s && typeof s.precio_sugerido === "number" && s.precio_sugerido > 0 && !s.aplicado;

export function queHacer(a: Aviso, sug?: Sugerencia | null): string | null {
  if (a.tipo === "facturas_margen_bajo" && sugerenciaAplicable(sug)) {
    return sug.precio_actual !== null && sug.precio_actual > 0
      ? `sube la carta de ${eur(sug.precio_actual)} a ${eur(sug.precio_sugerido)} (con IVA).`
      : `pon en la carta ${eur(sug.precio_sugerido)} (con IVA).`;
  }
  return QUE_HACER[a.tipo] ?? null;
}

/** Ruta del panel para aplicar el precio sugerido de un aviso (pide sesión y permiso de carta). */
export const rutaAplicarPrecio = (avisoId: string) => `/aplicar-precio/${encodeURIComponent(avisoId)}`;

/** Ruta del panel para un aviso (subconjunto de rutaDeAviso en src/lib/avisos.ts). */
export function rutaPanel(a: Pick<Aviso, "tipo" | "referencia_tipo" | "datos">): string {
  const enlace = typeof a.datos?.enlace === "string" ? a.datos.enlace : null;
  if (enlace && enlace.startsWith("?") && (a.tipo.startsWith("facturas_") || a.referencia_tipo === "facturas_alerta")) return `/facturas${enlace}`;
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

/** Línea 1: el título del aviso (corto); en «Margen bajo», «Margen bajo: <nombre>». */
export function tituloAviso(a: Aviso): string {
  const nombre = limpio(a.datos?.nombre);
  if (a.tipo === "facturas_margen_bajo" && nombre) return recortar(`Margen bajo: ${nombre}`, 90);
  return recortar(limpio(a.titulo) || etiquetaTipo(a.tipo), 90);
}

/**
 * Texto de un aviso suelto (al momento): 2-4 líneas (título, qué ha pasado, qué hacer y enlace).
 * Con un precio sugerido aplicable, el enlace es el de «Aplicar el precio» (pantalla del panel
 * que pide sesión, permiso de carta y confirmación).
 */
export function mensajeAviso(a: Aviso, panelUrl?: string | null, sug?: Sugerencia | null, op: OpcionesFrase = {}): string {
  const aplicar = a.tipo === "facturas_margen_bajo" && sugerenciaAplicable(sug) ? enlacePanel(panelUrl, rutaAplicarPrecio(a.id)) : null;
  const url = aplicar ?? enlacePanel(panelUrl, rutaPanel(a));
  const pie = url ? `\n${aplicar ? "Aplicar el precio" : "Ver"}: ${url}` : "";
  const titulo = tituloAviso(a);
  const frase = fraseAviso(a, op);
  const hacer = queHacer(a, sug);
  const lineas = [titulo, ...(frase && frase !== titulo ? [frase] : []), ...(hacer ? [`Qué hacer: ${hacer}`] : [])];
  return recortar(lineas.join("\n"), LIMITE_TELEGRAM - pie.length) + pie;
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

/** Fecha corta «martes 11/11» en Madrid. */
function fechaCorta(fecha: Date): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, weekday: "long", day: "2-digit", month: "2-digit" }).format(fecha).replace(",", "");
}

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

/**
 * Resumen diario: avisos de las últimas 24 h (sin los excluidos, caducados, con la campana apagada, de
 * unidades dudosas ni reservas que no valen), agrupados por tipo (más numeroso primero), con el número y hasta
 * FRASES_POR_TIPO frases (las más recientes). Nunca pasa de LIMITE_TELEGRAM: si no cabe, corta por grupos y lo dice.
 * Sin nada que contar, `texto` va vacío (no se manda «sin avisos»).
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
    .filter((a) => !motivoSospechoso(a))
    .filter((a) => visibilidadReserva(a, ctx.reservas) === "si")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  // «Por revisar»: solo el más reciente de cada clase, y solo si cambia o toca la semanal.
  const vistos = new Set<string>();
  const validos = base.filter((a) => {
    if (a.tipo !== "facturas_revision") return true;
    const clase = claseRevision(a);
    if (vistos.has(clase)) return false;
    vistos.add(clase);
    const cuantos = numero(a.datos?.cuantos);
    if (!incluirRevision(cuantos, previa[clase], hoy)) return false;
    if (cuantos !== null) revision[clase] = { n: cuantos, dia: hoy };
    return true;
  });
  const url = enlacePanel(panelUrl, "/avisos");
  const pie = url ? `\n\nVer todo: ${url}` : "";
  if (validos.length === 0) return { texto: "", total: 0, revision: previa };
  const cabecera = `Avisos de Casa Tomás · ${fechaCorta(ahora)}`;
  const op: OpcionesFrase = { ahora, reservas: ctx.reservas, nombre: true };
  const frase = (a: Aviso): string => {
    const f = fraseAviso(a, op);
    const p = a.tipo === "facturas_revision" ? previa[claseRevision(a)] : undefined;
    return p ? `${f} (el ${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)} eran ${p.n})` : f;
  };
  const grupos = new Map<string, Aviso[]>();
  for (const a of validos) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const ordenados = [...grupos.entries()].sort((x, y) => y[1].length - x[1].length || etiquetaTipo(x[0]).localeCompare(etiquetaTipo(y[0]), "es"));

  let cuerpo = `${cabecera}\nÚltimas 24 h: ${validos.length} ${validos.length === 1 ? "aviso" : "avisos"}.`;
  const avisoCorte = "\n\n(No cabe todo: el resto, en el panel.)";
  for (let g = 0; g < ordenados.length; g++) {
    const [tipo, lista] = ordenados[g];
    const frases = lista.slice(0, FRASES_POR_TIPO).map((a) => `• ${frase(a)}`);
    const resto = lista.length - frases.length;
    const bloque = `\n\n${etiquetaTipo(tipo)} (${lista.length})\n${frases.join("\n")}${resto > 0 ? `\n…y ${resto} más.` : ""}`;
    const reserva = (g < ordenados.length - 1 ? avisoCorte.length : 0) + pie.length;
    if (cuerpo.length + bloque.length + reserva > LIMITE_TELEGRAM) {
      // Si ni el primer grupo cabe entero, va recortado; si no, se corta aquí.
      if (g === 0) cuerpo = recortar(cuerpo + bloque, LIMITE_TELEGRAM - avisoCorte.length - pie.length);
      cuerpo += avisoCorte;
      break;
    }
    cuerpo += bloque;
  }
  return { texto: recortar(cuerpo + pie, LIMITE_TELEGRAM), total: validos.length, revision };
}

// ─── Resumen semanal para el dueño (lunes por la mañana) ────────────────────

/** Lo que devuelve la RPC avisos_telegram_datos_semanal (20261209400000). */
export interface DatosSemanales {
  vinos?: { limite?: number; bajo?: number; total?: number; peor?: { nombre: string; multiplicador: number }[] };
  tienda?: { activa?: boolean; limite?: number; bajo?: number; total?: number; bajo_coste?: number; peor?: { nombre: string; multiplicador: number }[] };
  facturas?: { documentos?: number; importe?: number; mayores?: { proveedor: string | null; total: number; fecha: string | null }[] };
  albaranes?: { n?: number; proveedores?: number; importe?: number; mayores?: { proveedor: string | null; importe: number; n: number }[] };
}

const miles = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" as unknown as boolean });
const milesEnteros = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" as unknown as boolean });
const eurM = (v: number) => `${miles.format(v)} €`;

const fechaCortaDia = (iso: string | null | undefined): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/**
 * Resumen semanal: vinos de la carta bajo el mínimo, tienda bajo el mínimo, facturas por verificar y albaranes sin
 * factura. Corto: cifras y los 3 mayores de cada cosa, más el enlace al panel. Vacío si no hay nada que decir.
 */
export function construirSemanal(d: DatosSemanales, ahora: Date, panelUrl?: string | null): { texto: string; secciones: number } {
  const bloques: string[] = [];
  const v = d.vinos;
  if (v && (v.bajo ?? 0) > 0) {
    bloques.push([
      `Vinos de la carta por debajo de ×${n1.format(v.limite ?? 2.3)}: ${v.bajo}${v.total ? ` de ${v.total}` : ""}`,
      ...(v.peor ?? []).slice(0, 3).map((x) => `• ${recortar(limpio(x.nombre), 50)} · ×${n2.format(x.multiplicador)}`),
    ].join("\n"));
  }
  const t = d.tienda;
  if (t && t.activa !== false && (t.bajo ?? 0) > 0) {
    bloques.push([
      `Tienda por debajo de ×${n1.format(t.limite ?? 1.5)}: ${t.bajo}${t.total ? ` de ${t.total}` : ""}${(t.bajo_coste ?? 0) > 0 ? ` (${t.bajo_coste} se venden por debajo del coste)` : ""}`,
      ...(t.peor ?? []).slice(0, 3).map((x) => `• ${recortar(limpio(x.nombre), 50)} · ×${n2.format(x.multiplicador)}`),
    ].join("\n"));
  }
  const f = d.facturas;
  if (f && (f.documentos ?? 0) > 0) {
    bloques.push([
      `Facturas por verificar: ${milesEnteros.format(f.documentos ?? 0)} documentos (${eurM(f.importe ?? 0)})`,
      ...(f.mayores ?? []).slice(0, 3).map((x) => `• ${recortar(limpio(x.proveedor) || "Sin proveedor", 40)} · ${eurM(x.total)}${fechaCortaDia(x.fecha) ? ` · ${fechaCortaDia(x.fecha)}` : ""}`),
    ].join("\n"));
  }
  const al = d.albaranes;
  if (al && (al.n ?? 0) > 0) {
    bloques.push([
      `Albaranes sin factura: ${eurM(al.importe ?? 0)} en ${al.proveedores ?? "?"} ${al.proveedores === 1 ? "proveedor" : "proveedores"}`,
      ...(al.mayores ?? []).slice(0, 3).map((x) => `• ${recortar(limpio(x.proveedor) || "Sin proveedor", 40)} · ${eurM(x.importe)} (${x.n} ${x.n === 1 ? "albarán" : "albaranes"})`),
    ].join("\n"));
  }
  if (bloques.length === 0) return { texto: "", secciones: 0 };
  const hayMargenes = bloques.some((b) => b.startsWith("Vinos") || b.startsWith("Tienda"));
  const hayDocs = bloques.some((b) => b.startsWith("Facturas") || b.startsWith("Albaranes"));
  const margenes = hayMargenes ? enlacePanel(panelUrl, "/facturas?tab=margenes") : null;
  const docs = hayDocs ? enlacePanel(panelUrl, "/facturas?tab=compras&modo=documentos") : null;
  const pie = [margenes && `Márgenes: ${margenes}`, docs && `Facturas: ${docs}`].filter(Boolean).join(NL);
  const cabecera = `Casa Tomás · resumen de la semana (${fechaCorta(ahora)})`;
  return { texto: recortar([cabecera, ...bloques, ...(pie ? [pie] : [])].join("\n\n"), LIMITE_TELEGRAM), secciones: bloques.length };
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
