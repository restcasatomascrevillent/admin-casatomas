import { describe, it, expect } from "vitest";
import {
  actualizacionPropuesta,
  anotarPeticionOriginal,
  diferenciasPeticion,
  extraerPeticionOriginal,
  fechaLegible,
  lineaPeticionOriginal,
  peticionGuardada,
  peticionOriginal,
} from "@/lib/reservas/solicitudPropuesta";

const solicitud = (o: Record<string, unknown> = {}) => ({
  fecha_solicitada: "2026-10-06",
  hora_solicitada: "14:00",
  numero_comensales: 20,
  notas_internas: null as string | null,
  ...o,
});

describe("petición original en notas internas", () => {
  it("la línea es legible y se puede volver a leer", () => {
    const linea = lineaPeticionOriginal({ fecha: "2026-10-06", hora: "14:00", comensales: 20 });
    expect(linea).toBe("[Petición original del cliente: 2026-10-06 14:00, 20 pax]");
    expect(extraerPeticionOriginal(`Llamar mañana\n${linea}`)).toEqual({
      fecha: "2026-10-06",
      hora: "14:00",
      comensales: 20,
    });
  });

  it("admite huecos vacíos", () => {
    const linea = lineaPeticionOriginal({ fecha: null, hora: null, comensales: null });
    expect(extraerPeticionOriginal(linea)).toEqual({ fecha: null, hora: null, comensales: null });
  });

  it("anotar es idempotente y respeta las notas existentes", () => {
    const orig = { fecha: "2026-10-06", hora: "14:00", comensales: 20 };
    const una = anotarPeticionOriginal("Cliente habitual", orig);
    expect(una).toBe("[Petición original del cliente: 2026-10-06 14:00, 20 pax]\nCliente habitual");
    expect(anotarPeticionOriginal(una, { ...orig, comensales: 99 })).toBe(una);
    expect(anotarPeticionOriginal(null, orig)).toBe(lineaPeticionOriginal(orig));
  });

  it("peticionOriginal usa la marca si existe, si no la fila", () => {
    expect(peticionOriginal(solicitud())).toEqual({ fecha: "2026-10-06", hora: "14:00", comensales: 20 });
    expect(
      peticionOriginal(
        solicitud({ fecha_solicitada: "2026-10-07", notas_internas: "[Petición original del cliente: 2026-10-06 14:00, 20 pax]" }),
      ).fecha,
    ).toBe("2026-10-06");
  });
});

describe("actualizacionPropuesta", () => {
  it("null si no cambia nada (normaliza hora y fecha)", () => {
    expect(
      actualizacionPropuesta(solicitud({ hora_solicitada: "14:00:00" }), { fecha: "2026-10-06", hora: "14:00", comensales: 20 }),
    ).toBeNull();
  });

  it("primer cambio: guarda lo nuevo y anota lo que pidió el cliente", () => {
    const upd = actualizacionPropuesta(solicitud({ notas_internas: "Ojo alergias" }), {
      fecha: "2026-10-07",
      hora: "21:00",
      comensales: 18,
    })!;
    expect(upd).toEqual({
      fecha_solicitada: "2026-10-07",
      hora_solicitada: "21:00",
      numero_comensales: 18,
      notas_internas: "[Petición original del cliente: 2026-10-06 14:00, 20 pax]\nOjo alergias",
    });
  });

  it("segundo cambio: no reescribe la petición original", () => {
    const tras1 = solicitud({
      fecha_solicitada: "2026-10-07",
      hora_solicitada: "21:00",
      numero_comensales: 18,
      notas_internas: "[Petición original del cliente: 2026-10-06 14:00, 20 pax]",
    });
    const upd = actualizacionPropuesta(tras1, { fecha: "2026-10-07", hora: "22:00", comensales: 18 })!;
    expect(upd.notas_internas).toBe("[Petición original del cliente: 2026-10-06 14:00, 20 pax]");
    expect(upd.hora_solicitada).toBe("22:00");
  });
});

describe("utilidades", () => {
  it("diferenciasPeticion", () => {
    const d = diferenciasPeticion(
      { fecha: "2026-10-06", hora: "14:00:00", comensales: 20 },
      { fecha: "2026-10-06", hora: "14:00", comensales: 18 },
    );
    expect(d).toEqual({ fecha: false, hora: false, comensales: true, alguna: true });
  });
  it("peticionGuardada descarta comensales inválidos", () => {
    expect(peticionGuardada(solicitud({ numero_comensales: 0 })).comensales).toBeNull();
  });
  it("fechaLegible sin desfase de zona horaria", () => {
    expect(fechaLegible("2026-10-06")).toBe("6/10/2026");
    expect(fechaLegible(null)).toBe("—");
  });
});
