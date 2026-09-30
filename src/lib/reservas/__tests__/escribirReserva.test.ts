/**
 * La escritura de una reserva (`escribirReserva.ts`): el ÚNICO `UPDATE reservas … WHERE id`
 * de las acciones de estado, sala y estrella.
 *
 * Lo que garantiza, y antes cada escritor hacía a su manera (o no hacía):
 *   · pide la fila de vuelta (`.select("id")`): con RLS una escritura denegada NO da error,
 *     devuelve 0 filas, y sin mirarlo la pantalla diría «hecho» sin haberlo guardado;
 *   · escritura CONDICIONADA al estado de partida (`.in("estado", …)`): si entre tanto otra
 *     persona (o el cliente desde su correo) cambió el estado, no se pisa — 0 filas;
 *   · si una escritura condicionada no toca nada, RELEE el estado (barato: solo en ese fallo)
 *     para decir qué pasó de verdad —«ya ha cambiado de estado (ahora está «Verificada»)» o
 *     «no tienes permiso»— en vez de una frase con las tres causas;
 *   · reintento sin `llegada_at` si la migración no está aplicada.
 *
 * Nada llega a Supabase: el cliente está mockeado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client");

import { supabase } from "@/integrations/supabase/client";
import { ErrorSinFilasReserva, __resetColumnaLlegadaParaTests, escribirReserva } from "../escribirReserva";

// ─── Doble de Supabase: registra cada llamada de la cadena, en orden ─────────

interface Escritura {
  tabla: string;
  payload: Record<string, unknown>;
  /** La cadena completa, p. ej. `["update", "eq", "in", "select"]`. */
  cadena: string[];
  eq: [string, unknown] | null;
  en: [string, unknown[]] | null;
  select: string | null;
}
interface Respuesta {
  error?: unknown;
  data?: unknown;
}
/**
 * Lo que contesta la RELECTURA del estado (`from("reservas").select("estado").eq("id", …).maybeSingle()`),
 * que solo se hace cuando una escritura condicionada no toca ninguna fila. `lanza`: la cadena no
 * tiene `maybeSingle` (el doble de otros tests), así que la relectura revienta y se ignora.
 */
interface Relectura {
  data?: unknown;
  error?: unknown;
  lanza?: boolean;
}

/** Cada relectura del estado que se ha hecho, en orden. */
let lecturas: Array<{ tabla: string; columnas: string | null; eq: [string, unknown] | null }> = [];

function mockEscrituras(respuestas: Respuesta[] = [], relectura: Relectura = {}) {
  const escrituras: Escritura[] = [];
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
    const e: Escritura = { tabla, payload: {}, cadena: [], eq: null, en: null, select: null };
    const builder: Record<string, unknown> = {
      update: vi.fn((payload: Record<string, unknown>) => {
        e.payload = { ...payload };
        e.cadena.push("update");
        escrituras.push(e);
        return builder;
      }),
      eq: vi.fn((columna: string, valor: unknown) => {
        e.cadena.push("eq");
        e.eq = [columna, valor];
        return builder;
      }),
      in: vi.fn((columna: string, valores: unknown[]) => {
        e.cadena.push("in");
        e.en = [columna, valores];
        return builder;
      }),
      select: vi.fn((columnas: string) => {
        e.cadena.push("select");
        e.select = columnas;
        return builder;
      }),
      maybeSingle: relectura.lanza
        ? undefined
        : vi.fn(() => {
            lecturas.push({ tabla, columnas: e.select, eq: e.eq });
            return Promise.resolve({ data: relectura.data ?? null, error: relectura.error ?? null });
          }),
      then: (ok: (v: unknown) => unknown, ko?: (x: unknown) => unknown) => {
        const r = respuestas.shift() ?? {};
        const data = "data" in r ? r.data : r.error ? null : [{ id: "r1" }];
        return Promise.resolve({ data, error: r.error ?? null }).then(ok, ko);
      },
    };
    return builder;
  }) as never);
  return escrituras;
}

const COLUMNA_AUSENTE = {
  code: "PGRST204",
  message: "Could not find the 'llegada_at' column of 'reservas' in the schema cache",
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetColumnaLlegadaParaTests();
  lecturas = [];
});

describe("qué escribe", () => {
  it("`update(cambios).eq('id', id).select('id')` sobre `reservas`, y devuelve las filas tocadas", async () => {
    const escrituras = mockEscrituras([{ data: [{ id: "r1" }] }]);

    const filas = await escribirReserva("r1", { espacio_id: "terraza" });

    expect(escrituras).toEqual([
      { tabla: "reservas", payload: { espacio_id: "terraza" }, cadena: ["update", "eq", "select"], eq: ["id", "r1"], en: null, select: "id" },
    ]);
    expect(filas).toEqual([{ id: "r1" }]);
  });

  it("sin estado de partida no pone ninguna condición (la estrella vale en cualquier estado)", async () => {
    const escrituras = mockEscrituras();

    await escribirReserva("r1", { importante: true });
    await escribirReserva("r1", { importante: true }, { desdeEstados: null });
    await escribirReserva("r1", { importante: true }, { desdeEstados: [] });

    expect(escrituras.map((e) => e.en)).toEqual([null, null, null]);
  });

  it("con estado de partida añade `.in('estado', …)` ANTES de pedir la fila de vuelta", async () => {
    const escrituras = mockEscrituras();

    await escribirReserva("r1", { estado: "completada" }, { desdeEstados: ["pendiente", "verificada", "confirmada"] });

    expect(escrituras[0].cadena).toEqual(["update", "eq", "in", "select"]);
    expect(escrituras[0].en).toEqual(["estado", ["pendiente", "verificada", "confirmada"]]);
  });

  it("escribe las columnas tal cual, incluido null (sala a «Sin asignar»)", async () => {
    const escrituras = mockEscrituras();

    await escribirReserva("r1", { hora: "21:00", espacio_id: null, estado: "verificada" });

    expect(escrituras[0].payload).toEqual({ hora: "21:00", espacio_id: null, estado: "verificada" });
  });
});

describe("cuando no se escribe nada", () => {
  it.each([
    ["0 filas", []],
    ["data null", null],
  ])("%s, sin error: lanza ErrorSinFilasReserva (RLS denegada en silencio) y no lo da por hecho", async (_n, data) => {
    mockEscrituras([{ data }]);

    const promesa = escribirReserva("r1", { importante: true });

    await expect(promesa).rejects.toBeInstanceOf(ErrorSinFilasReserva);
    await expect(promesa).rejects.toThrow("no tienes permiso para cambiar esta reserva, o ya no existe.");
  });

  it("sin condición de estado no hay nada que releer: el motivo es la RLS o que ya no existe, y no se hace ninguna consulta más", async () => {
    mockEscrituras([{ data: [] }]);

    const promesa = escribirReserva("r1", { importante: true });

    await expect(promesa).rejects.toMatchObject({ motivo: "sin_permiso_o_inexistente" });
    expect(lecturas).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("error de la BD: lo relanza tal cual (quien llama decide el aviso)", async () => {
    const error = { code: "42501", message: "permission denied for table reservas" };
    mockEscrituras([{ error }]);

    await expect(escribirReserva("r1", { importante: true })).rejects.toBe(error);
  });
});

describe("una escritura CONDICIONADA que no toca nada: relee el estado para decir qué pasó", () => {
  const escribir = () => escribirReserva("r1", { estado: "completada" }, { desdeEstados: ["pendiente"] });

  it("la reserva ya está en OTRO estado: lo dice (con el nombre de siempre) y que se ha refrescado la pantalla", async () => {
    // El caso del kanban con la tarjeta vieja: «Ha llegado» sobre una «Pendiente» que en la oficina
    // ya verificaron. Con la escritura condicionada no se pisa, y el aviso da el estado de verdad.
    mockEscrituras([{ data: [] }], { data: { estado: "verificada" } });

    const promesa = escribir();

    await expect(promesa).rejects.toBeInstanceOf(ErrorSinFilasReserva);
    await expect(promesa).rejects.toMatchObject({ motivo: "estado_cambiado", estadoActual: "verificada" });
    await expect(promesa).rejects.toThrow("la reserva ya ha cambiado de estado (ahora está «Verificada»). Se ha refrescado la pantalla.");
    // Una sola relectura, de la columna `estado` y de ESA reserva.
    expect(lecturas).toEqual([{ tabla: "reservas", columnas: "estado", eq: ["id", "r1"] }]);
  });

  it.each([
    ["completada", "«Llegó»"],
    ["no_show", "«No vino»"],
    ["cancelada", "«Cancelada»"],
  ])("nombra el estado %s como lo ve el personal (%s)", async (estado, nombre) => {
    mockEscrituras([{ data: [] }], { data: { estado } });

    await expect(escribir()).rejects.toThrow(`(ahora está ${nombre})`);
  });

  it("la reserva SIGUE en un estado válido: entonces la escritura la denegó la RLS, y se dice sin inventar que ya no existe", async () => {
    mockEscrituras([{ data: [] }], { data: { estado: "pendiente" } });

    const promesa = escribir();

    await expect(promesa).rejects.toMatchObject({ motivo: "sin_permiso" });
    await expect(promesa).rejects.toThrow("no tienes permiso para cambiar esta reserva.");
  });

  it("no se ve la reserva (RLS o ya no existe): «no tienes permiso, o ya no existe»", async () => {
    mockEscrituras([{ data: [] }], { data: null });

    const promesa = escribir();

    await expect(promesa).rejects.toMatchObject({ motivo: "sin_permiso_o_inexistente" });
    await expect(promesa).rejects.toThrow("no tienes permiso para cambiar esta reserva, o ya no existe.");
  });

  it("si la relectura falla (error de la BD) no se sabe: la frase con las tres causas de siempre", async () => {
    mockEscrituras([{ data: [] }], { error: { code: "42501", message: "denegado" } });

    const promesa = escribir();

    await expect(promesa).rejects.toMatchObject({ motivo: "no_se_sabe" });
    await expect(promesa).rejects.toThrow("no tienes permiso para cambiar esta reserva, o ya no existe, o ya ha cambiado de estado.");
  });

  it("si la relectura revienta (o no hay cliente que la haga) tampoco: nunca esconde el fallo original", async () => {
    mockEscrituras([{ data: [] }], { lanza: true });

    await expect(escribir()).rejects.toMatchObject({ motivo: "no_se_sabe" });
  });

  it("un estado vacío cuenta como «no se ve la reserva»: no se nombra un estado que no hay", async () => {
    mockEscrituras([{ data: [] }], { data: { estado: "" } });

    await expect(escribir()).rejects.toMatchObject({ motivo: "sin_permiso_o_inexistente" });
  });

  it("solo se relee cuando la escritura no toca nada: con éxito no hay ninguna consulta más", async () => {
    mockEscrituras();

    await escribir();

    expect(lecturas).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe("sin la columna llegada_at (migración sin aplicar)", () => {
  it("reintenta SIN ella, con los mismos filtros, y lo recuerda para la siguiente", async () => {
    const escrituras = mockEscrituras([{ error: COLUMNA_AUSENTE }, {}, {}]);

    await escribirReserva("r1", { estado: "completada", llegada_at: "2026-09-30T19:00:00.000Z" }, { desdeEstados: ["pendiente"] });
    await escribirReserva("r1", { estado: "confirmada", llegada_at: null });

    expect(escrituras.map((e) => Object.keys(e.payload))).toEqual([["estado", "llegada_at"], ["estado"], ["estado"]]);
    // El reintento conserva la condición de estado y la fila de vuelta.
    expect(escrituras[1].cadena).toEqual(["update", "eq", "in", "select"]);
    expect(escrituras[1].en).toEqual(["estado", ["pendiente"]]);
    // La siguiente escritura ya no la intenta (ni falla ni reintenta).
    expect(escrituras[2].cadena).toEqual(["update", "eq", "select"]);
  });

  it("un error que no es de esa columna no se reintenta", async () => {
    const escrituras = mockEscrituras([{ error: { code: "42501", message: "denegado" } }]);

    await expect(escribirReserva("r1", { estado: "completada", llegada_at: "x" })).rejects.toMatchObject({ code: "42501" });
    expect(escrituras).toHaveLength(1);
  });

  it("si el reintento también devuelve 0 filas, lanza ErrorSinFilasReserva", async () => {
    mockEscrituras([{ error: COLUMNA_AUSENTE }, { data: [] }]);

    await expect(escribirReserva("r1", { estado: "completada", llegada_at: "x" })).rejects.toBeInstanceOf(ErrorSinFilasReserva);
  });
});
