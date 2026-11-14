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
}

export interface Aviso {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  referencia_tipo: string | null;
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

/**
 * Avisos que hay que mandar al momento: tipo marcado, de las últimas 24 h y posteriores a la
 * activación, sin caducar, no excluidos, con campana, sin envío correcto y con menos de
 * MAX_FALLOS fallos. Misma regla que avisos_telegram_hay_pendientes (SQL). Orden: más antiguo primero.
 */
export function pendientesDeEnvio(avisos: Aviso[], envios: Envio[], cfg: Pick<ConfigTelegram, "tipos_al_momento" | "activo_desde">, ahora: Date): Aviso[] {
  const desde = Math.max(ahora.getTime() - 24 * 3600_000, cfg.activo_desde ? Date.parse(cfg.activo_desde) : ahora.getTime());
  const enviados = new Set<string>();
  const fallos = new Map<string, number>();
  for (const e of envios) {
    if (!e.aviso_id) continue;
    if (e.ok) enviados.add(e.aviso_id);
    else fallos.set(e.aviso_id, (fallos.get(e.aviso_id) ?? 0) + 1);
  }
  return avisos
    .filter((a) => cfg.tipos_al_momento.includes(a.tipo))
    .filter((a) => Date.parse(a.created_at) > desde)
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .filter((a) => !tipoExcluido(a.tipo) && !campanaApagada(a))
    .filter((a) => !enviados.has(a.id) && (fallos.get(a.id) ?? 0) < MAX_FALLOS)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** Recorta a `max` caracteres (contando como Telegram, en UTF-16) con «…» al final. */
export function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

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
  const m = t.match(/^(.+?[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«])/);
  return recortar(m ? m[1] : t, max);
}

/** «Qué ha pasado» de un aviso «Margen bajo», con los números de datos. null si faltan datos. */
function fraseMargenBajo(d: Record<string, unknown>): string | null {
  const canal = d.canal;
  const valor = numero(d.valor);
  const limite = numero(d.limite);
  if (valor === null || limite === null) return null;
  if (canal === "plato") {
    const antes = numero(d.eur_antes);
    const ahora = numero(d.eur);
    const prod = limpio(d.producto);
    const sube = prod && antes !== null && ahora !== null && ahora > antes ? ` Sube ${prod}: de ${eur(antes)} a ${eur(ahora)}.` : "";
    return `Los ingredientes ya son el ${n0.format(valor)} % de lo que cobras (máximo ${n0.format(limite)} %).${sube}`;
  }
  if (canal === "vino" || canal === "tienda" || canal === "peso") {
    const coste = numero(d.coste);
    const antes = numero(d.coste_antes);
    const que = canal === "peso" ? "el kilo" : "la botella";
    const cuesta = coste !== null ? ` ${que[0].toUpperCase()}${que.slice(1)} te cuesta ${eur(coste)}${antes !== null ? ` (antes ${eur(antes)})` : ""}.` : "";
    return `Cobras ${n1.format(valor)} veces lo que pagas (mínimo ${n1.format(limite)})${canal === "tienda" ? " en la tienda" : ""}.${cuesta}`;
  }
  return null;
}

/** Línea 2: qué ha pasado, con números (una frase corta). También es la frase del resumen. */
export function fraseAviso(a: Aviso): string {
  if (a.tipo === "facturas_margen_bajo" && a.datos) {
    const f = fraseMargenBajo(a.datos);
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
export function mensajeAviso(a: Aviso, panelUrl?: string | null, sug?: Sugerencia | null): string {
  const aplicar = a.tipo === "facturas_margen_bajo" && sugerenciaAplicable(sug) ? enlacePanel(panelUrl, rutaAplicarPrecio(a.id)) : null;
  const url = aplicar ?? enlacePanel(panelUrl, rutaPanel(a));
  const pie = url ? `\n${aplicar ? "Aplicar el precio" : "Ver"}: ${url}` : "";
  const titulo = tituloAviso(a);
  const frase = fraseAviso(a);
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

/**
 * Resumen diario: avisos de las últimas 24 h (sin los excluidos ni caducados), agrupados por
 * tipo (más numeroso primero), con el número y hasta FRASES_POR_TIPO frases (las más recientes).
 * Nunca pasa de LIMITE_TELEGRAM: si no cabe, corta por grupos y lo dice.
 */
export function construirResumen(avisos: Aviso[], ahora: Date, panelUrl?: string | null): { texto: string; total: number } {
  const desde = ahora.getTime() - 24 * 3600_000;
  const validos = avisos
    .filter((a) => Date.parse(a.created_at) > desde && Date.parse(a.created_at) <= ahora.getTime())
    .filter((a) => !tipoExcluido(a.tipo))
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const cabecera = `Avisos de Casa Tomás · ${fechaCorta(ahora)}`;
  const url = enlacePanel(panelUrl, "/avisos");
  const pie = url ? `\n\nVer todo: ${url}` : "";
  if (validos.length === 0) {
    return { texto: `${cabecera}\nSin avisos en las últimas 24 h.${pie}`, total: 0 };
  }
  const grupos = new Map<string, Aviso[]>();
  for (const a of validos) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const ordenados = [...grupos.entries()].sort((x, y) => y[1].length - x[1].length || etiquetaTipo(x[0]).localeCompare(etiquetaTipo(y[0]), "es"));

  let cuerpo = `${cabecera}\nÚltimas 24 h: ${validos.length} ${validos.length === 1 ? "aviso" : "avisos"}.`;
  const avisoCorte = "\n\n(No cabe todo: el resto, en el panel.)";
  for (let g = 0; g < ordenados.length; g++) {
    const [tipo, lista] = ordenados[g];
    const frases = lista.slice(0, FRASES_POR_TIPO).map((a) => `• ${fraseAviso(a)}`);
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
  return { texto: recortar(cuerpo + pie, LIMITE_TELEGRAM), total: validos.length };
}

/** Quita el token de cualquier texto de error (la URL de la API lo lleva). */
export function errorSaneado(texto: string): string {
  return texto.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot…").slice(0, 300);
}

/** Cuerpo de sendMessage: texto plano (sin parse_mode, no hay nada que escapar) y sin vista previa. */
export function cuerpoSendMessage(chatId: string, texto: string): Record<string, unknown> {
  return { chat_id: chatId, text: recortar(texto, LIMITE_TELEGRAM), link_preview_options: { is_disabled: true } };
}

export type Accion = "pendientes" | "resumen" | "probar";
export const esAccion = (v: unknown): v is Accion => v === "pendientes" || v === "resumen" || v === "probar";
