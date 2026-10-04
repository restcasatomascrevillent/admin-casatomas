import { describe, it, expect } from "vitest";
import {
  MAX_MESAS_POR_LOTE,
  etiquetaMesasReserva,
  generarNumerosMesaEnRango,
  mensajeChoquesLoteNombresMesa,
  mensajeChoquesResueltos,
  mensajeNombreMesaDuplicado,
  mesaReservaNumero,
  mesasCanvasParaNombre,
  nombreMesaDuplicado,
  nombresMesaDuplicadosEnLote,
  normalizarNombreMesa,
  resolverChoquesNombresMesa,
  siguienteNumeroMesaLibre,
} from "../nombresMesa";

describe("normalizarNombreMesa", () => {
  it("recorta espacios y pasa a minúsculas", () => {
    expect(normalizarNombreMesa("  Mesa 9  ")).toBe("mesa 9");
  });

  it("colapsa espacios repetidos", () => {
    expect(normalizarNombreMesa("Mesa   9")).toBe("mesa 9");
  });

  it("trata null/undefined como cadena vacía", () => {
    expect(normalizarNombreMesa(null)).toBe("");
    expect(normalizarNombreMesa(undefined)).toBe("");
  });

  // ALINEACIÓN CON POSTGRES: el índice único parcial
  // `uq_mesas_espacio_nombre_real` normaliza con
  // `lower(btrim(regexp_replace(nombre, '\s+', ' ', 'g')))` — colapsar PRIMERO
  // y recortar DESPUÉS, porque `btrim` con un solo argumento solo se lleva el
  // espacio U+0020 y no un tabulador. Si el orden se invirtiera, "\t9" sería
  // " 9" aquí y "9" en la base (o al revés) y las dos pantallas dirían cosas
  // distintas.
  it("colapsa antes de recortar, igual que el índice de Postgres", () => {
    expect(normalizarNombreMesa("\t7")).toBe("7");
    expect(normalizarNombreMesa("7\n")).toBe("7");
    expect(normalizarNombreMesa("\t\n 7 \r\n")).toBe("7");
  });

  it("colapsa el mismo whitespace que el \\s de Postgres", () => {
    expect(normalizarNombreMesa("Mesa \t\r\n 9")).toBe("mesa 9");
  });

  it("no toca el espacio duro U+00A0 (Postgres tampoco lo trata como espacio)", () => {
    // Con `\s` de JavaScript el NBSP se colapsaría y la pantalla diría
    // "duplicado" donde el índice deja pasar dos filas distintas.
    expect(normalizarNombreMesa("7 ")).toBe("7 ");
    expect(normalizarNombreMesa(" 7")).toBe(" 7");
  });

  it("un nombre de solo whitespace queda vacío (igual que en la base)", () => {
    expect(normalizarNombreMesa(" \t\n ")).toBe("");
  });
});

describe("mesaReservaNumero", () => {
  it("una mesa normal reserva número", () => {
    expect(mesaReservaNumero({ id: "m-1", nombre: "7" })).toBe(true);
  });

  it("is_merged/activa a null o undefined = mesa real y activa (como el coalesce del índice)", () => {
    expect(mesaReservaNumero({ id: "m-1", nombre: "7", is_merged: null, activa: null })).toBe(true);
    expect(mesaReservaNumero({ id: "m-1", nombre: "7", is_merged: undefined })).toBe(true);
  });

  it("una fusionada o una inactiva no reservan número", () => {
    expect(mesaReservaNumero({ id: "m-1", nombre: "7+8", is_merged: true })).toBe(false);
    expect(mesaReservaNumero({ id: "m-2", nombre: "7", activa: false })).toBe(false);
  });

  it("no revienta con null", () => {
    expect(mesaReservaNumero(null)).toBe(false);
    expect(mesaReservaNumero(undefined)).toBe(false);
  });
});

describe("mesasCanvasParaNombre", () => {
  it("traduce isMerged (camelCase del canvas) a is_merged", () => {
    const fuera = mesasCanvasParaNombre([
      { id: "m-1", nombre: "7", isMerged: true },
      { id: "m-2", nombre: "8" },
    ]);
    expect(fuera).toEqual([
      { id: "m-1", nombre: "7", is_merged: true, activa: null },
      { id: "m-2", nombre: "8", is_merged: null, activa: null },
    ]);
  });

  it("aguanta null/undefined y filas nulas", () => {
    expect(mesasCanvasParaNombre(null)).toEqual([]);
    expect(mesasCanvasParaNombre([null as any, { id: "m-1", nombre: "1" }])).toHaveLength(1);
  });
});

describe("nombreMesaDuplicado", () => {
  const mesas = [
    { id: "m-1", nombre: "Mesa 1" },
    { id: "m-2", nombre: "Mesa 9" },
    { id: "m-3", nombre: "Barra" },
  ];

  it("detecta un nombre exactamente igual", () => {
    expect(nombreMesaDuplicado("Mesa 9", mesas)).toBe(true);
  });

  it("detecta el duplicado ignorando mayúsculas y espacios", () => {
    expect(nombreMesaDuplicado("  mesa   9 ", mesas)).toBe(true);
  });

  it("no marca duplicado un nombre distinto", () => {
    expect(nombreMesaDuplicado("Mesa 10", mesas)).toBe(false);
  });

  it("no marca duplicado un nombre vacío", () => {
    expect(nombreMesaDuplicado("   ", mesas)).toBe(false);
  });

  it("excluye la propia mesa al renombrar (mismo id, mismo nombre)", () => {
    expect(nombreMesaDuplicado("Mesa 9", mesas, "m-2")).toBe(false);
  });

  it("sigue detectando el choque al renombrar hacia el nombre de OTRA mesa", () => {
    // Renombrando "Mesa 1" (m-1) a "Mesa 9": chocaría con m-2.
    expect(nombreMesaDuplicado("Mesa 9", mesas, "m-1")).toBe(true);
  });

  it("no revienta con una lista vacía o con filas nulas", () => {
    expect(nombreMesaDuplicado("Mesa 1", [])).toBe(false);
    const conFilaNula = [null, { id: "m-1", nombre: "Mesa 1" }] as unknown as {
      id: string;
      nombre: string;
    }[];
    expect(nombreMesaDuplicado("Mesa 1", conFilaNula)).toBe(true);
  });

  // El `where` del índice `uq_mesas_espacio_nombre_real` excluye fusionadas e
  // inactivas: no reservan número, así que la pantalla tampoco debe bloquearlo.
  it("ignora las mesas fusionadas (su nombre lo genera la fusión)", () => {
    const conFusion = [{ id: "g-1", nombre: "7+8", is_merged: true }];
    expect(nombreMesaDuplicado("7+8", conFusion)).toBe(false);
  });

  it("ignora las mesas inactivas", () => {
    const conInactiva = [{ id: "m-1", nombre: "7", activa: false }];
    expect(nombreMesaDuplicado("7", conInactiva)).toBe(false);
  });

  it("is_merged/activa a null cuentan como mesa real y activa", () => {
    const mesasNullable = [{ id: "m-1", nombre: "7", is_merged: null, activa: null }];
    expect(nombreMesaDuplicado("7", mesasNullable)).toBe(true);
  });

  it("no confunde una fusionada con una real que se llame igual", () => {
    // Caso del Salón: la fusionada "7+8" convive con las originales 7 y 8.
    const mesas2 = [
      { id: "m-7", nombre: "7", is_merged: false, activa: true },
      { id: "g-1", nombre: "7+8", is_merged: true, activa: true },
    ];
    expect(nombreMesaDuplicado("7", mesas2)).toBe(true);
    expect(nombreMesaDuplicado("8", mesas2)).toBe(false);
  });
});

describe("mensajeNombreMesaDuplicado", () => {
  it("incluye el nombre recortado tal cual lo escribió el usuario", () => {
    expect(mensajeNombreMesaDuplicado("  Mesa 9  ")).toBe(
      'Ya hay una mesa llamada "Mesa 9" en este espacio. Usa un nombre distinto.',
    );
  });
});

describe("siguienteNumeroMesaLibre", () => {
  it("sin mesas propone el 1", () => {
    expect(siguienteNumeroMesaLibre([])).toBe("1");
  });

  it("propone el primer hueco, no length + 1", () => {
    // Este es EXACTAMENTE el fallo del lienzo: con 1 y 3, `length + 1` daba
    // "3" (ya existente); el primer libre es el 2.
    expect(siguienteNumeroMesaLibre([
      { id: "a", nombre: "1" },
      { id: "b", nombre: "3" },
    ])).toBe("2");
  });

  it("si no hay huecos propone el siguiente", () => {
    expect(siguienteNumeroMesaLibre([
      { id: "a", nombre: "1" },
      { id: "b", nombre: "2" },
      { id: "c", nombre: "3" },
    ])).toBe("4");
  });

  it("los nombres que no son un número a secas no bloquean ese número", () => {
    expect(siguienteNumeroMesaLibre([
      { id: "a", nombre: "1A" },
      { id: "b", nombre: "Barra" },
    ])).toBe("1");
  });

  it("las fusionadas y las inactivas no bloquean número", () => {
    expect(siguienteNumeroMesaLibre([
      { id: "g", nombre: "1", is_merged: true },
      { id: "i", nombre: "2", activa: false },
    ])).toBe("1");
  });

  it("excluirId permite ignorar la propia mesa", () => {
    expect(siguienteNumeroMesaLibre([{ id: "a", nombre: "1" }], "a")).toBe("1");
  });

  it("no cuenta los espacios ni las mayúsculas al comparar", () => {
    expect(siguienteNumeroMesaLibre([{ id: "a", nombre: " 1 " }])).toBe("2");
  });
});

describe("generarNumerosMesaEnRango", () => {
  it("genera el rango inclusivo", () => {
    expect(generarNumerosMesaEnRango(7, 10)).toEqual({
      numeros: ["7", "8", "9", "10"],
      error: null,
    });
  });

  it("un rango de una sola mesa es válido", () => {
    expect(generarNumerosMesaEnRango(5, 5).numeros).toEqual(["5"]);
  });

  it("rechaza números no enteros y no devuelve nada", () => {
    const r = generarNumerosMesaEnRango(1.5, 4);
    expect(r.numeros).toEqual([]);
    expect(r.error).toMatch(/enteros/i);
    expect(generarNumerosMesaEnRango(Number.NaN, 4).error).toMatch(/enteros/i);
  });

  it("rechaza empezar por debajo de 1", () => {
    expect(generarNumerosMesaEnRango(0, 3).error).toMatch(/1 o mayor/i);
  });

  it("rechaza un hasta menor que desde", () => {
    expect(generarNumerosMesaEnRango(9, 4).error).toMatch(/mayor o igual/i);
  });

  it("aplica el tope para que un dedo torpe no cree miles de filas", () => {
    const r = generarNumerosMesaEnRango(1, MAX_MESAS_POR_LOTE + 1);
    expect(r.numeros).toEqual([]);
    expect(r.error).toContain(String(MAX_MESAS_POR_LOTE));
    expect(generarNumerosMesaEnRango(1, 10000).numeros).toEqual([]);
  });

  it("el tope se puede ajustar por parámetro", () => {
    expect(generarNumerosMesaEnRango(1, 3, 2).numeros).toEqual([]);
    expect(generarNumerosMesaEnRango(1, 2, 2).numeros).toEqual(["1", "2"]);
  });
});

describe("nombresMesaDuplicadosEnLote", () => {
  const existentes = [
    { id: "m-1", nombre: "1" },
    { id: "m-2", nombre: "2" },
    { id: "g-1", nombre: "3+4", is_merged: true },
    { id: "i-1", nombre: "5", activa: false },
  ];

  it("sin choques no hay nada que reportar", () => {
    const r = nombresMesaDuplicadosEnLote(["7", "8"], existentes);
    expect(r).toEqual({ yaExisten: [], repetidosEnLote: [], hayChoques: false });
    expect(mensajeChoquesLoteNombresMesa(r)).toBeNull();
  });

  it("dice exactamente qué números ya existen", () => {
    const r = nombresMesaDuplicadosEnLote(["1", "2", "7"], existentes);
    expect(r.yaExisten).toEqual(["1", "2"]);
    expect(r.hayChoques).toBe(true);
    expect(mensajeChoquesLoteNombresMesa(r)).toContain("1, 2");
  });

  it("detecta repeticiones dentro del propio lote", () => {
    const r = nombresMesaDuplicadosEnLote(["7", "7", "8"], existentes);
    expect(r.repetidosEnLote).toEqual(["7"]);
    expect(r.yaExisten).toEqual([]);
    expect(r.hayChoques).toBe(true);
  });

  it("una mesa fusionada o inactiva no hace chocar el lote", () => {
    const r = nombresMesaDuplicadosEnLote(["3+4", "5"], existentes);
    expect(r.hayChoques).toBe(false);
  });

  it("reporta cada número una sola vez", () => {
    const r = nombresMesaDuplicadosEnLote(["1", "1", "1"], existentes);
    expect(r.yaExisten).toEqual(["1"]);
    expect(r.repetidosEnLote).toEqual([]);
  });

  it("el mensaje deja claro que no se ha creado nada", () => {
    const r = nombresMesaDuplicadosEnLote(["1"], existentes);
    expect(mensajeChoquesLoteNombresMesa(r)).toMatch(/no se ha creado ninguna mesa/i);
  });
});

describe("resolverChoquesNombresMesa", () => {
  it("si no hay choque deja el nombre tal cual", () => {
    expect(resolverChoquesNombresMesa(["7", "8"], [{ id: "m-1", nombre: "1" }])).toEqual([
      { deseado: "7", asignado: "7", renombrado: false },
      { deseado: "8", asignado: "8", renombrado: false },
    ]);
  });

  it("añade sufijo -bis cuando el número ya existe (caso Salón al desagrupar)", () => {
    const r = resolverChoquesNombresMesa(["7", "8"], [
      { id: "m-7", nombre: "7" },
      { id: "m-8", nombre: "8" },
    ]);
    expect(r.map((x) => x.asignado)).toEqual(["7-bis", "8-bis"]);
    expect(r.every((x) => x.renombrado)).toBe(true);
  });

  it("encadena sufijos si el -bis también está pillado", () => {
    const r = resolverChoquesNombresMesa(["7"], [
      { id: "a", nombre: "7" },
      { id: "b", nombre: "7-bis" },
      { id: "c", nombre: "7-bis2" },
    ]);
    expect(r[0].asignado).toBe("7-bis3");
  });

  it("no repite nombres dentro de la propia tanda", () => {
    const r = resolverChoquesNombresMesa(["7", "7"], []);
    expect(r.map((x) => x.asignado)).toEqual(["7", "7-bis"]);
  });

  it("una mesa fusionada no bloquea el número al desagruparla", () => {
    // La propia mesa "7+8" sigue en el canvas mientras se desagrupa.
    const r = resolverChoquesNombresMesa(["7", "8"], [{ id: "g-1", nombre: "7+8", is_merged: true }]);
    expect(r.map((x) => x.asignado)).toEqual(["7", "8"]);
  });

  it("recorta el nombre deseado y tiene apaño para nombres vacíos", () => {
    const r = resolverChoquesNombresMesa(["  7  ", "", null], []);
    expect(r[0]).toEqual({ deseado: "7", asignado: "7", renombrado: false });
    expect(r[1].asignado).toBe("Mesa");
    expect(r[2].asignado).toBe("Mesa-bis");
  });
});

describe("mensajeChoquesResueltos", () => {
  it("no dice nada si no se renombró ninguna", () => {
    expect(mensajeChoquesResueltos([{ deseado: "7", asignado: "7", renombrado: false }])).toBeNull();
    expect(mensajeChoquesResueltos([])).toBeNull();
  });

  it("enumera los cambios para que el dueño sepa qué revisar", () => {
    const mensaje = mensajeChoquesResueltos([
      { deseado: "7", asignado: "7-bis", renombrado: true },
      { deseado: "8", asignado: "8", renombrado: false },
    ]);
    expect(mensaje).toContain("7 → 7-bis");
    expect(mensaje).not.toContain("8 →");
  });
});

describe("etiquetaMesasReserva (insignia de la tarjeta)", () => {
  it("una mesa: «Mesa 7»", () => {
    expect(etiquetaMesasReserva(["7"])).toBe("Mesa 7");
  });

  it("varias mesas: «Mesas 7, 9», en el orden recibido", () => {
    expect(etiquetaMesasReserva(["7", "9"])).toBe("Mesas 7, 9");
  });

  it("una mesa fusionada ya lleva el «+» en el nombre: «Mesa 7+8»", () => {
    expect(etiquetaMesasReserva(["7+8"])).toBe("Mesa 7+8");
  });

  it("sin mesas (o solo nombres vacíos) no hay etiqueta: quien llama decide si pinta «Sin mesa»", () => {
    expect(etiquetaMesasReserva([])).toBeNull();
    expect(etiquetaMesasReserva(undefined)).toBeNull();
    expect(etiquetaMesasReserva(["", "  ", null])).toBeNull();
  });

  it("ignora vacíos y repetidos, y no escribe «Mesa Mesa 9»", () => {
    expect(etiquetaMesasReserva(["7", "", "7"])).toBe("Mesa 7");
    expect(etiquetaMesasReserva(["Mesa 9"])).toBe("Mesa 9");
  });
});
