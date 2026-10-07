import { describe, expect, it } from "vitest";
import {
  aProveedor,
  cifsDistintos,
  claveProveedorCanonico,
  crearResolverProveedor,
  destinoFusionProveedorSugerido,
  faltaMigracionProveedores,
  filtrarProveedores,
  normalizarCif,
  type Proveedor,
} from "../proveedores";
import { filtrarProductos, indexarCategorias, nombresProveedores, proveedoresDe, type ResumenProducto } from "../productos";

const prov = (id: number, nombre: string, extra: Partial<Proveedor> = {}): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: "carga_inicial",
  documentos: 1,
  facturas: 1,
  albaranes: 0,
  total_facturas: 100,
  total_albaranes: 0,
  ultima_fecha: "2025-12-10",
  variantes: [],
  alias: [],
  cifs_extra: [],
  ...extra,
});

// Datos reales de la carga inicial del 07/10/2026.
const JOSELITO = prov(19, "Cárnicas Joselito S.A.", {
  nombre_comercial: "Joselito",
  cif: "A87934337",
  documentos: 2,
  albaranes: 1,
  variantes: ["Cárnicas Joselito S.A.", "JOSELITO (Cárnicas Joselito)"],
  alias: ["carnicas joselito", "joselito"],
});
const ANGELMAR = prov(26, "Herederos Angel Mariño Hermo C.B.", {
  nombre_comercial: "Angelmar",
  cif: "E13781760",
  variantes: ["HEREDEROS ANGEL MARIÑO HERMO C.B. (ANGELMAR)"],
  alias: ["angelmar", "herederos angel marino hermo", "herederos angel marino hermo c.b"],
});
const FLOPE = prov(23, "Flopeinversiones, S.L.", {
  cif: "B32455032",
  documentos: 2,
  variantes: ["FLOPEINVERSIONES, S.L."],
  alias: ["flopeinversiones"],
  cifs_extra: ["A22222222"],
});
const OSBORNE = prov(29, "Osborne", { documentos: 2, variantes: ["Osborne"], alias: ["osborne"] });
const TODOS = [JOSELITO, ANGELMAR, FLOPE, OSBORNE];

describe("aProveedor", () => {
  it("convierte la fila de la RPC (numeric como texto, arrays nulos)", () => {
    const p = aProveedor({
      id: "19", nombre: "Cárnicas Joselito S.A.", nombre_comercial: null, cif: "A87934337", activo: null, origen: "manual",
      documentos: 2, facturas: "1", albaranes: 1, total_facturas: "3126.57", total_albaranes: null, ultima_fecha: "2025-12-15",
      variantes: ["a", null, "b"], alias: null, cifs_extra: undefined,
    });
    expect(p).toMatchObject({ id: 19, activo: true, facturas: 1, total_facturas: 3126.57, total_albaranes: 0 });
    expect(p.variantes).toEqual(["a", "b"]);
    expect(p.alias).toEqual([]);
    expect(p.cifs_extra).toEqual([]);
  });
});

describe("crearResolverProveedor", () => {
  const r = crearResolverProveedor(TODOS);

  it("las dos formas de Joselito son el mismo proveedor, con su nombre canónico", () => {
    expect(r("JOSELITO (Cárnicas Joselito)")).toEqual({ clave: claveProveedorCanonico(19), nombre: "Cárnicas Joselito S.A." });
    expect(r("Cárnicas Joselito S.A.")).toEqual(r("JOSELITO (Cárnicas Joselito)"));
  });

  it("reconoce el nombre comercial y textos sin documento todavía", () => {
    expect(r("ANGELMAR").nombre).toBe("Herederos Angel Mariño Hermo C.B.");
    expect(r("  Osborne ").clave).toBe(claveProveedorCanonico(29));
    expect(r("Flopeinversiones SL").clave).toBe(claveProveedorCanonico(23));
  });

  it("un texto desconocido (o sin migración) se queda con la clave de texto de siempre", () => {
    expect(r("Proveedor Nuevo S.L.")).toEqual({ clave: "proveedor nuevo", nombre: "Proveedor Nuevo S.L." });
    expect(crearResolverProveedor(undefined)("JOSELITO (Cárnicas Joselito)").clave).toBe("joselito (carnicas joselito)");
  });
});

describe("Productos con proveedores unificados", () => {
  const prod = (id: number, proveedores: string[]): ResumenProducto => ({
    producto_id: id, nombre: `P${id}`, categoria_id: null, origen: "manual", unidad_habitual: null, compras: 1, documentos: 1,
    cantidades: {}, gasto: 10, lineas_sin_importe: 0, ultimo_precio: null, ultima_fecha: null, proveedores,
  });
  const lista = [
    prod(1, ["JOSELITO (Cárnicas Joselito)"]),
    prod(2, ["Cárnicas Joselito S.A.", "Osborne"]),
    prod(3, ["ANGELMAR"]),
  ];
  const r = crearResolverProveedor(TODOS);

  it("el filtro enseña cada proveedor una vez, con el nombre canónico", () => {
    expect(proveedoresDe(lista, r)).toEqual([
      { clave: "#19", nombre: "Cárnicas Joselito S.A." },
      { clave: "#26", nombre: "Herederos Angel Mariño Hermo C.B." },
      { clave: "#29", nombre: "Osborne" },
    ]);
    // Sin resolver: como antes, partido.
    expect(proveedoresDe(lista)).toHaveLength(4);
  });

  it("filtrar por Joselito trae los productos del albarán y de la factura", () => {
    const f = { busqueda: "", categoria: "todas" as const, proveedor: "#19", soloConCompras: false };
    expect(filtrarProductos(lista, f, indexarCategorias([]), r).map((p) => p.producto_id)).toEqual([1, 2]);
  });

  it("los nombres de un producto salen canónicos y sin repetir", () => {
    expect(nombresProveedores(prod(9, ["Cárnicas Joselito S.A.", "JOSELITO (Cárnicas Joselito)"]), r)).toEqual(["Cárnicas Joselito S.A."]);
  });
});

describe("filtrarProveedores", () => {
  it("por nombre, comercial, variante o CIF con o sin guion", () => {
    expect(filtrarProveedores(TODOS, "joselito").map((p) => p.id)).toEqual([19]);
    expect(filtrarProveedores(TODOS, "angelmar").map((p) => p.id)).toEqual([26]);
    expect(filtrarProveedores(TODOS, "B-32455032").map((p) => p.id)).toEqual([23]);
    expect(filtrarProveedores(TODOS, "a-2222").map((p) => p.id)).toEqual([23]);
    expect(filtrarProveedores(TODOS, "")).toHaveLength(4);
  });
});

describe("CIF y fusión", () => {
  it("normalizarCif como en SQL", () => {
    expect(normalizarCif("b-32455032")).toBe("B32455032");
    expect(normalizarCif("ESB32455032")).toBe("B32455032");
    expect(normalizarCif(" E 13.781.760 ")).toBe("E13781760");
    expect(normalizarCif("")).toBeNull();
    expect(normalizarCif(null)).toBeNull();
  });

  it("queda el que tiene CIF; luego el de más documentos", () => {
    expect(destinoFusionProveedorSugerido([prov(5, "sin cif", { documentos: 9 }), prov(7, "con cif", { cif: "B1", documentos: 1 })])).toBe(7);
    expect(destinoFusionProveedorSugerido([prov(5, "a", { documentos: 1 }), prov(7, "b", { documentos: 3 })])).toBe(7);
    expect(destinoFusionProveedorSugerido([])).toBeNull();
  });

  it("avisa de CIF distintos", () => {
    expect(cifsDistintos([JOSELITO, OSBORNE])).toEqual(["A87934337"]);
    expect(cifsDistintos([JOSELITO, FLOPE])).toEqual(["A87934337", "B32455032"]);
  });

  it("detecta la migración sin aplicar", () => {
    expect(faltaMigracionProveedores({ code: "PGRST202", message: "Could not find the function public.proveedores_listado" })).toBe(true);
    expect(faltaMigracionProveedores({ code: "42501", message: "permission denied" })).toBe(false);
    expect(faltaMigracionProveedores(null)).toBe(false);
  });
});
