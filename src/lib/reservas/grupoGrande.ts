// ============================================================================
// GRUPOS GRANDES — reglas de asignación automática y sugerencia para 8 o más
// ----------------------------------------------------------------------------
// Decisión del dueño (13/10/2026):
//   · La web solo admite reservas de hasta 7 personas. La asignación
//     AUTOMÁTICA («Organizar», «Repartir») ya no necesita lógica complicada:
//     una mesa, o como mucho DOS mesas juntas (piezas de 2 + pico: 6 + pico
//     = 7). Nunca combina tres o más mesas por su cuenta.
//   · Los grupos de 8 o más entran siempre por teléfono y los revisa una
//     persona: no se asignan solos; quedan para la asignación a mano, con
//     una SUGERENCIA de ayuda:
//       - el Reservado admite 14 (capacidad de la sala en la BD, 14 desde la
//         migración 20261013130000; si no llega el dato, `CAPACIDAD_RESERVADO`);
//       - si son más de 14 (o el Reservado ya está cogido en ese turno), se
//         monta una MESA LARGA en el SALÓN, pegada a la pared de abajo a la
//         derecha (tal como se ve el plano en el panel), juntando piezas de
//         las mesas del Salón como en el resto del modelo.
// Es solo una propuesta: no crea mesas en la BD ni mueve nada. El personal la
// monta y asigna a mano (juntar / pasar piezas, como siempre).
//
// DÓNDE VA LA MESA LARGA (fácil de cambiar: `MESA_LARGA_SALON`)
//   El plano del Salón (migración 20261008190000) tiene la sala útil entre
//   x 1,3 y 16,7 m y el fondo (pared de abajo) en y 8,1 m. A lo largo de la
//   pared de ABAJO, desde la esquina de la DERECHA hacia la izquierda, hay
//   unos 7 m libres de mesas de piezas (la fila 1–4 acaba en x ≈ 8,9 m); por
//   la pared de la derecha solo hay ~5 m antes de la 10. Por eso la mesa
//   larga va en horizontal, pegada a la pared de abajo, empezando en la
//   esquina de abajo a la derecha. Deja `holguraParedM` libre entre la mesa
//   y cada pared (sillas). Si el plano tiene paredes dibujadas, la esquina
//   se calcula con ellas; si no, con `paredesPorDefecto`.
// ============================================================================

import { piezasNecesarias, plazasDe } from "./piezasMesa";

/** Máximo de comensales que se asignan solos (lo que admite la web). */
export const MAX_COMENSALES_AUTO = 7;
/** Máximo de mesas que la asignación automática junta para una reserva. */
export const MAX_MESAS_AUTO = 2;
/** Capacidad del Reservado si la BD no la da. */
export const CAPACIDAD_RESERVADO = 14;

/** ¿Se puede asignar sola (1 mesa o 2 juntas)? 8 o más: la revisa una persona. */
export function seAsignaSolo(comensales: number): boolean {
  const n = Number(comensales);
  return Number.isFinite(n) && n > 0 && n <= MAX_COMENSALES_AUTO;
}

/** Grupo grande: 8 o más. Nunca se asigna solo. */
export function esGrupoGrande(comensales: number): boolean {
  return Number(comensales) > MAX_COMENSALES_AUTO;
}

/** ¿No cabe en el Reservado? (más de su capacidad, 14). */
export function excedeReservado(comensales: number, capacidad: number | null | undefined = CAPACIDAD_RESERVADO): boolean {
  const cap = Number(capacidad) > 0 ? Number(capacidad) : CAPACIDAD_RESERVADO;
  return Number(comensales) > cap;
}

// ─── Configuración de la mesa larga ──────────────────────────────────────────

export type Pared = "abajo" | "arriba" | "izquierda" | "derecha";

export interface ConfigMesaLarga {
  /** Nombre de la sala donde se monta (se compara sin tildes ni mayúsculas). */
  sala: string;
  /** Pared a lo largo de la cual va la mesa. */
  pared: Pared;
  /** Extremo de esa pared donde empieza (la esquina). */
  extremo: Pared;
  /** Largo de una pieza a lo largo de la fila (cm). */
  largoPiezaCm: number;
  /** Fondo de la mesa (cm). */
  fondoCm: number;
  /** Picos posibles (una silla en cada cabecera). */
  picosMax: number;
  /** Hueco libre entre la mesa y cada pared, para las sillas (m). */
  holguraParedM: number;
  /** Paredes de la sala (m) si el plano no tiene paredes dibujadas. */
  paredesPorDefecto: { izquierda: number; derecha: number; arriba: number; abajo: number };
}

/** Mesa larga del Salón: pared de abajo, desde la esquina de la derecha. CAMBIAR AQUÍ. */
export const MESA_LARGA_SALON: ConfigMesaLarga = {
  sala: "Salón",
  pared: "abajo",
  extremo: "derecha",
  largoPiezaCm: 55,
  fondoCm: 70,
  picosMax: 2,
  holguraParedM: 0.6,
  paredesPorDefecto: { izquierda: 1.3, derecha: 16.7, arriba: 0.3, abajo: 8.1 },
};

/** Sin tildes, minúsculas y sin espacios de sobra. */
export function normalizarNombre(nombre: string | null | undefined): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** ¿Es la sala de la mesa larga? */
export function esSalaMesaLarga(nombre: string | null | undefined, config: ConfigMesaLarga = MESA_LARGA_SALON): boolean {
  return normalizarNombre(nombre) === normalizarNombre(config.sala);
}

// ─── Geometría ───────────────────────────────────────────────────────────────

/** Lo que hace falta del plano (`planos_espacio`). Paredes en px de escena. */
export interface PlanoSalaMin {
  pixels_per_meter?: number | null;
  ancho_metros?: number | null;
  alto_metros?: number | null;
  configuracion?: { elementos?: ReadonlyArray<{ tipo?: string; props?: Record<string, unknown> | null }> | null } | null;
}

export interface Limites {
  izquierda: number;
  derecha: number;
  arriba: number;
  abajo: number;
}

/** Tramo de pared del plano, en metros (solo horizontales o verticales). */
export interface TramoPared {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  orientacion: "horizontal" | "vertical";
}

/**
 * Paredes dibujadas en el plano (`tipo: "wall"`), pasadas a metros. Se quedan
 * fuera los trozos cortos (< 1 m) y las paredes inclinadas.
 */
export function paredesPlano(plano: PlanoSalaMin | null | undefined): TramoPared[] {
  const ppm = Number(plano?.pixels_per_meter) > 0 ? Number(plano?.pixels_per_meter) : 50;
  const tramos: TramoPared[] = [];
  for (const e of plano?.configuracion?.elementos ?? []) {
    if (e?.tipo !== "wall" || !e.props) continue;
    const x1 = Number(e.props.x1) / ppm;
    const y1 = Number(e.props.y1) / ppm;
    const x2 = Number(e.props.x2) / ppm;
    const y2 = Number(e.props.y2) / ppm;
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    if (dx < 1 && dy < 1) continue; // trozos cortos: no son paredes de la sala
    if (dy <= dx * 0.1) tramos.push({ x1, y1, x2, y2, orientacion: "horizontal" });
    else if (dx <= dy * 0.1) tramos.push({ x1, y1, x2, y2, orientacion: "vertical" });
  }
  return tramos;
}

/**
 * Paredes exteriores de la sala, en metros: con las paredes dibujadas en el
 * plano (la horizontal más baja es la de abajo, la vertical más a la derecha la
 * de la derecha…); sin paredes, las de la configuración.
 */
export function limitesSala(plano: PlanoSalaMin | null | undefined, config: ConfigMesaLarga = MESA_LARGA_SALON): Limites {
  const tramos = paredesPlano(plano);
  const horizontales = tramos.filter((t) => t.orientacion === "horizontal").map((t) => (t.y1 + t.y2) / 2);
  const verticales = tramos.filter((t) => t.orientacion === "vertical").map((t) => (t.x1 + t.x2) / 2);
  const d = config.paredesPorDefecto;
  if (horizontales.length >= 2 && verticales.length >= 2) {
    return {
      izquierda: Math.min(...verticales),
      derecha: Math.max(...verticales),
      arriba: Math.min(...horizontales),
      abajo: Math.max(...horizontales),
    };
  }
  return { ...d };
}

/** Mesa del plano, lo justo para la geometría y las piezas (pos en m, tamaño en cm). */
export interface MesaPlanoMin {
  id: string;
  nombre: string;
  forma?: string | null;
  ancho?: number | null;
  alto?: number | null;
  pos_x?: number | null;
  pos_y?: number | null;
  capacidad?: number | null;
  activa?: boolean | null;
  piezas?: number | null;
  plazas_min?: number | null;
}

export interface Rect {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

function rectDe(m: MesaPlanoMin): Rect {
  return { x: Number(m.pos_x) || 0, y: Number(m.pos_y) || 0, ancho: (Number(m.ancho) || 80) / 100, alto: (Number(m.alto) || 80) / 100 };
}

/** ¿Se pisan dos rectángulos? (tocarse por el borde no cuenta). */
export function seSolapan(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto;
}

export interface Donante {
  mesaId: string;
  nombre: string;
  piezas: number;
}

export interface MesaLarga {
  piezas: number;
  picos: number;
  plazas: number;
  /** Mesa dibujada: esquina sup. izq. en METROS, tamaño en CM (como `mesas`). */
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  /** Largo en metros (para el texto). */
  largoM: number;
  /** Mesas que están donde va la mesa larga (o sus sillas): hay que retirarlas. */
  estorban: string[];
  /** De qué mesas del Salón salen las piezas (libres en ese servicio, la más cercana primero). */
  donantes: Donante[];
  /** Piezas que no salen de las mesas libres del Salón (0 = llegan). */
  faltanPiezas: number;
}

/**
 * La mesa larga para `comensales` en la esquina configurada. `ocupadas`: mesas
 * con reserva en ese servicio (no prestan piezas). No mueve nada: solo calcula.
 */
export function mesaLargaPara(params: {
  comensales: number;
  mesas: readonly MesaPlanoMin[];
  plano?: PlanoSalaMin | null;
  ocupadas?: ReadonlySet<string>;
  config?: ConfigMesaLarga;
}): MesaLarga {
  const config = params.config ?? MESA_LARGA_SALON;
  const { piezas, picos } = piezasNecesarias(params.comensales, config.picosMax);
  const lim = limitesSala(params.plano, config);
  const h = config.holguraParedM;
  const largo = (piezas * config.largoPiezaCm) / 100;
  const fondo = config.fondoCm / 100;
  const horizontal = config.pared === "abajo" || config.pared === "arriba";
  const anchoM = horizontal ? largo : fondo;
  const altoM = horizontal ? fondo : largo;

  let x: number;
  let y: number;
  if (horizontal) {
    y = config.pared === "abajo" ? lim.abajo - h - fondo : lim.arriba + h;
    x = config.extremo === "izquierda" ? lim.izquierda + h : lim.derecha - h - largo;
  } else {
    x = config.pared === "derecha" ? lim.derecha - h - fondo : lim.izquierda + h;
    y = config.extremo === "arriba" ? lim.arriba + h : lim.abajo - h - largo;
  }
  const redondear = (v: number) => Math.round(v * 100) / 100;
  const mesaRect: Rect = { x, y, ancho: anchoM, alto: altoM };
  // Las sillas: la holgura alrededor de la mesa también tiene que estar libre.
  const conSillas: Rect = { x: x - h, y: y - h, ancho: anchoM + 2 * h, alto: altoM + 2 * h };

  const activas = params.mesas.filter((m) => m.activa !== false);
  const estorban = activas
    .filter((m) => seSolapan(conSillas, rectDe(m)))
    .map((m) => m.nombre)
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

  // Piezas: de las mesas por piezas del Salón que están libres en ese servicio.
  const centro = { x: x + anchoM / 2, y: y + altoM / 2 };
  const ocupadas = params.ocupadas ?? new Set<string>();
  const candidatas = activas
    .filter((m) => Number(m.piezas) > 0 && m.forma !== "circular" && !ocupadas.has(m.id))
    .map((m) => {
      const r = rectDe(m);
      return { m, d: Math.hypot(r.x + r.ancho / 2 - centro.x, r.y + r.alto / 2 - centro.y) };
    })
    .sort((a, b) => a.d - b.d || a.m.nombre.localeCompare(b.m.nombre, "es", { numeric: true }));
  const donantes: Donante[] = [];
  let resto = piezas;
  for (const { m } of candidatas) {
    if (resto <= 0) break;
    const n = Math.min(Number(m.piezas), resto);
    donantes.push({ mesaId: m.id, nombre: m.nombre, piezas: n });
    resto -= n;
  }

  return {
    piezas,
    picos,
    plazas: plazasDe({ piezas, picos }),
    pos_x: redondear(mesaRect.x),
    pos_y: redondear(mesaRect.y),
    ancho: Math.round(anchoM * 100),
    alto: Math.round(altoM * 100),
    largoM: redondear(largo),
    estorban,
    donantes,
    // Sin mesas cargadas no se sabe de dónde saldrían: no se avisa de que faltan.
    faltanPiezas: params.mesas.length > 0 ? Math.max(0, resto) : 0,
  };
}

const NOMBRE_PARED: Record<Pared, string> = { abajo: "de abajo", arriba: "de arriba", izquierda: "de la izquierda", derecha: "de la derecha" };
const NOMBRE_EXTREMO: Record<Pared, string> = { abajo: "abajo", arriba: "arriba", izquierda: "a la izquierda", derecha: "a la derecha" };

/** «pegada a la pared de abajo a la derecha». */
export function textoSitioMesaLarga(config: ConfigMesaLarga = MESA_LARGA_SALON): string {
  return `pegada a la pared ${NOMBRE_PARED[config.pared]} ${NOMBRE_EXTREMO[config.extremo]}`;
}

function lista(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** «8 piezas + 2 picos (18 plazas, 4,4 m)». */
export function textoMedidasMesaLarga(m: MesaLarga): string {
  const picos = m.picos === 0 ? "" : m.picos === 1 ? " + pico" : ` + ${m.picos} picos`;
  return `${m.piezas} piezas${picos} (${m.plazas} plazas, ${m.largoM.toLocaleString("es-ES")} m)`;
}

/** Cómo montarla: de dónde salen las piezas y qué hay que retirar. */
export function textoMontajeMesaLarga(m: MesaLarga): string {
  const partes: string[] = [];
  if (m.donantes.length > 0) {
    partes.push(`piezas de ${lista(m.donantes.map((d) => `la ${d.nombre} (${d.piezas})`))}`);
  }
  if (m.faltanPiezas > 0) partes.push(`faltan ${m.faltanPiezas} piezas libres en el Salón`);
  if (m.estorban.length > 0) partes.push(`retira antes ${lista(m.estorban.map((n) => `la ${n}`))}`);
  return partes.join("; ");
}

// ─── Sugerencia ──────────────────────────────────────────────────────────────

export interface SalaSugerencia {
  id: string;
  nombre: string;
}

export type SugerenciaGrupo =
  | { tipo: "reservado"; sala: SalaSugerencia; capacidad: number; texto: string }
  | { tipo: "mesa_larga"; sala: SalaSugerencia; mesaLarga: MesaLarga; texto: string }
  | { tipo: "manual"; texto: string };

/**
 * Ayuda para asignar a mano un grupo de 8 o más (`null` si se asigna solo).
 *   · Hasta la capacidad del Reservado (14) y libre en ese turno → el Reservado.
 *   · Más de 14 (o Reservado cogido) → mesa larga en el Salón, en la esquina
 *     configurada, con las piezas de las mesas libres del Salón.
 *   · Sin Salón ni Reservado → «asígnalo a mano».
 * `forzarSalon`: la reserva ya está en el Reservado y no cabe (se usa en la
 * ficha del Reservado aunque el grupo sea de menos de 8).
 */
export function sugerenciaGrupoGrande(params: {
  comensales: number;
  reservado?: (SalaSugerencia & { capacidad?: number | null; ocupadoPor?: string | null }) | null;
  /** `mesas` sin cargar: solo medidas y sitio, sin de dónde salen las piezas. */
  salon?: (SalaSugerencia & { mesas?: readonly MesaPlanoMin[]; plano?: PlanoSalaMin | null; ocupadas?: ReadonlySet<string> }) | null;
  config?: ConfigMesaLarga;
  forzarSalon?: boolean;
}): SugerenciaGrupo | null {
  const { comensales, reservado, salon } = params;
  const config = params.config ?? MESA_LARGA_SALON;
  if (!params.forzarSalon && !esGrupoGrande(comensales)) return null;
  const capacidad = Number(reservado?.capacidad) > 0 ? Number(reservado?.capacidad) : CAPACIDAD_RESERVADO;
  const cabeEnReservado = !!reservado && !params.forzarSalon && comensales <= capacidad;

  if (cabeEnReservado && !reservado!.ocupadoPor) {
    return {
      tipo: "reservado",
      sala: { id: reservado!.id, nombre: reservado!.nombre },
      capacidad,
      texto: `Grupo de ${comensales}: al ${reservado!.nombre} (hasta ${capacidad}).`,
    };
  }
  if (salon) {
    const mesaLarga = mesaLargaPara({ comensales, mesas: salon.mesas ?? [], plano: salon.plano, ocupadas: salon.ocupadas, config });
    const motivo = cabeEnReservado
      ? `${reservado!.nombre} ya lo tiene ${reservado!.ocupadoPor} en este turno`
      : `más de ${capacidad}: no caben en el ${reservado?.nombre ?? "Reservado"}`;
    const montaje = textoMontajeMesaLarga(mesaLarga);
    return {
      tipo: "mesa_larga",
      sala: { id: salon.id, nombre: salon.nombre },
      mesaLarga,
      texto:
        `Grupo de ${comensales} (${motivo}): mesa larga en el ${salon.nombre}, ${textoSitioMesaLarga(config)}, ` +
        `${textoMedidasMesaLarga(mesaLarga)}${montaje ? `. ${capitalizar(montaje)}.` : "."}`,
    };
  }
  return { tipo: "manual", texto: `Grupo de ${comensales}: asígnalo a mano.` };
}

function capitalizar(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
