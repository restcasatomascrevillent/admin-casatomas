/**
 * Filtro de vinos con las píldoras de la carta de la web (04/11/2026): fila
 * por tipo y, con tipo, por denominación; «Origen por confirmar» junta los
 * que hay que corregir. Y la publicación por carta (Restaurante / Touza).
 */
import { describe, expect, it } from "vitest";
import {
  categoriaDelFiltro,
  FILTRO_SIN_ORIGEN,
  FILTRO_TODOS,
  filtrarVinos,
  filtroCategoria,
  filtroTipo,
  opcionesDenominacionVino,
  opcionesTipoVino,
  ordenarVinosPorCategoria,
  tipoDelFiltro,
} from "../filtroVinos";
import { cartasVino, textoPublicacionVino, vinoPublicado } from "../publicacionVino";

const ORIGEN = { ubicacion_pais: "España", ubicacion_region: "Algún sitio" };
const v = (id: string, categoria: string, extra: Record<string, unknown> = {}) => ({ id, categoria, ...ORIGEN, orden: 1, ...extra });

const VINOS = [
  v("rd1", "VINOS TINTOS — RIBERA DEL DUERO", { orden: 2 }),
  v("rd2", "VINOS TINTOS — RIBERA DEL DUERO", { orden: 1 }),
  v("ri1", "VINOS TINTOS — RIOJA"),
  v("tp1", "VINOS TINTOS — ORIGEN PENDIENTE"),
  v("rb1", "VINOS BLANCOS — RÍAS BAIXAS"),
  v("bp1", "VINOS BLANCOS — ORIGEN PENDIENTE"),
  v("ch1", "VINOS ESPUMOSOS — CHAMPAGNE"),
  v("sp1", "VINOS TINTOS — RIOJA", { ubicacion_pais: null }),
];

describe("valor del filtro", () => {
  it("tipo y categoría", () => {
    expect(tipoDelFiltro(FILTRO_TODOS)).toBeNull();
    expect(tipoDelFiltro(FILTRO_SIN_ORIGEN)).toBeNull();
    expect(tipoDelFiltro(filtroTipo("blanco"))).toBe("blanco");
    expect(tipoDelFiltro("tipo:inventado")).toBeNull();
    expect(tipoDelFiltro(filtroCategoria("VINOS TINTOS — RIOJA"))).toBe("tinto");
    expect(categoriaDelFiltro(filtroCategoria("VINOS TINTOS — RIOJA"))).toBe("VINOS TINTOS — RIOJA");
    expect(categoriaDelFiltro(filtroTipo("tinto"))).toBeNull();
  });
});

describe("filtrarVinos", () => {
  const ids = (lista: { id: string }[]) => lista.map((x) => x.id);
  it("todos, por tipo, por denominación y los de origen por confirmar", () => {
    expect(filtrarVinos(VINOS, FILTRO_TODOS)).toHaveLength(8);
    expect(ids(filtrarVinos(VINOS, filtroTipo("tinto")))).toEqual(["rd1", "rd2", "ri1", "tp1", "sp1"]);
    expect(ids(filtrarVinos(VINOS, filtroCategoria("VINOS TINTOS — RIOJA")))).toEqual(["ri1", "sp1"]);
    expect(ids(filtrarVinos(VINOS, FILTRO_SIN_ORIGEN))).toEqual(["tp1", "bp1", "sp1"]);
  });

  it("varias categorías: por tipo, categoría y su orden, como en la carta", () => {
    expect(ids(ordenarVinosPorCategoria(filtrarVinos(VINOS, FILTRO_TODOS)))).toEqual([
      "tp1", "rd2", "rd1", "ri1", "sp1", "bp1", "rb1", "ch1",
    ]);
  });
});

describe("píldoras", () => {
  it("fila de tipos con contador; sin Rosados ni Otros si no hay; «Origen por confirmar» solo si hay", () => {
    expect(opcionesTipoVino(VINOS).map((o) => `${o.etiqueta} ${o.cantidad}`)).toEqual([
      "Todos 8", "Tintos 5", "Blancos 2", "Espumosos 1", "Origen por confirmar 3",
    ]);
    const conRosado = [...VINOS, v("ro", "VINOS ROSADOS — NAVARRA")];
    expect(opcionesTipoVino(conRosado).map((o) => o.etiqueta)).toContain("Rosados");
    const limpios = VINOS.filter((x) => !["tp1", "bp1", "sp1"].includes(x.id));
    expect(opcionesTipoVino(limpios).map((o) => o.valor)).not.toContain(FILTRO_SIN_ORIGEN);
    // Elegido, se queda aunque ya no haya ninguno (para no dejar la fila sin nada marcado).
    expect(opcionesTipoVino(limpios, FILTRO_SIN_ORIGEN).find((o) => o.valor === FILTRO_SIN_ORIGEN)?.cantidad).toBe(0);
    expect(opcionesTipoVino(VINOS).find((o) => o.valor === FILTRO_SIN_ORIGEN)?.aviso).toBe(true);
  });

  it("fila de denominaciones: «Todas», las pendientes delante y el resto por nombre", () => {
    const tintos = opcionesDenominacionVino(VINOS, "tinto", filtroTipo("tinto"));
    expect(tintos.map((o) => `${o.etiqueta} ${o.cantidad}`)).toEqual([
      "Todas 5", "Origen por confirmar 1", "Ribera del Duero 2", "Rioja 2",
    ]);
    expect(tintos[0].valor).toBe(filtroTipo("tinto"));
    expect(tintos[1]).toMatchObject({ valor: filtroCategoria("VINOS TINTOS — ORIGEN PENDIENTE"), aviso: true });
  });

  it("la denominación elegida sale aunque la búsqueda la deje a 0", () => {
    const elegida = filtroCategoria("VINOS TINTOS — RIOJA");
    const soloRibera = VINOS.filter((x) => x.id.startsWith("rd"));
    expect(opcionesDenominacionVino(soloRibera, "tinto", elegida).map((o) => `${o.etiqueta} ${o.cantidad}`)).toEqual([
      "Todas 2", "Ribera del Duero 2", "Rioja 0",
    ]);
  });
});

describe("publicación por carta", () => {
  it("lo que sale en cada carta (como filtra la web: activado AND restaurante / touza)", () => {
    expect(cartasVino({ activado: true, restaurante: true, touza: false })).toEqual({ restaurante: true, touza: false });
    // BD aún sin migrar: activado = false manda, como en la web.
    expect(cartasVino({ activado: false, restaurante: true, touza: true })).toEqual({ restaurante: false, touza: false });
    expect(cartasVino({ activado: null, restaurante: null, touza: true })).toEqual({ restaurante: false, touza: true });
    expect(vinoPublicado({ restaurante: false, touza: true })).toBe(true);
    expect(vinoPublicado({ restaurante: false, touza: false })).toBe(false);
  });

  it("texto de la tarjeta", () => {
    expect(textoPublicacionVino({ restaurante: true, touza: true })).toBe("Sale en la carta de Casa Tomás y en la de Touza.");
    expect(textoPublicacionVino({ restaurante: true, touza: false })).toBe("Sale solo en la carta de la web de Casa Tomás.");
    expect(textoPublicacionVino({ restaurante: false, touza: true })).toBe("Sale solo en la carta de Touza.");
    expect(textoPublicacionVino({ restaurante: false, touza: false })).toBe("No sale en ninguna carta.");
  });
});
