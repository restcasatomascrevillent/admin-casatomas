import { describe, expect, it } from "vitest";
import {
  agruparPorFactura, type Aviso, type CartaDeProducto, cartaPorProducto, construirCierre, esAccion, esperarDrive, evaluarPendientes, instanteUtc,
  mensajeFactura, mensajesDistintos, precioMismoMargen, sugerenciasCarta, tipoRegistro,
} from "../logica";

const AHORA = new Date("2026-11-25T21:10:00Z"); // 22:10 en Madrid
const PANEL = "https://panel.test";

let n = 0;
const aviso = (p: Partial<Aviso> = {}): Aviso => ({
  id: `a${++n}`,
  tipo: "facturas_precio_sube",
  titulo: "Sube",
  mensaje: null,
  referencia_tipo: "facturas_alerta",
  created_at: new Date(AHORA.getTime() - 10 * 60_000).toISOString(),
  datos: {},
  ...p,
});
const subida = (datos: Record<string, unknown>, p: Partial<Aviso> = {}) =>
  aviso({ datos: { factura_id: 352, proveedor: "DISTRIBUCIONES GASTRONÓMICAS NICOLÁS Y VALERO, S.R.L.", medida: "kg", ...datos }, ...p });

const FACTURA = {
  id: 352, tipo: "factura", proveedor: "Distribuciones Gastronómicas Nicolás y Valero, S.R.L.", numero_documento: "F-2026-118",
  fecha: "2026-11-25", total: 1234.5, drive_url: "https://drive.google.com/file/d/abc/view", created_at: "2026-11-25T20:40:00",
};

describe("avisos-telegram · precio con el mismo margen", () => {
  it("el ejemplo del dueño: carta 20 € con IVA, compraba a 10 y ahora a 15 → 30 €", () => {
    expect(precioMismoMargen(20, 10, 15)).toBe(30);
  });
  it("redondea hacia arriba a 0,50 € (nunca baja el margen)", () => {
    expect(precioMismoMargen(28, 136, 178)).toBe(37); // 36,65 → 37,00
    expect(precioMismoMargen(19.5, 100, 110)).toBe(21.5); // 21,45 → 21,50
    expect(precioMismoMargen(4.9, 1.2, 1.32)).toBe(5.5); // 5,39 → 5,50
  });
  it("sin subida, sin datos o con unidades disparatadas (×10): sin sugerencia", () => {
    expect(precioMismoMargen(20, 10, 10)).toBeNull();
    expect(precioMismoMargen(20, 10, 8)).toBeNull();
    expect(precioMismoMargen(0, 10, 15)).toBeNull();
    expect(precioMismoMargen(20, 0, 15)).toBeNull();
    expect(precioMismoMargen(20, 1.5, 70)).toBeNull();
  });
});

describe("avisos-telegram · carta de cada producto", () => {
  const filas = {
    productos: [{ id: 284, categoria_id: 18 }, { id: 500, categoria_id: 12 }, { id: 302, categoria_id: 19 }, { id: 17, categoria_id: 17 }],
    categorias: [{ id: 12, nombre: "Vinos" }, { id: 17, nombre: "Pescado" }, { id: 18, nombre: "Marisco" }, { id: 19, nombre: "Carne" }],
    vinoProducto: [{ vino_id: "v1", producto_id: 500 }, { vino_id: "v2", producto_id: 500 }],
    vinos: [
      { id: "v1", nombre: "Ribera X", precio_eur: "20", precio_copa_eur: 4, activado: true, restaurante: true },
      { id: "v2", nombre: "Ribera X (retirado)", precio_eur: 22, activado: false, restaurante: true },
    ],
    escandallo: [
      { plato_id: "p1", producto_id: 284 }, // «Gamba roja»: solo gamba
      { plato_id: "p2", producto_id: 284 }, { plato_id: "p2", producto_id: 9 }, // croqueta: más cosas
      { plato_id: "p3", producto_id: 302 },
      { plato_id: "p4", producto_id: 17 },
    ],
    platos: [
      { id: "p1", nombre: "Gamba roja", precio_eur: 28, activado: true, restaurante: true },
      { id: "p2", nombre: "Croqueta de gamba roja", precio_eur: 2.85, activado: true, restaurante: true },
      { id: "p3", nombre: "Chuletón", precio_eur: 48, activado: true, restaurante: true },
      { id: "p4", nombre: "Lubina", precio_eur: 24, activado: true, restaurante: true },
    ],
  };
  const carta = cartaPorProducto(filas);

  it("vinos enlazados (activos) y platos de un solo producto; marca el marisco por su familia", () => {
    expect(carta.get(284)).toEqual({ marisco: true, articulos: [{ tipo: "plato", id: "p1", nombre: "Gamba roja", precio: 28 }] });
    expect(carta.get(500)).toEqual({ marisco: false, articulos: [{ tipo: "vino", id: "v1", nombre: "Ribera X", precio: 20, copa: 4 }] });
    expect(carta.get(17)?.marisco).toBe(false); // «Pescado» no es marisco
  });

  it("subida de marisco: precio del plato con el mismo margen", () => {
    const s = sugerenciasCarta(subida({ producto_id: 284, precio: 15, precio_ref: 10 }), carta.get(284));
    expect(s).toEqual([{ tipo: "plato", nombre: "Gamba roja", antes: 28, sugerido: 42, copa: null }]);
  });
  it("subida de vino: botella y copa", () => {
    const s = sugerenciasCarta(subida({ producto_id: 500, precio: 15, precio_ref: 10 }), carta.get(500));
    expect(s).toEqual([{ tipo: "vino", nombre: "Ribera X", antes: 20, sugerido: 30, copa: { antes: 4, sugerido: 6 } }]);
  });
  it("carne, pescado o cualquier plato que no sea marisco: sin sugerencia; tampoco en bajadas", () => {
    expect(sugerenciasCarta(subida({ producto_id: 302, precio: 15, precio_ref: 10 }), carta.get(302))).toEqual([]);
    expect(sugerenciasCarta(subida({ producto_id: 17, precio: 15, precio_ref: 10 }), carta.get(17))).toEqual([]);
    expect(sugerenciasCarta(aviso({ tipo: "facturas_precio_baja", datos: { producto_id: 284, precio: 8, precio_ref: 10 } }), carta.get(284))).toEqual([]);
  });
});

describe("avisos-telegram · un mensaje por factura", () => {
  it("agrupa los avisos de la misma factura; los que no son de una factura van sueltos", () => {
    const a1 = subida({ producto: "GAMBA" });
    const a2 = aviso({ tipo: "facturas_albaran_sin_factura", datos: { factura_id: 352 } });
    const a3 = subida({ producto: "CARABINERO" });
    const a4 = subida({ producto: "ACEITE", factura_id: 400 });
    const g = agruparPorFactura([a1, a2, a3, a4]);
    expect(g.map((x) => [x.factura_id, x.avisos.map((a) => a.id)])).toEqual([[352, [a1.id, a3.id]], [null, [a2.id]], [400, [a4.id]]]);
  });

  it("explícito: proveedor, nº y fecha; producto, precio anterior → nuevo y %; sugerido; Drive y panel", () => {
    const carta = new Map<number, CartaDeProducto>([[284, { marisco: true, articulos: [{ tipo: "plato", id: "p1", nombre: "Gamba roja", precio: 28 }] }]]);
    const avisos = [
      aviso({ tipo: "facturas_margen_bajo", datos: { factura_id: 352, canal: "plato", nombre: "Arroz de bogavante", valor: 41, limite: 35 } }),
      subida({ producto: "CARABINERO", producto_id: 285, precio: 66, precio_ref: 60, variacion_pct: 10 }),
      subida({ producto: "GAMBA ROJA N1 COSTA ALICANTE", producto_id: 284, precio: 178, precio_ref: 136, variacion_pct: 30.9 },
        { titulo: "Gamba roja N1 de Alicante sube un 31 % en Distribuciones Gastronómicas Nicolás y Valero, S.R.L." }),
    ];
    const texto = mensajeFactura(FACTURA, avisos, { panelUrl: PANEL, carta });
    expect(texto).toBe([
      "🧾 <b>Distribuciones Gastronómicas Nicolás y Valero</b> · Factura F-2026-118 del 25/11 · 1.234,50 €",
      "📈 Gamba roja N1 de Alicante: 136,00 → 178,00 €/kg (+31 %)",
      "   ↳ Gamba roja: carta 28,00 → <b>37,00 €</b> (mismo margen)",
      "📈 Carabinero: 60,00 → 66,00 €/kg (+10 %)",
      "⚠️ Arroz de bogavante: coste 41 % (máx. 35 %)",
      `📄 <a href="https://drive.google.com/file/d/abc/view">Original en Drive</a> · <a href="${PANEL}/facturas?tab=compras&amp;modo=documentos&amp;doc=352">Abrir en el panel</a>`,
    ].join("\n"));
  });

  it("sin factura en la base, la cabecera sale de los datos del aviso; sin Drive lo dice", () => {
    const texto = mensajeFactura(null, [subida({ producto: "NAVAJA", precio: 30, precio_ref: 25, fecha: "2026-11-24" })]);
    expect(texto.split("\n")[0]).toBe("🧾 <b>Distribuciones Gastronómicas Nicolás Y Valero</b> · Factura del 24/11");
    expect(texto).toContain("📄 Original aún sin Drive");
  });

  it("margen bajo con precio sugerido: «→ súbelo a …» y el enlace para aplicarlo", () => {
    const a = aviso({ tipo: "facturas_margen_bajo", datos: { factura_id: 352, canal: "vino", nombre: "Ribera X", valor: 2.1, limite: 2.3 } });
    const texto = mensajeFactura(FACTURA, [a], { panelUrl: PANEL, sugerencias: new Map([[a.id, { precio_actual: 20, precio_sugerido: 22.5 }]]) });
    expect(texto).toContain(`⚠️ Ribera X: cobras ×2,1 (mín. ×2,3) → súbelo a 22,50 € · <a href="${PANEL}/aplicar-precio/${a.id}">Aplicar precio</a>`);
  });

  it("importe inusual y precio pactado roto, sin repetir el proveedor", () => {
    const texto = mensajeFactura(FACTURA, [
      aviso({ tipo: "facturas_importe_inusual", datos: { factura_id: 352, proveedor: "X", importe: 1234.5, veces: 3.2 } }),
      aviso({ tipo: "facturas_precio_pactado", datos: { factura_id: 352, producto: "ACEITE OLIVA", precio: 4.9, precio_ref: 4.5, variacion_pct: 8.9, medida: "l" } }),
    ]);
    expect(texto).toContain("📌 Aceite oliva: 4,90 €/l, pactado 4,50 € (+9 %)");
    expect(texto).toContain("❗ Importe inusual: 1.234,50 € (×3,2 su media)");
  });

  it("espera al Drive hasta 20 min desde que se subió la factura", () => {
    expect(esperarDrive({ ...FACTURA, drive_url: null, created_at: "2026-11-25T21:00:00" }, AHORA)).toBe(true);
    expect(esperarDrive({ ...FACTURA, drive_url: null, created_at: "2026-11-25T20:40:00" }, AHORA)).toBe(false);
    expect(esperarDrive({ ...FACTURA, created_at: "2026-11-25T21:05:00" }, AHORA)).toBe(false);
    expect(esperarDrive(undefined, AHORA)).toBe(false);
    expect(instanteUtc("2026-11-25 21:00:00")).toBe(Date.parse("2026-11-25T21:00:00Z"));
  });

  it("el tope cuenta mensajes, no avisos (los de una factura comparten mensaje)", () => {
    expect(mensajesDistintos([{ mensaje_id: 7 }, { mensaje_id: 7 }, { mensaje_id: 8 }, { mensaje_id: null }])).toBe(3);
  });

  it("las subidas de precio salen aunque no suenen en la campana; el resto con la campana apagada, no", () => {
    const cfg = { tipos_al_momento: ["facturas_precio_sube", "facturas_margen_bajo"], activo_desde: "2026-11-24T00:00:00Z" };
    const sube = subida({ campana: false, agrupada: true, precio: 11, precio_ref: 10 });
    const margen = aviso({ tipo: "facturas_margen_bajo", datos: { campana: false } });
    expect(evaluarPendientes([sube, margen], [], cfg, AHORA).enviar.map((a) => a.id)).toEqual([sube.id]);
  });
});

describe("avisos-telegram · cierre del día", () => {
  const fac = (p: Record<string, unknown>) => ({ ...FACTURA, ...p });

  it("facturas subidas hoy (la mayor primero, con el total) y avisos de hoy por tipo", () => {
    const facturas = [
      fac({ id: 1, proveedor: "MAKRO AUTOSERVICIO MAYORISTA, S.A.", total: 312.4, created_at: "2026-11-25T09:15:00" }),
      fac({ id: 2, total: 912, created_at: "2026-11-25T11:00:00" }),
      fac({ id: 3, tipo: "albaran", proveedor: "Bodegas Catral", total: 306, created_at: "2026-11-25T18:30:00" }),
      fac({ id: 4, proveedor: "Ayer", total: 99, created_at: "2026-11-24T22:30:00" }), // 23:30 del 24 en Madrid
    ];
    const avisos = [
      subida({ producto: "GAMBA ROJA", precio: 178, precio_ref: 136, variacion_pct: 30.9, campana: false }),
      subida({ producto: "CARABINERO", precio: 66, precio_ref: 60, variacion_pct: 10 }),
      aviso({ tipo: "facturas_revision", datos: { cuantos: 90 } }),
      aviso({ tipo: "reserva_nueva" }),
      aviso({ tipo: "facturas_margen_bajo", created_at: "2026-11-24T20:00:00Z", datos: { canal: "plato", nombre: "Ayer", valor: 40, limite: 35 } }),
    ];
    const c = construirCierre(facturas, avisos, AHORA, PANEL);
    expect(c).toMatchObject({ facturas: 3, avisos: 2 });
    expect(c.texto).toBe([
      "<b>🌙 Cierre del día · miércoles 25/11</b>",
      "",
      "<b>🧾 Facturas subidas hoy: 3 · 1.530,40 €</b>",
      "• Distribuciones Gastronómicas… · 912,00 €",
      "• Makro Autoservicio Mayorista · 312,40 €",
      "• Bodegas Catral · albarán · 306,00 €",
      "",
      "<b>📈 Suben de precio: 2</b>",
      "• Gamba roja +31 %",
      "• Carabinero +10 %",
      "",
      `<a href="${PANEL}/facturas?tab=compras&amp;modo=documentos">Facturas</a> · <a href="${PANEL}/avisos">Avisos</a>`,
    ].join("\n"));
  });

  it("sin facturas pero con avisos lo dice; sin nada, no se manda", () => {
    const c = construirCierre([], [subida({ producto: "NAVAJA", precio: 30, precio_ref: 25, variacion_pct: 20 })], AHORA);
    expect(c.texto).toContain("Facturas subidas hoy: ninguna");
    expect(construirCierre([], [], AHORA).texto).toBe("");
  });

  it("más de 8 facturas: «y N más»", () => {
    const facturas = Array.from({ length: 11 }, (_, i) => fac({ id: i + 1, proveedor: `Prov ${i + 1}`, total: 10 + i, created_at: "2026-11-25T10:00:00" }));
    const c = construirCierre(facturas, [], AHORA);
    expect(c.texto).toContain("• y 3 más");
    expect(c.texto).toContain("Sin avisos de precios ni márgenes hoy.");
  });

  it("acción «cierre» (registro con su propio tipo)", () => {
    expect(esAccion("cierre")).toBe(true);
    expect(tipoRegistro("cierre")).toBe("cierre");
  });
});
