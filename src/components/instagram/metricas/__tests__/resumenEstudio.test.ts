/**
 * Cifras del Estudio leídas de la tabla (sin la Edge Function): el cálculo es
 * idéntico al de instagram-metricas (resumen.ts) y la Edge Function solo se usa
 * de respaldo (varias cuentas sin saber cuál, o la tabla falla).
 */
import { describe, expect, it, vi } from "vitest";
import { calcularResumenEstudio, FILAS_POR_CUENTA, leerResumenEstudio, type FilaCuentaEstudio } from "../resumenEstudio";
import { resumirPeriodo, serieDiaria, ultimoDia } from "../../../../../supabase/functions/instagram-metricas/resumen";

function sumarDias(fecha: string, n: number) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 70 días de una cuenta, con huecos y algún null, más recientes primero (como la consulta). */
function filas(ig = "1", dias = 70, hasta = "2026-11-04"): FilaCuentaEstudio[] {
  return Array.from({ length: dias }, (_, i) => i)
    .filter((i) => i % 9 !== 4)
    .map((i) => ({
      fecha: sumarDias(hasta, -i),
      ig_user_id: ig,
      seguidores: i % 5 === 0 ? null : 1500 - i * 3,
      alcance: 400 + ((i * 37) % 300),
      visualizaciones: 900 + i,
      visitas_perfil: i % 3,
      cuentas_interaccion: 20 + (i % 7),
      interacciones: i % 11 === 0 ? null : 30 + (i % 13),
      toques_enlaces: i % 4,
    }));
}

const respaldoNo = () => Promise.reject(new Error("no debería llamar a la Edge Function"));

describe("calcularResumenEstudio", () => {
  it("da lo mismo que la acción «leer» de instagram-metricas con las mismas filas", () => {
    const f = filas();
    const fin = ultimoDia(f)!;
    const esperado = { resumen: { d7: resumirPeriodo(f, fin, 7), d28: resumirPeriodo(f, fin, 28) }, serie: serieDiaria(f, fin, 28) };
    expect(calcularResumenEstudio(f)).toEqual(esperado);
  });

  it("sin filas, sin resumen", () => {
    expect(calcularResumenEstudio([])).toEqual({ resumen: null, serie: [] });
  });
});

describe("leerResumenEstudio", () => {
  it("una sola cuenta: de la tabla, sin la Edge Function", async () => {
    const leerFilas = vi.fn(async () => filas());
    const r = await leerResumenEstudio("touza", null, { leerFilas, respaldo: respaldoNo });
    expect(r.origen).toBe("tablas");
    expect(r.resumen?.d28.hasta).toBe("2026-11-04");
    expect(leerFilas).toHaveBeenCalledTimes(1);
  });

  it("con el id guardado, filtra por esa cuenta (y lee solo las filas que hacen falta)", async () => {
    const leerFilas = vi.fn(async (id: string | null) => filas(id ?? "x"));
    const r = await leerResumenEstudio(null, "222", { leerFilas, respaldo: respaldoNo });
    expect(leerFilas).toHaveBeenCalledWith("222", FILAS_POR_CUENTA);
    expect(r.origen).toBe("tablas");
  });

  it("varias cuentas: la del id guardado; sin saber cuál, la Edge Function", async () => {
    const dos = [...filas("1"), ...filas("2", 70, "2026-11-01")];
    const r = await leerResumenEstudio("touza", null, { leerFilas: async () => dos, respaldo: async () => ({ resumen: null, serie: [] }) });
    expect(r.origen).toBe("funcion");
    // id guardado que ya no tiene filas: se mira la tabla entera y, con dos cuentas sin la suya, respaldo.
    const leerFilas = vi.fn(async (id: string | null) => (id ? [] : dos));
    const respaldo = vi.fn(async () => ({ resumen: null, serie: [] }));
    expect((await leerResumenEstudio("touza", "999", { leerFilas, respaldo })).origen).toBe("funcion");
    expect(respaldo).toHaveBeenCalledWith("touza");
  });

  it("si la tabla falla (p. ej. sin migrar), la Edge Function como antes", async () => {
    const respaldo = vi.fn(async () => ({ resumen: null, serie: [{ fecha: "2026-11-04", alcance: 1, seguidores: 1, visualizaciones: 1, interacciones: 1 }] }));
    const r = await leerResumenEstudio(null, null, { leerFilas: () => Promise.reject(new Error("42P01")), respaldo });
    expect(r).toEqual({ resumen: null, serie: [expect.objectContaining({ alcance: 1 })], origen: "funcion" });
  });
});
