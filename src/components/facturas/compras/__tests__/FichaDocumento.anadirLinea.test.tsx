/** Ficha de documento › «Añadir línea»: botón con permiso, formulario vacío e insert con factura_id. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn((_tabla: string) => ({
    insert: (fila: unknown) => {
      insert(fila);
      return { select: () => ({ single: async () => ({ data: { id: 999 }, error: null }) }) };
    },
  }));
  return { insert, from, puedeEditar: { valor: true } };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: h.from, rpc: vi.fn(async () => ({ data: null, error: null })), storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.puedeEditar.valor, loading: false }),
}));
vi.mock("../AlbaranesDeFactura", () => ({ AlbaranesDeFactura: () => null }));
vi.mock("../FacturaDelAlbaran", () => ({ FacturaDelAlbaran: () => null }));
vi.mock("@/components/facturas/CosteLecturaDocumento", () => ({ CosteLecturaFactura: () => null }));
vi.mock("@/components/facturas/shared/OriginalIncrustado", () => ({ OriginalIncrustado: () => null }));
vi.mock("@/components/facturas/shared/BotonOriginal", () => ({ BotonOriginal: () => null }));

import { FichaDocumento } from "../FichaDocumento";
import type { Factura } from "@/hooks/useFacturas";

const doc = {
  id: 42, tipo: "factura", numero_documento: "F-1", proveedor: "P", cif: null, fecha: "2026-09-01",
  subtotal: null, iva: null, total: null, observaciones: null, drive_url: null, archivo_path: null,
  productos: [], verificada: false,
} as unknown as Factura;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FichaDocumento
        doc={doc}
        avisos={[]}
        facturaDelAlbaran={null}
        albaranesDeLaFactura={[]}
        onEditar={vi.fn()}
        onAbrirProducto={vi.fn()}
        onAbrirProveedor={vi.fn()}
        onAbrirDocumento={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("FichaDocumento › Añadir línea", () => {
  beforeEach(() => {
    h.insert.mockClear();
    h.puedeEditar.valor = true;
  });
  afterEach(cleanup);

  it("sin permiso de edición no aparece el botón", () => {
    h.puedeEditar.valor = false;
    montar();
    expect(screen.queryByRole("button", { name: /añadir línea/i })).toBeNull();
  });

  it("con permiso abre el formulario vacío y guarda con factura_id", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /añadir línea/i }));
    expect((screen.getByLabelText("Nombre del producto") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Nombre del producto"), { target: { value: "Sal fina" } });
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Precio unitario"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Total"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(h.insert).toHaveBeenCalledTimes(1));
    expect(h.from).toHaveBeenCalledWith("productos_factura");
    expect(h.insert.mock.calls[0][0]).toMatchObject({ factura_id: 42, nombre: "Sal fina", cantidad: 2, precio_unitario: 1.5, total: 3 });
    await waitFor(() => expect(screen.getByRole("button", { name: /añadir línea/i })).toBeTruthy());
  });

  it("Cancelar cierra el formulario sin insertar", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /añadir línea/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(h.insert).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /añadir línea/i })).toBeTruthy();
  });
});
