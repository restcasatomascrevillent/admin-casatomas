import { describe, it, expect } from "vitest";
import {
  migrarPlanoV1aV2,
  planoV2aElementosV1,
  ESPESOR_MURO_DEFAULT_M,
  type ElementoV1,
} from "../planoDocV2";
import { PIXELS_PER_METER, type Punto, type SegmentoPared } from "../planoUtils";
import { centroRectFabric, proyectarPuntoEnSegmento } from "../puertaGeometria";

/**
 * INVARIANTE GEOMÉTRICA de una puerta anclada: su centro REAL (el que sale de
 * la transformación de Fabric, que gira el Rect alrededor de su esquina
 * left/top) cae sobre la línea del muro.
 *
 * Se comprueba esto y no un round-trip literal de `{left, top}` a propósito:
 * el round-trip literal pasaba también con la conversión MAL hecha, porque
 * los dos sentidos compartían exactamente el mismo error (centro = left +
 * width/2). Lo que de verdad importa —y lo que estaba roto— es que la puerta
 * acabe encima de su muro.
 */
function esperarPuertaSobreMuro(
  puerta: ElementoV1,
  muro: SegmentoPared,
  toleranciaPx = 1
) {
  const centro: Punto = centroRectFabric({
    left: puerta.props.left,
    top: puerta.props.top,
    width: puerta.props.width,
    height: puerta.props.height,
    angle: puerta.props.angle,
  });
  const sobreElMuro = proyectarPuntoEnSegmento(centro, muro);
  const distancia = Math.hypot(sobreElMuro.x - centro.x, sobreElMuro.y - centro.y);
  expect(
    distancia,
    `la puerta ${puerta.id} está a ${distancia.toFixed(2)}px de su muro`
  ).toBeLessThanOrEqual(toleranciaPx);
}

/** Compara dos arrays de ElementoV1 sin importar el orden, con tolerancia de
 *  coma flotante en los campos numéricos de `props`. */
function esperarElementosEquivalentes(recibidos: ElementoV1[], esperados: ElementoV1[]) {
  expect(recibidos).toHaveLength(esperados.length);
  const porId = new Map(recibidos.map((e) => [e.id, e]));
  for (const esperado of esperados) {
    const real = porId.get(esperado.id);
    expect(real, `falta el elemento ${esperado.id}`).toBeDefined();
    expect(real!.tipo).toBe(esperado.tipo);
    for (const [key, valor] of Object.entries(esperado.props)) {
      if (typeof valor === "number") {
        expect(real!.props[key], `${esperado.id}.${key}`).toBeCloseTo(valor, 4);
      } else {
        expect(real!.props[key]).toEqual(valor);
      }
    }
  }
}

describe("migrarPlanoV1aV2 — plano vacío", () => {
  it("devuelve un doc vacío para un array vacío", () => {
    const doc = migrarPlanoV1aV2([]);
    expect(doc).toEqual({
      version: 2,
      unidad: "m",
      muros: [],
      aberturas: [],
      zonas: [],
      extras: [],
    });
  });
});

describe("migrarPlanoV1aV2 — muros", () => {
  it("convierte una pared px a metros, con el espesor por defecto", () => {
    const elementos: ElementoV1[] = [
      { id: "wall-1", tipo: "wall", props: { x1: 0, y1: 0, x2: 500, y2: 0 } },
    ];
    const doc = migrarPlanoV1aV2(elementos);
    expect(doc.muros).toHaveLength(1);
    expect(doc.muros[0]).toEqual({
      id: "wall-1",
      puntos: [{ x: 0, y: 0 }, { x: 10, y: 0 }], // 500px / 50px/m = 10m
      espesor: ESPESOR_MURO_DEFAULT_M,
    });
  });

  it("no rompe con una pared sin props nuevas (formato Fase 0/1, sin espesor)", () => {
    const elementos: ElementoV1[] = [
      { id: "wall-legacy", tipo: "wall", props: { x1: 100, y1: 200, x2: 300, y2: 200 } },
    ];
    const doc = migrarPlanoV1aV2(elementos);
    expect(doc.muros[0].espesor).toBe(ESPESOR_MURO_DEFAULT_M);
  });
});

describe("migrarPlanoV1aV2 — puertas ancladas (legacy 70x12)", () => {
  it("ancla una puerta horizontal de 70x12 al muro sobre el que está dibujada", () => {
    // Muro horizontal de (0,0) a (1000,0) px. Puerta legacy 70x12, centrada en
    // el muro a mitad de camino, sin rotación (caso típico Fase 0/1).
    const elementos: ElementoV1[] = [
      { id: "wall-1", tipo: "wall", props: { x1: 0, y1: 0, x2: 1000, y2: 0 } },
      {
        id: "door-1",
        tipo: "door",
        props: { left: 465, top: -6, width: 70, height: 12, angle: 0 },
      },
    ];
    const doc = migrarPlanoV1aV2(elementos);
    expect(doc.aberturas).toHaveLength(1);
    const abertura = doc.aberturas[0];
    expect(abertura.muroId).toBe("wall-1");
    expect(abertura.tipo).toBe("puerta");
    expect(abertura.ancho).toBeCloseTo(70 / PIXELS_PER_METER, 5);
    expect(abertura.alto).toBeCloseTo(12 / PIXELS_PER_METER, 5);
    // Centro de la puerta: (465+35, -6+6) = (500, 0) -> offset 10m desde x1=0.
    expect(abertura.offset).toBeCloseTo(10, 4);
    expect(abertura.anguloRelativoDeg).toBeCloseTo(0, 4);
    expect(doc.extras).toHaveLength(0);
  });

  it("manda a extras una puerta demasiado lejos de cualquier muro", () => {
    const elementos: ElementoV1[] = [
      { id: "wall-1", tipo: "wall", props: { x1: 0, y1: 0, x2: 1000, y2: 0 } },
      {
        id: "door-huerfana",
        tipo: "door",
        // 200px = 4m de distancia perpendicular al muro: muy por encima de la
        // tolerancia de anclaje (0.5m).
        props: { left: 465, top: 194, width: 70, height: 12, angle: 0 },
      },
    ];
    const doc = migrarPlanoV1aV2(elementos);
    expect(doc.aberturas).toHaveLength(0);
    expect(doc.extras).toHaveLength(1);
    expect(doc.extras[0].motivo).toBe("puerta_sin_muro_cercano");
    expect(doc.extras[0].elemento.id).toBe("door-huerfana");
  });
});

describe("migrarPlanoV1aV2 — zonas (areas)", () => {
  it("convierte un area sin rotar en una zona con 4 vertices", () => {
    const elementos: ElementoV1[] = [
      { id: "area-1", tipo: "area", props: { left: 0, top: 0, width: 100, height: 200 } },
    ];
    const doc = migrarPlanoV1aV2(elementos);
    expect(doc.zonas).toHaveLength(1);
    expect(doc.zonas[0].nombre).toBe("Zona");
    expect(doc.zonas[0].color).toBe("#3b82f6");
    // TL,TR,BR,BL en metros (100px/50=2m, 200px/50=4m).
    expect(doc.zonas[0].puntos).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("preserva nombre y color si el elemento ya los tenia", () => {
    const elementos: ElementoV1[] = [
      {
        id: "area-2",
        tipo: "area",
        props: { left: 0, top: 0, width: 50, height: 50, nombre: "Terraza", color: "#ff0000" },
      },
    ];
    const doc = migrarPlanoV1aV2(elementos);
    expect(doc.zonas[0].nombre).toBe("Terraza");
    expect(doc.zonas[0].color).toBe("#ff0000");
  });
});

describe("migrarPlanoV1aV2 — tipos desconocidos", () => {
  it("preserva un elemento de tipo desconocido en extras, sin perder datos", () => {
    const elementos: ElementoV1[] = [
      { id: "raro-1", tipo: "ventana", props: { foo: "bar", n: 42 } },
    ];
    const doc = migrarPlanoV1aV2(elementos);
    expect(doc.muros).toHaveLength(0);
    expect(doc.zonas).toHaveLength(0);
    expect(doc.aberturas).toHaveLength(0);
    expect(doc.extras).toEqual([
      { motivo: "tipo_desconocido", elemento: elementos[0] },
    ]);
  });
});

describe("round-trip V1 -> V2 -> V1", () => {
  it("reproduce un plano completo (muro + puerta anclada + zona) dentro de la precision de coma flotante", () => {
    const original: ElementoV1[] = [
      { id: "wall-1", tipo: "wall", props: { x1: 0, y1: 0, x2: 1000, y2: 0 } },
      { id: "wall-2", tipo: "wall", props: { x1: 1000, y1: 0, x2: 1000, y2: 600 } },
      {
        id: "door-1",
        tipo: "door",
        props: { left: 465, top: -6, width: 70, height: 12, angle: 0 },
      },
      {
        id: "area-1",
        tipo: "area",
        props: { left: 50, top: 50, width: 200, height: 100, angle: 30 },
      },
    ];

    const doc = migrarPlanoV1aV2(original);
    const reconstruido = planoV2aElementosV1(doc);
    esperarElementosEquivalentes(reconstruido, original);
  });

  it("deja la puerta rotada 90 grados sobre la línea de su muro vertical", () => {
    const muro: SegmentoPared = { x1: 300, y1: 0, x2: 300, y2: 500 };
    // Puerta de 70x12 con angle 90 cuyo centro real cae justo en (300, 250):
    // left/top salen de la inversa de la transformación de Fabric, no de
    // `centro - tamaño/2`.
    const original: ElementoV1[] = [
      { id: "wall-v", tipo: "wall", props: { x1: 300, y1: 0, x2: 300, y2: 500 } },
      {
        id: "door-v",
        tipo: "door",
        props: { left: 306, top: 215, width: 70, height: 12, angle: 90 },
      },
    ];
    esperarPuertaSobreMuro(original[1], muro);

    const doc = migrarPlanoV1aV2(original);
    expect(doc.aberturas).toHaveLength(1);
    expect(doc.aberturas[0].muroId).toBe("wall-v");

    const reconstruido = planoV2aElementosV1(doc);
    const puerta = reconstruido.find((e) => e.id === "door-v")!;
    // La invariante que de verdad importa: sigue encima del muro.
    esperarPuertaSobreMuro(puerta, muro);
    expect(puerta.props.angle).toBeCloseTo(90, 6);
    expect(puerta.props.width).toBeCloseTo(70, 6);
    expect(puerta.props.height).toBeCloseTo(12, 6);
  });

  it("una puerta con el left/top de la convención ANTIGUA se recoloca sobre el muro", () => {
    // Estos son los valores que generaba el código con el fallo (centro =
    // left + width/2): con angle 90 el centro real se va 12px fuera del muro.
    const muro: SegmentoPared = { x1: 300, y1: 0, x2: 300, y2: 500 };
    const puertaVieja: ElementoV1 = {
      id: "door-v",
      tipo: "door",
      props: { left: 294, top: 215, width: 70, height: 12, angle: 90 },
    };
    const centroViejo = centroRectFabric({
      left: 294,
      top: 215,
      width: 70,
      height: 12,
      angle: 90,
    });
    // Prueba de que el plano guardado está mal: el centro NO está en el muro.
    expect(Math.abs(centroViejo.x - 300)).toBeCloseTo(12, 6);

    const original: ElementoV1[] = [
      { id: "wall-v", tipo: "wall", props: { x1: 300, y1: 0, x2: 300, y2: 500 } },
      puertaVieja,
    ];
    const doc = migrarPlanoV1aV2(original);
    expect(doc.aberturas).toHaveLength(1);

    const reconstruido = planoV2aElementosV1(doc);
    const puerta = reconstruido.find((e) => e.id === "door-v")!;
    esperarPuertaSobreMuro(puerta, muro);
  });

  it("preserva un elemento de tipo desconocido y una puerta huerfana intactos", () => {
    const original: ElementoV1[] = [
      { id: "raro-1", tipo: "ventana", props: { foo: "bar" } },
      {
        id: "door-lejos",
        tipo: "door",
        props: { left: 0, top: 900, width: 70, height: 12, angle: 0 },
      },
    ];
    const doc = migrarPlanoV1aV2(original);
    const reconstruido = planoV2aElementosV1(doc);
    esperarElementosEquivalentes(reconstruido, original);
  });

  it("reproduce un plano vacio", () => {
    const doc = migrarPlanoV1aV2([]);
    expect(planoV2aElementosV1(doc)).toEqual([]);
  });
});
