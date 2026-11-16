import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Exploracion } from "@/lib/facturas/explorador";

const estado = vi.hoisted(() => ({ explorar: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => estado.rpc(...a) } }));
vi.mock("@/hooks/useExplorarCompras", () => ({ consultarExplorarCompras: (...a: unknown[]) => estado.explorar(...a) }));

import { obtenerInformeFacturas } from "../fuentes/facturas";
import { csvInformeTabla, type InformeTabla } from "../tabla";

const punto = (clave: string, etiqueta: string, valor: number, documentos: number) => ({ clave, etiqueta, id: Number(clave) || null, valor, documentos, desglose: null });
const exploracion = (agrupar: "familia" | "proveedor"): Exploracion =>
  ({
    parametros: { desde: "2026-10-01", hasta: "2026-10-31", hastaEfectivo: "2026-10-31", medida: agrupar === "familia" ? "base" : "gasto", agrupar, desglose: null, porLineas: true, soloProductos: false, unidad: null },
    sinDatos: false,
    total: { valor: 1000, documentos: 20, lineas: 90, variacionPct: null },
    anterior: null,
    unidades: null,
    series: [],
    puntos: [punto("1", "Bebidas", 600, 12), punto("6", "Despensa", 400, 8)],
    resto: null,
  }) as unknown as Exploracion;

const categoria = (categoria_id: number, categoria: string, padre_id: number | null, padre: string | null, gasto: number) => ({
  categoria_id, categoria, padre_id, padre, sin_clasificar: false, gasto, lineas: 3, productos: 2, lineas_sin_importe: 0,
});
const periodo = { tipo: "rango" as const, desde: "2026-10-01", hasta: "2026-10-31" };

describe("informes de Facturas: «Gasto por familia» con subfilas", () => {
  beforeEach(() => {
    estado.explorar = vi.fn(async () => exploracion("familia"));
    estado.rpc = vi.fn(async () => ({
      data: [
        categoria(12, "Vinos", 1, "Bebidas", 350),
        categoria(14, "Licores y destilados", 1, "Bebidas", 150),
        categoria(13, "Cervezas", 1, "Bebidas", 100),
        categoria(6, "Despensa", null, null, 400),
      ],
      error: null,
    }));
  });

  it("debajo de Bebidas salen Cervezas y Vinos (y solo esas), con su parte del total", async () => {
    // `as InformeTabla`: sin strictNullChecks, `if (inf.vacio)` no estrecha el tipo.
    const inf = (await obtenerInformeFacturas("familias", periodo, "Gasto por familia")) as InformeTabla;
    if (inf.vacio) throw new Error("vacío");
    expect(estado.rpc).toHaveBeenCalledWith("productos_gasto_por_categoria", { p_desde: "2026-10-01", p_hasta: "2026-10-31", p_tipo: null });
    const [tabla] = inf.tablas;
    expect(tabla.filas.map((f) => [f.nombre, f.valor, f._subfila ?? null])).toEqual([
      ["Bebidas", 600, null],
      ["Cervezas", 100, 1],
      ["Vinos", 350, 1],
      ["Despensa", 400, null],
    ]);
    expect(tabla.filas[1]).toMatchObject({ pct: 10, documentos: null });
    // El total no cuenta dos veces las subfilas.
    expect(tabla.total).toMatchObject({ valor: 1000, documentos: 20 });
    expect(tabla.nota).toContain("ya están sumados en Bebidas");
    const csv = csvInformeTabla(inf);
    expect(csv).toContain("\r\n↳ Cervezas;100;10;\r\n");
    expect(csv).toContain("\r\nBebidas;600;60;12\r\n");
  });

  it("una subfamilia sin compras en el periodo no sale", async () => {
    estado.rpc = vi.fn(async () => ({ data: [categoria(12, "Vinos", 1, "Bebidas", 350)], error: null }));
    // `as InformeTabla`: sin strictNullChecks, `if (inf.vacio)` no estrecha el tipo.
    const inf = (await obtenerInformeFacturas("familias", periodo, "Gasto por familia")) as InformeTabla;
    if (inf.vacio) throw new Error("vacío");
    expect(inf.tablas[0].filas.map((f) => f.nombre)).toEqual(["Bebidas", "Vinos", "Despensa"]);
  });

  it("«Gasto por proveedor» no pide subfamilias ni lleva subfilas", async () => {
    estado.explorar = vi.fn(async () => exploracion("proveedor"));
    const inf = (await obtenerInformeFacturas("proveedores", periodo, "Gasto por proveedor")) as InformeTabla;
    if (inf.vacio) throw new Error("vacío");
    expect(estado.rpc).not.toHaveBeenCalled();
    expect(inf.tablas[0].filas.every((f) => f._subfila === undefined)).toBe(true);
    expect(inf.tablas[0].nota).toBeNull();
  });
});
