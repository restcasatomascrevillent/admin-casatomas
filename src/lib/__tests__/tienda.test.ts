import { describe, expect, it } from "vitest";
import casosPrecio from "./fixtures/tienda-precios.json";
import {
  CONFIGURACION_TIENDA_POR_DEFECTO,
  URL_WEB_DEMO,
  URL_WEB_PRODUCCION,
  centimosTienda,
  ejemplosPrecio,
  formularioDesdeConfiguracion,
  motivoNoVendible,
  normalizarConfiguracionTienda,
  porcentaje,
  precioTienda,
  puedeVenderse,
  urlTiendaWeb,
  validarAjustes,
  type VinoTiendaPanel,
} from "@/lib/tienda";

describe("precio de tienda: round(precio_eur * (1 - descuento_pct / 100), 2)", () => {
  // Los mismos casos comprueba scripts/test-tienda.mjs contra tienda_precio_venta() en Postgres.
  it.each(casosPrecio.casos)("$precio € con $descuento % → $esperado €", ({ precio, descuento, esperado }) => {
    expect(centimosTienda(precio, descuento) / 100).toBe(esperado);
  });

  it("no se deja engañar por la coma flotante (3,35 × 0,7 = 2,3449999…)", () => {
    expect(3.35 * 0.7).toBeLessThan(2.345);
    expect(precioTienda(3.35, 30)).toBe(2.35);
  });

  it("sin precio de carta no hay precio de tienda", () => {
    expect(precioTienda(null, 30)).toBeNull();
    expect(precioTienda(undefined, 30)).toBeNull();
    expect(precioTienda(0, 30)).toBeNull();
    expect(precioTienda(-5, 30)).toBeNull();
    expect(precioTienda(Number.NaN, 30)).toBeNull();
  });
});

describe("qué vinos se venden (mismo criterio que la BD y la web)", () => {
  const config = { descuento_pct: 30, vinos_excluidos: ["excluido"] };
  const vino = (p: Partial<VinoTiendaPanel>): VinoTiendaPanel => ({
    id: "v", nombre: "Vino", categoria: "Tintos", precio_eur: 20, activado: true, restaurante: true, ...p,
  });

  it("activo, de la carta de Casa Tomás, con precio y no excluido", () => {
    expect(motivoNoVendible(vino({}), config)).toBeNull();
  });
  it.each([
    [{ activado: false }, "desactivado"],
    [{ activado: null }, "desactivado"],
    [{ restaurante: false }, "fuera_de_carta"],
    [{ restaurante: null }, "fuera_de_carta"],
    [{ precio_eur: 0 }, "sin_precio"],
    [{ precio_eur: null }, "sin_precio"],
    [{ id: "excluido" }, "excluido"],
  ] as const)("%o → %s", (cambio, motivo) => {
    expect(motivoNoVendible(vino(cambio), config)).toBe(motivo);
  });
  it("como la web, solo mira precio_eur > 0 (aunque rebajado quede en 0 €)", () => {
    expect(motivoNoVendible(vino({ precio_eur: 0.01 }), { vinos_excluidos: [] })).toBeNull();
    expect(precioTienda(0.01, 90)).toBe(0);
  });
  it("el interruptor solo vale para los vendibles y los excluidos", () => {
    expect(puedeVenderse(vino({}), config)).toBe(true);
    expect(puedeVenderse(vino({ id: "excluido" }), config)).toBe(true);
    expect(puedeVenderse(vino({ precio_eur: null }), config)).toBe(false);
    expect(puedeVenderse(vino({ restaurante: false }), config)).toBe(false);
  });
});

describe("enlace a la tienda de la web", () => {
  it("cada entorno enlaza a su web", () => {
    expect(urlTiendaWeb("produccion")).toBe(`${URL_WEB_PRODUCCION}/tienda`);
    expect(urlTiendaWeb("demo")).toBe(`${URL_WEB_DEMO}/tienda`);
    expect(urlTiendaWeb("preview")).toBe(`${URL_WEB_DEMO}/tienda`);
    expect(urlTiendaWeb("local")).toBe(`${URL_WEB_DEMO}/tienda`);
  });
  it("VITE_WEB_URL manda (sin barras de más)", () => {
    expect(urlTiendaWeb("produccion", "https://www.casatomas.es/")).toBe("https://www.casatomas.es/tienda");
    expect(urlTiendaWeb("demo", "  ")).toBe(`${URL_WEB_DEMO}/tienda`);
  });
  it("porcentaje con coma", () => {
    expect(porcentaje(30)).toBe("30 %");
    expect(porcentaje(27.5)).toBe("27,5 %");
  });
});

describe("Ajustes", () => {
  const base = formularioDesdeConfiguracion(CONFIGURACION_TIENDA_POR_DEFECTO);

  it("el formulario parte de la configuración (coma decimal)", () => {
    expect(base).toEqual({ activa: true, descuento: "30", aviso: "", recogida: "" });
    expect(formularioDesdeConfiguracion({ ...CONFIGURACION_TIENDA_POR_DEFECTO, descuento_pct: 27.5 }).descuento).toBe("27,5");
  });

  it("acepta lo válido y lo deja listo para guardar", () => {
    expect(validarAjustes({ ...base, descuento: "27,5", aviso: "  Navidad  ", recogida: "" })).toEqual({
      ok: true,
      cambios: { activa: true, descuento_pct: 27.5, aviso: "Navidad", recogida: null },
    });
    expect(validarAjustes({ ...base, descuento: "0" })).toMatchObject({ ok: true, cambios: { descuento_pct: 0 } });
    expect(validarAjustes({ ...base, descuento: "90" })).toMatchObject({ ok: true, cambios: { descuento_pct: 90 } });
  });

  it.each([
    [{ descuento: "95" }, "descuento"],
    [{ descuento: "-5" }, "descuento"],
    [{ descuento: "treinta" }, "descuento"],
    [{ descuento: "30,555" }, "descuento"],
    [{ descuento: "" }, "descuento"],
    [{ aviso: "x".repeat(501) }, "aviso"],
    [{ recogida: "x".repeat(501) }, "recogida"],
  ] as const)("rechaza %o (campo %s), como los CHECK de la tabla", (cambio, campo) => {
    const r = validarAjustes({ ...base, ...cambio });
    expect(r.ok).toBe(false);
    expect("errores" in r && r.errores[campo]).toBeTruthy();
  });
});

describe("normalizarConfiguracionTienda y ejemplos de la vista previa", () => {
  it("numeric llega como texto desde PostgREST", () => {
    expect(normalizarConfiguracionTienda({ activa: false, descuento_pct: "27.50", vinos_excluidos: ["a"], aviso: "", recogida: "Barra" }))
      .toMatchObject({ activa: false, descuento_pct: 27.5, vinos_excluidos: ["a"], aviso: null, recogida: "Barra" });
    expect(normalizarConfiguracionTienda(null)).toEqual(CONFIGURACION_TIENDA_POR_DEFECTO);
  });
  it("tres precios reales (barato, medio, caro) o redondos si no hay vinos", () => {
    const v = (precio_eur: number | null, id = String(precio_eur)) => ({ id, nombre: "", categoria: "", precio_eur, activado: true, restaurante: true });
    expect(ejemplosPrecio([])).toEqual([12, 24, 45]);
    expect(ejemplosPrecio([v(10), v(10, "b"), v(null)])).toEqual([10]);
    expect(ejemplosPrecio([10, 12, 18, 24, 30, 45, 60, 90, 120, 735].map((p) => v(p)))).toEqual([18, 45, 120]);
  });
});
