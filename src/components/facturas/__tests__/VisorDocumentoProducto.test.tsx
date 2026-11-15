// «Comparar facturas» (15/11/2026, aviso de GAMBA ROJA N1): la factura
// quincenal de 6 hojas se abre en la hoja del producto, sus líneas salen
// arriba y marcadas y al lado está la lista de todas sus compras.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const datos = vi.hoisted(() => ({
  lineas: [] as Record<string, unknown>[],
  compras: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const cadena = (llamadas: { m: string; a: unknown[] }[] = []): unknown =>
    new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            const sel = String(llamadas.find((l) => l.m === "select")?.a[0] ?? "");
            const res = { data: sel.includes("facturas!inner") ? datos.compras : datos.lineas, error: null };
            return (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
          }
          return (...a: unknown[]) => cadena([...llamadas, { m: prop, a }]);
        },
      },
    );
  return { supabase: { from: () => cadena(), storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } } };
});
vi.mock("@/lib/facturas/originalDrive", () => ({
  useOriginalDrive: () => ({ data: new Blob(["%PDF"], { type: "application/pdf" }), isError: false, isFetching: false }),
  useUrlDeBlob: () => "blob:original",
}));
vi.mock("@/lib/facturas/pintarPdf", () => ({
  pintarHojasPdf: async (_d: ArrayBuffer, o: { alHoja?: (u: string, i: number, t: number) => void } = {}) => {
    for (let i = 0; i < 6; i++) o.alHoja?.(`blob:hoja-${i + 1}`, i, 6);
    return { total: 6 };
  },
}));

import { VisorDocumento } from "../analisis/VisorDocumento";
import type { DocumentoCifra } from "@/lib/facturas/documentosCifra";

const doc = (id: number, numero: string, tipo: "factura" | "albaran", fecha: string): DocumentoCifra => ({
  id,
  fecha,
  proveedor: "Nicolás y Valero",
  proveedorId: 284,
  numero,
  tipo,
  local: "casa_tomas",
  total: 1000,
  aporta: 1000,
  cantidad: null,
  lineas: null,
  driveUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view",
  archivoPath: null,
});
const FACTURA = doc(1865, "A26/34512", "factura", "2026-07-15");
const ALBARAN = doc(352, "P26/24306", "albaran", "2026-10-09");
const GAMBA = { productoId: 284, nombreNormalizado: "gamba roja n1 costa alicante", nombre: "GAMBA ROJA N1" };

const lin = (id: number, pagina: number, orden: number, nombre: string, producto: number | null, precio = 10) => ({
  id, nombre, nombre_normalizado: nombre.toLowerCase(), producto_id: producto, cantidad: 2, unidad: "kg", precio_unitario: precio, total: precio * 2, pagina, orden, factura_id: 1865,
});
const compra = (id: number, d: DocumentoCifra, precio: number, facturadoEn: number | null = null) => ({
  ...lin(id, 1, 1, "GAMBA ROJA N1 COSTA ALICANTE", 284, precio),
  facturas: { id: d.id, fecha: d.fecha, proveedor: d.proveedor, proveedor_id: 284, numero_documento: d.numero, tipo: d.tipo, local: null, total: 1000, drive_url: d.driveUrl, archivo_path: null, facturado_en_id: facturadoEn },
});

const scroll = vi.fn();

beforeEach(() => {
  scroll.mockClear();
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: HTMLElement) {
    scroll(this.getAttribute("data-hoja"));
  };
  datos.lineas = [
    lin(1, 1, 1, "MEJILLON", 10),
    lin(2, 1, 2, "PULPO", 11),
    lin(3, 4, 45, "GAMBA ROJA N1 COSTA ALICANTE", 284, 136),
    lin(4, 5, 52, "GAMBA ROJA N1 COSTA ALICANTE", 284, 115),
    lin(5, 6, 61, "CIGALA", 12),
  ];
  datos.compras = [
    compra(10, FACTURA, 115),
    compra(11, doc(300, "P26/14.521", "albaran", "2026-07-03"), 115, 1865),
    compra(12, ALBARAN, 178),
  ];
});

function montar(onAbrirDocumento = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <VisorDocumento
        documentos={[FACTURA, ALBARAN]}
        indice={0}
        onIndice={() => {}}
        onCerrar={() => {}}
        total={2}
        notas={[{ etiqueta: "Factura anterior", linea: "GAMBA ROJA N1: 122,08 €/kg" }, null]}
        producto={GAMBA}
        onAbrirDocumento={onAbrirDocumento}
      />
    </QueryClientProvider>,
  );
  return onAbrirDocumento;
}

describe("VisorDocumento con el producto comparado", () => {
  it("abre el PDF en la hoja del producto y marca sus hojas", async () => {
    montar();
    const visor = await screen.findByTestId("visor-documento");
    await waitFor(() => expect(scroll).toHaveBeenCalledWith("4"));
    expect(within(visor).getByTestId("visor-hoja-producto")).toHaveTextContent("en las hojas 4, 5");
    const marcadas = visor.querySelectorAll("[data-marcada]");
    expect([...marcadas].map((m) => m.getAttribute("data-hoja"))).toEqual(["4", "5"]);
    expect(within(visor).getByRole("button", { name: /Ampliar la hoja 4 de 6 \(aquí está el producto\)/ })).toBeInTheDocument();
  });

  it("las líneas del producto salen arriba del todo y marcadas", async () => {
    montar();
    const lista = await screen.findByRole("list", { name: "Líneas del documento" });
    await waitFor(() => expect(within(lista).getAllByRole("listitem")).toHaveLength(5));
    const filas = within(lista).getAllByRole("listitem");
    expect(filas[0]).toHaveTextContent(/GAMBA ROJA N1 COSTA ALICANTE.*hoja 4/);
    expect(filas[1]).toHaveTextContent(/GAMBA ROJA N1 COSTA ALICANTE.*hoja 5/);
    expect(filas[0]).toHaveAttribute("data-del-producto", "true");
    expect(filas[2]).toHaveTextContent("MEJILLON");
    expect(filas[2]).not.toHaveAttribute("data-del-producto");
  });

  it("todas las compras: facturas y el albarán sin facturar, sin repetir el ya facturado, y abren su documento", async () => {
    const abrir = montar();
    fireEvent.click(await screen.findByRole("button", { name: /Todas las compras/ }));
    const lista = await screen.findByRole("list", { name: "Compras de GAMBA ROJA N1" });
    const filas = within(lista).getAllByRole("button");
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveAccessibleName(/Albarán P26\/24306 de Nicolás y Valero, 09\/10\/26: 178,00\s€\/kg\. Abrir/);
    expect(filas[1]).toHaveAccessibleName(/Factura A26\/34512.*\(abierto\)/);
    expect(filas[1]).toBeDisabled();
    expect(lista).not.toHaveTextContent("P26/14.521");
    fireEvent.click(filas[0]);
    expect(abrir).toHaveBeenCalledWith(expect.objectContaining({ id: 352, numero: "P26/24306", tipo: "albaran" }));
  });
});
