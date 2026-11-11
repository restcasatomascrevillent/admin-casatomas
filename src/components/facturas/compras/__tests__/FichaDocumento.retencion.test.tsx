/** Ficha de documento › retención de IRPF: Base · IVA · Retención IRPF (−19 %) · Total a pagar, solo si la hay. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: null })), storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: false, loading: false }) }));
vi.mock("../AlbaranesDeFactura", () => ({ AlbaranesDeFactura: () => null }));
vi.mock("../FacturaDelAlbaran", () => ({ FacturaDelAlbaran: () => null }));
vi.mock("@/components/facturas/CosteLecturaDocumento", () => ({ CosteLecturaFactura: () => null }));
vi.mock("@/components/facturas/shared/OriginalIncrustado", () => ({ OriginalIncrustado: () => null }));
vi.mock("@/components/facturas/shared/BotonOriginal", () => ({ BotonOriginal: () => null }));

import { FichaDocumento } from "../FichaDocumento";
import { aFacturaDetalle, type Factura } from "@/hooks/useFacturas";

const base = {
  id: 7, tipo: "factura", numero_documento: "A-1", proveedor: "SALVADOR MAS MAS", cif: null, fecha: "2026-10-01",
  subtotal: 1100, iva: 231, total: 1122, observaciones: null, drive_url: null, archivo_path: null,
  productos: [], verificada: true, alertas: [], local: null,
} as unknown as Factura;

function montar(doc: Factura) {
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

describe("FichaDocumento › retención de IRPF", () => {
  afterEach(cleanup);

  it("con retención: Base · IVA · Retención IRPF (−19 %) · Total a pagar, en ese orden", () => {
    montar({ ...base, retencion_irpf: 209, retencion_irpf_pct: 19 });
    const franja = screen.getByLabelText("Importes");
    expect(franja).toHaveTextContent(/Base imponible\s*1\.100,00\s€\s*IVA \(21 %\)\s*231,00\s€\s*Retención IRPF \(−19 %\)\s*−209,00\s€\s*Total a pagar\s*1\.122,00\s€/);
    expect(screen.getByTestId("retencion-documento")).toBeInTheDocument();
  });

  it("sin porcentaje conocido, solo «Retención IRPF»", () => {
    montar({ ...base, retencion_irpf: 209, retencion_irpf_pct: null });
    expect(screen.getByTestId("retencion-documento")).toHaveTextContent(/^Retención IRPF\s*−209,00\s€$/);
  });

  it("sin retención no sale nada y el total se llama «Total»", () => {
    montar({ ...base, subtotal: 100, iva: 10, total: 110 });
    expect(screen.queryByTestId("retencion-documento")).toBeNull();
    expect(screen.getByLabelText("Importes")).not.toHaveTextContent(/Retención|Total a pagar/);
  });

  it("la ficha del servidor (documento_compras) trae la retención; 0 o ausente = sin retención", () => {
    expect(aFacturaDetalle({ id: 1, retencion_irpf: "142.50", retencion_irpf_pct: "19.00" })).toMatchObject({ retencion_irpf: 142.5, retencion_irpf_pct: 19 });
    expect(aFacturaDetalle({ id: 1, retencion_irpf: null })).toMatchObject({ retencion_irpf: null, retencion_irpf_pct: null });
    expect(aFacturaDetalle({ id: 1 })).toMatchObject({ retencion_irpf: null });
  });
});
