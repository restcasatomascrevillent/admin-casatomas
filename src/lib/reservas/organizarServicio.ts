// ============================================================================
// «ORGANIZAR SERVICIO» — propuesta de sala + mesa para todo un servicio
// ----------------------------------------------------------------------------
// Lógica PURA y DETERMINISTA (mismas entradas → misma propuesta). La pantalla
// solo la enseña; nunca se aplica nada sin que el usuario lo confirme.
//
// Reglas del dueño (09/10/2026):
//   1. El sistema decide sala y mesa (el cliente no elige sala).
//   2. Las sentadas («Llegó») y las de «No vino» no se tocan. Las asignadas y
//      no sentadas sí se pueden mover, y cada cambio sale en una frase clara.
//   3. Una reserva por mesa en el servicio (no se reutilizan mesas por franjas).
//   4. Buen ajuste: pocas sillas vacías; las mesas grandes para los grupos.
//   5. Mover lo mínimo. Coste: nada < pico < pasar pieza < juntar < cambiar de
//      mesa < cambiar de sala a una reserva ya asignada.
//   6. La Terraza es la más flexible: cambiar sus plazas o juntar sitios cuesta poco.
//   7. «Terraza cerrada»: no se asigna nada ahí y lo que hubiera se recoloca.
//   8. Las importantes se colocan antes y se mueven menos.
//   9. Las que no caben salen con el motivo.
//  10. (13/10/2026) Lo automático es SENCILLO: hasta 7 comensales (lo que admite la
//      web), en UNA mesa o como mucho DOS (juntas, o una que recibe piezas de otra;
//      piezas de 2 + pico: 6 + pico = 7). Nunca combina 3 o más mesas solo.
//      Los grupos de 8 o más los revisa una persona: no se colocan; salen en
//      `revisarAMano` con la sugerencia (Reservado hasta 14; si no, mesa larga en el
//      Salón, ver `grupoGrande.ts`). Si ya tienen mesa, se respeta y no se mueven.
// Principio que manda: «ayudar en momentos frenéticos, no perjudicarlos».
//   · Con el servicio empezado (`minutoAhora`), las reservas con mesa que llegan
//     en los próximos 30 min (o ya deberían estar) no se tocan, sus mesas no
//     prestan piezas y moverse cuesta mucho más.
//   · Si la mejora sobre «dejarlo como está» es mínima, se propone no tocar nada:
//     «Ya está bien organizado».
//
// Algoritmo: dos planes y se queda con el bueno.
//   · Conservador: lo que ya tiene una mesa válida se queda; solo se colocan
//     las que no tienen mesa (o cuya mesa ya no vale).
//   · Completo: solo se fijan las sentadas, «No vino» y las inminentes; el
//     resto se recoloca.
//   En ambos: grupos grandes primero (importantes antes a igual tamaño), cada
//   reserva a la opción de menor coste (sillas vacías + cambios + mover) y
//   después una mejora local por intercambios. Se elige el completo solo si
//   mejora al conservador en más de un umbral.
// ============================================================================

import { minutosDeHora } from "./ocupacionMesa";
import { esGrupoGrande, MAX_MESAS_AUTO } from "./grupoGrande";
import {
  aplicarCambios,
  candidatasParaJuntar,
  estadoServicio,
  juntar,
  mesaPiezasDesde,
  plazasMesa,
  proponerParaSentar,
  type AjusteMesa,
  type EstadoServicio,
  type MesaPiezas,
  type Paso,
  type ReservaEnMesas,
} from "./piezasMesa";
import type { FilaMesaSala } from "./sentarAhora";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SalaOrg {
  id: string;
  nombre: string;
  /** La sala flexible (sitios de plazas variables). La que se puede cerrar. */
  terraza: boolean;
}

export interface ReservaOrg {
  id: string;
  nombre: string;
  hora: string;
  comensales: number;
  estado: string;
  importante: boolean;
  espacioId: string | null;
  /** Mesas que tiene asignadas ahora en este servicio. */
  mesaIds: string[];
  /** «Fijar mesa» (07/11/2026): con mesa, no se mueve nunca (ni sus mesas prestan piezas). */
  fijada?: boolean;
  /** «Liberar mesa»: ya se fue; su mesa no cuenta como ocupada. */
  salidaAt?: string | null;
}

export interface DestinoOrg {
  salaId: string;
  salaNombre: string;
  mesaIds: string[];
  mesaNombres: string[];
}

export interface MovimientoOrg {
  reservaId: string;
  nombre: string;
  hora: string;
  comensales: number;
  importante: boolean;
  desde: DestinoOrg | null;
  hacia: DestinoOrg;
  /** Ajustes de piezas/picos/plazas/uniones que necesita, por sala. */
  ajustes: Array<{ salaId: string; cambios: AjusteMesa[] }>;
  /** «Pepito (4 p., 21:00) pasa de la 4 del Comedor a la 5 del Salón». */
  texto: string;
  /** «pasa una pieza de la 4 a la 3 y pon pico», «junta la 5 y la 6». */
  detalle: string | null;
}

export interface SinSitioOrg {
  reservaId: string;
  nombre: string;
  hora: string;
  comensales: number;
  motivo: string;
}

/** Grupo de 8 o más sin mesa: lo asigna una persona (con la sugerencia como ayuda). */
export interface RevisarOrg {
  reservaId: string;
  nombre: string;
  hora: string;
  comensales: number;
  /** «Grupo de 18 (…): mesa larga en el Salón, pegada a la pared de abajo a la derecha…». */
  sugerencia: string;
}

export interface ResultadoOrg {
  movimientos: MovimientoOrg[];
  sinSitio: SinSitioOrg[];
  /** Grupos de 8 o más sin mesa: no se asignan solos. */
  revisarAMano: RevisarOrg[];
  /** No hay nada que cambiar (ni nadie sin sitio). */
  yaOrganizado: boolean;
  /** «3 cambios», «Ya está bien organizado». */
  resumen: string;
  /** Plan elegido (para depurar y tests). */
  plan: "conservador" | "completo";
}

export interface EntradaOrg {
  salas: SalaOrg[];
  mesas: FilaMesaSala[];
  /** Ajustes ya guardados de ESTE servicio (todas las salas). */
  ajustes: Array<AjusteMesa & { espacioId: string }>;
  reservas: ReservaOrg[];
  terrazaCerrada?: boolean;
  /** Minuto del día de ahora si el servicio ya ha empezado; `null` antes del servicio. */
  minutoAhora?: number | null;
  /** Mesas que Configuración no ofrece al asignar. */
  excluidas?: ReadonlySet<string>;
  /**
   * Mesas que se usan solo como último recurso (para dejar paso; 08/11/2026). Cuestan `COSTES.alFinal` cada
   * una, salvo para la reserva que ya está en ella (asignada a mano o fijada: se respeta).
   */
  alFinal?: ReadonlySet<string>;
  /** Sugerencia para un grupo grande (Reservado / mesa larga en el Salón). */
  sugerirGrupo?: (r: ReservaOrg) => string | null;
}

// ─── Costes ──────────────────────────────────────────────────────────────────

export const COSTES = {
  /** Por silla vacía. */
  sillaVacia: 1,
  pico: 1,
  pieza: 2,
  plazasSitio: 0.5,
  juntar: 4,
  juntarTerraza: 1.5,
  cambiarMesa: 5,
  cambiarSala: 8,
  sinSitio: 100,
  /** Por mesa «al final» (para dejar paso): solo antes que quedarse sin sitio. */
  alFinal: 60,
  /** Por debajo de esta mejora no se propone mover nada (antes del servicio / empezado). */
  umbral: 4,
  umbralEmpezado: 20,
  /** Con el servicio empezado, mover cuesta esto veces más. */
  factorEmpezado: 3,
  factorImportante: 2,
} as const;

const MINUTOS_INMINENTE = 30;
const ESTADOS_A_COLOCAR = new Set(["pendiente", "verificada", "confirmada"]);
const ESTADOS_FIJOS = new Set(["completada", "no_show"]);

// ─── Modelo interno ──────────────────────────────────────────────────────────

interface MesaInt {
  id: string;
  nombre: string;
  salaId: string;
  /** Plazas fijas (redondas y mesas sin piezas). */
  fija: number;
  mp: MesaPiezas | null;
}

interface Colocacion {
  salaId: string;
  mesaIds: string[];
  cambios: AjusteMesa[];
  pasos: Paso[];
  junta: boolean;
  coste: number;
  plazas: number;
}

interface Plan {
  colocadas: Map<string, Colocacion>;
  noCaben: string[];
  coste: number;
}

function preparar(entrada: EntradaOrg) {
  const salasActivas = entrada.salas.filter((s) => !(s.terraza && entrada.terrazaCerrada));
  const salaPorId = new Map(entrada.salas.map((s) => [s.id, s]));
  const mesas: MesaInt[] = entrada.mesas
    .filter((m) => salaPorId.has(m.espacio_id))
    .map((m) => ({ id: m.id, nombre: m.nombre, salaId: m.espacio_id, fija: m.capacidad, mp: mesaPiezasDesde(m) }))
    .sort((a, b) => a.salaId.localeCompare(b.salaId) || numero(a.nombre) - numero(b.nombre) || a.id.localeCompare(b.id));
  const mesaPorId = new Map(mesas.map((m) => [m.id, m]));
  const piezasPorSala = new Map<string, MesaPiezas[]>();
  for (const m of mesas) if (m.mp) piezasPorSala.set(m.salaId, [...(piezasPorSala.get(m.salaId) ?? []), m.mp]);
  const estadoInicial = new Map<string, EstadoServicio>();
  for (const s of entrada.salas) {
    estadoInicial.set(
      s.id,
      estadoServicio(piezasPorSala.get(s.id) ?? [], entrada.ajustes.filter((a) => a.espacioId === s.id)),
    );
  }
  return { salasActivas, salaPorId, mesas, mesaPorId, piezasPorSala, estadoInicial };
}

type Contexto = ReturnType<typeof preparar> & { entrada: EntradaOrg };

function numero(n: string): number {
  const v = parseInt(n, 10);
  return Number.isNaN(v) ? 9999 : v;
}

function plazasDe(ctx: Contexto, estados: Map<string, EstadoServicio>, mesaId: string): number {
  const m = ctx.mesaPorId.get(mesaId);
  if (!m) return 0;
  if (!m.mp) return m.fija;
  const e = estados.get(m.salaId)?.get(mesaId);
  return e ? plazasMesa(m.mp, e) : 0;
}

function costePasos(pasos: Paso[], sitio: boolean): number {
  let c = 0;
  for (const p of pasos) c += p.tipo === "pico" ? COSTES.pico * Math.abs(p.n) : COSTES.pieza * p.n;
  if (sitio) c += COSTES.plazasSitio;
  return c;
}

function mismoConjunto(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

// ─── Colocar una reserva ─────────────────────────────────────────────────────

function mejorColocacion(
  ctx: Contexto,
  r: ReservaOrg,
  usadas: Map<string, string>,
  estados: Map<string, EstadoServicio>,
  reservasPorSala: Map<string, ReservaEnMesas[]>,
  empezado: boolean,
): Colocacion | null {
  const excluidas = ctx.entrada.excluidas ?? new Set<string>();
  const salaOk = new Set(ctx.salasActivas.map((s) => s.id));
  const libre = (id: string) => !usadas.has(id) && !excluidas.has(id) && salaOk.has(ctx.mesaPorId.get(id)?.salaId ?? "");
  const factor = (r.importante ? COSTES.factorImportante : 1) * (empezado ? COSTES.factorEmpezado : 1);
  const costeMover = (salaId: string, mesaIds: string[]) => {
    if (r.mesaIds.length === 0) return 0;
    if (mismoConjunto(r.mesaIds, mesaIds)) return 0;
    const salaActual = ctx.mesaPorId.get(r.mesaIds[0])?.salaId ?? r.espacioId;
    return (salaActual === salaId ? COSTES.cambiarMesa : COSTES.cambiarSala) * factor;
  };
  const alFinal = ctx.entrada.alFinal;
  const costeAlFinal = (mesaIds: string[]) =>
    alFinal ? mesaIds.filter((id) => alFinal.has(id) && !r.mesaIds.includes(id)).length * COSTES.alFinal : 0;
  let mejor: Colocacion | null = null;
  const considerar = (c0: Colocacion) => {
    const c = { ...c0, coste: c0.coste + costeAlFinal(c0.mesaIds) };
    if (!mejor || c.coste < mejor.coste - 1e-9) mejor = c;
  };

  // Su mesa de ahora, tal cual (también si es una unión).
  if (r.mesaIds.length > 0 && r.mesaIds.every(libre)) {
    const plazas = r.mesaIds.reduce((s, id) => s + plazasDe(ctx, estados, id), 0);
    const salaId = ctx.mesaPorId.get(r.mesaIds[0])!.salaId;
    if (plazas >= r.comensales) {
      considerar({ salaId, mesaIds: [...r.mesaIds], cambios: [], pasos: [], junta: false, plazas, coste: (plazas - r.comensales) * COSTES.sillaVacia });
    }
  }

  for (const m of ctx.mesas) {
    if (!libre(m.id)) continue;
    const plazas = plazasDe(ctx, estados, m.id);
    if (plazas <= 0) continue;
    // Tal cual.
    if (plazas >= r.comensales) {
      considerar({
        salaId: m.salaId, mesaIds: [m.id], cambios: [], pasos: [], junta: false, plazas,
        coste: (plazas - r.comensales) * COSTES.sillaVacia + costeMover(m.salaId, [m.id]),
      });
    }
    if (!m.mp) continue;
    const estado = estados.get(m.salaId)!;
    // Sitio de la Terraza: ajustar sus plazas al grupo (también a la baja).
    if (m.mp.sitio) {
      const objetivo = Math.max(m.mp.sitio.min, r.comensales);
      if (objetivo <= m.mp.sitio.max && objetivo !== plazas) {
        const e = estado.get(m.id)!;
        considerar({
          salaId: m.salaId, mesaIds: [m.id],
          cambios: [{ mesaId: m.id, piezas: e.piezas, picos: e.picos, unidaA: e.unidaA, plazas: objetivo }],
          pasos: [], junta: false, plazas: objetivo,
          coste: (objetivo - r.comensales) * COSTES.sillaVacia + COSTES.plazasSitio + costeMover(m.salaId, [m.id]),
        });
      }
    } else if (plazas < r.comensales) {
      // Mesa por piezas: pico o pieza de una vecina libre.
      const res = proponerParaSentar({
        mesas: ctx.piezasPorSala.get(m.salaId) ?? [],
        estado,
        reservas: reservasPorSala.get(m.salaId) ?? [],
        mesaId: m.id,
        comensales: r.comensales,
        maximo: 1,
      });
      const p = res.propuestas[0];
      // Como mucho DOS mesas: la de destino y UNA que le pase piezas (nunca de varias).
      const donantes = new Set(p?.pasos.flatMap((x) => (x.tipo === "mover" ? [x.desde] : [])) ?? []);
      if (p && donantes.size + 1 <= MAX_MESAS_AUTO) {
        const final = aplicarCambios(estado, p.cambios).get(m.id)!;
        const plazasFinal = plazasMesa(m.mp, final);
        considerar({
          salaId: m.salaId, mesaIds: [m.id], cambios: p.cambios, pasos: p.pasos, junta: false, plazas: plazasFinal,
          coste: (plazasFinal - r.comensales) * COSTES.sillaVacia + costePasos(p.pasos, false) + costeMover(m.salaId, [m.id]),
        });
      }
    }
    // Juntar con una de al lado (solo si sola no llega).
    if (plazas < r.comensales || (m.mp.sitio && r.comensales > m.mp.sitio.max)) {
      for (const otra of candidatasParaJuntar(m.mp, ctx.piezasPorSala.get(m.salaId) ?? [], estado)) {
        if (!libre(otra.id)) continue;
        const sitio = !!m.mp.sitio && !!otra.sitio;
        let cambios = juntar(m.mp, otra, estado);
        let total: number;
        if (sitio) {
          // Reparte el grupo entre los dos sitios (cada uno en su rango).
          const a = Math.min(m.mp.sitio!.max, Math.max(m.mp.sitio!.min, Math.ceil(r.comensales / 2)));
          const b = Math.min(otra.sitio!.max, Math.max(otra.sitio!.min, r.comensales - a));
          total = a + b;
          const em = estado.get(m.id)!;
          cambios = [
            { mesaId: m.id, piezas: em.piezas, picos: em.picos, unidaA: em.unidaA, plazas: a },
            { ...cambios[0], plazas: b },
          ];
        } else {
          total = plazas + plazasDe(ctx, estados, otra.id);
        }
        if (total < r.comensales) continue;
        const ids = [m.id, otra.id];
        considerar({
          salaId: m.salaId, mesaIds: ids, cambios, pasos: [], junta: true, plazas: total,
          coste:
            (total - r.comensales) * COSTES.sillaVacia +
            (sitio ? COSTES.juntarTerraza : COSTES.juntar) +
            costeMover(m.salaId, ids),
        });
      }
    }
  }
  return mejor;
}

function colocar(
  ctx: Contexto,
  r: ReservaOrg,
  c: Colocacion,
  usadas: Map<string, string>,
  estados: Map<string, EstadoServicio>,
  reservasPorSala: Map<string, ReservaEnMesas[]>,
) {
  for (const id of c.mesaIds) usadas.set(id, r.id);
  if (c.cambios.length) estados.set(c.salaId, aplicarCambios(estados.get(c.salaId)!, c.cambios));
  reservasPorSala.set(c.salaId, [
    ...(reservasPorSala.get(c.salaId) ?? []),
    { reservaId: r.id, mesaIds: c.mesaIds, comensales: r.comensales },
  ]);
}

// ─── Planes ──────────────────────────────────────────────────────────────────

function ordenColocacion(a: ReservaOrg, b: ReservaOrg): number {
  return (
    b.comensales - a.comensales ||
    Number(b.importante) - Number(a.importante) ||
    a.hora.localeCompare(b.hora) ||
    a.id.localeCompare(b.id)
  );
}

function hacerPlan(ctx: Contexto, fijas: ReservaOrg[], aColocar: ReservaOrg[], empezado: boolean): Plan {
  const usadas = new Map<string, string>();
  const estados = new Map(ctx.estadoInicial);
  const reservasPorSala = new Map<string, ReservaEnMesas[]>();
  const colocadas = new Map<string, Colocacion>();

  for (const r of fijas) {
    const ids = r.mesaIds.filter((id) => ctx.mesaPorId.has(id));
    if (ids.length === 0) continue;
    const salaId = ctx.mesaPorId.get(ids[0])!.salaId;
    // Con el servicio empezado, sus mesas no prestan piezas: «necesitan» todas las que tienen.
    const comensales = empezado ? ids.reduce((s, id) => s + plazasDe(ctx, estados, id), 0) : r.comensales;
    for (const id of ids) usadas.set(id, r.id);
    reservasPorSala.set(salaId, [...(reservasPorSala.get(salaId) ?? []), { reservaId: r.id, mesaIds: ids, comensales }]);
  }

  const noCaben: string[] = [];
  let coste = 0;
  for (const r of [...aColocar].sort(ordenColocacion)) {
    const c = mejorColocacion(ctx, r, usadas, estados, reservasPorSala, empezado);
    if (!c) {
      noCaben.push(r.id);
      coste += COSTES.sinSitio;
      continue;
    }
    colocar(ctx, r, c, usadas, estados, reservasPorSala);
    colocadas.set(r.id, c);
    coste += c.coste;
  }

  // Mejora local: intercambiar las mesas (sueltas y sin ajustes) de dos reservas si sale más barato.
  const porId = new Map(aColocar.map((r) => [r.id, r]));
  const costeEn = (r: ReservaOrg, mesaId: string, plazas: number, salaId: string) => {
    const factor = (r.importante ? COSTES.factorImportante : 1) * (empezado ? COSTES.factorEmpezado : 1);
    const mover =
      r.mesaIds.length === 0 || mismoConjunto(r.mesaIds, [mesaId])
        ? 0
        : (ctx.mesaPorId.get(r.mesaIds[0])?.salaId === salaId ? COSTES.cambiarMesa : COSTES.cambiarSala) * factor;
    const alFinal = ctx.entrada.alFinal?.has(mesaId) && !r.mesaIds.includes(mesaId) ? COSTES.alFinal : 0;
    return (plazas - r.comensales) * COSTES.sillaVacia + mover + alFinal;
  };
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    let mejoro = false;
    const ids = [...colocadas.keys()].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ca = colocadas.get(ids[i])!;
        const cb = colocadas.get(ids[j])!;
        if (ca.mesaIds.length !== 1 || cb.mesaIds.length !== 1 || ca.cambios.length || cb.cambios.length) continue;
        const ra = porId.get(ids[i])!;
        const rb = porId.get(ids[j])!;
        if (cb.plazas < ra.comensales || ca.plazas < rb.comensales) continue;
        const nuevoA = costeEn(ra, cb.mesaIds[0], cb.plazas, cb.salaId);
        const nuevoB = costeEn(rb, ca.mesaIds[0], ca.plazas, ca.salaId);
        if (nuevoA + nuevoB < ca.coste + cb.coste - 1e-9) {
          colocadas.set(ids[i], { ...cb, coste: nuevoA });
          colocadas.set(ids[j], { ...ca, coste: nuevoB });
          coste += nuevoA + nuevoB - ca.coste - cb.coste;
          mejoro = true;
        }
      }
    }
    if (!mejoro) break;
  }

  return { colocadas, noCaben, coste };
}

// ─── Textos ──────────────────────────────────────────────────────────────────

const pax = (r: { comensales: number; hora: string }) => `${r.comensales} p., ${r.hora.slice(0, 5)}`;

export function deLaSala(nombre: string): string {
  const n = nombre.trim();
  return /^(terraza|sala|barra)/i.test(n) || /a$/i.test(n) ? `de la ${n}` : `del ${n}`;
}

function textoMesas(d: DestinoOrg): string {
  return `la ${d.mesaNombres.join(" + ")} ${deLaSala(d.salaNombre)}`;
}

function textoMovimiento(r: ReservaOrg, desde: DestinoOrg | null, hacia: DestinoOrg, detalle: string | null): string {
  const quien = `${r.nombre || "Sin nombre"} (${pax(r)})`;
  if (!desde) return `${quien} → ${textoMesas(hacia)}`;
  if (desde.salaId === hacia.salaId && mismoConjunto(desde.mesaIds, hacia.mesaIds)) {
    return `${quien} se queda en ${textoMesas(hacia)}${detalle ? `: ${detalle}` : ""}`;
  }
  return `${quien} pasa de ${textoMesas(desde)} a ${textoMesas(hacia)}`;
}

function textoDetalle(ctx: Contexto, c: Colocacion): string | null {
  const nombre = (id: string) => ctx.mesaPorId.get(id)?.nombre ?? "?";
  if (c.junta) return `junta la ${c.mesaIds.map(nombre).join(" y la ")}`;
  const partes: string[] = [];
  const movs = c.pasos.filter((p): p is Extract<Paso, { tipo: "mover" }> => p.tipo === "mover");
  if (movs.length) {
    partes.push(
      `pasa ${movs.map((p) => `${p.n === 1 ? "una pieza" : `${p.n} piezas`} de la ${nombre(p.desde)}`).join(" y ")} a la ${nombre(movs[0].hacia)}`,
    );
  }
  for (const p of c.pasos) if (p.tipo === "pico") partes.push(p.n > 0 ? "pon pico" : "quita el pico");
  const sitio = c.cambios.find((x) => x.plazas != null && c.mesaIds.includes(x.mesaId));
  if (sitio && !c.junta) partes.push(`ponla para ${c.plazas}`);
  return partes.length ? partes.join(" y ") : null;
}

// ─── Entrada principal ───────────────────────────────────────────────────────

export function organizarServicio(entrada: EntradaOrg): ResultadoOrg {
  const ctx: Contexto = { ...preparar(entrada), entrada };
  const empezado = entrada.minutoAhora != null;
  const salaOk = new Set(ctx.salasActivas.map((s) => s.id));

  // Las que ya se fueron («Liberar mesa») y las de «No vino» no se tocan, pero tampoco ocupan:
  // su mesa vuelve a estar libre (la BD lo admite con la migración 20261009150000).
  const relevantes = entrada.reservas.filter(
    (r) => (ESTADOS_A_COLOCAR.has(r.estado) || ESTADOS_FIJOS.has(r.estado)) && !r.salidaAt && r.estado !== "no_show",
  );
  const inamovible = (r: ReservaOrg) => {
    if (ESTADOS_FIJOS.has(r.estado)) return true;
    // Mesa fijada (07/11/2026): ni «Organizar» ni «Terraza cerrada» la mueven.
    if (r.fijada && r.mesaIds.length > 0) return true;
    if (!empezado || r.mesaIds.length === 0) return false;
    const m = minutosDeHora(r.hora);
    return m != null && m <= (entrada.minutoAhora as number) + MINUTOS_INMINENTE;
  };
  // Su mesa vale tal cual: existe, en una sala abierta, y caben (con las plazas de ahora).
  const mesaValida = (r: ReservaOrg) =>
    r.mesaIds.length > 0 &&
    r.mesaIds.every((id) => ctx.mesaPorId.has(id) && salaOk.has(ctx.mesaPorId.get(id)!.salaId)) &&
    r.mesaIds.reduce((s, id) => s + plazasDe(ctx, ctx.estadoInicial, id), 0) >= r.comensales;

  // Grupos de 8 o más: no se colocan solos. Si ya tienen mesa se respeta (fija); si no, a revisar.
  const grande = (r: ReservaOrg) => esGrupoGrande(r.comensales) && !ESTADOS_FIJOS.has(r.estado);
  const grandes = relevantes.filter(grande);
  const fijasBase = [...relevantes.filter((r) => !grande(r) && inamovible(r)), ...grandes.filter((r) => r.mesaIds.length > 0)];
  const movibles = relevantes.filter((r) => !grande(r) && !inamovible(r));
  const revisarAMano: RevisarOrg[] = grandes
    .filter((r) => r.mesaIds.length === 0)
    .sort((a, b) => a.hora.localeCompare(b.hora) || a.id.localeCompare(b.id))
    .map((r) => ({
      reservaId: r.id,
      nombre: r.nombre,
      hora: r.hora,
      comensales: r.comensales,
      sugerencia: entrada.sugerirGrupo?.(r) ?? `Grupo de ${r.comensales}: asígnalo a mano.`,
    }));

  const conservador = hacerPlan(
    ctx,
    [...fijasBase, ...movibles.filter(mesaValida)],
    movibles.filter((r) => !mesaValida(r)),
    empezado,
  );
  const completo = hacerPlan(ctx, fijasBase, movibles, empezado);
  // En el conservador, las que se quedan donde están cuestan sus sillas vacías: así se comparan bien.
  const costeConservador =
    conservador.coste +
    movibles
      .filter(mesaValida)
      .reduce((s, r) => s + (r.mesaIds.reduce((t, id) => t + plazasDe(ctx, ctx.estadoInicial, id), 0) - r.comensales), 0);
  const umbral = empezado ? COSTES.umbralEmpezado : COSTES.umbral;
  const usarCompleto =
    completo.noCaben.length < conservador.noCaben.length ||
    (completo.noCaben.length === conservador.noCaben.length && completo.coste < costeConservador - umbral);
  const plan = usarCompleto ? completo : conservador;

  const destino = (salaId: string, mesaIds: string[]): DestinoOrg => ({
    salaId,
    salaNombre: ctx.salaPorId.get(salaId)?.nombre ?? "",
    mesaIds,
    mesaNombres: mesaIds.map((id) => ctx.mesaPorId.get(id)?.nombre ?? "?"),
  });

  const movimientos: MovimientoOrg[] = [];
  for (const r of [...movibles].sort((a, b) => a.hora.localeCompare(b.hora) || a.id.localeCompare(b.id))) {
    const c = plan.colocadas.get(r.id);
    if (!c) continue;
    const sinCambio = mismoConjunto(r.mesaIds, c.mesaIds) && c.cambios.length === 0;
    if (sinCambio) continue;
    const salaActual = r.mesaIds.length ? ctx.mesaPorId.get(r.mesaIds[0])?.salaId ?? r.espacioId : null;
    const desde = r.mesaIds.length && salaActual ? destino(salaActual, r.mesaIds) : null;
    const hacia = destino(c.salaId, c.mesaIds);
    const detalle = textoDetalle(ctx, c);
    movimientos.push({
      reservaId: r.id,
      nombre: r.nombre,
      hora: r.hora,
      comensales: r.comensales,
      importante: r.importante,
      desde,
      hacia,
      ajustes: c.cambios.length ? [{ salaId: c.salaId, cambios: c.cambios }] : [],
      texto: textoMovimiento(r, desde, hacia, detalle),
      detalle,
    });
  }

  const maxPlazas = Math.max(
    0,
    ...ctx.mesas
      .filter((m) => salaOk.has(m.salaId))
      .map((m) => (m.mp?.sitio ? m.mp.sitio.max * 2 : m.mp ? m.mp.piezasMax * 2 + m.mp.picosMax : m.fija)),
  );
  const sinSitio: SinSitioOrg[] = plan.noCaben
    .map((id) => entrada.reservas.find((r) => r.id === id)!)
    .sort((a, b) => a.hora.localeCompare(b.hora))
    .map((r) => ({
      reservaId: r.id,
      nombre: r.nombre,
      hora: r.hora,
      comensales: r.comensales,
      motivo:
        r.comensales > maxPlazas * 2
          ? `Ninguna mesa ni unión llega a ${r.comensales} plazas`
          : `No queda mesa libre para ${r.comensales}${entrada.terrazaCerrada ? " (Terraza cerrada)" : ""}`,
    }));

  const yaOrganizado = movimientos.length === 0 && sinSitio.length === 0 && revisarAMano.length === 0;
  const n = movimientos.length;
  return {
    movimientos,
    sinSitio,
    revisarAMano,
    yaOrganizado,
    resumen: yaOrganizado
      ? "Ya está bien organizado"
      : n === 0
        ? "Nada que mover"
        : `${n} ${n === 1 ? "cambio" : "cambios"}`,
    plan: usarCompleto ? "completo" : "conservador",
  };
}

// ─── Vista previa en los planos ──────────────────────────────────────────────

/**
 * Cómo QUEDARÍAN las mesas si se aplica todo: mesa → reserva. Parte de lo que
 * hay ahora (`mesasActuales`: reserva → mesas) y aplica los movimientos.
 */
export function disposicionPropuesta(
  mesasActuales: ReadonlyMap<string, readonly string[]>,
  movimientos: readonly MovimientoOrg[],
): Map<string, string> {
  const porReserva = new Map<string, readonly string[]>(mesasActuales);
  for (const m of movimientos) porReserva.set(m.reservaId, m.hacia.mesaIds);
  const porMesa = new Map<string, string>();
  for (const [reservaId, mesaIds] of porReserva) for (const id of mesaIds) porMesa.set(id, reservaId);
  return porMesa;
}

/** Los ajustes del servicio tras la propuesta (por mesa, el último manda). */
export function ajustesPropuestos<A extends AjusteMesa & { espacioId: string }>(
  ajustes: readonly A[],
  movimientos: readonly MovimientoOrg[],
): Array<AjusteMesa & { espacioId: string }> {
  const porMesa = new Map<string, AjusteMesa & { espacioId: string }>(ajustes.map((a) => [a.mesaId, a]));
  for (const m of movimientos) {
    for (const g of m.ajustes) for (const c of g.cambios) porMesa.set(c.mesaId, { ...c, espacioId: g.salaId });
  }
  return [...porMesa.values()];
}

/** Mesas que cambian con la propuesta (destino de un movimiento o con piezas/plazas/uniones nuevas). */
export function mesasQueCambian(movimientos: readonly MovimientoOrg[]): Map<string, MovimientoOrg> {
  const mapa = new Map<string, MovimientoOrg>();
  for (const m of movimientos) {
    for (const g of m.ajustes) for (const c of g.cambios) if (!mapa.has(c.mesaId)) mapa.set(c.mesaId, m);
    for (const id of m.hacia.mesaIds) mapa.set(id, m);
  }
  return mapa;
}
