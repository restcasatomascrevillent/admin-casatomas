/**
 * Tests para src/hooks/usePlanosEspacio.ts — `useCrearOActualizarPlano`.
 *
 * Contexto: el hook hacía un SELECT sonda (`select("id").eq(...).maybeSingle()`)
 * y ramificaba a INSERT o UPDATE, DESCARTANDO el `{ error }` de la sonda. Eso
 * producía dos defectos:
 *
 *   1. Si la sonda fallaba —o RLS escondía la fila— se caía por la rama del
 *      INSERT y el usuario recibía un 23505 de clave duplicada que no tenía
 *      nada que ver con lo ocurrido.
 *   2. Carrera: dos pestañas guardando el mismo espacio leían ambas "no
 *      existe" y la segunda chocaba con el UNIQUE.
 *
 * Ahora es un único `upsert(plano, { onConflict: "espacio_id" })`, así que
 * crear y actualizar son la MISMA llamada de cliente y es Postgres quien
 * resuelve el conflicto contra la constraint UNIQUE de `espacio_id`.
 *
 * Cubre:
 * - Crea cuando no existe (el backend resuelve el upsert como INSERT)
 * - Actualiza cuando ya existe (el backend lo resuelve como UPDATE)
 * - Una sola escritura, sin sonda previa (la carrera ya no tiene ventana)
 * - El error del backend se propaga tal cual, sin convertirse en un 23505
 * - Cero filas tras un upsert aceptado se reetiqueta sin perder el original
 * - El payload se reenvía intacto (nada machaca columnas ausentes)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** El payload que manda de verdad `EditorPlanoEspacio` al guardar. */
const PLANO = {
  espacio_id: "esp-1",
  ancho: 600,
  alto: 400,
  ancho_metros: 12,
  alto_metros: 8,
  pixels_per_meter: 50,
  metros_cuadrados: 96,
  configuracion: { elementos: [], realDimensions: { width: 12, height: 8 } },
};

const filaGuardada = (overrides: Record<string, unknown> = {}) => ({
  id: "plano-1",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-28T10:00:00Z",
  ...PLANO,
  ...overrides,
});

// ─── Helpers de mock ──────────────────────────────────────────────────────────

type Registro = {
  /** Tablas pasadas a `supabase.from()`. */
  tablas: string[];
  /** Cada llamada a `.upsert()`, con su payload y sus opciones. */
  upserts: Array<{ payload: Record<string, unknown>; opciones: unknown }>;
  /** Traza ordenada de métodos del builder, para detectar la sonda. */
  metodos: string[];
};

/**
 * Mock de `supabase.from` para `planos_espacio`.
 *
 * `.single()` resuelve con lo que le pasemos. `maybeSingle`, `insert` y
 * `update` siguen presentes a propósito: si el hook volviera a usarlos, la
 * traza `metodos` lo delata en vez de petar con "no es una función".
 */
function mockPlanos(resultado: { data: unknown; error: unknown }): Registro {
  const registro: Registro = { tablas: [], upserts: [], metodos: [] };

  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((tabla: string) => {
    registro.tablas.push(tabla);

    const builder: Record<string, unknown> = {
      upsert: vi.fn((payload: Record<string, unknown>, opciones: unknown) => {
        registro.metodos.push("upsert");
        registro.upserts.push({ payload, opciones });
        return builder;
      }),
      insert: vi.fn(() => {
        registro.metodos.push("insert");
        return builder;
      }),
      update: vi.fn(() => {
        registro.metodos.push("update");
        return builder;
      }),
      select: vi.fn((cols?: string) => {
        registro.metodos.push(cols ? `select(${cols})` : "select()");
        return builder;
      }),
      eq: vi.fn(() => {
        registro.metodos.push("eq");
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        registro.metodos.push("maybeSingle");
        return { data: null, error: null };
      }),
      single: vi.fn(async () => {
        registro.metodos.push("single");
        return resultado;
      }),
    };

    return builder;
  });

  return registro;
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useCrearOActualizarPlano(), { wrapper });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useCrearOActualizarPlano", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crea el plano cuando no existe y devuelve la fila insertada", async () => {
    const fila = filaGuardada({ id: "plano-nuevo" });
    const registro = mockPlanos({ data: fila, error: null });
    const { result } = setup();

    let devuelto: unknown;
    await act(async () => {
      devuelto = await result.current.mutateAsync(PLANO);
    });

    expect(devuelto).toEqual(fila);
    expect(registro.tablas).toEqual(["planos_espacio"]);
    expect(registro.upserts).toHaveLength(1);
    expect(registro.upserts[0].opciones).toEqual({ onConflict: "espacio_id" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("actualiza el plano cuando ya existe, con la MISMA llamada de cliente", async () => {
    // El backend resuelve el ON CONFLICT como UPDATE: misma fila de siempre,
    // valores nuevos. Desde el cliente es indistinguible de la creación, y esa
    // es justo la propiedad que hace que la carrera desaparezca.
    const fila = filaGuardada({ id: "plano-1", ancho: 900, ancho_metros: 18 });
    const registro = mockPlanos({ data: fila, error: null });
    const { result } = setup();

    let devuelto: unknown;
    await act(async () => {
      devuelto = await result.current.mutateAsync({ ...PLANO, ancho: 900, ancho_metros: 18 });
    });

    expect(devuelto).toEqual(fila);
    expect(registro.upserts).toHaveLength(1);
    expect(registro.upserts[0].opciones).toEqual({ onConflict: "espacio_id" });
    expect(registro.upserts[0].payload).toMatchObject({ espacio_id: "esp-1", ancho: 900 });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("no hace SELECT sonda ni ramifica a insert/update: una sola escritura", async () => {
    const registro = mockPlanos({ data: filaGuardada(), error: null });
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync(PLANO);
    });

    // La sonda era `select("id") -> eq -> maybeSingle`. Si vuelve, esto falla.
    expect(registro.metodos).not.toContain("maybeSingle");
    expect(registro.metodos).not.toContain('select(id)');
    expect(registro.metodos).not.toContain("insert");
    expect(registro.metodos).not.toContain("update");
    // Exactamente: upsert -> select() -> single
    expect(registro.metodos).toEqual(["upsert", "select()", "single"]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("propaga el error real del backend en vez de convertirlo en un 23505 engañoso", async () => {
    // Antes, un fallo al leer (o una fila escondida por RLS) mandaba el flujo
    // a la rama del INSERT y lo que salía era un 23505 de clave duplicada.
    const errorReal = {
      code: "42501",
      message: 'new row violates row-level security policy for table "planos_espacio"',
    };
    mockPlanos({ data: null, error: errorReal });
    const { result } = setup();

    await act(async () => {
      await expect(result.current.mutateAsync(PLANO)).rejects.toMatchObject({
        code: "42501",
        message: errorReal.message,
      });
    });

    // Lo que NO debe pasar: que el usuario acabe viendo un duplicado de clave.
    await expect(result.current.mutateAsync(PLANO)).rejects.not.toMatchObject({ code: "23505" });

    // Y la causa real sube al aviso, no se queda solo en la consola.
    expect(toast.error).toHaveBeenCalledWith("Error al guardar plano", {
      description: errorReal.message,
    });
  });

  it("propaga tal cual un fallo de conexión (el caso que la sonda se tragaba)", async () => {
    const errorReal = { code: "08006", message: "connection failure" };
    mockPlanos({ data: null, error: errorReal });
    const { result } = setup();

    await act(async () => {
      await expect(result.current.mutateAsync(PLANO)).rejects.toMatchObject({
        code: "08006",
        message: "connection failure",
      });
    });
  });

  it("si un 23505 viene DE VERDAD del backend, se propaga sin maquillar", async () => {
    const errorReal = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "planos_espacio_espacio_id_key"',
    };
    mockPlanos({ data: null, error: errorReal });
    const { result } = setup();

    await act(async () => {
      await expect(result.current.mutateAsync(PLANO)).rejects.toMatchObject({
        code: "23505",
        message: errorReal.message,
      });
    });
  });

  it("cero filas tras un upsert aceptado se explica, conservando el error original", async () => {
    // `.single()` convierte "cero filas" en PGRST116. Tras un upsert que el
    // servidor NO rechazó, eso significa que la escritura entró y la fila no se
    // puede releer (RLS de SELECT), no que haya un problema de datos.
    const pgrst116 = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    mockPlanos({ data: null, error: pgrst116 });
    const { result } = setup();

    await act(async () => {
      await expect(result.current.mutateAsync(PLANO)).rejects.toMatchObject({
        code: "PGRST116",
        cause: pgrst116,
      });
    });

    const lanzado = await result.current.mutateAsync(PLANO).catch((e: Error) => e);
    expect((lanzado as Error).message).toContain("RLS");
    expect((lanzado as Error).message).not.toContain("JSON object requested");
  });

  it("reenvía el payload intacto: no inyecta ni recorta columnas", async () => {
    // Guarda contra el riesgo del upsert con objeto parcial: si el hook
    // añadiera claves por su cuenta, podría machacar columnas con defaults.
    const parcial = { espacio_id: "esp-2", ancho: 320 };
    const registro = mockPlanos({ data: filaGuardada({ id: "plano-2" }), error: null });
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync(parcial);
    });

    expect(registro.upserts[0].payload).toEqual(parcial);
    expect(Object.keys(registro.upserts[0].payload)).toEqual(["espacio_id", "ancho"]);
  });
});
