/**
 * La cifra del botón «Por atender» de la Lista (`cifraPorAtender`, en `cifrasPorEstado.ts`), lógica pura.
 *
 * QUÉ SE FIJA
 * ----------------------------------------------------------------------------
 * · `cifraPorAtender` (2026-10-05): se cuenta con los filtros de la lista SIN el de estado y con las
 *   solicitudes sin resolver: es EXACTAMENTE el número de filas que la lista enseña al pulsar el botón (se
 *   comprueba contra `filtrarFilasUnificadas`, el filtro de la propia lista).
 * · TOUZA NO ADMITE RESERVAS (decisión del dueño, 2026-10-01): lo de `marca = 'touza'` no cuenta nunca, igual
 *   que no sale en la lista (`admiteReservas`, aplicada en `unificarReservasYSolicitudes`).
 *
 * Aquí se probaban también las cifras por estado de «Cómo avanza una reserva» (`contarPorEstado`,
 * `cifrasDeLaLista`, `alcanceCifrasDeLaLista`): el 2026-10-06 el dueño quitó esas cifras del timeline y su
 * código se retiró con ellas.
 */
import { describe, it, expect } from "vitest";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { cifraPorAtender } from "../cifrasPorEstado";
import {
  FILTRO_POR_ATENDER,
  FILTRO_SOLICITUDES,
  FILTRO_SOLICITUDES_CERRADAS,
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
  type FiltrosListaUnificada,
  type ReservaListable,
} from "../vistaUnificada";
import { ORDEN_ESTADOS } from "../estadosReserva";

const reserva = (id: string, estado: string, o: Partial<ReservaListable> = {}): ReservaListable => ({
  id,
  fecha: "2026-10-01",
  hora: "21:00:00",
  nombre: `Cliente ${id}`,
  telefono: "600000000",
  email: null,
  estado,
  canal: "web",
  numero_comensales: 2,
  notas_cliente: null,
  marca: "casa_tomas",
  ...o,
});

/**
 * Una reserva de cada estado (la única pendiente, «a»), repartidas en tres días y tres canales, más una de Touza
 * («c», Touza no admite reservas) y una con un estado que no existe («h»).
 */
const LISTA: ReservaListable[] = [
  reserva("a", "pendiente", { nombre: "Ana Pendiente", canal: "telefono" }),
  reserva("b", "verificada", { nombre: "Berta Verificada" }),
  reserva("c", "confirmada", { nombre: "Carlos Touza", marca: "touza" }),
  reserva("d", "completada", { nombre: "Elena Llegó", canal: "manual" }),
  reserva("e", "confirmada", { nombre: "Fede Segundodia", fecha: "2026-10-02", canal: "telefono", telefono: "611222333" }),
  reserva("f", "cancelada", { nombre: "Gema Cancelada", fecha: "2026-10-02" }),
  // Sin canal: la lista lo trata como «web».
  reserva("g", "no_show", { nombre: "Hugo NoVino", fecha: "2026-10-03", canal: null }),
  // Un estado que no existe (el CHECK no lo permite): pasa los filtros de la lista, pero no cuenta en ningún estado.
  reserva("h", "rechazada", { nombre: "Ines Rara" }),
];

describe("cifraPorAtender (el botón «Por atender»)", () => {
  const solicitud = (id: string, estado: string, o: Partial<SolicitudPendiente> = {}): SolicitudPendiente => ({
    id,
    nombre: `Solicitud ${id}`,
    telefono: "699000000",
    email: null,
    fecha_solicitada: "2026-10-01",
    hora_solicitada: "14:00",
    numero_comensales: 12,
    notas_cliente: null,
    motivo_rechazo: "grupo_grande",
    descripcion_rechazo: null,
    estado,
    notas_internas: null,
    created_at: null,
    updated_at: null,
    marca: "casa_tomas",
    ...o,
  });
  /** Dos sin resolver (pendiente, contactado), dos cerradas y una de Touza sin resolver (no cuenta). */
  const SOLICITUDES: SolicitudPendiente[] = [
    solicitud("s1", "pendiente", { nombre: "Familia Navarro" }),
    solicitud("s2", "contactado", { fecha_solicitada: "2026-10-02" }),
    solicitud("s3", "resuelta"),
    solicitud("s4", "descartada"),
    solicitud("s5", "pendiente", { marca: "touza" }),
  ];

  it("sin filtros: las reservas `pendiente` MÁS las solicitudes sin resolver (ni otros estados, ni cerradas, ni Touza)", () => {
    // LISTA: una pendiente de Casa Tomás («a»). SOLICITUDES: dos sin resolver de Casa Tomás.
    expect(cifraPorAtender(LISTA, SOLICITUDES, {})).toBe(3);
    expect(cifraPorAtender(LISTA, [], {})).toBe(1);
    expect(cifraPorAtender([], SOLICITUDES, {})).toBe(2);
  });

  it("sin nada por atender es 0 (dato real)", () => {
    expect(cifraPorAtender([reserva("x", "confirmada")], [solicitud("y", "resuelta")], {})).toBe(0);
    expect(cifraPorAtender([], [], {})).toBe(0);
  });

  it("TOUZA NO ADMITE RESERVAS: ni sus reservas pendientes ni sus solicitudes sin resolver cuentan; sin marca, sí", () => {
    const deTouza = [reserva("tz1", "pendiente", { marca: "touza" }), reserva("tz2", "pendiente", { marca: "touza" })];
    expect(cifraPorAtender(deTouza, [solicitud("tz3", "pendiente", { marca: "touza" })], {})).toBe(0);
    // Una reserva o solicitud sin marca es de Casa Tomás.
    expect(cifraPorAtender([reserva("x", "pendiente", { marca: null })], [solicitud("y", "contactado", { marca: null })], {})).toBe(2);
  });

  it("el filtro de ESTADO no la cambia, sea cual sea", () => {
    const todos = cifraPorAtender(LISTA, SOLICITUDES, {});
    for (const estado of [...ORDEN_ESTADOS, "all", FILTRO_POR_ATENDER, FILTRO_SOLICITUDES, FILTRO_SOLICITUDES_CERRADAS, "valor-raro"]) {
      expect(cifraPorAtender(LISTA, SOLICITUDES, { estado }), estado).toBe(todos);
    }
  });

  it("sigue la búsqueda, la fecha y el canal", () => {
    expect(cifraPorAtender(LISTA, SOLICITUDES, { busqueda: "navarro" })).toBe(1);
    expect(cifraPorAtender(LISTA, SOLICITUDES, { busqueda: "ana pendiente" })).toBe(1);
    expect(cifraPorAtender(LISTA, SOLICITUDES, { fecha: "2026-10-01" })).toBe(2); // «a» y «s1»
    expect(cifraPorAtender(LISTA, SOLICITUDES, { fecha: "2026-10-02" })).toBe(1); // «s2»
    // Las solicitudes solo salen con «teléfono»; «a» es de teléfono.
    expect(cifraPorAtender(LISTA, SOLICITUDES, { canal: "telefono" })).toBe(3);
    expect(cifraPorAtender(LISTA, SOLICITUDES, { canal: "web" })).toBe(0);
  });

  it("es justo el número de filas que la lista enseña con «Por atender» puesto, con cualquier combinación de filtros", () => {
    const combinaciones: FiltrosListaUnificada[] = [
      {},
      { fecha: "2026-10-01" },
      { canal: "telefono" },
      { busqueda: "e" },
      { fecha: "2026-10-02", canal: "telefono", busqueda: "solicitud" },
    ];
    for (const f of combinaciones) {
      const filas = filtrarFilasUnificadas(unificarReservasYSolicitudes(LISTA, SOLICITUDES), { ...f, estado: FILTRO_POR_ATENDER });
      expect(cifraPorAtender(LISTA, SOLICITUDES, f), JSON.stringify(f)).toBe(filas.length);
    }
  });

  it("no toca lo que recibe", () => {
    const copiaReservas = JSON.parse(JSON.stringify(LISTA));
    const copiaSolicitudes = JSON.parse(JSON.stringify(SOLICITUDES));
    const filtros = { busqueda: "a", estado: "confirmada" };
    cifraPorAtender(LISTA, SOLICITUDES, filtros);
    expect(LISTA).toEqual(copiaReservas);
    expect(SOLICITUDES).toEqual(copiaSolicitudes);
    expect(filtros).toEqual({ busqueda: "a", estado: "confirmada" });
  });
});
