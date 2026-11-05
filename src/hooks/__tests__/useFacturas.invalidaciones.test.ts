/**
 * QA de Compras (05/11/2026, C-11): tras cambiar una línea, un documento o
 * entrar documentos nuevos se refresca también lo calculado con ellos
 * (productos, gráficas/fichas de Compras, proveedores); la línea NO vuelve a
 * bajar la lista entera: su cabecera se corrige en la caché.
 */
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { invalidarTrasDocumento, refrescarTrasLinea } from "../useFacturas";

const LISTA = ["facturas", "lista"];

function cliente(lista: unknown) {
  const qc = new QueryClient();
  qc.setQueryData(LISTA, lista);
  for (const k of [["facturas", "documento", 7], ["productos", "resumen"], ["compras", "ficha-proveedor", "x"], ["proveedores", "listado"], ["albaranes"]]) {
    qc.setQueryData(k, 1);
  }
  return qc;
}
const vieja = (qc: QueryClient, k: unknown[]) => qc.getQueryState(k)?.isInvalidated === true;

describe("invalidaciones de Compras", () => {
  it("tras una línea: ficha, productos, compras y proveedores; la lista se corrige sin recargar", () => {
    const qc = cliente({ cabeceras: [{ id: 7, n_lineas: 2 }, { id: 8, n_lineas: 5 }], completos: null });
    const refetch = vi.spyOn(qc, "invalidateQueries");
    refrescarTrasLinea(qc, 7, 1);
    for (const k of [["facturas", "documento", 7], ["productos", "resumen"], ["compras", "ficha-proveedor", "x"], ["proveedores", "listado"], ["albaranes"]]) {
      expect(vieja(qc, k)).toBe(true);
    }
    // La lista: marcada como vieja SIN pedirse ahora (refetchType none) y con la línea nueva contada.
    expect(refetch).toHaveBeenCalledWith(expect.objectContaining({ queryKey: LISTA, refetchType: "none" }));
    expect(qc.getQueryData<{ cabeceras: { id: number; n_lineas: number }[] }>(LISTA)?.cabeceras).toEqual([
      { id: 7, n_lineas: 3 },
      { id: 8, n_lineas: 5 },
    ]);
  });

  it("con la carga de antes (la lista trae los documentos completos) sí se recarga la lista", () => {
    const qc = cliente({ cabeceras: [], completos: new Map() });
    refrescarTrasLinea(qc, 7);
    expect(vieja(qc, LISTA)).toBe(true);
  });

  it("tras editar un documento: todo, también productos, compras y proveedores", () => {
    const qc = cliente({ cabeceras: [], completos: null });
    invalidarTrasDocumento(qc);
    for (const k of [LISTA, ["productos", "resumen"], ["compras", "ficha-proveedor", "x"], ["proveedores", "listado"]]) {
      expect(vieja(qc, k)).toBe(true);
    }
  });
});
