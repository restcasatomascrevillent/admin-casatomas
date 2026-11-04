import { describe, it, expect } from "vitest";
import {
  FILTRO_POR_ATENDER,
  FILTRO_SOLICITUDES,
  FILTRO_SOLICITUDES_CERRADAS,
  OPCIONES_FILTRO_ESTADO,
  estaPorAtender,
  filtrarFilasUnificadas,
  resolverDeepLinkReservas,
  resolverSubpestanaConfiguracion,
  unificarReservasYSolicitudes,
  type ReservaListable,
} from "@/lib/reservas/vistaUnificada";
import { ESTADOS_RESERVA, ORDEN_ESTADOS } from "@/lib/reservas/estadosReserva";
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

  // «Por atender» (2026-10-05, petición del dueño; el nombre también es suyo): un valor más del filtro de estado.
  it("«Por atender» (FILTRO_POR_ATENDER): las reservas pendientes y las solicitudes sin resolver, y nada más", () => {
    expect(FILTRO_POR_ATENDER).toBe("por_atender");
    // Ni la confirmada ni la «Llegó», ni la solicitud descartada.
    expect(ids(FILTRO_POR_ATENDER).sort()).toEqual(["pend", "solicitud-abierta", "solicitud-contactada"]);
  });

  it("«Por atender» se combina con el canal, la fecha y la búsqueda como cualquier estado", () => {
    // Las solicitudes solo salen con «teléfono» (el único canal que las registra), y la pendiente es de teléfono.
    expect(ids(FILTRO_POR_ATENDER, { canal: "telefono" }).sort()).toEqual(["pend", "solicitud-abierta", "solicitud-contactada"]);
    expect(ids(FILTRO_POR_ATENDER, { canal: "web" })).toEqual([]);
    expect(ids(FILTRO_POR_ATENDER, { fecha: "2026-09-25" }).sort()).toEqual(["solicitud-abierta", "solicitud-contactada"]);
    expect(ids(FILTRO_POR_ATENDER, { fecha: "2026-09-23" })).toEqual(["pend"]);
    expect(ids(FILTRO_POR_ATENDER, { busqueda: "ANA@" })).toEqual(["pend"]);
    expect(ids(FILTRO_POR_ATENDER, { busqueda: "666 111" }).sort()).toEqual(["solicitud-abierta", "solicitud-contactada"]);
  });

  it("el estado «pendiente» del timeline sigue siendo SOLO de reservas (sin solicitudes)", () => {
    expect(ids("pendiente")).toEqual(["pend"]);
  });
});

describe("estaPorAtender (qué entra en «Por atender»)", () => {
  const filaDeReserva = (estado: string) => unificarReservasYSolicitudes([reserva({ estado })], [])[0];
  const filaDeSolicitud = (estado: string) => unificarReservasYSolicitudes([], [solicitud({ estado })])[0];

  it("de las reservas, solo las `pendiente`", () => {
    for (const estado of [...ORDEN_ESTADOS, "rechazada"]) {
      expect(estaPorAtender(filaDeReserva(estado)), estado).toBe(estado === "pendiente");
    }
  });

  it("de las solicitudes, las sin resolver (pendiente, contactado); las cerradas no", () => {
    expect(estaPorAtender(filaDeSolicitud("pendiente"))).toBe(true);
    expect(estaPorAtender(filaDeSolicitud("contactado"))).toBe(true);
    expect(estaPorAtender(filaDeSolicitud("resuelta"))).toBe(false);
    expect(estaPorAtender(filaDeSolicitud("descartada"))).toBe(false);
  });
});

describe("OPCIONES_FILTRO_ESTADO (el desplegable «Estado»)", () => {
  it("empieza por «Todos los estados» (ya no «Todos») y justo después «Por atender»", () => {
    expect(OPCIONES_FILTRO_ESTADO.slice(0, 2)).toEqual([
      { value: "all", label: "Todos los estados" },
      { value: FILTRO_POR_ATENDER, label: "Por atender (reservas y solicitudes sin resolver)", corta: "Por atender" },
    ]);
  });

  it("cerrado, un estado de reserva se dice con el nombre de su insignia («Llegó», no «Llegó / completada»)", () => {
    for (const estado of ORDEN_ESTADOS) {
      const opcion = OPCIONES_FILTRO_ESTADO.find((o) => o.value === estado)!;
      expect(opcion.label, estado).toBe(ESTADOS_RESERVA[estado].etiquetaFiltro);
      expect(opcion.corta, estado).toBe(ESTADOS_RESERVA[estado].etiqueta);
    }
    expect(OPCIONES_FILTRO_ESTADO.find((o) => o.value === "completada")?.corta).toBe("Llegó");
  });

  it("los valores no cambian: los de siempre más `por_atender`", () => {
    expect(OPCIONES_FILTRO_ESTADO.map((o) => o.value)).toEqual([
      "all",
      "por_atender",
      FILTRO_SOLICITUDES,
      "pendiente",
      "verificada",
      "confirmada",
      "completada",
      "no_show",
      "cancelada",
      FILTRO_SOLICITUDES_CERRADAS,
    ]);
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
    // El enlace de la campana para `reserva_sin_asignar` (CentroNotificaciones)
    // es /reservas?tab=asignacion: tiene que abrir esa pestaña, no Lista.
    expect(resolverDeepLinkReservas({ tab: "asignacion" }).tab).toBe("asignacion");
    expect(resolverDeepLinkReservas({ tab: "inventada" }).tab).toBe("reservas");
    expect(resolverDeepLinkReservas({}).tab).toBe("reservas");
  });
});

describe("resolverSubpestanaConfiguracion", () => {
  it("?sub=plantillas abre «Plantillas email» (destino de /super-admin/plantillas-email)", () => {
    expect(resolverSubpestanaConfiguracion("plantillas")).toBe("plantillas");
    expect(resolverSubpestanaConfiguracion("general")).toBe("general");
  });

  it("sin ?sub o con uno desconocido, «General»", () => {
    expect(resolverSubpestanaConfiguracion(null)).toBe("general");
    expect(resolverSubpestanaConfiguracion(undefined)).toBe("general");
    expect(resolverSubpestanaConfiguracion("")).toBe("general");
    expect(resolverSubpestanaConfiguracion("plantillas-email")).toBe("general");
  });
});
