import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECTIONS } from "@/hooks/useUserRole";
import type { Exploracion, ParametrosExplorar } from "@/lib/facturas/explorador";

const estado = vi.hoisted(() => ({ llamadas: [] as unknown[], respuesta: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useExplorarCompras", () => ({
  consultarExplorarCompras: vi.fn(async (p: unknown) => {
    estado.llamadas.push(p);
    return estado.respuesta;
  }),
}));

import { INFORMES, SECCIONES_INFORME, buscarInforme, informesPorSeccion, puedeVerInforme, type DefinicionInforme } from "../registro";
import { obtenerInformeFacturas } from "../fuentes/facturas";
import { informeVinoFavorito } from "../fuentes/vinoFavorito";

const sinPermisos = { esSuperAdmin: false, permisos: [] };
const permiso = (section_key: string, can_view: boolean, can_edit = false) => ({ section_key, can_view, can_edit });

describe("registro de informes", () => {
  it("ids únicos y con forma de URL; cada sección y cada permiso existen", () => {
    const ids = INFORMES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of INFORMES) {
      expect(i.id).toMatch(/^[a-z0-9-]+$/);
      expect(SECCIONES_INFORME.some((s) => s.id === i.seccion)).toBe(true);
      if (i.permiso.tipo === "seccion") expect(SECTIONS.some((s) => s.key === (i.permiso as { seccion: string }).seccion)).toBe(true);
      expect(i.formatos.length).toBeGreaterThan(0);
    }
  });

  it("están los informes que había repartidos por el panel", () => {
    expect(INFORMES.map((i) => i.id)).toEqual(
      expect.arrayContaining(["trafico-web-mensual", "rrss-mensual", "facturas-gasto-proveedor", "facturas-gasto-familia", "facturas-gasto-mes", "facturas-productos", "carta-vino-favorito"]),
    );
  });

  it("un super admin los ve todos, agrupados en el orden de las secciones", () => {
    const grupos = informesPorSeccion({ esSuperAdmin: true, permisos: [] });
    expect(grupos.flatMap((g) => g.informes)).toHaveLength(INFORMES.length);
    const orden = grupos.map((g) => SECCIONES_INFORME.findIndex((s) => s.id === g.seccion.id));
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("cada informe solo sale a quien tiene permiso en su sección", () => {
    expect(informesPorSeccion(sinPermisos)).toEqual([]);
    const soloFacturas = informesPorSeccion({ esSuperAdmin: false, permisos: [permiso("facturas", true)] });
    expect(soloFacturas.map((g) => g.seccion.id)).toEqual(["facturas"]);
    // Tráfico web es solo de super admins.
    expect(puedeVerInforme(buscarInforme("trafico-web-mensual")!, { esSuperAdmin: false, permisos: SECTIONS.map((s) => permiso(s.key, true, true)) })).toBe(false);
    // Los votos llevan nombre y contacto: hace falta «Editar» en la carta.
    const vino = buscarInforme("carta-vino-favorito")!;
    expect(puedeVerInforme(vino, { esSuperAdmin: false, permisos: [permiso("gestor_carta", true)] })).toBe(false);
    expect(puedeVerInforme(vino, { esSuperAdmin: false, permisos: [permiso("gestor_carta", true, true)] })).toBe(true);
    // «Editar» implica «Ver».
    const rrss = buscarInforme("rrss-mensual")!;
    expect(puedeVerInforme(rrss, { esSuperAdmin: false, permisos: [permiso("marketing", false, true)] })).toBe(true);
  });

  it("buscarInforme solo encuentra los de la lista dada", () => {
    const lista: DefinicionInforme[] = [INFORMES[0]];
    expect(buscarInforme(INFORMES[0].id, lista)).toBe(INFORMES[0]);
    expect(buscarInforme("carta-vino-favorito", lista)).toBeNull();
    expect(buscarInforme(null)).toBeNull();
  });
});

const exploracion = (o: Partial<Exploracion> = {}): Exploracion =>
  ({
    parametros: { desde: "2026-10-01", hasta: "2026-10-31", hastaEfectivo: null, medida: "gasto", agrupar: "proveedor", desglose: null, porLineas: false, soloProductos: false, unidad: null },
    sinDatos: false,
    total: { valor: 300, documentos: 7, lineas: null, variacionPct: null },
    puntos: [
      { clave: "1", etiqueta: "Makro Distribución S.A.", id: 1, valor: 200, documentos: 4, desglose: null },
      { clave: "2", etiqueta: "Bodegas Alfa", id: 2, valor: 100, documentos: 3, desglose: null },
    ],
    series: [],
    resto: null,
    ...o,
  }) as unknown as Exploracion;

describe("informes de Facturas", () => {
  beforeEach(() => {
    estado.llamadas = [];
  });

  it("pide explorar_compras sin filtros (los dos locales) en el periodo y devuelve la tabla con su total", async () => {
    estado.respuesta = exploracion();
    const r = await obtenerInformeFacturas("proveedores", { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" }, "Gasto por proveedor");
    const p = estado.llamadas[0] as ParametrosExplorar;
    expect(p).toMatchObject({ p_desde: "2026-10-01", p_hasta: "2026-10-31", p_medida: "gasto", p_agrupar: "proveedor", p_filtros: {} });
    expect(r.vacio).toBe(false);
    if (r.vacio) return;
    expect(r.nombreArchivo).toBe("informe-gasto-por-proveedor-2026-10-01-a-2026-10-31");
    const t = r.tablas[0];
    expect(t.columnas.map((c) => c.etiqueta)).toEqual(["Proveedor", "Gasto con IVA", "% del total", "Documentos"]);
    expect(t.filas[0]).toMatchObject({ valor: 200, documentos: 4 });
    expect(t.filas[0].pct).toBeCloseTo(66.67, 1);
    expect(t.total).toMatchObject({ nombre: "Total", valor: 300, documentos: 7, pct: 100 });
    expect(t.nota).toBeNull();
  });

  it("avisa de lo que no sale en la tabla y no inventa el 100 %", async () => {
    estado.respuesta = exploracion({ resto: { entidades: 12, valor: 50, documentos: 5 } });
    const r = await obtenerInformeFacturas("proveedores", { tipo: "mes", mes: "2026-02" }, "Gasto por proveedor");
    expect((estado.llamadas[0] as ParametrosExplorar).p_hasta).toBe("2026-02-28");
    if (r.vacio) throw new Error("no debería estar vacío");
    expect(r.tablas[0].nota).toMatch(/^Y 12 más que no salen en la tabla: 50,00\s€ en total\.$/);
    expect(r.tablas[0].total?.pct).toBeNull();
  });

  it("sin compras en el periodo: vacío con el motivo", async () => {
    estado.respuesta = exploracion({ sinDatos: true, puntos: [] });
    expect(await obtenerInformeFacturas("familias", { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" }, "Gasto por familia")).toEqual({
      vacio: true,
      motivo: "No hay compras registradas en este periodo.",
    });
  });
});

describe("informe de la votación del vino favorito", () => {
  const voto = (vino: string, nombre: string) => ({ id: nombre, vino_id: null, vino_nombre: vino, nombre, contacto: `${nombre}@x.es`, idioma: "es", created_at: "2026-11-05T10:00:00Z" });

  it("recuento por vino (con total) y participantes", () => {
    const r = informeVinoFavorito([voto("Alfa", "Ana"), voto("Beta", "Bea"), voto("Alfa", "Carlos")] as never, { hoy: "2026-11-10" });
    if (r.vacio) throw new Error("no debería estar vacío");
    expect(r.tablas.map((t) => t.titulo)).toEqual(["Votos por vino", "Participantes"]);
    expect(r.tablas[0].filas.map((f) => [f.vino, f.votos])).toEqual([
      ["Alfa", 2],
      ["Beta", 1],
    ]);
    expect(r.tablas[0].total).toMatchObject({ votos: 3, pct: 100 });
    expect(r.tablas[1].filas[0]).toMatchObject({ nombre: "Ana", contacto: "Ana@x.es", vino: "Alfa" });
    expect(r.nombreArchivo).toBe("informe-votacion-del-vino-favorito-2026-11-10");
  });

  it("sin votos: vacío", () => {
    expect(informeVinoFavorito([], { hoy: "2026-11-10" })).toEqual({ vacio: true, motivo: "Todavía no ha votado nadie." });
  });
});
