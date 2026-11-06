/** Compras › Proveedores en acordeón: gasto filtrado, albaranes sin factura, aria-expanded y despliegue. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Factura } from "@/hooks/useFacturas";
import { crearResolverProveedor, type Proveedor } from "@/lib/facturas/proveedores";
import { agregarPorProveedor } from "@/lib/facturas/resumenCompras";
import { ListaProveedores } from "../ListaProveedores";

const prov = (id: number, nombre: string, extra: Partial<Proveedor> = {}): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 9,
  facturas: 9,
  albaranes: 0,
  total_facturas: 9999,
  total_albaranes: 0,
  ultima_fecha: "2026-01-01",
  variantes: [nombre],
  alias: [],
  cifs_extra: [],
  ...extra,
});

const doc = (id: number, extra: Partial<Factura>): Factura =>
  ({ id, tipo: "factura", numero_documento: `F-${id}`, proveedor: "Makro", fecha: "2026-10-03", total: 100, productos: [], facturado_en_id: null, ...extra }) as Factura;

const PROVS = [prov(1, "Makro"), prov(2, "Hielos")];
const agregados = agregarPorProveedor(
  [doc(1, { total: 1234.5 }), doc(2, { tipo: "albaran", total: 10, fecha: "2026-10-09" })],
  crearResolverProveedor(PROVS),
);

function pintar(extra: Partial<React.ComponentProps<typeof ListaProveedores>> = {}) {
  const onAlternar = vi.fn();
  render(
    <ListaProveedores
      proveedores={PROVS}
      agregados={agregados}
      abiertoId={null}
      cargando={false}
      mensaje={null}
      hayFiltros={false}
      onAlternar={onAlternar}
      despliegue={(p) => <div data-testid="despliegue">{p.nombre}</div>}
      {...extra}
    />,
  );
  return onAlternar;
}

describe("ListaProveedores", () => {
  it("cada fila: documentos, último, albaranes sin factura y gasto del filtro (no el de la RPC)", () => {
    pintar();
    const makro = screen.getByRole("button", { name: /^Makro/ });
    expect(makro).toHaveTextContent("2 documentos · último 09/10/26");
    expect(makro).toHaveTextContent("1 albarán sin factura");
    expect(makro).toHaveTextContent(/1\.244,50\s€/);
    const hielos = screen.getByRole("button", { name: /^Hielos/ });
    expect(hielos).toHaveTextContent("0 documentos · último 01/01/26");
    expect(hielos).toHaveTextContent(/0,00\s€/);
  });

  it("acordeón: aria-expanded, el despliegue solo del abierto y cabecera de nivel 3", () => {
    const onAlternar = pintar({ abiertoId: 1 });
    expect(screen.getByRole("button", { name: /^Makro/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Hielos/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("despliegue")).toHaveLength(1);
    expect(within(screen.getByRole("heading", { level: 3, name: /^Makro/ })).getByRole("button")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Hielos/ }));
    expect(onAlternar).toHaveBeenCalledWith(2);
  });

  it("con local o periodo elegidos no tira de la última fecha de la RPC", () => {
    pintar({ hayFiltros: true });
    expect(screen.getByRole("button", { name: /^Hielos/ })).not.toHaveTextContent("último");
  });

  it("vacío, cargando y mensaje", () => {
    const { unmount } = render(
      <ListaProveedores proveedores={[]} agregados={new Map()} abiertoId={null} cargando={false} mensaje={null} hayFiltros onAlternar={vi.fn()} despliegue={() => null} />,
    );
    expect(screen.getByText("Ningún proveedor coincide")).toBeInTheDocument();
    unmount();
    render(<ListaProveedores proveedores={PROVS} agregados={agregados} abiertoId={null} cargando={false} mensaje="Falta la migración" hayFiltros={false} onAlternar={vi.fn()} despliegue={() => null} />);
    expect(screen.getByText("Falta la migración")).toBeInTheDocument();
  });
});
