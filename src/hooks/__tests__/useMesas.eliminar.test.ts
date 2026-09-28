/**
 * Tests para `useEliminarMesa` (src/hooks/useMesas.ts).
 *
 * POR QUÉ EXISTE ESTE FICHERO
 *
 *   Hasta 8021e88 el hook borraba y mostraba "Mesa eliminada correctamente"
 *   sin comprobar nada más que el `{ error }`. Y comprobar `{ error }` NO
 *   BASTA: un DELETE denegado por RLS se resuelve con
 *   `{ data: [], error: null }` —ni excepción, ni error, ni filas—, así que
 *   desde `20260928120000_mesas_asignaciones_rls_por_seccion.sql` (escribir en
 *   `mesas` exige `can_write_section('reservas')`) ese mensaje es falso para
 *   quien no tenga la sección: la mesa sigue viva y la pantalla dice que no.
 *
 *   Los tres caminos que cubre, que son los tres significados de "cero filas"
 *   (mismo criterio que `interpretarCeroFilas` en `guardadoPlano.ts`):
 *     1. el DELETE devuelve la fila            -> borrado real
 *     2. cero filas y la fila YA NO ESTÁ       -> otra sesión se adelantó
 *     3. cero filas y la fila SIGUE AHÍ        -> denegada (permisos)
 *
 *   Los casos 2 y 3 FALLAN con el código viejo: los dos resolvían y cantaban
 *   "Mesa eliminada correctamente".
 *
 * Estilo de mock copiado de `useAccionesModoServicio.test.tsx` (builder
 * encadenable + QueryClientProvider). Este fichero es `.ts` y no `.tsx`, así
 * que el wrapper se monta con `createElement` en vez de JSX.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEliminarMesa, ErrorEliminarMesa } from "@/hooks/useMesas";

const MESA_ID = "mesa-1";

// ─── Mock de supabase ─────────────────────────────────────────────────────────

interface Respuesta {
  data: unknown;
  error?: unknown;
}

interface Registro {
  /** Cuántos `.delete()` se pidieron. */
  deletes: number;
  /** Cuántos `.maybeSingle()` — es decir, cuántos SELECT de confirmación. */
  confirmaciones: number;
  /** Columnas pedidas en cada `.select(...)`, en orden. */
  selects: unknown[];
  /** Cada `.eq(columna, valor)`, en orden. */
  eqs: unknown[][];
}

/**
 * Un único builder encadenable sirve para las DOS consultas del hook:
 *   · el borrado      `delete().eq('id', X).select('id')`  -> se `await`ea el
 *     builder, así que responde por `then`;
 *   · la confirmación `select('id, activa').eq('id', X).maybeSingle()` ->
 *     responde por `maybeSingle`.
 * Como son métodos distintos, cada una puede devolver algo diferente sin
 * pisarse, y `registro` deja ver cuál se llegó a ejecutar.
 */
function mockMesas(opciones: { borrado: Respuesta; confirmacion?: Respuesta }): Registro {
  const registro: Registro = { deletes: 0, confirmaciones: 0, selects: [], eqs: [] };

  const builder: Record<string, unknown> = {
    delete: vi.fn(() => {
      registro.deletes += 1;
      return builder;
    }),
    select: vi.fn((columnas?: unknown) => {
      registro.selects.push(columnas);
      return builder;
    }),
    eq: vi.fn((...args: unknown[]) => {
      registro.eqs.push(args);
      return builder;
    }),
    maybeSingle: vi.fn(() => {
      registro.confirmaciones += 1;
      const r = opciones.confirmacion ?? { data: null, error: null };
      return Promise.resolve({ data: r.data, error: r.error ?? null });
    }),
    then: (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({
        data: opciones.borrado.data,
        error: opciones.borrado.error ?? null,
      }).then(onfulfilled),
  };

  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  return registro;
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => useEliminarMesa(), { wrapper });
  return { result, queryClient };
}

/** Ejecuta la mutación y devuelve el valor resuelto O el error, sin romper el test. */
async function eliminar(result: { current: { mutateAsync: (id: string) => Promise<unknown> } }) {
  let salida: unknown;
  await act(async () => {
    salida = await result.current.mutateAsync(MESA_ID).catch((e: unknown) => e);
  });
  return salida;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useEliminarMesa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Borrado real ────────────────────────────────────────────────────────

  describe("el borrado funciona", () => {
    it("devuelve 'eliminada' y avisa de éxito", async () => {
      mockMesas({ borrado: { data: [{ id: MESA_ID }] } });
      const { result } = setup();

      expect(await eliminar(result)).toBe("eliminada");
      expect(toast.success).toHaveBeenCalledWith("Mesa eliminada correctamente");
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("no gasta un SELECT de confirmación si el DELETE ya devolvió la fila", async () => {
      const registro = mockMesas({ borrado: { data: [{ id: MESA_ID }] } });
      const { result } = setup();

      await eliminar(result);

      expect(registro.deletes).toBe(1);
      expect(registro.confirmaciones).toBe(0);
    });

    it("pide `.select('id')` en el DELETE — sin eso no hay forma de enterarse", async () => {
      // REGRESIÓN: el código viejo hacía `delete().eq('id', X)` a secas y leía
      // solo `{ error }`. Sin `.select('id')` no vuelven filas que contar y un
      // rechazo de RLS es indistinguible de un borrado bueno.
      const registro = mockMesas({ borrado: { data: [{ id: MESA_ID }] } });
      const { result } = setup();

      await eliminar(result);

      expect(registro.selects).toContain("id");
      expect(registro.eqs).toContainEqual(["id", MESA_ID]);
    });

    it("invalida la caché de mesas", async () => {
      mockMesas({ borrado: { data: [{ id: MESA_ID }] } });
      const { result, queryClient } = setup();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      await eliminar(result);

      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mesas"] });
    });
  });

  // ── 2. La fila ya no existía ───────────────────────────────────────────────

  describe("cero filas y la fila ya no está", () => {
    it("devuelve 'ya-no-estaba': no es un fallo para el usuario", async () => {
      // Otra sesión la borró antes. El objetivo —que no esté— se cumple igual,
      // así que NO se lanza: los llamantes hacen bien en quitarla del lienzo.
      const registro = mockMesas({
        borrado: { data: [] },
        confirmacion: { data: null },
      });
      const { result } = setup();

      expect(await eliminar(result)).toBe("ya-no-estaba");
      expect(registro.confirmaciones).toBe(1);
    });

    it("avisa, pero NO dice 'eliminada correctamente'", async () => {
      // Con el código viejo esto cantaba éxito atribuyéndose un borrado ajeno.
      mockMesas({ borrado: { data: [] }, confirmacion: { data: null } });
      const { result } = setup();

      await eliminar(result);

      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning).mock.calls[0][0]).toMatch(/ya no existía/i);
    });
  });

  // ── 3. Denegado por RLS ────────────────────────────────────────────────────

  describe("cero filas y la fila sigue ahí (RLS)", () => {
    it("lanza ErrorEliminarMesa con motivo 'permisos'", async () => {
      // EL CASO QUE MOTIVA TODO: supabase-js devuelve `{ data: [], error: null }`
      // cuando RLS deniega el DELETE. El código viejo resolvía y mentía.
      mockMesas({
        borrado: { data: [] },
        confirmacion: { data: { id: MESA_ID, activa: true } },
      });
      const { result } = setup();

      const salida = await eliminar(result);

      expect(salida).toBeInstanceOf(ErrorEliminarMesa);
      expect((salida as ErrorEliminarMesa).fallo).toEqual({ clase: "permisos" });
    });

    it("avisa de que la mesa SIGUE AHÍ y no dice que se eliminó", async () => {
      mockMesas({
        borrado: { data: [] },
        confirmacion: { data: { id: MESA_ID, activa: true } },
      });
      const { result } = setup();

      await eliminar(result);

      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      const mensaje = vi.mocked(toast.error).mock.calls[0][0] as string;
      expect(mensaje).toMatch(/permisos/i);
      expect(mensaje).toMatch(/sigue ahí/i);
      expect(mensaje).not.toMatch(/correctamente/i);
    });

    it("una fila DESACTIVADA que sigue existiendo también es denegación", async () => {
      // `activa = false` no es "borrada": la fila está, el DELETE no la quitó.
      // (Aquí se separa del criterio de `desactivar` en `guardadoPlano.ts`,
      //  donde una fila ya inactiva sí cuenta como objetivo cumplido.)
      mockMesas({
        borrado: { data: [] },
        confirmacion: { data: { id: MESA_ID, activa: false } },
      });
      const { result } = setup();

      expect(await eliminar(result)).toBeInstanceOf(ErrorEliminarMesa);
    });

    it("si ni siquiera se puede leer la fila, es pesimista: denegada", async () => {
      // Ante la duda no se da nada por bueno, igual que en el guardado del plano.
      mockMesas({
        borrado: { data: [] },
        confirmacion: { data: null, error: { message: "boom" } },
      });
      const { result } = setup();

      const salida = await eliminar(result);

      expect(salida).toBeInstanceOf(ErrorEliminarMesa);
      expect((salida as ErrorEliminarMesa).fallo).toEqual({ clase: "permisos" });
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // ── Errores explícitos ─────────────────────────────────────────────────────

  describe("el DELETE devuelve error", () => {
    it("42501 se clasifica como permisos y no se consulta la fila", async () => {
      mockMesas({
        borrado: { data: null, error: { code: "42501", message: "row-level security" } },
      });
      const { result } = setup();

      const salida = await eliminar(result);

      expect(salida).toBeInstanceOf(ErrorEliminarMesa);
      expect((salida as ErrorEliminarMesa).fallo).toEqual({ clase: "permisos" });
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("cualquier otro error conserva su mensaje", async () => {
      mockMesas({
        borrado: { data: null, error: { code: "23503", message: "violates foreign key" } },
      });
      const { result } = setup();

      const salida = await eliminar(result);

      expect(salida).toBeInstanceOf(ErrorEliminarMesa);
      expect((salida as ErrorEliminarMesa).fallo).toEqual({
        clase: "error",
        mensaje: "violates foreign key",
      });
      expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/violates foreign key/);
    });
  });
});
