import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiapositivasTabla } from "../DiapositivasTabla";
import { CLAVE_SUBFILA, type InformeTabla } from "@/lib/informes/tabla";

// 17/11/2026 (dueño: «lo de "Añada 202X…" se corta el texto en el informe»).
const informe = (filas: InformeTabla["tablas"][number]["filas"], columnas = 10): InformeTabla => ({
  vacio: false,
  titulo: "Vinos: facturas y carta",
  descripcion: "",
  textoPeriodo: "Carta a 17/11/2026",
  nombreArchivo: "x",
  tablas: [
    {
      titulo: "Vinos: facturas y carta",
      columnas: [
        { id: "nombre", etiqueta: "Vino", tipo: "texto" },
        { id: "precio", etiqueta: "Carta con IVA", tipo: "precio", ancho: 100 },
        { id: "venta", etiqueta: "Venta sin IVA", tipo: "precio", ancho: 100 },
        { id: "compra", etiqueta: "Compra", tipo: "precio", ancho: 100 },
        ...Array.from({ length: columnas - 4 }, (_, i) => ({ id: `c${i}`, etiqueta: `C${i}`, tipo: "texto" as const, ancho: 80 })),
      ],
      filas,
    },
  ],
});

const celdasDe = (container: HTMLElement, texto: string) => [...container.querySelectorAll("td")].filter((td) => td.textContent === texto);

describe("DiapositivasTabla", () => {
  it("el nombre de una subfila se extiende por las celdas vacías que le siguen, sin cortarse", () => {
    const { container } = render(
      <DiapositivasTabla
        informe={informe([
          { nombre: "Fefiñanes 2024", precio: 26.5, venta: 24.09, compra: 13.95 },
          { nombre: "Añada 2023 · no está en carta", compra: 13.75, [CLAVE_SUBFILA]: 1 },
          { nombre: "Sin compras en magnum (1,5 l): solo de 75 cl", [CLAVE_SUBFILA]: 1 },
        ])}
        generado="17 nov 2026, 12:00"
      />,
    );
    const [anada] = celdasDe(container, "Añada 2023 · no está en carta");
    expect(anada.colSpan).toBe(3);
    expect(anada.parentElement?.children).toHaveLength(10 - 2);
    // El aviso no tiene nada más: ocupa toda la fila.
    expect(celdasDe(container, "Sin compras en magnum (1,5 l): solo de 75 cl")[0].colSpan).toBe(10);
    // Las filas normales no cambian.
    expect(celdasDe(container, "Fefiñanes 2024")[0].colSpan).toBe(1);
  });

  it("un texto largo baja a una segunda línea (y con letra más pequeña si ni así cabe) dentro del alto de la fila", () => {
    const largo = "Marqués de Riscal Finca Montico Verdejo sobre lías Gran Vino de Rueda 2024";
    const { container } = render(<DiapositivasTabla informe={informe([{ nombre: "Muga" }, { nombre: largo }])} generado="" />);
    const corto = celdasDe(container, "Muga")[0].firstElementChild as HTMLElement;
    const caja = celdasDe(container, largo)[0].firstElementChild as HTMLElement;
    expect(corto.style.fontSize).toBe("16px");
    expect(caja.style.whiteSpace).toBe("normal");
    expect(Number.parseFloat(caja.style.fontSize)).toBeLessThan(16);
    // Dos líneas como mucho: cabe en los 38 px de la fila.
    expect(Number.parseFloat(caja.style.maxHeight)).toBeLessThanOrEqual(38);
  });
});
