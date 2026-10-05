import { describe, expect, it } from "vitest";
import {
  avisoMagnitudes,
  cuadraConDescuento,
  cuadraExacto,
  type LineaMagnitud,
  normalizarUnidad,
  resolverMagnitud,
} from "./magnitudes.ts";
import { normalizarDatos } from "./extraccion.ts";
import { comprobarCuadre, type DocumentoExtraido, type LineaExtraida } from "./esquema.ts";
import { LUGA_FILAS, LUGA_SUMA } from "./fixtures/luga-ml101511.ts";

const linea = (l: Partial<LineaMagnitud>): LineaMagnitud => ({
  cantidad: 1,
  unidad: "ud",
  peso_kg: null,
  base_precio: "desconocida",
  precio_unitario: null,
  total: null,
  bonificada: false,
  ...l,
});

describe("normalizarUnidad", () => {
  it.each([
    ["uds", "ud"], ["unidades", "ud"], ["ud", "ud"], ["u", "ud"], ["un", "ud"], ["UDS.", "ud"], ["Unidad", "ud"],
    ["und", "ud"], ["", "ud"], [null, "ud"], [undefined, "ud"],
    ["kg", "kg"], ["KGS", "kg"], ["kilos", "kg"], ["Kilo", "kg"], ["kg.", "kg"], ["kilogramos", "kg"],
    ["l", "l"], ["lt", "l"], ["L", "l"], ["litros", "l"], ["Litro", "l"], ["lts", "l"],
    ["caja", "caja"], ["CA", "ca"], ["docena", "docena"],
  ])("%s → %s", (entrada, salida) => {
    expect(normalizarUnidad(entrada as string | null | undefined)).toBe(salida);
  });
});

describe("aritmética de la fila", () => {
  it("cuadraExacto tolera el redondeo del precio impreso (NATOP 24 × 4,14 = 99,36 ≈ 99,46)", () => {
    expect(cuadraExacto(24, 4.14, 99.46)).toBe(true);
    expect(cuadraExacto(12, 4.14, 99.46)).toBe(false);
    expect(cuadraExacto(2, 9.03, 18.07)).toBe(true);
  });
  it("cuadraConDescuento: importe por debajo del bruto pero no por debajo del 40 %", () => {
    expect(cuadraConDescuento(24, 4.14, 89.42)).toBe(true);
    expect(cuadraConDescuento(12, 4.14, 99.46)).toBe(false); // por encima del bruto
    expect(cuadraConDescuento(100, 4.14, 99.46)).toBe(false); // un 24 %: no es un descuento
  });
});

describe("resolverMagnitud · los cuatro ejemplos del dueño (Luga ML/101511)", () => {
  it.each([
    ["NATOP", 12, 24, 4.14, 99.46],
    ["CG. PUNTAS", 3, 15, 5.8, 87.0],
    ["JAMON", 8, 75.48, 20.5, 1547.26],
    ["ESPINAS", 1, 2, 4.2, 8.4],
  ])("%s: %s uds · %s kg · %s → %s se guarda por kilos con sus bultos", (_n, uds, kg, precio, total) => {
    const m = resolverMagnitud(linea({ cantidad: uds, unidad: "uds", peso_kg: kg, precio_unitario: precio, total }));
    expect(m).toMatchObject({ cantidad: kg, unidad: "kg", bultos: uds, regla: "peso_cuadra", sugerencia: null });
  });

  it("da igual lo que diga base_precio si la aritmética es clara (el modelo dice por_unidad)", () => {
    const m = resolverMagnitud(linea({ cantidad: 12, peso_kg: 24, base_precio: "por_unidad", precio_unitario: 4.14, total: 99.46 }));
    expect(m.unidad).toBe("kg");
    expect(m.cantidad).toBe(24);
  });

  it("FR.COSTILLA 24 uds · 12,8 kg · 8,90 → 113,88: por kilo (aunque 24 × 8,90 con un 47 % de dto también encajaría)", () => {
    const m = resolverMagnitud(linea({ cantidad: 24, peso_kg: 12.8, precio_unitario: 8.9, total: 113.88 }));
    expect(m).toMatchObject({ cantidad: 12.8, unidad: "kg", bultos: 24, regla: "peso_cuadra" });
  });

  it("LAMINAS 3 uds · 1,5 kg · 17,84 → 53,53: el precio es por unidad, se queda en ud sin bultos", () => {
    const m = resolverMagnitud(linea({ cantidad: 3, unidad: "uds", peso_kg: 1.5, precio_unitario: 17.84, total: 53.53 }));
    expect(m).toMatchObject({ cantidad: 3, unidad: "ud", bultos: null, regla: "cantidad_cuadra" });
  });

  it("línea por unidades sin peso: solo normaliza la unidad", () => {
    const m = resolverMagnitud(linea({ cantidad: 3, unidad: "unidades", precio_unitario: 17.25, total: 51.75 }));
    expect(m).toMatchObject({ cantidad: 3, unidad: "ud", bultos: null, regla: "cantidad_cuadra", sugerencia: null });
  });
});

describe("resolverMagnitud · Dto%", () => {
  it("12 uds · 24 kg · 4,14 · Dto 10 % → 89,42: por kilo con descuento", () => {
    const m = resolverMagnitud(linea({ cantidad: 12, peso_kg: 24, precio_unitario: 4.14, total: 89.42 }));
    expect(m).toMatchObject({ cantidad: 24, unidad: "kg", bultos: 12, regla: "peso_con_descuento" });
  });

  it("10 uds · 3,5 kg · 5,00 · Dto 10 % → 45,00: por unidad con descuento (el peso no llega)", () => {
    const m = resolverMagnitud(linea({ cantidad: 10, peso_kg: 3.5, precio_unitario: 5, total: 45 }));
    expect(m).toMatchObject({ cantidad: 10, unidad: "ud", bultos: null, regla: "cantidad_con_descuento" });
  });

  it("las dos encajan con descuento: desempata base_precio", () => {
    const base = { cantidad: 24, peso_kg: 20, precio_unitario: 4, total: 70 };
    expect(resolverMagnitud(linea({ ...base, base_precio: "por_kg" }))).toMatchObject({ cantidad: 20, unidad: "kg", bultos: 24 });
    expect(resolverMagnitud(linea({ ...base, base_precio: "por_unidad" }))).toMatchObject({ cantidad: 24, unidad: "ud", bultos: null });
    expect(resolverMagnitud(linea({ ...base, base_precio: "desconocida" }))).toMatchObject({ cantidad: 24, unidad: "ud" });
  });

  it("precio por litro con columna de litros → unidad 'l'", () => {
    const m = resolverMagnitud(linea({ cantidad: 6, peso_kg: 30, base_precio: "por_litro", precio_unitario: 1.2, total: 36 }));
    expect(m).toMatchObject({ cantidad: 30, unidad: "l", bultos: 6 });
  });
});

describe("resolverMagnitud · no se inventa nada", () => {
  it("sin peso e importe/precio redondo (8,40 / 4,20 = 2): deja la cantidad y lo sugiere para avisar", () => {
    const m = resolverMagnitud(linea({ cantidad: 1, unidad: "uds", precio_unitario: 4.2, total: 8.4 }));
    expect(m).toMatchObject({ cantidad: 1, unidad: "ud", bultos: null, regla: "no_cuadra", sugerencia: 2 });
  });

  it("sin peso e importe/precio NO redondo: deja la cantidad y no sugiere nada", () => {
    const m = resolverMagnitud(linea({ cantidad: 1, precio_unitario: 7.53, total: 25.13 }));
    expect(m).toMatchObject({ cantidad: 1, regla: "no_cuadra", sugerencia: null });
  });

  it("con peso que tampoco cuadra: lo leído, sin sugerencia (ya avisa el descuadre de línea)", () => {
    const m = resolverMagnitud(linea({ cantidad: 1, peso_kg: 10, precio_unitario: 4.2, total: 8.4 }));
    expect(m).toMatchObject({ cantidad: 1, unidad: "ud", bultos: null, regla: "no_cuadra", sugerencia: null });
  });

  it("albarán sin precios (Joselito 12 uds · 111,8 kg): sin base por kilo se queda en unidades", () => {
    const m = resolverMagnitud(linea({ cantidad: 12, peso_kg: 111.8, base_precio: "desconocida" }));
    expect(m).toMatchObject({ cantidad: 12, unidad: "ud", bultos: null, regla: "sin_comprobar" });
  });

  it("sin precios pero el documento dice por kilo: kilos con sus bultos", () => {
    const m = resolverMagnitud(linea({ cantidad: 12, peso_kg: 111.8, base_precio: "por_kg" }));
    expect(m).toMatchObject({ cantidad: 111.8, unidad: "kg", bultos: 12, regla: "sin_comprobar" });
  });

  it("una sola columna de kilos (cantidad = kilos, unidad 'kgs') → kg sin bultos", () => {
    const m = resolverMagnitud(linea({ cantidad: 4.96, unidad: "kgs", base_precio: "por_kg", precio_unitario: 42, total: 208.32 }));
    expect(m).toMatchObject({ cantidad: 4.96, unidad: "kg", bultos: null, regla: "cantidad_cuadra" });
  });

  it("el modelo pone los kilos en cantidad Y en peso_kg con unidad 'uds' → kg sin bultos", () => {
    const m = resolverMagnitud(linea({ cantidad: 24, unidad: "uds", peso_kg: 24, precio_unitario: 4.14, total: 99.46 }));
    expect(m).toMatchObject({ cantidad: 24, unidad: "kg", bultos: null });
  });

  it("por_kg con cantidad entera y sin peso: no cambia 'ud' (3 ud de un por_kg mal etiquetado)", () => {
    expect(resolverMagnitud(linea({ cantidad: 3, base_precio: "por_kg", precio_unitario: 17.25, total: 51.75 })).unidad).toBe("ud");
    expect(resolverMagnitud(linea({ cantidad: 7.35, base_precio: "por_kg", precio_unitario: 10, total: 73.5 })).unidad).toBe("kg");
  });

  it("abono en negativo: -1 ud · 2 kg · 4,20 → -8,40 se guarda como -2 kg", () => {
    const m = resolverMagnitud(linea({ cantidad: -1, peso_kg: 2, precio_unitario: 4.2, total: -8.4 }));
    expect(m).toMatchObject({ cantidad: -2, unidad: "kg", bultos: -1, regla: "peso_cuadra" });
  });

  it("bonificada (importe 0) por kilo: kilos, sin comprobar", () => {
    const m = resolverMagnitud(linea({ cantidad: 1, peso_kg: 2, base_precio: "por_kg", precio_unitario: 4.2, total: 0, bonificada: true }));
    expect(m).toMatchObject({ cantidad: 2, unidad: "kg", bultos: 1, regla: "sin_comprobar" });
  });
});

describe("avisoMagnitudes", () => {
  it("un solo aviso con las líneas sospechosas; null si no hay", () => {
    expect(avisoMagnitudes([])).toBeNull();
    const a = avisoMagnitudes([
      { nombre: "MAYONESA", cantidad: 3, unidad: "ud", precio_unitario: 17.25, total: 51.75, sugerencia: null },
      { nombre: "ESPINAS", cantidad: 1, unidad: "ud", precio_unitario: 4.2, total: 8.4, sugerencia: 2 },
    ]);
    expect(a?.codigo).toBe("cantidad_posible_peso");
    expect(a?.severidad).toBe("media");
    expect(a?.mensaje).toContain("ESPINAS");
    expect((a?.detalle.lineas as unknown[]).length).toBe(1);
  });
});

// ─── Integración: normalizarDatos y comprobarCuadre con Luga ────────────────

const lugaComoModelo = (): DocumentoExtraido => ({
  tipo: "factura",
  proveedor: "LUGA SABORES S.L.",
  cif: "B-54529045",
  numero_documento: "ML/101511",
  fecha: "2025-12-31",
  sin_importes: false,
  filas_tabla: LUGA_FILAS.length,
  productos: LUGA_FILAS.map((f): LineaExtraida => ({
    nombre: f.nombre,
    cantidad: f.cantidad,
    unidad: "uds",
    peso_kg: f.peso_kg,
    base_precio: "por_unidad",
    precio_unitario: f.precio_unitario,
    total: f.total,
    bonificada: false,
  })),
  subtotal: null,
  iva: null,
  total: LUGA_SUMA,
  observaciones: null,
  resumen: null,
});

describe("normalizarDatos · Luga ML/101511 (54 filas, verdad de campo)", () => {
  it("las 54 cuadran cantidad × precio = importe; 19 en kg con bultos, 35 en ud", () => {
    const d = normalizarDatos(lugaComoModelo());
    expect(d.productos).toHaveLength(54);
    const noCuadran = d.productos.filter((p) =>
      Math.abs(p.cantidad * (p.precio_unitario as number) - (p.total as number)) > Math.max(0.05, Math.abs(p.cantidad) * 0.005 + 0.01)
    );
    expect(noCuadran).toEqual([]);
    expect(d.productos.filter((p) => p.unidad === "kg" && p.bultos !== null)).toHaveLength(19);
    expect(d.productos.filter((p) => p.unidad === "ud" && p.bultos === null)).toHaveLength(35);
    expect(d.productos[2]).toMatchObject({ cantidad: 24, unidad: "kg", bultos: 12, precio_unitario: 4.14, total: 99.46 });
    expect(d.productos[44]).toMatchObject({ cantidad: 75.48, unidad: "kg", bultos: 8, total: 1547.26 });
    expect(d.avisos).toEqual([]);
  });

  it("sin la columna de peso: no inventa kilos, deja las Uds y avisa con un solo aviso", () => {
    const doc = lugaComoModelo();
    doc.productos = doc.productos.map((p) => ({ ...p, peso_kg: null }));
    const d = normalizarDatos(doc);
    expect(d.productos[2]).toMatchObject({ cantidad: 12, unidad: "ud", bultos: null });
    expect(d.avisos).toHaveLength(1);
    expect(d.avisos[0].codigo).toBe("cantidad_posible_peso");
  });

  it("comprobarCuadre ya no ve descuadres de línea en las filas al peso", () => {
    const d = comprobarCuadre(lugaComoModelo());
    expect(d.filter((x) => x.codigo === "descuadre_linea")).toEqual([]);
  });

  it("y sigue viendo un descuadre de verdad", () => {
    const doc = lugaComoModelo();
    doc.productos[3] = { ...doc.productos[3], total: 50 }; // ROUX 1 × 12,31 ≠ 50
    expect(comprobarCuadre(doc).filter((x) => x.codigo === "descuadre_linea")).toHaveLength(1);
  });
});
