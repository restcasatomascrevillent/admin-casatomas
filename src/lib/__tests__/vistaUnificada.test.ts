import { describe, it, expect } from "vitest";
import {
  FILTRO_SOLICITUDES,
  FILTRO_SOLICITUDES_CERRADAS,
  filtrarFilasUnificadas,
  resolverDeepLinkReservas,
  unificarReservasYSolicitudes,
  type ReservaListable,
} from "@/lib/reservas/vistaUnificada";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";

const reserva = (o: Partial<ReservaListable> = {}): ReservaListable => ({
  id: "r1",
  fecha: "2026-09-23",
  hora: "21:00:00",
  nombre: "Ana López",
  telefono: "600111222",
  email: "ana@test.com",
  estado: "confirmada",
  canal: "web",
  numero_comensales: 4,
  notas_cliente: null,
  ...o,
});

const solicitud = (o: Partial<SolicitudPendiente> = {}): SolicitudPendiente => ({
  id: "s1",
  nombre: "Juan García",
  telefono: "+34 666 111 222",
  email: null,
  fecha_solicitada: "2026-09-25",
  hora_solicitada: "14:00",
  numero_comensales: 12,
  notas_cliente: null,
  motivo_rechazo: "grupo_grande",
  descripcion_rechazo: null,
  estado: "pendiente",
  notas_internas: null,
  created_at: "2026-09-23T10:00:00Z",
  updated_at: null,
  ...o,
});

describe("unificarReservasYSolicitudes", () => {
  it("mezcla ambas fuentes sin colisión de ids y pone primero las solicitudes abiertas", () => {
    const filas = unificarReservasYSolicitudes(
      [reserva({ id: "r1", fecha: "2026-09-30" }), reserva({ id: "r2", fecha: "2026-09-20" })],
      [solicitud({ id: "r1", estado: "resuelta", fecha_solicitada: "2026-10-01" }), solicitud({ id: "s2" })],
    );
    expect(filas.map((f) => f.id)).toEqual(["solicitud-s2", "solicitud-r1", "r1", "r2"]);
    expect(new Set(filas.map((f) => f.id)).size).toBe(4);
  });

  it("ordena por fecha descendente y hora ascendente dentro del día", () => {
    const filas = unificarReservasYSolicitudes(
      [
        reserva({ id: "tarde", hora: "22:00:00" }),
        reserva({ id: "pronto", hora: "13:30:00" }),
        reserva({ id: "manana", fecha: "2026-09-24" }),
      ],
      [],
    );
    expect(filas.map((f) => f.id)).toEqual(["manana", "pronto", "tarde"]);
  });
});

describe("filtrarFilasUnificadas", () => {
  const filas = unificarReservasYSolicitudes(
    [
      reserva({ id: "conf" }),
      reserva({ id: "pend", estado: "pendiente", canal: "telefono" }),
      reserva({ id: "lleg", estado: "completada" }),
    ],
    [solicitud({ id: "abierta" }), solicitud({ id: "contactada", estado: "contactado" }), solicitud({ id: "cerrada", estado: "descartada" })],
  );
  const ids = (estado: string, extra = {}) => filtrarFilasUnificadas(filas, { estado, ...extra }).map((f) => f.id);

  it("'Todos' incluye reservas y solo solicitudes abiertas", () => {
    expect(ids("all").sort()).toEqual(["conf", "lleg", "pend", "solicitud-abierta", "solicitud-contactada"].sort());
  });

  it("filtro de solicitudes sin resolver / cerradas", () => {
    expect(ids(FILTRO_SOLICITUDES).sort()).toEqual(["solicitud-abierta", "solicitud-contactada"]);
    expect(ids(FILTRO_SOLICITUDES_CERRADAS)).toEqual(["solicitud-cerrada"]);
  });

  it("un estado de reserva excluye las solicitudes", () => {
    expect(ids("pendiente")).toEqual(["pend"]);
    expect(ids("completada")).toEqual(["lleg"]);
  });

  it("canal: las solicitudes solo aparecen con 'telefono'", () => {
    expect(ids("all", { canal: "telefono" }).sort()).toEqual(["pend", "solicitud-abierta", "solicitud-contactada"]);
    expect(ids("all", { canal: "web" }).sort()).toEqual(["conf", "lleg"]);
  });

  it("fecha y búsqueda se aplican a las dos fuentes", () => {
    expect(ids("all", { fecha: "2026-09-25" }).sort()).toEqual(["solicitud-abierta", "solicitud-contactada"]);
    expect(ids("all", { busqueda: "666 111" }).sort()).toEqual(["solicitud-abierta", "solicitud-contactada"]);
    expect(ids("all", { busqueda: "ANA@" }).sort()).toEqual(["conf", "lleg", "pend"]);
  });
});

describe("resolverDeepLinkReservas", () => {
  it("redirige las pestañas antiguas a 'reservas' conservando filtros", () => {
    expect(resolverDeepLinkReservas({ tab: "hoy" })).toEqual({ tab: "reservas", status: undefined, date: undefined });
    expect(resolverDeepLinkReservas({ tab: "lista", status: "pendiente", date: "today" })).toEqual({
      tab: "reservas",
      status: "pendiente",
      date: "today",
    });
    expect(resolverDeepLinkReservas({ tab: "solicitudes" })).toEqual({
      tab: "reservas",
      status: FILTRO_SOLICITUDES,
      date: undefined,
    });
  });

  it("respeta las pestañas vigentes y descarta las desconocidas", () => {
    expect(resolverDeepLinkReservas({ tab: "blacklist" }).tab).toBe("blacklist");
    expect(resolverDeepLinkReservas({ tab: "configuracion" }).tab).toBe("configuracion");
    expect(resolverDeepLinkReservas({ tab: "inventada" }).tab).toBe("reservas");
    expect(resolverDeepLinkReservas({}).tab).toBe("reservas");
  });
});
