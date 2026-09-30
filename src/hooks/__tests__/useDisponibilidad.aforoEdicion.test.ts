/**
 * Aforo al EDITAR: la misma regla que el trigger `trg_validar_capacidad` en un
 * UPDATE (migración 20260930212000_aforo_permite_ediciones_sin_subir_ocupacion).
 * Un cambio se rechaza solo si AÑADE ocupación a un turno que queda por encima
 * del aforo; si la reserva ya ocupaba plaza y se queda en el mismo turno (mismo
 * negocio, mismo día, mismo lado del corte de las 17:00) sin subir de
 * comensales, se puede guardar aunque el turno esté pasado de aforo (p. ej.
 * tras desactivar una sala).
 */
import { describe, it, expect, vi } from "vitest";

const datos = vi.hoisted(() => ({
  tablas: {} as Record<string, unknown[]>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: datos.tablas[tabla] ?? [], error: null }).then(ok, ko);
      return b;
    },
  },
}));

import {
  efectoEdicionEnAforo,
  verificarAforoTurno,
  type CambioAforo,
  type EfectoEdicionAforo,
  type ReservaAnteriorAforo,
} from "@/hooks/useDisponibilidad";

// ------------------------------------------------------------
// La regla, sin I/O
// ------------------------------------------------------------

const ANTERIOR: ReservaAnteriorAforo = {
  id: "r1",
  fecha: "2026-10-10",
  hora: "21:00:00",
  numero_comensales: 6,
  estado: "confirmada",
  marca: "casa_tomas",
};

/** El mismo turno y los mismos comensales que `ANTERIOR`: cada caso cambia solo lo suyo. */
const SIN_CAMBIOS: CambioAforo = { fecha: "2026-10-10", hora: "21:00", comensales: 6, marca: "casa_tomas" };

type Caso = [
  descripcion: string,
  anterior: Partial<ReservaAnteriorAforo>,
  cambio: Partial<CambioAforo>,
  esperado: EfectoEdicionAforo,
];

const CASOS: Caso[] = [
  // Se puede guardar aunque el turno esté pasado de aforo: no suma ocupación.
  ["reducir comensales en el mismo turno", {}, { comensales: 4 }, "no_suma"],
  ["mantener comensales (reenviar sin cambios)", {}, {}, "no_suma"],
  ["mover la hora dentro del turno (21:00 → 22:30)", {}, { hora: "22:30" }, "no_suma"],
  ["mover la hora y reducir a la vez", {}, { hora: "20:00", comensales: 2 }, "no_suma"],
  ["«21:00:00» de la BD y «21:00» del formulario son la misma hora", {}, { hora: "21:00" }, "no_suma"],
  ["reserva pendiente que baja de comensales", { estado: "pendiente" }, { comensales: 5 }, "no_suma"],
  ["reserva verificada que cambia de hora en el turno", { estado: "verificada" }, { hora: "23:00" }, "no_suma"],
  ["pasar de pendiente a confirmada en el mismo turno", { estado: "pendiente" }, { estado: "confirmada" }, "no_suma"],
  ["marca vacía en la anterior = Casa Tomás (COALESCE del trigger)", { marca: null }, { marca: "casa_tomas" }, "no_suma"],
  ["sin marca en el cambio = la de la anterior", { marca: "touza" }, { marca: undefined }, "no_suma"],
  ["fecha guardada con hora detrás («2026-10-10T00:00:00»)", { fecha: "2026-10-10T00:00:00" }, {}, "no_suma"],
  ["corte: 17:00 → 17:30 es la misma cena", { hora: "17:00:00" }, { hora: "17:30" }, "no_suma"],
  ["corte: 16:30 → 16:59 es la misma comida", { hora: "16:30" }, { hora: "16:59" }, "no_suma"],
  ["una hora fuera de los turnos configurados (23:45) sigue siendo cena", {}, { hora: "23:45" }, "no_suma"],

  // Se comprueba el aforo como en un alta: suma ocupación.
  ["subir comensales", {}, { comensales: 7 }, "suma"],
  ["subir comensales moviendo la hora dentro del turno", {}, { hora: "22:00", comensales: 8 }, "suma"],
  ["mover a la comida (otro turno)", {}, { hora: "14:00" }, "suma"],
  ["mover a otro día", {}, { fecha: "2026-10-11" }, "suma"],
  ["cambiar de negocio", {}, { marca: "touza" }, "suma"],
  ["corte: 16:59 → 17:00 ya es la cena", { hora: "16:59" }, { hora: "17:00" }, "suma"],
  ["pasar de cancelada a viva", { estado: "cancelada" }, { estado: "pendiente" }, "suma"],
  ["pasar de «No vino» a confirmada, aunque baje de comensales", { estado: "no_show" }, { estado: "confirmada", comensales: 2 }, "suma"],

  // Conservador: ante un dato ilegible no se da por «mismo turno».
  ["hora guardada ilegible", { hora: "" }, {}, "suma"],
  ["hora nueva de las 24:00 (el motor la pliega a la comida, la BD la cuenta como cena)", { hora: "23:30" }, { hora: "24:00" }, "suma"],
  ["fecha nueva con otro formato", {}, { fecha: "10/10/2026" }, "suma"],
  ["comensales que no son un número", {}, { comensales: Number.NaN }, "suma"],

  // No ocupa plaza: el trigger no comprueba nada.
  ["cancelada que se edita y sigue cancelada", { estado: "cancelada" }, { comensales: 12, hora: "14:00" }, "no_ocupa"],
  ["«Llegó» (completada)", { estado: "completada" }, { comensales: 9 }, "no_ocupa"],
  ["«No vino» (no_show)", { estado: "no_show" }, {}, "no_ocupa"],
  ["cancelar una reserva viva", {}, { estado: "cancelada", comensales: 20 }, "no_ocupa"],
];

describe("efectoEdicionEnAforo · la regla del trigger en un UPDATE", () => {
  it.each(CASOS)("%s", (_descripcion, anterior, cambio, esperado) => {
    expect(efectoEdicionEnAforo({ ...ANTERIOR, ...anterior }, { ...SIN_CAMBIOS, ...cambio })).toBe(esperado);
  });
});

// ------------------------------------------------------------
// El aviso previo del formulario
// ------------------------------------------------------------

/**
 * Casa Tomás con 10 plazas y la CENA por encima del aforo: 6 + 8 = 14 (lo que
 * queda tras desactivar una sala). La comida, con 3.
 */
function cenaPasadaDeAforo() {
  datos.tablas = {
    configuracion_turnos: [],
    espacios_reserva: [{ id: "salon", nombre: "Salón", capacidad_maxima: 10, caracteristicas: { marca: "casa_tomas" } }],
    reservas: [
      { id: "r-seis", hora: "21:00:00", numero_comensales: 6, espacio_id: null },
      { id: "r-ocho", hora: "21:30:00", numero_comensales: 8, espacio_id: null },
      { id: "r-comida", hora: "13:00:00", numero_comensales: 3, espacio_id: null },
    ],
  };
}

/** La reserva de 6 de la cena, tal como está guardada. */
const R_SEIS: ReservaAnteriorAforo = {
  id: "r-seis",
  fecha: "2026-10-10",
  hora: "21:00:00",
  numero_comensales: 6,
  estado: "confirmada",
  marca: "casa_tomas",
};

describe("verificarAforoTurno · con la reserva anterior (edición)", () => {
  it("reducir comensales (6 → 5) en la cena pasada de aforo se puede guardar, como hará la BD", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 5, "casa_tomas", R_SEIS);

    expect(aforo.disponible).toBe(true);
    expect(aforo.efectoEdicion).toBe("no_suma");
    // Sin contarse a sí misma: solo la de 8.
    expect(aforo.comensalesActuales).toBe(8);
    expect(aforo.mensaje).toMatch(/por encima del aforo \(13 de 10\)/);
    expect(aforo.mensaje).toMatch(/no suma comensales/);
  });

  it("con solo el id (la llamada de antes) se sigue comprobando como un alta", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 5, "casa_tomas", "r-seis");

    expect(aforo.disponible).toBe(false);
    expect(aforo.efectoEdicion).toBeUndefined();
    expect(aforo.comensalesActuales).toBe(8);
    expect(aforo.mensaje).toMatch(/Aforo superado/);
  });

  it("mover la hora dentro de la cena sin subir comensales se puede guardar", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "22:15", 6, "casa_tomas", R_SEIS);

    expect(aforo.disponible).toBe(true);
    expect(aforo.efectoEdicion).toBe("no_suma");
  });

  it("subir comensales (6 → 7) en la cena pasada de aforo: aforo superado", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 7, "casa_tomas", R_SEIS);

    expect(aforo.disponible).toBe(false);
    expect(aforo.efectoEdicion).toBe("suma");
    expect(aforo.mensaje).toMatch(/Aforo superado en el turno de cena/);
  });

  it("mover a la comida, que tiene hueco: se comprueba como un alta y cabe", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "13:30", 6, "casa_tomas", R_SEIS);

    expect(aforo.efectoEdicion).toBe("suma");
    expect(aforo.disponible).toBe(true);
    expect(aforo.mensaje).toBe("Quedan 7 plazas en el turno de comida (3/10 ocupadas)");
  });

  it("mover a la comida subiendo a 8: no cabe (3 + 8 > 10)", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "13:30", 8, "casa_tomas", R_SEIS);

    expect(aforo.efectoEdicion).toBe("suma");
    expect(aforo.disponible).toBe(false);
  });

  it("mover a otro día igual de lleno: otro día no es el mismo turno", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-11", "21:00", 6, "casa_tomas", R_SEIS);

    expect(aforo.efectoEdicion).toBe("suma");
    expect(aforo.disponible).toBe(false);
  });

  it("cambiar de negocio se comprueba contra el aforo del otro (aquí, sin salas)", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 6, "touza", R_SEIS);

    expect(aforo.efectoEdicion).toBe("suma");
    expect(aforo.capacidadMaxima).toBe(0);
    expect(aforo.disponible).toBe(false);
  });

  it("una reserva cancelada no se comprueba (la BD tampoco la mira)", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 12, "casa_tomas", {
      ...R_SEIS,
      estado: "cancelada",
    });

    expect(aforo.efectoEdicion).toBe("no_ocupa");
    expect(aforo.disponible).toBe(true);
    expect(aforo.mensaje).toMatch(/no ocupa plaza/);
  });

  it("con hueco en el turno, el mensaje es el de siempre", async () => {
    datos.tablas = {
      configuracion_turnos: [],
      espacios_reserva: [{ id: "salon", nombre: "Salón", capacidad_maxima: 20, caracteristicas: { marca: "casa_tomas" } }],
      reservas: [
        { id: "r-seis", hora: "21:00:00", numero_comensales: 6, espacio_id: null },
        { id: "r-ocho", hora: "21:30:00", numero_comensales: 8, espacio_id: null },
      ],
    };
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 4, "casa_tomas", R_SEIS);

    expect(aforo.efectoEdicion).toBe("no_suma");
    expect(aforo.disponible).toBe(true);
    expect(aforo.mensaje).toBe("Quedan 12 plazas en el turno de cena (8/20 ocupadas)");
  });

  it("sin reserva anterior (alta) no hay efecto de edición y todo sigue igual", async () => {
    cenaPasadaDeAforo();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 1, "casa_tomas");

    expect(aforo.efectoEdicion).toBeUndefined();
    expect(aforo.comensalesActuales).toBe(14);
    expect(aforo.disponible).toBe(false);
  });
});
