// «Escribir reserva» (10/11/2026): normalización de lo escrito a mano.
import { describe, expect, it } from "vitest";
import {
  componerFecha,
  limpiarLecturaModelo,
  normalizarReservaManuscrita,
  parsearComensales,
  parsearFecha,
  parsearHora,
  parsearMes,
  resolverEspacio,
} from "../reserva-manuscrita";

const ESPACIOS = [
  { id: "s1", nombre: "Salón" },
  { id: "s2", nombre: "Comedor" },
  { id: "s3", nombre: "Terraza" },
  { id: "s4", nombre: "Reservado" },
];
// 10/11/2026 a mediodía en Madrid.
const HOY = new Date("2026-11-10T11:00:00Z");

describe("normalizarReservaManuscrita · texto libre", () => {
  it("«Esther 2px salón 13 noviembre 14:15»", () => {
    const r = normalizarReservaManuscrita("Esther 2px salón 13 noviembre 14:15", { espacios: ESPACIOS, hoy: HOY });
    expect(r).toMatchObject({
      nombre: "Esther",
      comensales: 2,
      espacio_id: "s1",
      espacio_nombre: "Salón",
      fecha: "2026-11-13",
      hora: "14:15",
      telefono: null,
      email: null,
    });
  });

  it("«noviempre», «2 pax» y «14h15»", () => {
    const r = normalizarReservaManuscrita("Esther 2 pax salon 13 noviempre 14h15", { espacios: ESPACIOS, hoy: HOY });
    expect(r).toMatchObject({ nombre: "Esther", comensales: 2, espacio_id: "s1", fecha: "2026-11-13", hora: "14:15" });
  });

  it("fecha que ya pasó este año → el año siguiente", () => {
    const r = normalizarReservaManuscrita("Juan Pérez 4 personas terraza 5 de marzo 2:15 tarde 612 345 678", {
      espacios: ESPACIOS,
      hoy: HOY,
    });
    expect(r).toMatchObject({
      nombre: "Juan Pérez",
      comensales: 4,
      espacio_id: "s3",
      fecha: "2027-03-05",
      hora: "14:15",
      telefono: "612345678",
    });
  });

  it("sin fecha escrita → la de la página abierta del libro", () => {
    const r = normalizarReservaManuscrita("Esther 2px salón 14:15", { espacios: ESPACIOS, hoy: HOY, fechaPorDefecto: "2026-11-21" });
    expect(r).toMatchObject({ nombre: "Esther", comensales: 2, espacio_id: "s1", fecha: "2026-11-21", fecha_escrita: false, hora: "14:15" });
  });

  it("con fecha escrita, manda lo escrito sobre la página", () => {
    const r = normalizarReservaManuscrita("Esther 2px 13 noviembre 14:15", { hoy: HOY, fechaPorDefecto: "2026-11-21" });
    expect(r).toMatchObject({ fecha: "2026-11-13", fecha_escrita: true });
  });

  it("sala inexistente: queda sin asignar", () => {
    const r = normalizarReservaManuscrita("Ana 3px 20/11 21:00", { espacios: ESPACIOS, hoy: HOY });
    expect(r).toMatchObject({ nombre: "Ana", comensales: 3, espacio_id: null, fecha: "2026-11-20", hora: "21:00" });
  });
});

describe("normalizarReservaManuscrita · campos del modelo", () => {
  it("usa los campos y completa lo que falta con la transcripción", () => {
    const r = normalizarReservaManuscrita(
      { texto: "Esther 2px salón 13 noviembre 14:15", nombre: "esther", comensales: null, espacio: "salon", dia: 13, mes: 11, hora: null },
      { espacios: ESPACIOS, hoy: HOY },
    );
    expect(r).toMatchObject({ nombre: "Esther", comensales: 2, espacio_id: "s1", fecha: "2026-11-13", hora: "14:15" });
  });

  it("el año escrito manda", () => {
    const r = normalizarReservaManuscrita({ dia: 2, mes: 1, anio: 2028 }, { hoy: HOY });
    expect(r.fecha).toBe("2028-01-02");
  });
});

describe("piezas", () => {
  it("comensales", () => {
    expect(parsearComensales("2px")).toBe(2);
    expect(parsearComensales("2 pax")).toBe(2);
    expect(parsearComensales("6 personas")).toBe(6);
    expect(parsearComensales("8")).toBe(8);
    expect(parsearComensales(0)).toBeNull();
  });

  it("hora", () => {
    expect(parsearHora("14:15")).toBe("14:15");
    expect(parsearHora("14h15")).toBe("14:15");
    expect(parsearHora("14h")).toBe("14:00");
    expect(parsearHora("2:15 tarde")).toBe("14:15");
    expect(parsearHora("21.30")).toBe("21:30");
    expect(parsearHora("a las 9 de la noche")).toBe("21:00");
    expect(parsearHora("25:00")).toBeNull();
  });

  it("meses con faltas", () => {
    expect(parsearMes("noviembre")).toBe(11);
    expect(parsearMes("noviempre")).toBe(11);
    expect(parsearMes("Setiembre")).toBe(9);
    expect(parsearMes("dic")).toBe(12);
    expect(parsearMes("salon")).toBeNull();
  });

  it("fecha y año", () => {
    expect(parsearFecha("13 de noviembre", HOY)).toBe("2026-11-13");
    expect(parsearFecha("10 noviembre", HOY)).toBe("2026-11-10");
    expect(parsearFecha("9 noviembre", HOY)).toBe("2027-11-09");
    expect(parsearFecha("mañana", HOY)).toBe("2026-11-11");
    expect(componerFecha(31, 2, null, HOY)).toBeNull();
  });

  it("espacio aproximado y sin tildes", () => {
    expect(resolverEspacio("SALON", ESPACIOS)?.id).toBe("s1");
    expect(resolverEspacio("terrraza", ESPACIOS)?.id).toBe("s3");
    expect(resolverEspacio("cocina", ESPACIOS)).toBeNull();
  });

  it("limpiarLecturaModelo descarta tipos raros", () => {
    expect(limpiarLecturaModelo({ nombre: "  Esther ", dia: 40, mes: 11, comensales: 2, hora: 5 })).toMatchObject({
      nombre: "Esther",
      dia: null,
      mes: 11,
      comensales: 2,
      hora: null,
    });
  });
});
