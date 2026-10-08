// ============================================================================
// MESAS POR PIEZAS — lógica pura (sin React ni Supabase)
// ----------------------------------------------------------------------------
// Modelo acordado con el dueño (08/10/2026), pensado para el Comedor de Casa
// Tomás y válido para Salón y Terraza cuando se configuren:
//   · Cada mesa tiene número fijo. Su tamaño se cuenta en PIEZAS: la pieza
//     básica es una mesa de 2 (una silla a cada lado). Una «de 4» = 2 piezas.
//   · PICO = +1 silla en una cabecera. Plazas = 2 × piezas + picos.
//       2 piezas → 4, con pico 5 · 3 piezas → 6, con pico 7.
//   · El PLANO BASE (columnas de `mesas`) no se toca nunca desde el servicio.
//     Cada servicio (fecha + comida/cena) guarda sus AJUSTES aparte
//     (`ajustes_mesa_servicio`): piezas, picos y con quién está junta.
//   · Las piezas solo pasan entre mesas del mismo `grupo_piezas` (el plano
//     define qué huecos son físicamente posibles: nunca a través de columnas)
//     y nunca a una mesa redonda ni más allá de `piezas_max` (el hueco).
//   · La app PROPONE, nunca mueve sin confirmar, y no quita piezas que
//     necesite otra reserva de ese servicio.
// ============================================================================

/** Hacia dónde se alarga la fila. Derecha/izquierda: fila horizontal; abajo/arriba: vertical. */
export type LadoCrecimiento = "derecha" | "izquierda" | "abajo" | "arriba";

/** Configuración base de una mesa por piezas (lo que dice el plano). */
export interface MesaPiezas {
  id: string;
  nombre: string;
  /** Piezas del plano base (≥ 1). */
  piezas: number;
  /** Picos del plano base (0..picosMax). */
  picos: number;
  /** Cabeceras donde cabe un pico (0, 1 o 2). */
  picosMax: number;
  /** Hueco: máximo de piezas que caben en fila en su sitio. */
  piezasMax: number;
  /** Mesas que pueden pasarse piezas entre sí. `null` = ninguna. */
  grupo: string | null;
  redonda: boolean;
  /** Centro en metros, solo para medir cercanía. */
  x: number;
  y: number;
}

/** Ajuste guardado de una mesa en un servicio. */
export interface AjusteMesa {
  mesaId: string;
  piezas: number;
  picos: number;
  /** Mesa principal con la que está junta (fila unida). `null` = suelta. */
  unidaA: string | null;
}

export interface EstadoMesa {
  piezas: number;
  picos: number;
  unidaA: string | null;
}

export type EstadoServicio = Map<string, EstadoMesa>;

/** Una reserva del servicio y las mesas que ocupa. */
export interface ReservaEnMesas {
  reservaId: string;
  mesaIds: string[];
  comensales: number;
}

export type Paso =
  | { tipo: "mover"; desde: string; hacia: string; n: number }
  | { tipo: "pico"; mesa: string; n: number };

export interface Propuesta {
  pasos: Paso[];
  /** «Para sentar 7 en la 3: pasa una pieza de la 4 a la 3 y pon pico». */
  texto: string;
  /** Estado final de cada mesa tocada, listo para guardar. */
  cambios: AjusteMesa[];
}

export interface ResultadoPropuesta {
  propuestas: Propuesta[];
  /** Por qué no hay propuesta (si no la hay). */
  motivo: string | null;
}

// ─── Plazas ──────────────────────────────────────────────────────────────────

export function plazasDe(e: { piezas: number; picos: number }): number {
  if (e.piezas <= 0) return 0;
  return e.piezas * 2 + e.picos;
}

/**
 * Lo mínimo para sentar `comensales` en una fila: el menor número de piezas,
 * usando picos solo si hacen falta.
 *   7 con 1 pico posible → 3 piezas + 1 pico · 6 → 3 piezas · 5 → 2 + pico.
 */
export function piezasNecesarias(comensales: number, picosMax: number): { piezas: number; picos: number } {
  const c = Math.max(1, comensales);
  const piezas = Math.max(1, Math.ceil((c - picosMax) / 2));
  const picos = Math.max(0, Math.min(picosMax, c - piezas * 2));
  return { piezas, picos };
}

// ─── Estado del servicio ─────────────────────────────────────────────────────

/** Plano base + ajustes del servicio = cómo está cada mesa ahora. */
export function estadoServicio(mesas: MesaPiezas[], ajustes: AjusteMesa[]): EstadoServicio {
  const porMesa = new Map(ajustes.map((a) => [a.mesaId, a]));
  const estado: EstadoServicio = new Map();
  for (const m of mesas) {
    const a = porMesa.get(m.id);
    estado.set(m.id, a ? { piezas: a.piezas, picos: a.picos, unidaA: a.unidaA } : { piezas: m.piezas, picos: m.picos, unidaA: null });
  }
  return estado;
}

/** Ids de la fila unida a la que pertenece la mesa (ella incluida). */
export function mesasDeLaUnion(estado: EstadoServicio, mesaId: string): string[] {
  const principal = estado.get(mesaId)?.unidaA ?? mesaId;
  const ids = [principal];
  for (const [id, e] of estado) if (id !== principal && e.unidaA === principal) ids.push(id);
  return ids.length > 1 || principal !== mesaId ? ids : [mesaId];
}

function estaJunta(estado: EstadoServicio, mesaId: string): boolean {
  return mesasDeLaUnion(estado, mesaId).length > 1;
}

const distancia = (a: MesaPiezas, b: MesaPiezas) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Piezas que una mesa puede soltar sin dejar corta a ninguna reserva del
 * servicio. Si está junta con otra o sentada en varias mesas, no suelta nada.
 */
export function piezasSobrantes(
  mesa: MesaPiezas,
  estado: EstadoServicio,
  reservas: ReservaEnMesas[],
): number {
  const e = estado.get(mesa.id);
  if (!e || e.piezas <= 0 || estaJunta(estado, mesa.id)) return 0;
  let necesita = 0;
  for (const r of reservas) {
    if (!r.mesaIds.includes(mesa.id)) continue;
    if (r.mesaIds.length > 1) return 0;
    necesita = Math.max(necesita, piezasNecesarias(r.comensales, mesa.picosMax).piezas);
  }
  return Math.max(0, e.piezas - necesita);
}

/** ¿Puede `desde` pasar piezas a `hacia`? (hueco definido en el plano) */
export function puedenPasarsePiezas(desde: MesaPiezas, hacia: MesaPiezas): boolean {
  return (
    desde.id !== hacia.id &&
    !desde.redonda &&
    !hacia.redonda &&
    desde.grupo !== null &&
    desde.grupo === hacia.grupo
  );
}

// ─── Textos ──────────────────────────────────────────────────────────────────

const la = (nombre: string) => `la ${nombre}`;
const piezasTexto = (n: number) => (n === 1 ? "una pieza" : `${n} piezas`);

function listaY(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

export function textoPasos(pasos: Paso[], nombres: Map<string, string>): string {
  const nombre = (id: string) => nombres.get(id) ?? "?";
  const movs = pasos.filter((p): p is Extract<Paso, { tipo: "mover" }> => p.tipo === "mover");
  const picos = pasos.filter((p): p is Extract<Paso, { tipo: "pico" }> => p.tipo === "pico");
  const frases: string[] = [];
  if (movs.length > 0) {
    const origen = listaY(movs.map((m) => `${piezasTexto(m.n)} de ${la(nombre(m.desde))}`));
    frases.push(`pasa ${origen} a ${la(nombre(movs[0].hacia))}`);
  }
  for (const p of picos) {
    if (p.n > 0) frases.push(p.n === 1 ? "pon pico" : `pon ${p.n} picos`);
    else frases.push("quita el pico");
  }
  return listaY(frases);
}

// ─── Propuestas ──────────────────────────────────────────────────────────────

interface Donante {
  mesa: MesaPiezas;
  sobran: number;
  libre: boolean;
}

function donantesPara(
  destino: MesaPiezas,
  mesas: MesaPiezas[],
  estado: EstadoServicio,
  reservas: ReservaEnMesas[],
): Donante[] {
  return mesas
    .filter((m) => puedenPasarsePiezas(m, destino))
    .map((m) => ({
      mesa: m,
      sobran: piezasSobrantes(m, estado, reservas),
      libre: !reservas.some((r) => r.mesaIds.includes(m.id)),
    }))
    .filter((d) => d.sobran > 0)
    // Primero la más cercana (la adyacente); a igual distancia, la que está libre.
    .sort((a, b) => distancia(a.mesa, destino) - distancia(b.mesa, destino) || Number(b.libre) - Number(a.libre));
}

/** Reparte `faltan` piezas empezando por `orden[0]`. `null` si no llegan. */
function repartir(orden: Donante[], faltan: number): Array<{ donante: Donante; n: number }> | null {
  const tomas: Array<{ donante: Donante; n: number }> = [];
  let resto = faltan;
  for (const d of orden) {
    if (resto <= 0) break;
    const n = Math.min(d.sobran, resto);
    tomas.push({ donante: d, n });
    resto -= n;
  }
  return resto > 0 ? null : tomas;
}

function montarPropuesta(
  destino: MesaPiezas,
  estado: EstadoServicio,
  tomas: Array<{ donante: Donante; n: number }>,
  picosFinal: number,
  nombres: Map<string, string>,
  prefijo: string,
): Propuesta {
  const actual = estado.get(destino.id)!;
  const pasos: Paso[] = tomas.map((t) => ({ tipo: "mover", desde: t.donante.mesa.id, hacia: destino.id, n: t.n }));
  if (picosFinal !== actual.picos) pasos.push({ tipo: "pico", mesa: destino.id, n: picosFinal - actual.picos });
  const recibidas = tomas.reduce((s, t) => s + t.n, 0);
  const cambios: AjusteMesa[] = [
    { mesaId: destino.id, piezas: actual.piezas + recibidas, picos: picosFinal, unidaA: actual.unidaA },
    ...tomas.map((t) => {
      const e = estado.get(t.donante.mesa.id)!;
      const piezas = e.piezas - t.n;
      return { mesaId: t.donante.mesa.id, piezas, picos: piezas === 0 ? 0 : e.picos, unidaA: e.unidaA };
    }),
  ];
  const texto = textoPasos(pasos, nombres);
  return { pasos, texto: `${prefijo}${texto}`, cambios };
}

/**
 * Qué hacer para que `objetivo` piezas/picos quepan en `destino`. Devuelve
 * varias alternativas: la primera usa la pieza más cercana; las demás empiezan
 * por otra mesa. Nunca incluye movimientos imposibles.
 */
function planesPara(
  destino: MesaPiezas,
  objetivo: { piezas: number; picos: number },
  mesas: MesaPiezas[],
  estado: EstadoServicio,
  reservas: ReservaEnMesas[],
  prefijo: string,
  maximo: number,
): ResultadoPropuesta {
  const actual = estado.get(destino.id);
  if (!actual) return { propuestas: [], motivo: "Esa mesa no está en el plano." };
  if (destino.redonda) return { propuestas: [], motivo: `${capital(la(destino.nombre))} es redonda: no admite piezas ni pico.` };
  if (estaJunta(estado, destino.id)) {
    return { propuestas: [], motivo: `${capital(la(destino.nombre))} está junta con otra mesa: sepáralas primero.` };
  }
  const piezasFinal = Math.max(actual.piezas, objetivo.piezas);
  if (piezasFinal > destino.piezasMax) {
    return {
      propuestas: [],
      motivo: `En el hueco de ${la(destino.nombre)} caben como mucho ${destino.piezasMax} piezas (${plazasDe({ piezas: destino.piezasMax, picos: destino.picosMax })} plazas).`,
    };
  }
  const picosFinal = Math.min(destino.picosMax, Math.max(actual.picos, objetivo.picos));
  const nombres = new Map(mesas.map((m) => [m.id, m.nombre]));
  const faltan = piezasFinal - actual.piezas;

  if (faltan <= 0) {
    if (picosFinal === actual.picos) return { propuestas: [], motivo: null };
    return { propuestas: [montarPropuesta(destino, estado, [], picosFinal, nombres, prefijo)], motivo: null };
  }

  const donantes = donantesPara(destino, mesas, estado, reservas);
  const propuestas: Propuesta[] = [];
  const vistas = new Set<string>();
  for (let i = 0; i < donantes.length && propuestas.length < maximo; i++) {
    const orden = [donantes[i], ...donantes.filter((_, j) => j !== i)];
    const tomas = repartir(orden, faltan);
    if (!tomas) continue;
    const clave = tomas.map((t) => `${t.donante.mesa.id}:${t.n}`).sort().join("|");
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    propuestas.push(montarPropuesta(destino, estado, tomas, picosFinal, nombres, prefijo));
  }
  if (propuestas.length === 0) {
    return {
      propuestas: [],
      motivo:
        destino.grupo === null
          ? `${capital(la(destino.nombre))} no tiene mesas cerca de las que coger piezas.`
          : `No hay piezas libres cerca de ${la(destino.nombre)} en este servicio.`,
    };
  }
  return { propuestas, motivo: null };
}

/**
 * AUTO-PROPUESTA: sentar `comensales` en `mesaId`. Excluye de `reservas` la
 * propia reserva que se está sentando antes de llamar.
 */
export function proponerParaSentar(params: {
  mesas: MesaPiezas[];
  estado: EstadoServicio;
  reservas: ReservaEnMesas[];
  mesaId: string;
  comensales: number;
  maximo?: number;
}): ResultadoPropuesta {
  const { mesas, estado, reservas, mesaId, comensales, maximo = 4 } = params;
  const destino = mesas.find((m) => m.id === mesaId);
  if (!destino) return { propuestas: [], motivo: "Esa mesa no se gestiona por piezas." };
  const actual = estado.get(mesaId);
  if (actual && plazasDe(actual) >= comensales) return { propuestas: [], motivo: null };
  const objetivo = piezasNecesarias(comensales, destino.picosMax);
  return planesPara(destino, objetivo, mesas, estado, reservas, `Para sentar ${comensales} en ${la(destino.nombre)}: `, maximo);
}

/** Botón «+ Mesa en fila»: una pieza más, de la sobrante más cercana. */
export function proponerPiezaEnFila(params: {
  mesas: MesaPiezas[];
  estado: EstadoServicio;
  reservas: ReservaEnMesas[];
  mesaId: string;
}): ResultadoPropuesta {
  const { mesas, estado, reservas, mesaId } = params;
  const destino = mesas.find((m) => m.id === mesaId);
  const actual = estado.get(mesaId);
  if (!destino || !actual) return { propuestas: [], motivo: "Esa mesa no se gestiona por piezas." };
  return planesPara(destino, { piezas: actual.piezas + 1, picos: actual.picos }, mesas, estado, reservas, "", 4);
}

/** Botones «+ Pico» / «− Pico». `null` si no cabe o no hay pico que quitar. */
export function cambiarPico(mesa: MesaPiezas, estado: EstadoServicio, delta: 1 | -1): AjusteMesa | null {
  const e = estado.get(mesa.id);
  if (!e || mesa.redonda || e.piezas <= 0) return null;
  const picos = e.picos + delta;
  if (picos < 0 || picos > mesa.picosMax) return null;
  return { mesaId: mesa.id, piezas: e.piezas, picos, unidaA: e.unidaA };
}

/** Mesas con las que se puede juntar (misma zona, sueltas, no redondas). */
export function candidatasParaJuntar(mesa: MesaPiezas, mesas: MesaPiezas[], estado: EstadoServicio): MesaPiezas[] {
  if (mesa.redonda || estaJunta(estado, mesa.id)) return [];
  return mesas
    .filter((m) => puedenPasarsePiezas(m, mesa) && !estaJunta(estado, m.id) && (estado.get(m.id)?.piezas ?? 0) > 0)
    .sort((a, b) => distancia(a, mesa) - distancia(b, mesa));
}

/** «Juntar con…»: `otra` queda unida a `principal`. Las plazas se suman. */
export function juntar(principal: MesaPiezas, otra: MesaPiezas, estado: EstadoServicio): AjusteMesa[] {
  const p = estado.get(principal.id)!;
  const o = estado.get(otra.id)!;
  return [
    { mesaId: principal.id, piezas: p.piezas, picos: p.picos, unidaA: null },
    { mesaId: otra.id, piezas: o.piezas, picos: o.picos, unidaA: principal.id },
  ];
}

/**
 * «Separar»: deshace la unión y devuelve a la mesa su forma del plano base.
 * Las piezas que le sobran vuelven a las mesas de su zona que están por debajo
 * de su base (la más cercana primero), para no perder piezas por el camino.
 */
export function separar(mesa: MesaPiezas, mesas: MesaPiezas[], estado: EstadoServicio): AjusteMesa[] {
  const cambios = new Map<string, AjusteMesa>();
  const fijar = (id: string, parcial: Partial<AjusteMesa>) => {
    const e = estado.get(id)!;
    const previo = cambios.get(id) ?? { mesaId: id, piezas: e.piezas, picos: e.picos, unidaA: e.unidaA };
    cambios.set(id, { ...previo, ...parcial });
  };

  const union = mesasDeLaUnion(estado, mesa.id);
  if (union.length > 1) for (const id of union) fijar(id, { unidaA: null });

  const e = estado.get(mesa.id)!;
  let sobran = e.piezas - mesa.piezas;
  if (sobran > 0) {
    const receptoras = mesas
      .filter((m) => puedenPasarsePiezas(mesa, m))
      .filter((m) => (cambios.get(m.id)?.piezas ?? estado.get(m.id)!.piezas) < m.piezas)
      .sort((a, b) => distancia(a, mesa) - distancia(b, mesa));
    for (const r of receptoras) {
      if (sobran <= 0) break;
      const actual = cambios.get(r.id)?.piezas ?? estado.get(r.id)!.piezas;
      const n = Math.min(sobran, r.piezas - actual);
      fijar(r.id, { piezas: actual + n, picos: actual === 0 ? r.picos : estado.get(r.id)!.picos });
      sobran -= n;
    }
  }
  // Si prestó piezas, no se inventan: se queda con las que tiene.
  const piezas = Math.min(e.piezas, mesa.piezas);
  const picos = piezas > 0 ? mesa.picos : 0;
  if (e.piezas !== piezas || e.picos !== picos) fijar(mesa.id, { piezas, picos });
  return [...cambios.values()];
}

/** Aplica cambios a un estado (sin mutar el original). */
export function aplicarCambios(estado: EstadoServicio, cambios: AjusteMesa[]): EstadoServicio {
  const nuevo: EstadoServicio = new Map(estado);
  for (const c of cambios) nuevo.set(c.mesaId, { piezas: c.piezas, picos: c.picos, unidaA: c.unidaA });
  return nuevo;
}

function capital(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ─── Puente con las filas de `mesas` ─────────────────────────────────────────

/** Lo que hace falta de una fila de `mesas` (pos en m, tamaño en cm). */
export interface FilaMesaPiezas {
  id: string;
  nombre: string;
  forma: string;
  ancho: number | null;
  alto: number | null;
  pos_x: number | null;
  pos_y: number | null;
  piezas?: number | null;
  picos_base?: number | null;
  picos_max?: number | null;
  piezas_max?: number | null;
  grupo_piezas?: string | null;
  crece_hacia?: string | null;
}

/** `null` si la mesa no se gestiona por piezas (`piezas` vacío). */
export function mesaPiezasDesde(f: FilaMesaPiezas): MesaPiezas | null {
  if (!f.piezas || f.piezas < 1) return null;
  const ancho = (f.ancho ?? 80) / 100;
  const alto = (f.alto ?? 80) / 100;
  return {
    id: f.id,
    nombre: f.nombre,
    piezas: f.piezas,
    picos: f.picos_base ?? 0,
    picosMax: f.forma === "circular" ? 0 : (f.picos_max ?? 0),
    piezasMax: f.forma === "circular" ? f.piezas : Math.max(f.piezas, f.piezas_max ?? f.piezas),
    grupo: f.forma === "circular" ? null : (f.grupo_piezas ?? null),
    redonda: f.forma === "circular",
    x: (f.pos_x ?? 0) + ancho / 2,
    y: (f.pos_y ?? 0) + alto / 2,
  };
}

/**
 * Cómo se pinta la mesa en este servicio: más larga (o más corta) según sus
 * piezas, creciendo hacia `crece_hacia`, y con las plazas recalculadas.
 */
export interface GeometriaServicio {
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  capacidad: number;
  piezas: number;
  picos: number;
  /** Cabecera donde se dibuja el pico: la contraria a la que crece. */
  ladoPico: LadoCrecimiento;
  /** Fila vertical (las piezas se apilan en `alto`). */
  vertical: boolean;
}

const OPUESTO: Record<LadoCrecimiento, LadoCrecimiento> = {
  derecha: "izquierda",
  izquierda: "derecha",
  abajo: "arriba",
  arriba: "abajo",
};

export function geometriaServicio(f: FilaMesaPiezas, e: EstadoMesa | undefined): GeometriaServicio | null {
  if (!f.piezas || f.piezas < 1 || !e) return null;
  const lado: LadoCrecimiento =
    f.crece_hacia === "izquierda" || f.crece_hacia === "abajo" || f.crece_hacia === "arriba" ? f.crece_hacia : "derecha";
  const vertical = lado === "abajo" || lado === "arriba";
  const largoBase = vertical ? (f.alto ?? 80) : (f.ancho ?? 80);
  const largoPieza = largoBase / f.piezas;
  const largo = Math.max(0, e.piezas * largoPieza);
  const desplazamiento = ((e.piezas - f.piezas) * largoPieza) / 100;
  return {
    pos_x: (f.pos_x ?? 0) - (lado === "izquierda" ? desplazamiento : 0),
    pos_y: (f.pos_y ?? 0) - (lado === "arriba" ? desplazamiento : 0),
    ancho: vertical ? (f.ancho ?? 80) : largo,
    alto: vertical ? largo : (f.alto ?? 80),
    capacidad: plazasDe(e),
    piezas: e.piezas,
    picos: e.picos,
    ladoPico: OPUESTO[lado],
    vertical,
  };
}
