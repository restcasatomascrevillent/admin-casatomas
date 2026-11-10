import { describe, expect, it } from "vitest";
import { csvInformeTabla, nombreArchivoInforme, paginarTablas, textoCelda, type InformeTabla, type TablaInforme } from "../tabla";

const tabla = (n: number, total = true): TablaInforme => ({
  titulo: "Gasto por proveedor",
  columnas: [
    { id: "nombre", etiqueta: "Proveedor", tipo: "texto" },
    { id: "valor", etiqueta: "Gasto con IVA", tipo: "eur" },
  ],
  filas: Array.from({ length: n }, (_, i) => ({ nombre: `P${i + 1}`, valor: i + 0.5 })),
  total: total ? { nombre: "Total", valor: 99 } : null,
});

describe("informes de tabla", () => {
  it("formatea las celdas como en el panel (null es «—», no 0)", () => {
    expect(textoCelda(null, "eur")).toBe("—");
    expect(textoCelda(1234.5, "eur")).toMatch(/1234,50\s€|1\.234,50\s€/);
    expect(textoCelda(1234, "entero")).toBe("1.234");
    expect(textoCelda(12345, "entero")).toBe("12.345");
    expect(textoCelda(12.345, "pct")).toBe("12,3 %");
    expect(textoCelda("Hola", "texto")).toBe("Hola");
  });

  it("CSV para Excel: BOM, «;», coma decimal, totales, nota y una línea # por tabla", () => {
    const inf: InformeTabla = {
      vacio: false,
      titulo: "Gasto",
      descripcion: "",
      textoPeriodo: "Octubre de 2026",
      tablas: [{ ...tabla(2), nota: "Y 3 más" }, { titulo: "Otra; con punto y coma", columnas: [{ id: "a", etiqueta: 'Di "hola"', tipo: "texto" }], filas: [{ a: "x;y" }] }],
      nombreArchivo: "x",
    };
    const csv = csvInformeTabla(inf);
    expect(csv.startsWith("﻿# Gasto por proveedor · Octubre de 2026\r\nProveedor;Gasto con IVA\r\nP1;0,5\r\nP2;1,5\r\nTotal;99\r\n# Y 3 más\r\n\r\n")).toBe(true);
    expect(csv).toContain('# "Otra; con punto y coma" · Octubre de 2026');
    expect(csv).toContain('"Di ""hola"""');
    expect(csv).toContain('"x;y"');
  });

  it("reparte las filas en diapositivas; el total cuenta como una fila y va en la última", () => {
    expect(paginarTablas([tabla(10)], 11)).toHaveLength(1);
    const p = paginarTablas([tabla(11)], 11);
    expect(p.map((x) => [x.filas.length, x.parte, x.partes, x.ultima])).toEqual([
      [11, 1, 2, false],
      [0, 2, 2, true],
    ]);
    expect(paginarTablas([tabla(0, false)], 11)).toHaveLength(1);
    expect(paginarTablas([tabla(3), tabla(25, false)], 11).map((x) => x.filas.length)).toEqual([3, 11, 11, 3]);
  });

  it("nombre del archivo sin tildes ni espacios", () => {
    expect(nombreArchivoInforme("Votación del vino favorito", "2026-11-10")).toBe("informe-votacion-del-vino-favorito-2026-11-10");
  });
});
