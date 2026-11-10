/**
 * La comida de martes a jueves en el libro, en tres bloques (10/11/2026, petición del dueño): «Menú del día»,
 * «Carta» y «Resto» (sin el dato o «No vino»), cada uno por hora y con su total. Y el filtro rápido
 * «Menú del día / Carta» de la Tabla.
 */
import { describe, it, expect } from "vitest";
import { bloquesComidaMenuDelDia, esDiaDeMenuDelDia } from "@/lib/reservas/menuDelDia";
import { filtrarFilasUnificadas, unificarReservasYSolicitudes, type ReservaListable } from "@/lib/reservas/vistaUnificada";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";

const r = (id: string, hora: string, pax: number, menu: boolean | null | undefined, estado = "confirmada") => ({
  id,
  hora,
  numero_comensales: pax,
  estado,
  menu_del_dia: menu,
});

describe("esDiaDeMenuDelDia", () => {
  it("martes, miércoles y jueves sí; el resto no (y una fecha rota, no)", () => {
    expect(["2026-11-10", "2026-11-11", "2026-11-12"].map(esDiaDeMenuDelDia)).toEqual([true, true, true]);
    expect(["2026-11-09", "2026-11-13", "2026-11-14", "2026-11-15"].map(esDiaDeMenuDelDia)).toEqual([false, false, false, false]);
    expect(esDiaDeMenuDelDia("10/11/2026")).toBe(false);
  });
});

describe("bloquesComidaMenuDelDia", () => {
  const comida = [
    r("a", "13:30:00", 2, true),
    r("b", "13:45:00", 4, false),
    r("c", "14:00:00", 3, true),
    r("d", "14:15:00", 5, null),
    r("e", "14:30:00", 2, true, "no_show"),
    r("f", "15:00:00", 6, false),
  ];

  it("martes: Menú del día, Carta y Resto, conservando el orden por hora y con su total de personas", () => {
    const bloques = bloquesComidaMenuDelDia("2026-11-10", comida)!;
    expect(bloques.map((b) => [b.etiqueta, b.reservas.map((x) => x.id), b.pax])).toEqual([
      ["Menú del día", ["a", "c"], 5],
      ["Carta", ["b", "f"], 10],
      // Sin el dato (antigua) y el «No vino», que no suma personas.
      ["Resto", ["d", "e"], 5],
    ]);
  });

  it("sin bloques vacíos", () => {
    const bloques = bloquesComidaMenuDelDia("2026-11-11", [r("a", "13:30", 2, true)])!;
    expect(bloques.map((b) => b.clave)).toEqual(["menu"]);
  });

  it("otro día (lunes, viernes, fin de semana): null, va como siempre", () => {
    for (const fecha of ["2026-11-09", "2026-11-13", "2026-11-14"]) expect(bloquesComidaMenuDelDia(fecha, comida)).toBeNull();
  });
});

describe("filtro rápido «Menú del día / Carta» de la Tabla", () => {
  const reserva = (id: string, menu: boolean | null): ReservaListable => ({
    id,
    fecha: "2026-11-10",
    hora: "13:30:00",
    nombre: id,
    estado: "confirmada",
    numero_comensales: 2,
    menu_del_dia: menu,
  });
  const solicitud = { id: "s1", nombre: "Bot", estado: "pendiente", fecha_solicitada: "2026-11-10" } as SolicitudPendiente;
  const filas = unificarReservasYSolicitudes([reserva("menu", true), reserva("carta", false), reserva("antigua", null)], [solicitud]);
  const ids = (servicio: "all" | "menu" | "carta") =>
    filtrarFilasUnificadas(filas, { servicio }).map((f) => (f.tipo === "reserva" ? f.reserva.id : "solicitud"));

  it("«Menú del día» solo las de menú; «Carta» solo las de carta; sin filtro, todas", () => {
    expect(ids("menu")).toEqual(["menu"]);
    expect(ids("carta")).toEqual(["carta"]);
    expect(ids("all").sort()).toEqual(["antigua", "carta", "menu", "solicitud"]);
  });
});
