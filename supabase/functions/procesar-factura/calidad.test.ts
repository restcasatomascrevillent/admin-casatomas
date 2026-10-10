// Casos reales de la revisión foto a foto del 10/10/2026 (48 fotos de octubre).
import { describe, expect, it } from "vitest";
import {
  avisoClienteAjeno,
  cifControlValido,
  limpiarObservaciones,
  numeroProvisional,
  proveedorCorto,
} from "./calidad";
import { normalizarDatos, paginaImpresa } from "./extraccion";
import {
  comprobarCuadre,
  type DocumentoExtraido,
  DOCUMENTO_JSON_SCHEMA,
  leerImporteLiteral,
  retirarImportesNoImpresos,
  validarEstructura,
} from "./esquema";
import { parseImporte } from "./normalizacion";

const linea = (o: Record<string, unknown>) => ({
  nombre: "X", cantidad: 1, unidad: "ud", peso_kg: null, base_precio: "por_unidad",
  precio_unitario: 1, total: 1, iva_pct: null, bonificada: false, albaran_ref: null, ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  tipo: "albaran", proveedor: "Prov", cif: null, cliente: null, numero_documento: "1",
  pagina: { actual: null, total: null }, fecha: "2026-10-10", sin_importes: false, productos: [linea({})],
  subtotal: null, iva: null, total: null, observaciones: null, resumen: null, ...o,
});
const codigos = (d: ReturnType<typeof normalizarDatos>) => d.avisos.map((a) => a.codigo);

describe("1 · documento sin número", () => {
  it("nota de entrega de Narejos sin número → provisional SN-NAREJOS-20261010 y aviso, sin fallar", () => {
    for (const numero of [null, "", "  "]) {
      const d = normalizarDatos(base({ numero_documento: numero, proveedor: "HERMANOS NAREJOS S.L.", fecha: "2026-10-10" }));
      expect(d.numero_documento).toBe("SN-NAREJOS-20261010");
      expect(codigos(d)).toContain("numero_ausente");
    }
  });
  it("Aceites Crevillente, S.L. → SN-ACEITES-…; sin proveedor → SN-DESCONOCIDO-…", () => {
    expect(numeroProvisional("Aceites Crevillente, S.L.", "2026-10-08")).toBe("SN-ACEITES-20261008");
    expect(numeroProvisional(null, "2026-10-08")).toBe("SN-DESCONOCIDO-20261008");
    expect(proveedorCorto("Distribuciones Gastronómicas Nicolás y Valero, S.R.L.")).toBe("GASTRONOMICA");
  });
  it("el esquema permite null y prohíbe sacarlo de teléfonos o del año", () => {
    const p = DOCUMENTO_JSON_SCHEMA.schema.properties.numero_documento;
    expect(p.type).toContain("null");
    expect(p.description).toMatch(/telefono/);
    expect(p.description).toMatch(/ano/);
    expect(validarEstructura(base({ numero_documento: null })).ok).toBe(true);
  });
});

describe("2 · CIF con dígito de control", () => {
  it.each([
    ["B06805246", true], ["B08605246", false], ["B06050246", false], ["B06505246", false], ["B06B05246", false],
    ["F54450895", true], ["F54650895", false], ["B53363974", true], ["B55363974", false],
    ["29016276M", true], ["33288687M", true], ["323288687M", false], ["46914230-A", true], ["X1234567L", true],
    ["ESB06805246", true], ["", false],
  ])("%s → %s", (cif, ok) => {
    expect(cifControlValido(cif)).toBe(ok);
  });
  it("se guarda normalizado: «46914230-A» → 46914230A, «F-54650895» → F54650895", () => {
    expect(normalizarDatos(base({ cif: "46914230-A" })).cif).toBe("46914230A");
    expect(normalizarDatos(base({ cif: "F-54650895" })).cif).toBe("F54650895");
  });
});

describe("3 · cargos del pie: el descuadre pequeño ya avisa", () => {
  it("N. y Valero 385: líneas 316,23 frente a base 318,05 (embalaje 1,82) → descuadre_cabecera", () => {
    const doc = base({
      productos: [linea({ cantidad: 1, precio_unitario: 316.23, total: 316.23 })],
      subtotal: 318.05, subtotal_literal: "318,05",
    }) as unknown as DocumentoExtraido;
    expect(comprobarCuadre(doc).map((d) => d.codigo)).toContain("descuadre_cabecera");
  });
  it("con el embalaje como línea cuadra exacto", () => {
    const doc = base({
      productos: [linea({ precio_unitario: 316.23, total: 316.23 }), linea({ nombre: "Embalaje", precio_unitario: 1.82, total: 1.82 })],
      subtotal: 318.05,
    }) as unknown as DocumentoExtraido;
    expect(comprobarCuadre(doc).map((d) => d.codigo)).not.toContain("descuadre_cabecera");
  });
});

describe("4 · unidades al peso y precio neto", () => {
  it("carrillada 12,40 ud → kg; lubina 5 a €/kg → kg; pollo 4 ud por unidad se queda en ud", () => {
    const d = normalizarDatos(base({
      productos: [
        linea({ nombre: "CARRILLADA IBERICA", cantidad: 12.4, precio_unitario: null, total: null }),
        linea({ nombre: "LUBINA 600/800", cantidad: 5, base_precio: "por_kg", precio_unitario: 9, total: 45 }),
        linea({ nombre: "POLLO ENTERO CAJA 4x1KG", cantidad: 4, precio_unitario: 5, total: 20 }),
        linea({ nombre: "ZANAHORIA GRANEL KILO", cantidad: 3, precio_unitario: 1, total: 3 }),
        linea({ nombre: "AJO BLANCO PELADO 1 KG UNIDAD", cantidad: 2, precio_unitario: 4, total: 8 }),
      ],
    }));
    expect(d.productos.map((p) => p.unidad)).toEqual(["kg", "kg", "ud", "kg", "ud"]);
  });
  it("DIPER: precio bruto 12,83 con bonif+dto e importe 55,18 → precio NETO 9,1967", () => {
    const d = normalizarDatos(base({
      productos: [linea({ nombre: "KEBAB POLLO", cantidad: 6, precio_unitario: 12.83, total: 55.18 })],
    }));
    expect(d.productos[0].precio_unitario).toBeCloseTo(9.1967, 4);
    expect(d.productos[0].total).toBe(55.18);
  });
  it("sin descuento el precio no se toca", () => {
    const d = normalizarDatos(base({ productos: [linea({ cantidad: 3, precio_unitario: 2.5, total: 7.5 })] }));
    expect(d.productos[0].precio_unitario).toBe(2.5);
  });
});

describe("5 · manuscritos y talonarios", () => {
  it("Casimiro 384: PERCEBE, CENTOLLA y BOGAVANTE preimpresos sin cantidad se descartan; ERIZO se queda", () => {
    const d = normalizarDatos(base({
      productos: [
        linea({ nombre: "PERCEBE", cantidad: null, precio_unitario: null, total: null }),
        linea({ nombre: "CENTOLLA", cantidad: 0, precio_unitario: null, total: null }),
        linea({ nombre: "BOGAVANTE", cantidad: null, precio_unitario: null, total: null }),
        linea({ nombre: "ERIZO", cantidad: 3, precio_unitario: 17, total: 51 }),
      ],
    }));
    expect(d.productos.map((p) => p.nombre)).toEqual(["ERIZO"]);
    expect(codigos(d)).toContain("lineas_descartadas");
  });
  it("apóstrofo como coma decimal: 51'00, 134'97, 1'20, 60'00; con 3 cifras es de miles", () => {
    expect(leerImporteLiteral("51'00")).toBe(51);
    expect(leerImporteLiteral("134'97")).toBe(134.97);
    expect(leerImporteLiteral("128’00 €")).toBe(128);
    expect(leerImporteLiteral("1'234,56")).toBe(1234.56);
    expect(parseImporte("1'20")).toBe(1.2);
    expect(parseImporte("60'00")).toBe(60);
  });
  it("Tomás Nicolás 354: el verificador cita «134'97» y el total es 134,97 → sin aviso falso", () => {
    const doc = base({ subtotal: 122.7, subtotal_literal: "122'70", iva: 12.27, iva_literal: "12'27", total: 134.97, total_literal: "134'97" }) as unknown as DocumentoExtraido;
    const r = retirarImportesNoImpresos(doc, {
      fila_total_impresa: true, total_citado: "134'97", base_imponible_citada: "122'70", cuota_iva_citada: "12'27",
    });
    expect(r.discordancias).toEqual([]);
    expect(r.retiradas).toEqual([]);
  });
});

describe("6 · albaran_ref por línea", () => {
  it("el esquema lo pide en cada fila y normalizarDatos lo conserva (Narejos 357: 14.261, 14.319…)", () => {
    const items = (DOCUMENTO_JSON_SCHEMA.schema.properties.productos as unknown as {
      items: { required: string[] };
    }).items;
    expect(items.required).toContain("albaran_ref");
    const d = normalizarDatos(base({
      productos: [linea({ albaran_ref: "14.261" }), linea({ albaran_ref: "14.319" }), linea({ albaran_ref: null })],
    }));
    expect(d.productos.map((p) => p.albaran_ref)).toEqual(["14.261", "14.319", null]);
  });
});

describe("8 · cliente ajeno", () => {
  it("Pulpería Compostela (351) avisa; Casa Tomás / MASIDE no", () => {
    expect(avisoClienteAjeno("José Manuel Casal Madureira – Pulpería Compostela, Los Molinos (Novelda)")?.codigo).toBe("cliente_ajeno");
    expect(avisoClienteAjeno("RESTAURANTE CASA TOMÁS")).toBeNull();
    expect(avisoClienteAjeno("MASIDE 2011, S.L.U. B-54583356")).toBeNull();
    expect(avisoClienteAjeno("B54583356")).toBeNull();
    expect(avisoClienteAjeno(null)).toBeNull();
    expect(codigos(normalizarDatos(base({ cliente: "ENCHENTA SLU B94186988" })))).toContain("cliente_ajeno");
  });
});

describe("9 · mercancía pendiente de servir", () => {
  it("Luga 341: «MAIZENA EXPRESS OSCURA» sin precio en un documento con precios → aviso linea_sin_importe", () => {
    const d = normalizarDatos(base({
      productos: [linea({ precio_unitario: 10, total: 10 }), linea({ nombre: "MAIZENA EXPRESS OSCURA", cantidad: 1, precio_unitario: null, total: null })],
    }));
    expect(d.productos).toHaveLength(2);
    expect(codigos(d)).toContain("linea_sin_importe");
  });
  it("una fila «Mercancía pendiente de servir» sin importe se descarta", () => {
    const d = normalizarDatos(base({
      productos: [linea({ precio_unitario: 10, total: 10 }), linea({ nombre: "Mercancía pendiente de servir: VENTRESCA", cantidad: 1, precio_unitario: null, total: null })],
    }));
    expect(d.productos).toHaveLength(1);
  });
  it("un albarán sin precios no avisa de líneas sin importe", () => {
    const d = normalizarDatos(base({ sin_importes: true, productos: [linea({ precio_unitario: null, total: null })] }));
    expect(codigos(d)).not.toContain("linea_sin_importe");
  });
});

describe("paginación impresa (para A1: «PÁGINA Nº x/y»)", () => {
  it("se lee y se valida", () => {
    expect(normalizarDatos(base({ pagina: { actual: 2, total: 2 } })).pagina).toEqual({ actual: 2, total: 2 });
    expect(paginaImpresa({ actual: null, total: null })).toBeNull();
    expect(paginaImpresa({ actual: 3, total: 2 })).toEqual({ actual: 3, total: null });
    expect(paginaImpresa(undefined)).toBeNull();
    expect(DOCUMENTO_JSON_SCHEMA.schema.required).toContain("pagina");
  });
});

describe("observaciones sin notas de franjas (374)", () => {
  it("quita «En esta franja…» y deja la forma de pago", () => {
    expect(limpiarObservaciones("Forma de pago: RECIBO · En esta franja solo se ve la cabecera. La franja solo muestra iconos de la interfaz."))
      .toBe("Forma de pago: RECIBO");
    expect(limpiarObservaciones("En esta franja no hay nada.")).toBeNull();
  });
});
