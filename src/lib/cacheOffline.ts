// ============================================================================
//  «Hoy» sin cobertura — copia de las consultas del día en el dispositivo (07/11/2026)
// ----------------------------------------------------------------------------
//  Los camareros usan Reservas › «Hoy» desde el móvil, y en el local hay zonas
//  sin cobertura. Se guarda en localStorage, por usuario, lo mínimo para pintar
//  «Hoy»: las reservas del día, las mesas, las asignaciones y los ajustes de mesa
//  del día, las salas y la configuración. Al entrar (sesión confirmada, ver
//  `useAuth`) se cargan en la caché de TanStack con su hora ORIGINAL, así que se
//  pintan al momento y se vuelven a pedir igualmente (están «viejas»).
//
//  Reglas: solo datos del día de hoy (fecha local) y como mucho de hace 18 h;
//  otro usuario no ve la copia; se borra al cerrar sesión o cambiar de usuario
//  (useAuth → vaciarCache). Todo va en try/catch: sin almacén, sin cuota o con
//  JSON roto se sigue sin copia, nunca rompe la pantalla. Sin dependencias
//  (useAuth la importa).
// ============================================================================
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

export const CLAVE_COPIA_HOY = "reservas-hoy:copia-offline";
/** Sube este número si cambia la forma de lo guardado: las copias viejas se ignoran. */
export const VERSION_COPIA_HOY = 1;
/** Más vieja que esto no se carga, aunque sea del mismo día. */
export const CADUCIDAD_COPIA_HOY_MS = 18 * 60 * 60 * 1000;
/** Espera tras el último cambio antes de escribir (las respuestas llegan en ráfaga). */
export const ESPERA_GUARDADO_MS = 1_500;

interface ConsultaGuardada {
  clave: QueryKey;
  datos: unknown;
  /** `dataUpdatedAt` de la consulta: la hora de «datos de las HH:MM». */
  actualizado: number;
}

interface CopiaHoy {
  v: number;
  /** Día (local, `yyyy-MM-dd`) en que se guardó. */
  fecha: string;
  usuario: string;
  guardado: number;
  consultas: ConsultaGuardada[];
}

const almacen = (): Storage | null => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** `yyyy-MM-dd` en hora LOCAL (como `useHoyLocal`; `toISOString` daría el día UTC). */
export function fechaLocal(d: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * ¿Es una consulta de «Hoy» que merece copia? Solo las claves de estos hooks y, las que llevan día,
 * las de `hoy`:
 *   · ["reservas-hoy", "pendientes-mesa", hoy] (VistaHoy) y ["reservas-kanban", hoy] (kanban);
 *   · ["asignaciones_mesa", hoy, …] (useAsignacionesMesa) y ["ajustes_mesa_servicio", "dia", hoy];
 *   · ["mesas"] / ["mesas", sala] (no la variante «con-inactivas» de Configuración);
 *   · ["espacios_reserva"] y ["configuracion-reservas"];
 *   · desde el 09/11/2026: ["reservas-hoy", "canceladas", hoy], ["planos_espacio", sala], los ajustes de una
 *     sala y turno de hoy y ["salas_cerradas_servicio", …] de hoy (eventos y «Sala cerrada»).
 */
export function esConsultaDeHoy(clave: QueryKey, hoy: string): boolean {
  const [a, b, c, d] = clave as readonly unknown[];
  switch (a) {
    case "reservas-hoy":
      // 09/11/2026: también las canceladas de hoy (lista de escritorio).
      return clave.length === 3 && (b === "pendientes-mesa" || b === "canceladas") && c === hoy;
    case "reservas-kanban":
      return clave.length === 2 && b === hoy;
    case "asignaciones_mesa":
      return b === hoy;
    case "ajustes_mesa_servicio":
      // Las del día (todas las salas) y, desde el 09/11/2026, las de una sala y turno de hoy (plano).
      return (clave.length === 3 && b === "dia" && c === hoy) || (clave.length === 4 && c === hoy);
    case "salas_cerradas_servicio":
      // 09/11/2026: eventos de hoy y el interruptor «Sala cerrada» de una sala hoy.
      return (clave.length === 4 && b === "eventos" && c === hoy && d === hoy) || (clave.length === 4 && b !== "eventos" && c === hoy);
    case "planos_espacio":
      // 09/11/2026: el plano de cada sala (sin él, el plano de «Hoy» esperaba a la red).
      return clave.length === 2 && typeof b === "string";
    case "mesas":
      return clave.length <= 2;
    case "espacios_reserva":
    case "configuracion-reservas":
      return clave.length === 1;
    default:
      return false;
  }
}

/** Escribe la copia con las consultas de hoy que hay ahora en la caché (sin ninguna, la borra). */
export function guardarCopiaHoy(qc: QueryClient, usuario: string, ahora: number = Date.now()): void {
  const ls = almacen();
  if (!ls || !usuario) return;
  try {
    const hoy = fechaLocal(new Date(ahora));
    const consultas: ConsultaGuardada[] = qc
      .getQueryCache()
      .findAll({ predicate: (q) => q.state.status === "success" && q.state.data !== undefined && esConsultaDeHoy(q.queryKey, hoy) })
      .map((q) => ({ clave: q.queryKey, datos: q.state.data, actualizado: q.state.dataUpdatedAt }));
    if (consultas.length === 0) {
      ls.removeItem(CLAVE_COPIA_HOY);
      return;
    }
    const copia: CopiaHoy = { v: VERSION_COPIA_HOY, fecha: hoy, usuario, guardado: ahora, consultas };
    ls.setItem(CLAVE_COPIA_HOY, JSON.stringify(copia));
  } catch {
    // Sin sitio (cuota), modo privado o datos que no se pueden serializar: mejor sin copia que con media.
    try {
      ls.removeItem(CLAVE_COPIA_HOY);
    } catch {
      /* nada */
    }
  }
}

/** La copia válida de `usuario` (hoy, < 18 h, versión actual) o null. Una inválida se borra. */
export function leerCopiaHoy(usuario: string, ahora: number = Date.now()): CopiaHoy | null {
  const ls = almacen();
  if (!ls || !usuario) return null;
  try {
    const bruto = ls.getItem(CLAVE_COPIA_HOY);
    if (!bruto) return null;
    const c = JSON.parse(bruto) as Partial<CopiaHoy>;
    const valida =
      c.v === VERSION_COPIA_HOY &&
      c.usuario === usuario &&
      c.fecha === fechaLocal(new Date(ahora)) &&
      typeof c.guardado === "number" &&
      ahora - c.guardado >= 0 &&
      ahora - c.guardado <= CADUCIDAD_COPIA_HOY_MS &&
      Array.isArray(c.consultas);
    if (!valida) {
      ls.removeItem(CLAVE_COPIA_HOY);
      return null;
    }
    return c as CopiaHoy;
  } catch {
    return null;
  }
}

/**
 * Carga la copia en la caché: solo lo que aún no tenga datos y con su hora original (`updatedAt`),
 * para que se pinte ya y se vuelva a pedir igual. Devuelve cuántas consultas se han cargado.
 */
export function hidratarCopiaHoy(qc: QueryClient, usuario: string, ahora: number = Date.now()): number {
  const copia = leerCopiaHoy(usuario, ahora);
  if (!copia) return 0;
  const hoy = fechaLocal(new Date(ahora));
  let cargadas = 0;
  try {
    for (const { clave, datos, actualizado } of copia.consultas) {
      if (!Array.isArray(clave) || !esConsultaDeHoy(clave, hoy) || datos === undefined) continue;
      if (qc.getQueryData(clave) !== undefined) continue;
      qc.setQueryData(clave, datos, { updatedAt: typeof actualizado === "number" ? actualizado : copia.guardado });
      cargadas++;
    }
  } catch {
    // Copia rara: lo cargado, cargado; lo demás llegará de la red.
  }
  return cargadas;
}

/** Borra la copia (cerrar sesión, cambiar de usuario). */
export function borrarCopiaHoy(): void {
  try {
    almacen()?.removeItem(CLAVE_COPIA_HOY);
  } catch {
    /* nada */
  }
}

/**
 * Con la sesión de `usuario` confirmada: carga la copia y, desde ahí, la mantiene al día (cada vez
 * que llega una respuesta buena de una consulta de hoy, se reescribe tras `ESPERA_GUARDADO_MS`).
 * Devuelve la función que lo para (al cerrar sesión o cambiar de usuario).
 */
export function activarCopiaHoy(qc: QueryClient, usuario: string): () => void {
  hidratarCopiaHoy(qc, usuario);
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  const programar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = null;
      guardarCopiaHoy(qc, usuario);
    }, ESPERA_GUARDADO_MS);
  };
  const dejarDeEscuchar = qc.getQueryCache().subscribe((evento) => {
    if (evento.type !== "updated" || evento.action.type !== "success") return;
    if (esConsultaDeHoy((evento.query as Query).queryKey, fechaLocal())) programar();
  });
  return () => {
    dejarDeEscuchar();
    if (temporizador) clearTimeout(temporizador);
  };
}
