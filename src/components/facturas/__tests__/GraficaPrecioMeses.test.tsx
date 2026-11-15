import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GraficaPrecioMeses } from "../analisis/GraficaPrecioMeses";
import { geometriaPrecio } from "@/lib/facturas/vistasAnalisis";
import { aCompras } from "@/lib/facturas/comprasProducto";

const g = geometriaPrecio(
  [
    { mes: "2026-06", precio: 100 },
    { mes: "2026-07", precio: 105 },
    { mes: "2026-08", precio: null },
    { mes: "2026-09", precio: 110 },
    { mes: "2026-10", precio: 118 },
    { mes: "2026-11", precio: 130 },
  ],
  100,
)!;

const compras = aCompras([
  { id: 1, nombre: "PERCEBE", producto_id: 7, cantidad: 1.5, unidad: "kg", precio_unitario: 130, pagina: 1, orden: 1, facturas: { id: 50, tipo: "factura", numero_documento: "F-9", fecha: "2026-11-09", proveedor: "Cetárea Angelmar", total: 300 } },
  { id: 2, nombre: "PERCEBE", producto_id: 7, cantidad: 2, unidad: "kg", precio_unitario: 112, pagina: 1, orden: 1, facturas: { id: 40, tipo: "albaran", numero_documento: "A-1", fecha: "2026-10-02", proveedor: "Cetárea Angelmar", total: 200 } },
  { id: 3, nombre: "PERCEBE", producto_id: 7, cantidad: 1, unidad: "kg", precio_unitario: 124, pagina: 1, orden: 1, facturas: { id: 41, tipo: "factura", numero_documento: "F-2", fecha: "2026-10-20", proveedor: "Cetárea Angelmar", total: 200 } },
]);
const comprasDe = (mes: string) => compras.filter((c) => c.doc.fecha?.startsWith(mes));

const montar = (conCompras = true) =>
  render(
    <div style={{ height: 200 }}>
      <GraficaPrecioMeses g={g} unidad="kg" etiquetaRef="antes" ariaLabel="Precio de Percebe por mes" comprasDe={conCompras ? comprasDe : undefined} />
    </div>,
  );

describe("GraficaPrecioMeses", () => {
  it("eje Y con precios en la unidad de la serie y la raya con su etiqueta", () => {
    montar();
    const ticks = within(screen.getByTestId("eje-precio")).getAllByTestId("tick-precio").map((t) => t.textContent);
    expect(ticks).toContain("100 €/kg");
    expect(ticks).toContain("120 €/kg");
    expect(screen.getByTestId("raya-referencia")).toBeInTheDocument();
    expect(screen.getByTestId("etiqueta-referencia")).toHaveTextContent("antes 100 €/kg");
    expect(screen.getAllByTestId("punto-precio")).toHaveLength(5);
  });

  it("al pasar el ratón por un punto: precio, fecha, cantidad y documento de la compra", () => {
    montar();
    const punto = screen.getByRole("button", { name: /noviembre 2026: 130,00\s€\/kg/ });
    fireEvent.mouseEnter(punto);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(/noviembre 2026: 130,00\s€\/kg/);
    expect(tip).toHaveTextContent(/09\/11\/26 · 130,00\s€\/kg · 1,5 kg/);
    expect(tip).toHaveTextContent("Factura F-9 · Cetárea Angelmar");
    fireEvent.mouseLeave(punto);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("un mes con varias compras: el rango mín.–máx. y cada compra", () => {
    montar();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /octubre 2026/ }));
    expect(screen.getByTestId("tooltip-rango")).toHaveTextContent(/2 compras: de 112,00\s€\/kg a 124,00\s€\/kg/);
    expect(screen.getAllByTestId("tooltip-compra")).toHaveLength(2);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Albarán A-1");
  });

  it("con el dedo: tocar abre y deja el cuadro fijo; tocar otra vez o fuera lo cierra", () => {
    montar();
    const punto = screen.getByRole("button", { name: /noviembre 2026/ });
    fireEvent.click(punto);
    expect(punto).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseLeave(punto);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(punto);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(punto);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("los puntos son de 44 px para el dedo y sin compras cargadas sale solo el precio del mes", () => {
    montar(false);
    const punto = screen.getByRole("button", { name: /junio 2026/ });
    expect(punto.className).toContain("h-11");
    fireEvent.focus(punto);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/junio 2026: 100,00\s€\/kg.*Precio del mes, sin IVA/);
  });
});
