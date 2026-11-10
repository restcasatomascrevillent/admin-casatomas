// ============================================================================
//  Reserva escrita a mano → campos del alta manual (10/11/2026)
// ----------------------------------------------------------------------------
//  «Escribir reserva» (Reservas): se escribe a mano con el lápiz, p. ej.
//  «Esther 2px salón 13 noviembre 14:15», la Edge Function
//  `interpretar-reserva-manuscrita` la transcribe con visión y este módulo PURO
//  (sin Deno, sin imports) convierte lo que devuelve el modelo en los campos del
//  formulario de alta (FormularioReserva, prellenado):
//
//    · comensales: «2px», «2 pax», «2 personas», «2 comensales» → 2.
//    · fecha: «13 noviembre», «13 de noviembre», «13 noviempre» (faltas: meses
//      con distancia de edición), «13/11», «13-11-2026», «hoy», «mañana». Sin
//      año escrito: este año, o el siguiente si ese día ya pasó (Europe/Madrid).
//    · hora: «14:15», «14h15», «14h», «a las 14», «2:15 tarde», «9 noche» → HH:MM.
//    · espacio: contra la lista REAL de `espacios_reserva` (sin tildes ni
//      mayúsculas, por palabra y aproximada). Sin coincidencia clara: null.
//
//  Lo usan la Edge Function (limpiarLecturaModelo, antes de responder) y el
//  panel (normalizarReservaManuscrita, con las salas ya cargadas). Los campos
//  que el modelo no dé se buscan en la transcripción literal (`texto`).
// ============================================================================

/** Lo que devuelve el modelo (structured output). Todo opcional/nullable. */
export interface LecturaModelo {
  /** Transcripción literal de lo escrito. */
  texto?: string | null;
  nombre?: string | null;
  telefono?: string | null;
  email?: string | null;
  comensales?: number | string | null;
  /** Sala tal como está escrita («salón»). */
  espacio?: string | null;
  /** Fecha tal como está escrita («13 noviembre»). */
  fecha?: string | null;
  dia?: number | null;
  mes?: number | null;
  /** Solo si el año está escrito. */
  anio?: number | null;
  hora?: string | null;
  notas?: string | null;
}

export interface EspacioRef {
  id: string;
  nombre: string;
}

export interface ReservaInterpretada {
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  /** YYYY-MM-DD */
  fecha: string | null;
  /** HH:MM (24 h) */
  hora: string | null;
  comensales: number | null;
  espacio_id: string | null;
  espacio_nombre: string | null;
  /** Lo escrito para la sala, aunque no case con ninguna. */
  espacio_texto: string | null;
  notas: string | null;
  texto: string | null;
  /** true si la fecha sale de lo escrito; false si es la de la página del libro (o no hay). */
  fecha_escrita: boolean;
}

export interface OpcionesNormalizar {
  espacios?: EspacioRef[];
  /** «Ahora» (tests). Por defecto, new Date(). */
  hoy?: Date;
  /** YYYY-MM-DD: la página abierta del libro de reservas, si no se escribió fecha. */
  fechaPorDefecto?: string | null;
}

// ─── Utilidades de texto ────────────────────────────────────────────────────

/** Minúsculas y sin tildes («Salón» → «salon»; la ñ también pasa a n). */
export function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = tmp;
    }
  }
  return fila[b.length];
}

/** Faltas toleradas según la longitud de la palabra. */
function tolerancia(largo: number): number {
  if (largo <= 3) return 0;
  if (largo <= 5) return 1;
  return 2;
}

function textoONull(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

// ─── Comensales ─────────────────────────────────────────────────────────────

const RE_COMENSALES =
  /\b(\d{1,3})\s*(?:px|pax|p|pers\.?|personas?|comensales?|cubiertos?|adultos?)(?![a-z])/;

export function parsearComensales(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === "number" && Number.isFinite(v)) n = Math.round(v);
  else if (typeof v === "string") {
    const t = sinTildes(v).trim();
    const m = t.match(RE_COMENSALES) ?? t.match(/^(\d{1,3})$/);
    if (m) n = Number(m[1]);
  }
  return n !== null && n >= 1 && n <= 500 ? n : null;
}

// ─── Hora ───────────────────────────────────────────────────────────────────

const RE_HORA =
  /(?:\ba\s+las?\s+)?\b(\d{1,2})\s*(?::|h(?![a-z])|\.(?=\d{2}\b))\s*(\d{2})?(?:\s*(?:h|hrs?|horas?)\b)?(?:\s*(?:de\s+la\s+|por\s+la\s+)?(tarde|noche|manana|mediodia|pm|am)\b)?|\ba\s+las?\s+(\d{1,2})\b(?:\s*(?:de\s+la\s+|por\s+la\s+)?(tarde|noche|manana|mediodia|pm|am)\b)?/;

function aHora(h: number, min: number, franja?: string): string | null {
  let hh = h;
  if (franja && ["tarde", "noche", "pm"].includes(franja) && hh < 12) hh += 12;
  if (franja === "mediodia" && hh < 6) hh += 12;
  if (franja === "am" && hh === 12) hh = 0;
  if (hh > 23 || min > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function horaDeCoincidencia(m: RegExpMatchArray): string | null {
  if (m[1] !== undefined) return aHora(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3]);
  if (m[4] !== undefined) return aHora(Number(m[4]), 0, m[5]);
  return null;
}

/** «14:15», «14h15», «14h», «a las 14», «2:15 tarde» → «14:15». */
export function parsearHora(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = sinTildes(v).trim();
  const m = t.match(RE_HORA);
  if (m) return horaDeCoincidencia(m);
  const solo = t.match(/^(\d{1,2})$/);
  return solo ? aHora(Number(solo[1]), 0) : null;
}

// ─── Fecha ──────────────────────────────────────────────────────────────────

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const ABREVIATURAS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, setiembre: 9,
  oct: 10, nov: 11, dic: 12,
};

/** «noviembre», «noviempre», «nov» → 11. null si no parece un mes. */
export function parsearMes(palabra: string): number | null {
  const p = sinTildes(palabra).replace(/[^a-z]/g, "");
  if (p.length < 3) return null;
  if (ABREVIATURAS[p]) return ABREVIATURAS[p];
  let mejor: { mes: number; d: number } | null = null;
  MESES.forEach((nombre, i) => {
    const d = distancia(p, nombre);
    if (d <= tolerancia(nombre.length) && (!mejor || d < mejor.d)) mejor = { mes: i + 1, d };
  });
  return mejor ? (mejor as { mes: number }).mes : null;
}

/** Hoy en Madrid, como {anio, mes, dia}. */
export function hoyEnMadrid(ahora: Date = new Date()): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const valor = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { anio: valor("year"), mes: valor("month"), dia: valor("day") };
}

function fechaValida(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Día y mes (y año si se escribió) → YYYY-MM-DD. Sin año: este año en Madrid,
 * o el siguiente si ese día ya pasó (hoy mismo cuenta como este año).
 */
export function componerFecha(dia: number, mes: number, anio: number | null | undefined, ahora: Date = new Date()): string | null {
  if (!Number.isInteger(dia) || !Number.isInteger(mes)) return null;
  let a: number;
  if (typeof anio === "number" && Number.isInteger(anio)) {
    a = anio < 100 ? 2000 + anio : anio;
  } else {
    const hoy = hoyEnMadrid(ahora);
    const yaPaso = mes < hoy.mes || (mes === hoy.mes && dia < hoy.dia);
    a = yaPaso ? hoy.anio + 1 : hoy.anio;
  }
  return fechaValida(a, mes, dia) ? iso(a, mes, dia) : null;
}

function sumarDias(ahora: Date, dias: number): string {
  const h = hoyEnMadrid(ahora);
  const d = new Date(Date.UTC(h.anio, h.mes - 1, h.dia + dias));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const RE_FECHA_TEXTO = /\b(\d{1,2})\s*(?:de\s+)?([a-z]{3,12})\.?(?:\s+(?:de\s+|del\s+)?(\d{4}))?/g;
const RE_FECHA_NUM = /\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2}|\d{4}))?\b/;
const RE_FECHA_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;

interface Coincidencia {
  valor: string;
  inicio: number;
  fin: number;
}

function buscarFecha(t: string, ahora: Date): Coincidencia | null {
  const isoM = t.match(RE_FECHA_ISO);
  if (isoM && isoM.index !== undefined) {
    const v = fechaValida(+isoM[1], +isoM[2], +isoM[3]) ? iso(+isoM[1], +isoM[2], +isoM[3]) : null;
    if (v) return { valor: v, inicio: isoM.index, fin: isoM.index + isoM[0].length };
  }
  for (const m of t.matchAll(RE_FECHA_TEXTO)) {
    const mes = parsearMes(m[2]);
    if (!mes || m.index === undefined) continue;
    const v = componerFecha(Number(m[1]), mes, m[3] ? Number(m[3]) : null, ahora);
    if (v) return { valor: v, inicio: m.index, fin: m.index + m[0].length };
  }
  const num = t.match(RE_FECHA_NUM);
  if (num && num.index !== undefined) {
    const v = componerFecha(Number(num[1]), Number(num[2]), num[3] ? Number(num[3]) : null, ahora);
    if (v) return { valor: v, inicio: num.index, fin: num.index + num[0].length };
  }
  const rel = t.match(/\b(pasado\s+manana|manana|hoy)\b/);
  if (rel && rel.index !== undefined) {
    const dias = rel[1] === "hoy" ? 0 : rel[1] === "manana" ? 1 : 2;
    return { valor: sumarDias(ahora, dias), inicio: rel.index, fin: rel.index + rel[0].length };
  }
  return null;
}

/** «13 noviembre», «13/11», «mañana»… → YYYY-MM-DD (ver componerFecha). */
export function parsearFecha(v: unknown, ahora: Date = new Date()): string | null {
  if (typeof v !== "string") return null;
  return buscarFecha(sinTildes(v), ahora)?.valor ?? null;
}

// ─── Espacio ────────────────────────────────────────────────────────────────

const PALABRAS_VACIAS = new Set([
  "a", "al", "el", "la", "las", "los", "de", "del", "en", "para", "y", "con", "por", "sala", "zona", "mesa",
]);

function palabras(s: string): string[] {
  return sinTildes(s).split(/[^a-z0-9]+/).filter((p) => p && !PALABRAS_VACIAS.has(p));
}

/** Puntuación 0-1 de lo escrito contra el nombre de una sala (0 = no casa). */
function puntuarEspacio(escrito: string, nombre: string): number {
  const e = sinTildes(escrito).replace(/[^a-z0-9]+/g, " ").trim();
  const n = sinTildes(nombre).replace(/[^a-z0-9]+/g, " ").trim();
  if (!e || !n) return 0;
  if (e === n) return 1;
  if (distancia(e, n) <= tolerancia(n.length)) return 0.9;
  const pe = palabras(escrito);
  const pn = palabras(nombre);
  if (!pe.length || !pn.length) return 0;
  // Cada palabra escrita tiene que casar con alguna del nombre.
  let total = 0;
  for (const w of pe) {
    let mejor = 0;
    for (const x of pn) {
      if (w === x) mejor = Math.max(mejor, 1);
      else if (w.length >= 4 && x.startsWith(w)) mejor = Math.max(mejor, 0.8);
      else if (distancia(w, x) <= tolerancia(x.length)) mejor = Math.max(mejor, 0.7);
    }
    if (mejor === 0) return 0;
    total += mejor;
  }
  // Penaliza las palabras del nombre que no se escribieron (prefiere «Salón» a «Salón privado»).
  return (total / pe.length) * (0.7 + (0.3 * Math.min(pe.length, pn.length)) / pn.length);
}

/** Sala de la lista que mejor casa con lo escrito, o null si ninguna casa o hay empate. */
export function resolverEspacio(escrito: unknown, espacios: EspacioRef[] = []): EspacioRef | null {
  if (typeof escrito !== "string" || !escrito.trim()) return null;
  const puntos = espacios
    .map((e) => ({ e, p: puntuarEspacio(escrito, e.nombre) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p);
  if (!puntos.length) return null;
  if (puntos.length > 1 && Math.abs(puntos[0].p - puntos[1].p) < 0.01) return null; // ambiguo
  return puntos[0].e;
}

// ─── Teléfono y email ───────────────────────────────────────────────────────

const RE_TELEFONO = /(?:\+|00)?\d(?:[\s.-]?\d){8,13}/;
const RE_EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

export function parsearTelefono(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(RE_TELEFONO);
  if (!m) return null;
  const limpio = m[0].replace(/[\s.-]/g, "");
  const digitos = limpio.replace(/^\+|^00/, "");
  return digitos.length >= 9 ? limpio : null;
}

export function parsearEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.replace(/\s+/g, "").match(RE_EMAIL);
  return m ? m[0].toLowerCase() : null;
}

// ─── Texto libre ────────────────────────────────────────────────────────────

/**
 * Interpreta una línea escrita a mano sin ayuda del modelo («Esther 2px salón
 * 13 noviembre 14:15»). Va quitando lo reconocido (hora, fecha, comensales,
 * teléfono, email, sala) y el nombre es lo que queda.
 */
export function interpretarTextoLibre(texto: string, opciones: OpcionesNormalizar = {}): ReservaInterpretada {
  const ahora = opciones.hoy ?? new Date();
  const espacios = opciones.espacios ?? [];
  const original = texto.replace(/\s+/g, " ").trim();
  // Trabaja sobre una copia sin tildes con la MISMA longitud por carácter
  // (cada carácter se normaliza por separado), para recortar el original.
  let t = Array.from(original).map((c) => sinTildes(c).slice(0, 1) || " ").join("");
  const resto = Array.from(original);
  const quitar = (inicio: number, fin: number) => {
    for (let i = inicio; i < fin; i++) resto[i] = " ";
    t = t.slice(0, inicio) + " ".repeat(fin - inicio) + t.slice(fin);
  };

  const email = (() => {
    const m = t.match(RE_EMAIL);
    if (!m || m.index === undefined) return null;
    quitar(m.index, m.index + m[0].length);
    return m[0].toLowerCase();
  })();

  const telefono = (() => {
    const m = t.match(RE_TELEFONO);
    if (!m || m.index === undefined) return null;
    const v = parsearTelefono(m[0]);
    if (v) quitar(m.index, m.index + m[0].length);
    return v;
  })();

  const hora = (() => {
    const m = t.match(RE_HORA);
    if (!m || m.index === undefined) return null;
    const v = horaDeCoincidencia(m);
    if (v) quitar(m.index, m.index + m[0].length);
    return v;
  })();

  const comensales = (() => {
    const m = t.match(RE_COMENSALES);
    if (!m || m.index === undefined) return null;
    const v = parsearComensales(m[0]);
    if (v) quitar(m.index, m.index + m[0].length);
    return v;
  })();

  const fecha = (() => {
    const f = buscarFecha(t, ahora);
    if (!f) return null;
    quitar(f.inicio, f.fin);
    return f.valor;
  })();

  // Sala: la palabra (o par de palabras) que mejor casa con alguna sala real.
  let espacio: EspacioRef | null = null;
  let espacioTexto: string | null = null;
  const tokens = [...t.matchAll(/[a-z0-9]+/g)].map((m) => ({ w: m[0], i: m.index ?? 0 }));
  let mejor = { p: 0, inicio: 0, fin: 0, e: null as EspacioRef | null };
  for (let k = 0; k < tokens.length; k++) {
    for (const n of [2, 1]) {
      if (k + n > tokens.length) continue;
      const trozo = tokens.slice(k, k + n);
      if (trozo.some((x) => PALABRAS_VACIAS.has(x.w) || /^\d+$/.test(x.w))) continue;
      const escrito = trozo.map((x) => x.w).join(" ");
      for (const e of espacios) {
        const p = puntuarEspacio(escrito, e.nombre);
        if (p > mejor.p) {
          const ult = trozo[trozo.length - 1];
          mejor = { p, inicio: trozo[0].i, fin: ult.i + ult.w.length, e };
        }
      }
    }
  }
  if (mejor.e && mejor.p >= 0.7) {
    espacio = mejor.e;
    espacioTexto = original.slice(mejor.inicio, mejor.fin);
    quitar(mejor.inicio, mejor.fin);
  }

  // Nombre: las palabras que quedan, sin conectores sueltos.
  const nombre = resto
    .join("")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}.'-]+$/gu, ""))
    .filter((w) => w && /\p{L}/u.test(w) && !PALABRAS_VACIAS.has(sinTildes(w)) && !/^(px|pax|personas?|h)$/i.test(w))
    .slice(0, 5)
    .join(" ");

  return {
    nombre: nombre || null,
    telefono,
    email,
    fecha,
    hora,
    comensales,
    espacio_id: espacio?.id ?? null,
    espacio_nombre: espacio?.nombre ?? null,
    espacio_texto: espacioTexto,
    notas: null,
    texto: original || null,
    fecha_escrita: fecha !== null,
  };
}

// ─── Entrada principal ──────────────────────────────────────────────────────

/**
 * Lectura del modelo (o texto suelto) → campos del alta. Lo que el modelo dé
 * manda; lo que falte se busca en la transcripción literal.
 */
export function normalizarReservaManuscrita(
  entrada: LecturaModelo | string | null | undefined,
  opciones: OpcionesNormalizar = {},
): ReservaInterpretada {
  const ahora = opciones.hoy ?? new Date();
  const espacios = opciones.espacios ?? [];
  const lectura: LecturaModelo = typeof entrada === "string" ? { texto: entrada } : entrada ?? {};
  const texto = textoONull(lectura.texto, 1000);
  const libre = texto ? interpretarTextoLibre(texto, { espacios, hoy: ahora }) : null;

  let fecha: string | null = null;
  if (typeof lectura.dia === "number" && typeof lectura.mes === "number") {
    fecha = componerFecha(lectura.dia, lectura.mes, lectura.anio ?? null, ahora);
  }
  fecha ??= parsearFecha(lectura.fecha, ahora) ?? libre?.fecha ?? null;
  const fechaEscrita = fecha !== null;
  const porDefecto = opciones.fechaPorDefecto && /^\d{4}-\d{2}-\d{2}$/.test(opciones.fechaPorDefecto) ? opciones.fechaPorDefecto : null;
  fecha ??= porDefecto;

  const espacioTexto = textoONull(lectura.espacio, 80);
  const espacio = resolverEspacio(espacioTexto, espacios);
  const espacioFinal = espacio
    ? { id: espacio.id, nombre: espacio.nombre, texto: espacioTexto }
    : libre?.espacio_id
      ? { id: libre.espacio_id, nombre: libre.espacio_nombre, texto: libre.espacio_texto }
      : { id: null, nombre: null, texto: espacioTexto ?? libre?.espacio_texto ?? null };

  const nombre = textoONull(lectura.nombre, 80) ?? libre?.nombre ?? null;

  return {
    nombre: nombre ? nombre.replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : null,
    telefono: parsearTelefono(lectura.telefono) ?? libre?.telefono ?? null,
    email: parsearEmail(lectura.email) ?? libre?.email ?? null,
    fecha,
    hora: parsearHora(lectura.hora) ?? libre?.hora ?? null,
    comensales: parsearComensales(lectura.comensales) ?? libre?.comensales ?? null,
    espacio_id: espacioFinal.id,
    espacio_nombre: espacioFinal.nombre,
    espacio_texto: espacioFinal.texto,
    notas: textoONull(lectura.notas, 500),
    texto,
    fecha_escrita: fechaEscrita,
  };
}

/**
 * Limpieza de lo que devuelve el modelo antes de mandarlo al panel (Edge
 * Function): solo tipos y longitudes; la interpretación la hace el panel.
 */
export function limpiarLecturaModelo(raw: unknown): LecturaModelo {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const entero = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
  return {
    texto: textoONull(r.texto, 1000),
    nombre: textoONull(r.nombre, 80),
    telefono: textoONull(r.telefono, 40),
    email: textoONull(r.email, 120),
    comensales: entero(r.comensales, 1, 500) ?? textoONull(r.comensales, 20),
    espacio: textoONull(r.espacio, 80),
    fecha: textoONull(r.fecha, 60),
    dia: entero(r.dia, 1, 31),
    mes: entero(r.mes, 1, 12),
    anio: entero(r.anio, 2000, 2100),
    hora: textoONull(r.hora, 30),
    notas: textoONull(r.notas, 500),
  };
}
