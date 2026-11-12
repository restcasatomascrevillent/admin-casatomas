/**
 * Ficha de documento › el original (dueño, 09/11/2026): se ve AL LADO de los datos.
 *   · Ancha (≥ 880 px) y con algo que incrustar (Drive o Storage): dos columnas,
 *     datos a la izquierda con su scroll y el visor a la derecha a todo el alto.
 *   · Estrecha: el visor va debajo de los importes.
 *   · Sin original: nada de columna vacía; un aviso discreto.
 *   · Un solo sitio: sin botón «Original» en la cabecera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://x.test/firmada.pdf" }, error: null }) }) },
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-de-prueba" } } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useAuth", () => ({ useUsuarioIdOpcional: () => "u-1" }));
vi.mock("../AlbaranesDeFactura", () => ({ AlbaranesDeFactura: () => null }));
vi.mock("../FacturaDelAlbaran", () => ({ FacturaDelAlbaran: () => null }));
vi.mock("@/components/facturas/CosteLecturaDocumento", () => ({ CosteLecturaFactura: () => null }));

import { FichaDocumento } from "../FichaDocumento";
import type { Factura } from "@/hooks/useFacturas";

const DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjK_lm-no/view";
const base = {
  id: 9, tipo: "factura", numero_documento: "F-9", proveedor: "P", cif: null, fecha: "2026-10-01",
  subtotal: 10, iva: 1, total: 11, observaciones: null, drive_url: null, archivo_path: null,
  productos: [], verificada: true, alertas: [], local: null,
} as unknown as Factura;

let ancho = 1200;
beforeEach(() => {
  ancho = 1200;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // El original de Drive lo sirve facturas-original: una foto.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "Content-Type": "image/jpeg" } })),
  );
  URL.createObjectURL = vi.fn(() => "blob:original-9");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: ancho, height: 800, top: 0, left: 0, right: ancho, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe("FichaDocumento › visor del original", () => {
  it("ancha con Drive: dos columnas, datos con su scroll y el original (servido por el servidor) a la derecha", async () => {
    const { container } = montar({ ...base, drive_url: DRIVE });
    expect(container.querySelector('[data-vista="lateral"]')).not.toBeNull();
    const detalles = screen.getByTestId("ficha-detalles");
    expect(detalles.className).toMatch(/overflow-y-auto/);
    const visor = screen.getByRole("region", { name: "Documento original" });
    expect(detalles).not.toContainElement(visor);
    // La ficha vuelve a montar el visor al medir el ancho: se busca de nuevo.
    expect(await screen.findByAltText("Factura F-9")).toHaveAttribute("src", "blob:original-9");
    const visorFinal = screen.getByRole("region", { name: "Documento original" });
    expect(visorFinal).toContainElement(screen.getByAltText("Factura F-9"));
    expect(visorFinal.querySelector("iframe")).toBeNull();
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/functions\/v1\/facturas-original\?id=9$/), expect.anything());
    expect(within(visor).getByRole("link", { name: /abrir en drive/i })).toHaveAttribute("href", DRIVE);
  });

  it("un solo sitio para el original: ni botón en la cabecera ni la fila «Original en Google Drive»", () => {
    montar({ ...base, drive_url: DRIVE });
    expect(screen.queryByRole("button", { name: /original/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/original en google drive/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Documento original" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /abrir/i })).toHaveLength(1);
  });

  it("ancha con copia en Storage: también al lado", async () => {
    const { container } = montar({ ...base, archivo_path: "facturas/9.pdf" });
    expect(container.querySelector('[data-vista="lateral"]')).not.toBeNull();
    expect(await screen.findByRole("link", { name: /abrir pdf/i })).toBeInTheDocument();
  });

  it("estrecha: el visor va debajo de los importes, dentro de la columna única", () => {
    ancho = 600;
    const { container } = montar({ ...base, drive_url: DRIVE });
    expect(container.querySelector('[data-vista="apilada"]')).not.toBeNull();
    const importes = screen.getByLabelText("Importes");
    const visor = screen.getByRole("region", { name: "Documento original" });
    expect(importes.compareDocumentPosition(visor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin original: sin columna vacía, solo un aviso discreto", () => {
    const { container } = montar(base);
    expect(container.querySelector('[data-vista="apilada"]')).not.toBeNull();
    expect(screen.getByTestId("sin-original")).toHaveTextContent("No se guardó el original de este documento.");
    expect(screen.queryByRole("region", { name: "Documento original" })).not.toBeInTheDocument();
  });
});
