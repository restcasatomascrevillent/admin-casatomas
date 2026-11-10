import { describe, expect, it } from "vitest";
import { formatearEurPequeno, resumirLecturaManuscrita, FUNCION_LECTURA_MANUSCRITA } from "../gastoLecturaManuscrita";

describe("gasto de leer reservas escritas a mano", () => {
  it("resume solo la función del libro y pasa a euros", () => {
    const r = resumirLecturaManuscrita(
      [
        { funcion: "chat-facturas", llamadas: 9, peticiones: 9, errores: 0, coste_usd: 3 },
        { funcion: FUNCION_LECTURA_MANUSCRITA, llamadas: 4, peticiones: 4, errores: 1, coste_usd: 0.02 },
      ],
      0.9,
    );
    expect(r.lecturas).toBe(4);
    expect(r.errores).toBe(1);
    expect(r.eur).toBeCloseTo(0.018);
    expect(r.eurPorLectura).toBeCloseTo(0.0045);
  });

  it("sin lecturas: cero y sin coste por lectura", () => {
    const r = resumirLecturaManuscrita([], 0.92);
    expect(r).toMatchObject({ lecturas: 0, eur: 0, eurPorLectura: null });
  });

  it("importes de céntimos con 4 decimales", () => {
    expect(formatearEurPequeno(0.0037)).toBe("0,0037 €");
    expect(formatearEurPequeno(1.5)).toBe("1,50 €");
  });
});
