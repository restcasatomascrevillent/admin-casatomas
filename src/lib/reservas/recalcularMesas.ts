// ============================================================================
// RECALCULAR MESAS — lógica pura (sin React, sin Supabase), con tests
// ----------------------------------------------------------------------------
// Petición del dueño (07/11/2026): en el servicio la gente cambia de mesa sin
// parar. Cuando el camarero sienta a alguien en una mesa que estaba PREVISTA
// para otra reserva que aún no ha llegado, esa otra no se queda «sin mesa»: se
// le busca la mejor mesa libre en su franja. Y un botón «Recalcular mesas»
// recoloca de una vez las reservas por llegar cuya mesa prevista está ocupada
// ahora o choca con otra.
//
// Reglas:
//   · Las reservas con la mesa FIJADA (`reservas.mesa_fijada`) no se mueven
//     nunca ni se les quita la mesa.
//   · Las sentadas («Llegó») y las ya liberadas tampoco se tocan.
//   · La mesa nueva: de SU sala (el RPC `asignar_mesas_reserva` rechaza mesas
//     de otra sala, MESA_OTRA_SALA, y cambiar de sala a otra reserva sin
//     preguntar sería sorpresa), donde quepan sus comensales, libre en su
//     franja (misma cuenta que el trigger, `estadoParaConfirmar`), sin nadie
//     sentado ahora mismo en este turno y no excluida del reparto. Entre las
//     válidas, la más justa (menos sillas vacías) y luego por número.
//   · Si no hay ninguna, se dice: «se queda sin mesa: no hay ninguna libre».
// ============================================================================

import { ESTADO_LLEGADA } from "./estadosReserva";
import { turnoDeHora } from "./asignacionMesas";
import { estadoParaConfirmar, type AsignacionConfirmar, type Desplazamiento } from "./confirmarMesa";
import type { MesaOpcion } from "./hoyMovil";
import type { ConfigOcupacionMesa } from "./ocupacionMesa";

const POR_LLEGAR = new Set(["pendiente", "verificada", "confirmada"]);

const horaCorta = (h: string) => (h ?? "").slice(0, 5);

function numeroMesa(nombre: string): number {
  const v = parseInt(nombre, 10);
  return Number.isNaN(v) ? Number.MAX_SAFE_INTEGER : v;
}

const sentadaSinIrse = (a: AsignacionConfirmar) => a.reservas?.estado === ESTADO_LLEGADA && !a.reservas?.salida_at;

/** Mesas con alguien SENTADO ahora mismo (sin «Liberar») en el turno de `hora`, salvo `reservaId`. */
export function mesasOcupadasAhora(
  asignaciones: readonly AsignacionConfirmar[],
  hora: string,
  reservaId = "",
): Set<string> {
  const turno = turnoDeHora(hora);
  const ocupadas = new Set<string>();
  for (const a of asignaciones) {
    if (a.reserva_id === reservaId || !sentadaSinIrse(a)) continue;
    if (turnoDeHora(a.reservas?.hora ?? "") !== turno) continue;
    ocupadas.add(a.mesa_id);
  }
  return ocupadas;
}

export interface ReservaReemplazo {
  id: string;
  hora: string;
  comensales: number;
  /** Su sala: solo se buscan mesas de ella. `null` = cualquiera. */
  salaId: string | null;
}

/** La mejor mesa libre para `reserva` en su franja, o `null` si no hay ninguna. */
export function elegirMesaReemplazo(p: {
  opciones: readonly MesaOpcion[];
  asignaciones: readonly AsignacionConfirmar[];
  reserva: ReservaReemplazo;
  /** Mesas que no se pueden usar (la que se acaba de elegir, las ya repartidas…). */
  evitar?: ReadonlySet<string>;
  excluidas?: ReadonlySet<string>;
  config?: ConfigOcupacionMesa;
}): MesaOpcion | null {
  const { reserva } = p;
  const ocupadas = mesasOcupadasAhora(p.asignaciones, reserva.hora, reserva.id);
  const validas = p.opciones.filter(
    (m) =>
      m.plazas >= reserva.comensales &&
      (!reserva.salaId || m.espacioId === reserva.salaId) &&
      !p.evitar?.has(m.id) &&
      !p.excluidas?.has(m.id) &&
      !ocupadas.has(m.id) &&
      estadoParaConfirmar(p.asignaciones, m.id, { id: reserva.id, hora: reserva.hora }, p.config).tipo === "libre",
  );
  validas.sort(
    (a, b) =>
      a.plazas - b.plazas || numeroMesa(a.nombre) - numeroMesa(b.nombre) || a.nombre.localeCompare(b.nombre, "es"),
  );
  return validas[0] ?? null;
}

/** Copia de las filas con las mesas de `reservaId` cambiadas por `mesaIds` (para seguir calculando). */
function conMesas(
  lista: readonly AsignacionConfirmar[],
  reservaId: string,
  mesaIds: readonly string[],
  reserva: AsignacionConfirmar["reservas"],
): AsignacionConfirmar[] {
  return [
    ...lista.filter((a) => a.reserva_id !== reservaId),
    ...mesaIds.map((mesa_id) => ({ mesa_id, reserva_id: reservaId, reservas: reserva })),
  ];
}

/**
 * Al coger mesas previstas para otras reservas: a las que se quedan SIN ninguna mesa se les busca la mejor
 * libre de su sala (`recolocadaEn` y `mesaIdsQuedan = [esa]`), o `recolocadaEn: null` si no hay. Las que
 * siguen con otra mesa suya (iban en dos juntas) se quedan como estaban.
 */
export function recolocarDesplazadas(p: {
  desplazadas: readonly Desplazamiento[];
  opciones: readonly MesaOpcion[];
  asignaciones: readonly AsignacionConfirmar[];
  /** Las mesas que se acaban de elegir para la reserva (o el cliente sin reserva) que se sienta. */
  mesasElegidas: readonly string[];
  excluidas?: ReadonlySet<string>;
  config?: ConfigOcupacionMesa;
}): Desplazamiento[] {
  const salaDe = new Map(p.opciones.map((m) => [m.id, m.espacioId]));
  const nombreDe = new Map(p.opciones.map((m) => [m.id, m.nombre]));
  const evitar = new Set(p.mesasElegidas);
  let sim: AsignacionConfirmar[] = [...p.asignaciones];
  return p.desplazadas.map((d) => {
    if (d.mesaIdsQuedan.length > 0) return d;
    const fila = p.asignaciones.find((a) => a.reserva_id === d.reservaId);
    const comensales = fila?.reservas?.numero_comensales ?? 1;
    const salaId = d.mesaIdsAntes.map((id) => salaDe.get(id)).find((s): s is string => !!s) ?? null;
    sim = conMesas(sim, d.reservaId, [], fila?.reservas ?? null);
    const mesa = elegirMesaReemplazo({
      opciones: p.opciones,
      asignaciones: sim,
      reserva: { id: d.reservaId, hora: d.hora, comensales, salaId },
      evitar,
      excluidas: p.excluidas,
      config: p.config,
    });
    if (!mesa) return { ...d, mesaIdsQuedan: [], recolocadaEn: null };
    evitar.add(mesa.id);
    sim = conMesas(sim, d.reservaId, [mesa.id], fila?.reservas ?? null);
    return { ...d, mesaIdsQuedan: [mesa.id], recolocadaEn: { mesaId: mesa.id, mesaNombre: nombreDe.get(mesa.id) ?? mesa.nombre } };
  });
}

// ─── «Recalcular mesas» del turno ────────────────────────────────────────────

export interface MovimientoRecalculo {
  reservaId: string;
  nombre: string;
  hora: string;
  comensales: number;
  desdeIds: string[];
  desdeNombres: string[];
  hacia: MesaOpcion;
  /** «García 7→9». */
  texto: string;
}

export interface SinSitioRecalculo {
  reservaId: string;
  nombre: string;
  hora: string;
  desdeNombres: string[];
}

export interface PropuestaRecalculo {
  movimientos: MovimientoRecalculo[];
  /** Su mesa choca y no hay ninguna libre: se quedan como están (que lo mire una persona). */
  sinSitio: SinSitioRecalculo[];
  /** «Se moverán 3 reservas: García 7→9, …» o «No hace falta mover ninguna». */
  resumen: string;
}

/**
 * Propuesta de «Recalcular mesas» para un turno: las reservas POR LLEGAR y NO fijadas cuya mesa prevista está
 * ocupada ahora (alguien sentado sin liberar), está fijada para otra o choca en la franja con otra prevista
 * (se mueve la que llega más tarde) pasan a la mejor mesa libre de su sala. Por hora; cada movimiento cuenta
 * para los siguientes. Las sentadas, las fijadas y las que no chocan no se tocan.
 */
export function proponerRecalculo(p: {
  opciones: readonly MesaOpcion[];
  asignaciones: readonly AsignacionConfirmar[];
  turno: "comida" | "cena";
  excluidas?: ReadonlySet<string>;
  config?: ConfigOcupacionMesa;
}): PropuestaRecalculo {
  const nombreDe = new Map(p.opciones.map((m) => [m.id, m.nombre]));
  const salaDe = new Map(p.opciones.map((m) => [m.id, m.espacioId]));
  const porReserva = new Map<string, { reservas: AsignacionConfirmar["reservas"]; mesas: string[] }>();
  for (const a of p.asignaciones) {
    const r = a.reservas;
    if (!r || turnoDeHora(r.hora) !== p.turno) continue;
    if (!POR_LLEGAR.has(r.estado ?? "") || r.mesa_fijada || r.salida_at) continue;
    const actual = porReserva.get(a.reserva_id) ?? { reservas: r, mesas: [] };
    actual.mesas.push(a.mesa_id);
    porReserva.set(a.reserva_id, actual);
  }
  const candidatas = [...porReserva.entries()].sort(
    ([ia, a], [ib, b]) => (a.reservas?.hora ?? "").localeCompare(b.reservas?.hora ?? "") || ia.localeCompare(ib),
  );

  let sim: AsignacionConfirmar[] = [...p.asignaciones];
  const movimientos: MovimientoRecalculo[] = [];
  const sinSitio: SinSitioRecalculo[] = [];
  for (const [id, { reservas: r, mesas }] of candidatas) {
    const hora = r?.hora ?? "";
    const ocupadas = mesasOcupadasAhora(sim, hora, id);
    const choca = mesas.some((mesaId) => {
      if (ocupadas.has(mesaId)) return true;
      const e = estadoParaConfirmar(sim, mesaId, { id, hora }, p.config);
      if (e.tipo === "ocupada" || e.tipo === "fijada") return true;
      // Dos previstas en la misma mesa y franja: se queda la que llega antes.
      return e.tipo === "prevista" && e.desplazadas.some((d) => d.hora < hora || (d.hora === hora && d.reservaId < id));
    });
    if (!choca) continue;
    const desdeNombres = mesas.map((m) => nombreDe.get(m) ?? "?");
    const salaId = mesas.map((m) => salaDe.get(m)).find((s): s is string => !!s) ?? null;
    const sinEsta = conMesas(sim, id, [], r);
    const mesa = elegirMesaReemplazo({
      opciones: p.opciones,
      asignaciones: sinEsta,
      reserva: { id, hora, comensales: r?.numero_comensales ?? 1, salaId },
      excluidas: p.excluidas,
      config: p.config,
    });
    const nombre = r?.nombre?.trim() || "Sin nombre";
    if (!mesa) {
      sinSitio.push({ reservaId: id, nombre, hora, desdeNombres });
      continue;
    }
    sim = conMesas(sinEsta, id, [mesa.id], r);
    movimientos.push({
      reservaId: id,
      nombre,
      hora,
      comensales: r?.numero_comensales ?? 1,
      desdeIds: mesas,
      desdeNombres,
      hacia: mesa,
      texto: `${nombre} ${desdeNombres.join("+")}→${mesa.nombre}`,
    });
  }
  const resumen =
    movimientos.length === 0
      ? "No hace falta mover ninguna reserva."
      : `Se ${movimientos.length === 1 ? "moverá 1 reserva" : `moverán ${movimientos.length} reservas`}: ${movimientos.map((m) => m.texto).join(", ")}.`;
  return { movimientos, sinSitio, resumen };
}

/** «García (21:30) se queda en la 7: no hay ninguna mesa libre en su sala.» */
export function textoSinSitio(s: SinSitioRecalculo): string {
  return `${s.nombre} (${horaCorta(s.hora)}) se queda en la ${s.desdeNombres.join(" + ")}: no hay ninguna mesa libre en su sala.`;
}
