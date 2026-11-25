import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nuevaFactura } from "@/components/facturacion/modelo";

const estado = vi.hoisted(() => ({
  datos: null as unknown,
  gastos: { gastos: null as unknown, cargando: false, error: false, disponible: true },
  pdfs: [] as { numero: string; borrador: boolean }[],
  descargas: [] as string[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFacturacionOficiososia", () => ({
  useFacturacionOficiososia: () => ({ data: estado.datos, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useGastosServiciosMes", () => ({ useGastosServiciosMes: () => estado.gastos }));
vi.mock("@/components/facturacion/pdf", () => ({
  blobPdfFactura: async (f: { numero: string }, o: { borrador?: boolean }) => {
    estado.pdfs.push({ numero: f.numero, borrador: !!o.borrador });
    return new Blob(["%PDF-1.4"], { type: "application/pdf" });
  },
}));
vi.mock("@/components/facturas/shared/VisorPdf", () => ({ VisorPdf: ({ titulo }: { titulo: string }) => <div data-testid="visor">{titulo}</div> }));
vi.mock("@/components/trafico-web/informe/pdf", () => ({ descargarBlob: (_b: Blob, nombre: string) => estado.descargas.push(nombre) }));

import InformeReciboMensualGenerador from "../generadores/InformeReciboMensualGenerador";

const Marco = ({ acciones, children }: { acciones: ReactNode; children: ReactNode }) => (
  <div>
    {acciones}
    {children}
  </div>
);
const pintar = () =>
  render(
    <MemoryRouter>
      <InformeReciboMensualGenerador periodo={{ tipo: "mes", mes: "2026-11" }} hoy="2026-11-26" Marco={Marco} />
    </MemoryRouter>,
  );
const documento = (o = {}) => ({ ...nuevaFactura(), cliente: { nombre: "Casa Tomás", nif: "", direccion: "", email: "" }, ...o });

beforeEach(() => {
  estado.pdfs = [];
  estado.descargas = [];
  estado.gastos = { gastos: [], cargando: false, error: false, disponible: true };
});

describe("Informes › Recibo mensual (Gestor Gasto)", () => {
  it("con el recibo emitido del mes: su PDF tal cual y se descarga con su número", async () => {
    estado.datos = {
      config: null,
      facturas: [{ id: "1", numero: "R-2026-004", creado_en: "", actualizado_en: "", documento: documento({ numero: "R-2026-004", tipo: "mensual", mes: "2026-11" }) }],
      borradores: [],
    };
    pintar();
    expect(await screen.findByTestId("visor")).toHaveTextContent("Recibo mensual de noviembre de 2026");
    expect(screen.getByTestId("origen-recibo")).toHaveAttribute("data-origen", "emitido");
    expect(estado.pdfs).toEqual([{ numero: "R-2026-004", borrador: false }]);
    fireEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
    expect(estado.descargas).toEqual(["Recibo-R-2026-004.pdf"]);
  });

  it("sin recibo del mes: uno nuevo como borrador, sin guardar nada", async () => {
    estado.datos = { config: { documento: documento({ catalogo: { productos: [], paquetes: [], cuotaMensual: 50 } }), actualizado_en: "" }, facturas: [], borradores: [] };
    pintar();
    await screen.findByTestId("visor");
    expect(screen.getByTestId("origen-recibo")).toHaveAttribute("data-origen", "nuevo");
    expect(screen.getByText(/Todavía no hay recibo de noviembre de 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gestor Gasto" })).toHaveAttribute("href", "/super-admin/gestor-gasto");
    await waitFor(() => expect(estado.pdfs[0]?.borrador).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
    expect(estado.descargas).toEqual(["Recibo-mensual-2026-11-borrador.pdf"]);
  });

  it("mientras cargan los gastos de Servicios no hay PDF ni botón activo", () => {
    estado.datos = { config: null, facturas: [], borradores: [] };
    estado.gastos = { gastos: null, cargando: true, error: false, disponible: true };
    pintar();
    expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeDisabled();
    expect(screen.queryByTestId("visor")).toBeNull();
  });
});
