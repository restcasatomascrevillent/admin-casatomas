import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ pedidas: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (columnas: string) => {
    h.pedidas.push(columnas);
    const fila = { id: "r1", marca: "casa_tomas", hora: "21:00" };
    const resultado = columnas.includes("fuera_")
      ? { data: null, error: { code: "42703", message: "column reservas.fuera_lugar does not exist" } }
      : { data: [fila], error: null };
    const cadena = { eq: () => cadena, neq: () => cadena, order: () => Promise.resolve(resultado) };
    return cadena;
  };
  return { supabase: { from: () => ({ select: consulta }) } };
});

import { consultaReservasHoy, __resetColumnasFueraParaTests } from "../consultaReservasHoy";

describe("consultaReservasHoy sin la migración de «Sentar fuera»", () => {
  it("relee sin las columnas de fuera y lo recuerda (Hoy no se cae)", async () => {
    __resetColumnasFueraParaTests();
    const filas = await consultaReservasHoy("2026-11-10").queryFn();
    expect(filas.map((r) => r.id)).toEqual(["r1"]);
    expect(h.pedidas.map((c) => c.includes("fuera_"))).toEqual([true, false]);
    await consultaReservasHoy("2026-11-10").queryFn();
    expect(h.pedidas.map((c) => c.includes("fuera_"))).toEqual([true, false, false]);
  });
});
