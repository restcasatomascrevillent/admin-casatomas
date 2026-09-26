/**
 * Tests de `src/components/reservas/asignacionPlano.ts`.
 *
 * Solo lo que es PROPIO del plano. El corte de turno de las 17:00, el ajuste de
 * capacidad y los mensajes de error del RPC viven en
 * `src/lib/reservas/asignacionMesas.ts` y tienen sus tests allí: aquí solo se
 * comprueba que este fichero los usa (p. ej. que `horaEnFiltro` respeta el
 * corte) y no que los reimplemente.
 */
import { describe, it, expect } from "vitest";
import {
  agruparPorReserva,
  dateAFechaISO,
  esFechaISO,
  esFiltroTurno,
  etiquetaFiltroTurno,
  fechaISOaDate,
  horaEnFiltro,
  hoyLocal,
  nombreMesasJuntas,
  OPCIONES_TURNO,
  plazasDeMesas,
  resumenCierreDia,
  turnoParaConsulta,
} from "@/components/reservas/asignacionPlano";

// ─── Filtro de turno ─────────────────────────────────────────────────────────

describe("horaEnFiltro", () => {
  it("parte los servicios en el corte de las 17:00, igual que el SQL", () => {
    expect(horaEnFiltro("13:30:00", "comida")).toBe(true);
    expect(horaEnFiltro("16:59:00", "comida")).toBe(true);
    expect(horaEnFiltro("17:00:00", "comida")).toBe(false);

    expect(horaEnFiltro("17:00:00", "cena")).toBe(true);
    expect(horaEnFiltro("21:30:00", "cena")).toBe(true);
    expect(horaEnFiltro("13:30:00", "cena")).toBe(false);
  });

  it("con 'todo el día' no descarta nada", () => {
    expect(horaEnFiltro("13:30:00", "dia")).toBe(true);
    expect(horaEnFiltro("21:30:00", "dia")).toBe(true);
    expect(horaEnFiltro("", "dia")).toBe(true);
  });
});

describe("turnoParaConsulta", () => {
  it("'todo el día' no se le pide a la base de datos como turno", () => {
    expect(turnoParaConsulta("dia")).toBeUndefined();
    expect(turnoParaConsulta("comida")).toBe("comida");
    expect(turnoParaConsulta("cena")).toBe("cena");
  });
});

describe("esFiltroTurno", () => {
  it("acepta los tres valores de la barra y rechaza el resto", () => {
    expect(esFiltroTurno("comida")).toBe(true);
    expect(esFiltroTurno("cena")).toBe(true);
    expect(esFiltroTurno("dia")).toBe(true);
    expect(esFiltroTurno("")).toBe(false);
    expect(esFiltroTurno("merienda")).toBe(false);
    expect(esFiltroTurno(null)).toBe(false);
  });
});

describe("OPCIONES_TURNO / etiquetaFiltroTurno", () => {
  it("ofrece comida, cena y todo el día, en ese orden", () => {
    expect(OPCIONES_TURNO.map((o) => o.valor)).toEqual(["comida", "cena", "dia"]);
  });

  it("etiqueta cada filtro en español", () => {
    expect(etiquetaFiltroTurno("comida")).toBe("Comida");
    expect(etiquetaFiltroTurno("cena")).toBe("Cena");
    expect(etiquetaFiltroTurno("dia")).toBe("Todo el día");
  });
});

// ─── Mesas de cada reserva ───────────────────────────────────────────────────

describe("agruparPorReserva", () => {
  it("junta las mesas de cada reserva conservando el orden de entrada", () => {
    const grupos = agruparPorReserva([
      { reserva_id: "r1", mesa_id: "m4" },
      { reserva_id: "r2", mesa_id: "m9" },
      { reserva_id: "r1", mesa_id: "m5" },
    ]);

    expect([...grupos.keys()]).toEqual(["r1", "r2"]);
    expect(grupos.get("r1")!.map((a) => a.mesa_id)).toEqual(["m4", "m5"]);
    expect(grupos.get("r2")!.map((a) => a.mesa_id)).toEqual(["m9"]);
  });

  it("con lista vacía devuelve un mapa vacío", () => {
    expect(agruparPorReserva([]).size).toBe(0);
  });
});

describe("plazasDeMesas", () => {
  const mesas = new Map([
    ["m4", { capacidad: 4 }],
    ["m5", { capacidad: 2 }],
  ]);

  it("suma las plazas de las mesas juntas: la 4 y la 5 hacen 6", () => {
    expect(plazasDeMesas(["m4", "m5"], mesas)).toBe(6);
  });

  it("sin mesas son 0 plazas", () => {
    expect(plazasDeMesas([], mesas)).toBe(0);
  });

  it("una mesa que ya no existe no inventa plazas", () => {
    expect(plazasDeMesas(["m4", "m-borrada"], mesas)).toBe(4);
  });
});

describe("nombreMesasJuntas", () => {
  it("escribe las mesas juntas en una línea", () => {
    expect(nombreMesasJuntas(["Mesa 4", "Mesa 5"])).toBe("Mesa 4 + Mesa 5");
    expect(nombreMesasJuntas(["Mesa 4"])).toBe("Mesa 4");
    expect(nombreMesasJuntas([])).toBe("");
  });
});

// ─── Estado de cierre del día ────────────────────────────────────────────────

describe("resumenCierreDia", () => {
  const reservas = [
    { id: "r1", numero_comensales: 6, espacio_id: "e-salon" },
    { id: "r2", numero_comensales: 2, espacio_id: "e-salon" },
    { id: "r3", numero_comensales: 4, espacio_id: "e-salon" },
  ];

  it("cuenta las que ya tienen mesa y las que siguen pendientes de mesa", () => {
    const resumen = resumenCierreDia(
      reservas,
      new Map([["r1", [{}, {}]]]),
    );

    expect(resumen.total).toBe(3);
    expect(resumen.conMesa).toBe(1);
    expect(resumen.pendientesMesa).toBe(2);
    expect(resumen.comensales).toBe(12);
    expect(resumen.comensalesConMesa).toBe(6);
    expect(resumen.cerrado).toBe(false);
  });

  it("marca el servicio cerrado solo cuando TODAS tienen mesa", () => {
    const resumen = resumenCierreDia(
      reservas,
      new Map([
        ["r1", [{}]],
        ["r2", [{}]],
        ["r3", [{}]],
      ]),
    );

    expect(resumen.conMesa).toBe(3);
    expect(resumen.pendientesMesa).toBe(0);
    expect(resumen.porcentaje).toBe(100);
    expect(resumen.cerrado).toBe(true);
  });

  it("sin ninguna mesa repartida no está cerrado y va al 0%", () => {
    const resumen = resumenCierreDia(reservas, new Map());
    expect(resumen.conMesa).toBe(0);
    expect(resumen.pendientesMesa).toBe(3);
    expect(resumen.porcentaje).toBe(0);
    expect(resumen.cerrado).toBe(false);
  });

  it("sin reservas no hay nada que cerrar y no se declara cerrado", () => {
    const resumen = resumenCierreDia([], new Map());
    expect(resumen.total).toBe(0);
    expect(resumen.conMesa).toBe(0);
    expect(resumen.pendientesMesa).toBe(0);
    expect(resumen.cerrado).toBe(false);
  });

  it("una reserva sin sala también cuenta como pendiente, no se pierde", () => {
    const resumen = resumenCierreDia(
      [
        { id: "r1", numero_comensales: 4, espacio_id: "e-salon" },
        { id: "r2", numero_comensales: 2, espacio_id: null },
      ],
      new Map([["r1", [{}]]]),
    );

    expect(resumen.total).toBe(2);
    expect(resumen.conMesa).toBe(1);
    expect(resumen.pendientesMesa).toBe(1);
    expect(resumen.conMesa + resumen.pendientesMesa).toBe(resumen.total);
  });
});

// ─── Fechas del selector ─────────────────────────────────────────────────────

describe("esFechaISO", () => {
  it("acepta un YYYY-MM-DD real", () => {
    expect(esFechaISO("2026-09-26")).toBe(true);
    expect(esFechaISO("2024-02-29")).toBe(true); // 2024 sí es bisiesto
  });

  it("rechaza lo que no es una fecha de calendario", () => {
    expect(esFechaISO("2026-02-29")).toBe(false); // 2026 no es bisiesto
    expect(esFechaISO("2026-02-30")).toBe(false);
    expect(esFechaISO("2026-13-01")).toBe(false);
    expect(esFechaISO("26-09-2026")).toBe(false);
    expect(esFechaISO("hoy")).toBe(false);
    expect(esFechaISO(null)).toBe(false);
    expect(esFechaISO(undefined)).toBe(false);
  });
});

describe("fechaISOaDate / dateAFechaISO", () => {
  it("van y vuelven sin saltarse de día por la zona horaria", () => {
    expect(dateAFechaISO(fechaISOaDate("2026-09-26"))).toBe("2026-09-26");
    expect(dateAFechaISO(fechaISOaDate("2026-01-01"))).toBe("2026-01-01");
    expect(dateAFechaISO(fechaISOaDate("2026-12-31"))).toBe("2026-12-31");
  });

  it("da un Date local, no UTC", () => {
    const d = fechaISOaDate("2026-09-26");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(26);
  });
});

describe("hoyLocal", () => {
  it("devuelve la fecha de hoy en formato YYYY-MM-DD", () => {
    expect(hoyLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hoyLocal()).toBe(new Date().toLocaleDateString("sv-SE"));
  });
});
