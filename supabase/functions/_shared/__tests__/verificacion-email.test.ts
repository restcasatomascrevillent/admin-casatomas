/**
 * _shared/verificacion-email.ts — marca reservas.email_verificado_at (doble
 * opt-in del newsletter, migración 20261003184500). Doble mínimo de
 * supabase-js: se comprueba la consulta exacta y que nunca lance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registrarEmailVerificado,
  faltaColumnaVerificacion,
  type ClienteVerificacion,
} from "../verificacion-email";

interface Llamada {
  tabla: string;
  valores: Record<string, unknown>;
  eq: [string, unknown];
  is: [string, null];
  select: string;
}

function clienteFalso(
  respuesta: { data: unknown[] | null; error: { code?: string; message?: string } | null } | Error,
  llamadas: Llamada[],
): ClienteVerificacion {
  return {
    from(tabla: string) {
      return {
        update(valores: Record<string, unknown>) {
          return {
            eq(c1: string, v1: unknown) {
              return {
                is(c2: string, v2: null) {
                  return {
                    select(cols: string) {
                      llamadas.push({ tabla, valores, eq: [c1, v1], is: [c2, v2], select: cols });
                      if (respuesta instanceof Error) return Promise.reject(respuesta);
                      return Promise.resolve(respuesta);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

const AHORA = "2026-10-03T18:45:00.000Z";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("registrarEmailVerificado", () => {
  it("marca email_verificado_at solo si aún era NULL, en esa reserva", async () => {
    const llamadas: Llamada[] = [];
    const r = await registrarEmailVerificado(clienteFalso({ data: [{ id: "res-1" }], error: null }, llamadas), "res-1", AHORA);

    expect(r).toBe("registrada");
    expect(llamadas).toEqual([
      { tabla: "reservas", valores: { email_verificado_at: AHORA }, eq: ["id", "res-1"], is: ["email_verificado_at", null], select: "id" },
    ]);
  });

  it("ya verificada (0 filas): ya_estaba, la primera verificación no se mueve", async () => {
    const r = await registrarEmailVerificado(clienteFalso({ data: [], error: null }, []), "res-1", AHORA);
    expect(r).toBe("ya_estaba");
  });

  it("migración sin aplicar (PGRST204): sin_columna, con rastro en el log, sin lanzar", async () => {
    const r = await registrarEmailVerificado(
      clienteFalso({ data: null, error: { code: "PGRST204", message: "Could not find the 'email_verificado_at' column of 'reservas' in the schema cache" } }, []),
      "res-1",
      AHORA,
    );
    expect(r).toBe("sin_columna");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("20261003184500"));
  });

  it("otro error de la BD: error, sin lanzar", async () => {
    const r = await registrarEmailVerificado(clienteFalso({ data: null, error: { code: "57014", message: "timeout" } }, []), "res-1", AHORA);
    expect(r).toBe("error");
  });

  it("excepción (red caída): error, sin lanzar", async () => {
    const r = await registrarEmailVerificado(clienteFalso(new Error("fetch failed"), []), "res-1", AHORA);
    expect(r).toBe("error");
  });
});

describe("faltaColumnaVerificacion", () => {
  it.each([
    [{ code: "PGRST204", message: "Could not find the 'email_verificado_at' column of 'reservas' in the schema cache" }, true],
    [{ code: "42703", message: 'column "email_verificado_at" does not exist' }, true],
    [{ code: "PGRST204", message: "Could not find the 'otra' column of 'reservas' in the schema cache" }, false],
    [{ code: "23514", message: "check" }, false],
    [null, false],
  ])("%j -> %s", (error, esperado) => {
    expect(faltaColumnaVerificacion(error)).toBe(esperado);
  });
});
