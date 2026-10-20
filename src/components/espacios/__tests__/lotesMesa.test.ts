import { describe, it, expect } from "vitest";
import {
  MAX_CAPACIDAD_MESA,
  MAX_LADO_MESA_CM,
  MAX_LARGO_NOMBRE_MESA,
  MIN_CAPACIDAD_MESA,
  MIN_LADO_MESA_CM,
  MOTIVO_FALLO_GENERICO,
  MOTIVO_NUMERO_REPETIDO,
  MOTIVO_SIN_SITIO,
  PRESETS_MESA,
  PRESET_MESA_POR_DEFECTO,
  actualizarFilaLote,
  anadirNombresAlLote,
  aplicarCapacidadAFilas,
  aplicarPresetAFila,
  aplicarPresetAFilas,
  capacidadSugeridaBarra,
  esNumeroDeMesaRepetido,
  filasLoteDesdeNombres,
  medidasMesaTexto,
  motivoFalloAltaMesa,
  normalizarCapacidadMesa,
  normalizarLadoMesaCm,
  parsearListaNumerosMesa,
  presetMesaPorId,
  presetMesaQueEncaja,
  quitarFilaLote,
  resumenAltaLoteMesas,
  resumenFilasLote,
  type PresetMesa,
} from "../lotesMesa";
import { MAX_MESAS_POR_LOTE } from "../nombresMesa";

// ---------------------------------------------------------------------------
// parsearListaNumerosMesa
// ---------------------------------------------------------------------------

describe("parsearListaNumerosMesa", () => {
  it("acepta la lista completa del encargo: rangos, rango con prefijo y suelto", () => {
    const r = parsearListaNumerosMesa("1-8, 11-16, T1-T6, 20");
    expect(r.error).toBeNull();
    expect(r.numeros).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8",
      "11", "12", "13", "14", "15", "16",
      "T1", "T2", "T3", "T4", "T5", "T6",
      "20",
    ]);
  });

  it("un valor suelto entra tal cual", () => {
    expect(parsearListaNumerosMesa("20").numeros).toEqual(["20"]);
  });

  it("un rango de un solo número es válido", () => {
    expect(parsearListaNumerosMesa("5-5").numeros).toEqual(["5"]);
  });

  it("acepta .. como separador de rango", () => {
    expect(parsearListaNumerosMesa("1..4").numeros).toEqual(["1", "2", "3", "4"]);
  });

  it("acepta el guion largo que mete el corrector de Word", () => {
    expect(parsearListaNumerosMesa("1–3").numeros).toEqual(["1", "2", "3"]);
  });

  // Las salas reales usan prefijo por zona ("T" de terraza).
  it("expande un rango con prefijo conservándolo", () => {
    expect(parsearListaNumerosMesa("T1-T6").numeros).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
  });

  it("el segundo extremo hereda el prefijo si no lo repites (T1-6)", () => {
    expect(parsearListaNumerosMesa("T1-6").numeros).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
  });

  it("conserva el espacio del prefijo (Mesa 1-Mesa 3, no Mesa1)", () => {
    expect(parsearListaNumerosMesa("Mesa 1-Mesa 3").numeros).toEqual(["Mesa 1", "Mesa 2", "Mesa 3"]);
  });

  it("respeta los ceros a la izquierda si así está numerada la sala", () => {
    expect(parsearListaNumerosMesa("01-03").numeros).toEqual(["01", "02", "03"]);
    expect(parsearListaNumerosMesa("08-11").numeros).toEqual(["08", "09", "10", "11"]);
  });

  it("rechaza un rango con prefijos distintos en cada extremo", () => {
    const r = parsearListaNumerosMesa("T1-M6");
    expect(r.numeros).toEqual([]);
    expect(r.error).toMatch(/prefijos distintos/i);
  });

  it("rechaza un rango al revés diciendo cuál es", () => {
    const r = parsearListaNumerosMesa("1-4, 9-4");
    expect(r.numeros).toEqual([]);
    expect(r.error).toContain("9-4");
    expect(r.error).toMatch(/mayor o igual/i);
  });

  // Un nombre con guion NO es un rango: su segundo extremo no acaba en dígitos.
  it("un nombre con guion entra como nombre literal (7-bis)", () => {
    expect(parsearListaNumerosMesa("7-bis").numeros).toEqual(["7-bis"]);
  });

  it("los nombres que no son números entran igual (Barra, Reservado)", () => {
    expect(parsearListaNumerosMesa("Barra, Reservado, T7").numeros).toEqual([
      "Barra",
      "Reservado",
      "T7",
    ]);
  });

  it("quita los repetidos del propio texto y lo avisa sin bloquear", () => {
    const r = parsearListaNumerosMesa("1-3, 2");
    expect(r.error).toBeNull();
    expect(r.numeros).toEqual(["1", "2", "3"]);
    expect(r.avisos.join(" ")).toMatch(/repetido/i);
    expect(r.avisos.join(" ")).toContain("2");
  });

  it("quita los repetidos de rangos que se solapan", () => {
    const r = parsearListaNumerosMesa("1-5, 3-8");
    expect(r.numeros).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(r.avisos).toHaveLength(1);
  });

  it("compara los repetidos como Postgres (espacios y mayúsculas no cuentan)", () => {
    const r = parsearListaNumerosMesa("T1,  t1 ");
    expect(r.numeros).toEqual(["T1"]);
    expect(r.avisos).toHaveLength(1);
  });

  it("aguanta espacios, saltos de línea, tabuladores y comas de más", () => {
    const r = parsearListaNumerosMesa("  1 ,, 2 \n 3 \t 4 ;; ");
    expect(r.error).toBeNull();
    expect(r.numeros).toEqual(["1", "2", "3", "4"]);
  });

  it("el texto vacío o solo espacios pide números en vez de reventar", () => {
    expect(parsearListaNumerosMesa("").numeros).toEqual([]);
    expect(parsearListaNumerosMesa("").error).toMatch(/al menos un número/i);
    expect(parsearListaNumerosMesa("   \n , ; ").error).toMatch(/al menos un número/i);
  });

  it("aplica el tope del lote a un rango entero antes de expandirlo", () => {
    const r = parsearListaNumerosMesa(`1-${MAX_MESAS_POR_LOTE + 1}`);
    expect(r.numeros).toEqual([]);
    expect(r.error).toContain(String(MAX_MESAS_POR_LOTE));
    // Un rango disparatado no debe intentar materializarse.
    expect(parsearListaNumerosMesa("1-100000").numeros).toEqual([]);
  });

  it("justo en el tope sí entra", () => {
    const r = parsearListaNumerosMesa(`1-${MAX_MESAS_POR_LOTE}`);
    expect(r.error).toBeNull();
    expect(r.numeros).toHaveLength(MAX_MESAS_POR_LOTE);
  });

  it("el tope se puede ajustar por parámetro, en rangos y en sueltos", () => {
    expect(parsearListaNumerosMesa("1-5", 3).error).toContain("3");
    expect(parsearListaNumerosMesa("1,2,3,4", 3).error).toContain("3");
    expect(parsearListaNumerosMesa("1,2,3", 3).numeros).toEqual(["1", "2", "3"]);
  });

  it("rechaza un nombre absurdamente largo en vez de crear esa mesa", () => {
    const r = parsearListaNumerosMesa("x".repeat(MAX_LARGO_NOMBRE_MESA + 1));
    expect(r.numeros).toEqual([]);
    expect(r.error).toMatch(/demasiado largo/i);
  });

  it("no revienta con basura: la trata como nombre y no deja la lista a medias", () => {
    const r = parsearListaNumerosMesa("???, ---, 5");
    expect(r.error).toBeNull();
    expect(r.numeros).toEqual(["???", "---", "5"]);
  });

  it("aguanta null/undefined como entrada", () => {
    expect(parsearListaNumerosMesa(null as unknown as string).numeros).toEqual([]);
    expect(parsearListaNumerosMesa(undefined as unknown as string).error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

describe("PRESETS_MESA", () => {
  // La razón está en la cabecera de lotesMesa.ts: PlanoEspacio2D.tsx:491 pinta
  // como rectángulo redondeado CUALQUIER forma que no sea "circular".
  it("solo la redonda usa forma circular: el resto son rectangulares", () => {
    const circulares = PRESETS_MESA.filter((p) => p.forma === "circular");
    expect(circulares.map((p) => p.id)).toEqual(["redonda-6p"]);
    expect(PRESETS_MESA.every((p) => p.forma === "circular" || p.forma === "rectangular")).toBe(true);
  });

  it("cubre los tipos que pidió el dueño con su tamaño y capacidad", () => {
    const porId = Object.fromEntries(PRESETS_MESA.map((p) => [p.id, p])) as Record<string, PresetMesa>;
    expect(porId["redonda-6p"]).toMatchObject({ forma: "circular", anchoCm: 150, altoCm: 150, capacidad: 6 });
    expect(porId["cuadrada-4p"]).toMatchObject({ forma: "rectangular", anchoCm: 80, altoCm: 80, capacidad: 4 });
    expect(porId["rect-2p"]).toMatchObject({ forma: "rectangular", anchoCm: 80, altoCm: 80, capacidad: 2 });
    expect(porId["rect-4p"]).toMatchObject({ forma: "rectangular", anchoCm: 120, altoCm: 80, capacidad: 4 });
    expect(porId["banquete-8p"]).toMatchObject({ forma: "rectangular", anchoCm: 240, altoCm: 90, capacidad: 8 });
    expect(porId["barra"]).toMatchObject({ forma: "rectangular", anchoCm: 300, altoCm: 50 });
  });

  it("una cuadrada es un rectángulo con ancho == alto", () => {
    const cuadrada = presetMesaPorId("cuadrada-4p")!;
    expect(cuadrada.anchoCm).toBe(cuadrada.altoCm);
  });

  it("la barra saca su capacidad del largo, no de un número inventado", () => {
    expect(presetMesaPorId("barra")!.capacidad).toBe(capacidadSugeridaBarra(300));
  });

  it("todos los presets caben en los topes que acepta el formulario", () => {
    PRESETS_MESA.forEach((p) => {
      expect(p.capacidad).toBeGreaterThanOrEqual(MIN_CAPACIDAD_MESA);
      expect(p.capacidad).toBeLessThanOrEqual(MAX_CAPACIDAD_MESA);
      expect(p.anchoCm).toBeGreaterThanOrEqual(MIN_LADO_MESA_CM);
      expect(p.anchoCm).toBeLessThanOrEqual(MAX_LADO_MESA_CM);
      expect(p.altoCm).toBeGreaterThanOrEqual(MIN_LADO_MESA_CM);
      expect(p.altoCm).toBeLessThanOrEqual(MAX_LADO_MESA_CM);
    });
  });

  it("el preset por defecto es el mismo tamaño que proponía «Añadir Mesa»", () => {
    expect(PRESET_MESA_POR_DEFECTO).toMatchObject({ forma: "rectangular", anchoCm: 80, altoCm: 80, capacidad: 2 });
  });

  it("los ids no se repiten", () => {
    expect(new Set(PRESETS_MESA.map((p) => p.id)).size).toBe(PRESETS_MESA.length);
  });
});

describe("capacidadSugeridaBarra", () => {
  it("un taburete por cada hueco completo", () => {
    expect(capacidadSugeridaBarra(300)).toBe(5);
    expect(capacidadSugeridaBarra(120)).toBe(2);
  });

  it("nunca baja de una plaza aunque la barra sea minúscula o absurda", () => {
    expect(capacidadSugeridaBarra(59)).toBe(MIN_CAPACIDAD_MESA);
    expect(capacidadSugeridaBarra(0)).toBe(MIN_CAPACIDAD_MESA);
    expect(capacidadSugeridaBarra(-10)).toBe(MIN_CAPACIDAD_MESA);
    expect(capacidadSugeridaBarra(Number.NaN)).toBe(MIN_CAPACIDAD_MESA);
  });

  it("no pasa del tope de capacidad de una mesa", () => {
    expect(capacidadSugeridaBarra(10000)).toBe(MAX_CAPACIDAD_MESA);
  });

  it("la separación por taburete se puede ajustar", () => {
    expect(capacidadSugeridaBarra(300, 50)).toBe(6);
    expect(capacidadSugeridaBarra(300, 0)).toBe(MIN_CAPACIDAD_MESA);
  });
});

describe("medidasMesaTexto", () => {
  it("una circular se describe por su diámetro", () => {
    expect(medidasMesaTexto("circular", 150, 150)).toBe("Ø150 cm");
  });

  it("una rectangular, por ancho × largo", () => {
    expect(medidasMesaTexto("rectangular", 120, 80)).toBe("120×80 cm");
  });
});

describe("presetMesaPorId / presetMesaQueEncaja", () => {
  it("encuentra el preset por id y devuelve null con un id que no existe", () => {
    expect(presetMesaPorId("redonda-6p")?.capacidad).toBe(6);
    expect(presetMesaPorId("no-existe")).toBeNull();
    expect(presetMesaPorId(null)).toBeNull();
  });

  it("reconoce una mesa que encaja exactamente con un preset", () => {
    expect(presetMesaQueEncaja({ forma: "circular", anchoCm: 150, altoCm: 150, capacidad: 6 })?.id).toBe("redonda-6p");
    // Mismo tamaño, distinta capacidad: es otro preset distinto.
    expect(presetMesaQueEncaja({ forma: "rectangular", anchoCm: 80, altoCm: 80, capacidad: 4 })?.id).toBe("cuadrada-4p");
    expect(presetMesaQueEncaja({ forma: "rectangular", anchoCm: 80, altoCm: 80, capacidad: 2 })?.id).toBe("rect-2p");
  });

  it("una mesa retocada a mano no encaja con ninguno", () => {
    expect(presetMesaQueEncaja({ forma: "rectangular", anchoCm: 95, altoCm: 80, capacidad: 3 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Normalizadores de los campos
// ---------------------------------------------------------------------------

describe("normalizarCapacidadMesa", () => {
  it("recorta a los topes y redondea", () => {
    expect(normalizarCapacidadMesa(0)).toBe(MIN_CAPACIDAD_MESA);
    expect(normalizarCapacidadMesa(-4)).toBe(MIN_CAPACIDAD_MESA);
    expect(normalizarCapacidadMesa(99)).toBe(MAX_CAPACIDAD_MESA);
    expect(normalizarCapacidadMesa(3.6)).toBe(4);
    expect(normalizarCapacidadMesa(6)).toBe(6);
  });

  it("un campo vacío o con basura no deja una capacidad NaN en la base", () => {
    expect(normalizarCapacidadMesa("")).toBe(MIN_CAPACIDAD_MESA);
    expect(normalizarCapacidadMesa("abc")).toBe(MIN_CAPACIDAD_MESA);
    expect(normalizarCapacidadMesa(null)).toBe(MIN_CAPACIDAD_MESA);
    expect(normalizarCapacidadMesa(undefined)).toBe(MIN_CAPACIDAD_MESA);
  });

  it("lee un número escrito como texto (lo que da un input)", () => {
    expect(normalizarCapacidadMesa("8")).toBe(8);
  });
});

describe("normalizarLadoMesaCm", () => {
  it("recorta a los topes del formulario", () => {
    expect(normalizarLadoMesaCm(10)).toBe(MIN_LADO_MESA_CM);
    expect(normalizarLadoMesaCm(9999)).toBe(MAX_LADO_MESA_CM);
    expect(normalizarLadoMesaCm(120)).toBe(120);
  });

  it("con basura usa el valor por defecto que le pasen", () => {
    expect(normalizarLadoMesaCm("abc")).toBe(80);
    expect(normalizarLadoMesaCm(null, 150)).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Filas del lote
// ---------------------------------------------------------------------------

const REDONDA = presetMesaPorId("redonda-6p")!;
const RECT4 = presetMesaPorId("rect-4p")!;

describe("filasLoteDesdeNombres", () => {
  it("crea una fila por número con los valores del preset", () => {
    const filas = filasLoteDesdeNombres(["1", "2"], REDONDA);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      nombre: "1",
      forma: "circular",
      anchoCm: 150,
      altoCm: 150,
      capacidad: 6,
      presetId: "redonda-6p",
    });
  });

  it("usa el preset por defecto si no se pasa ninguno", () => {
    expect(filasLoteDesdeNombres(["1"])[0].presetId).toBe(PRESET_MESA_POR_DEFECTO.id);
  });

  it("las claves de React nunca se repiten, ni con nombres iguales", () => {
    const filas = filasLoteDesdeNombres(["1", "1", "1"]);
    expect(new Set(filas.map((f) => f.clave)).size).toBe(3);
  });

  it("aguanta una lista vacía o nula", () => {
    expect(filasLoteDesdeNombres([])).toEqual([]);
    expect(filasLoteDesdeNombres(null as unknown as string[])).toEqual([]);
  });
});

describe("anadirNombresAlLote", () => {
  it("añade los nuevos sin tocar lo que ya se había ajustado", () => {
    const previas = aplicarCapacidadAFilas(filasLoteDesdeNombres(["1", "2"], RECT4), 5);
    const r = anadirNombresAlLote(previas, ["3"], REDONDA);
    expect(r.anadidas).toBe(1);
    expect(r.filas).toHaveLength(3);
    // Las dos primeras conservan su capacidad retocada a mano.
    expect(r.filas[0].capacidad).toBe(5);
    expect(r.filas[1].capacidad).toBe(5);
    expect(r.filas[2]).toMatchObject({ nombre: "3", forma: "circular", capacidad: 6 });
  });

  it("no duplica un número que ya está en la lista y lo dice", () => {
    const previas = filasLoteDesdeNombres(["1", "2"]);
    const r = anadirNombresAlLote(previas, ["2", "3"]);
    expect(r.anadidas).toBe(1);
    expect(r.yaEstaban).toEqual(["2"]);
    expect(r.filas.map((f) => f.nombre)).toEqual(["1", "2", "3"]);
  });

  it("compara como Postgres al deduplicar (espacios y mayúsculas)", () => {
    const r = anadirNombresAlLote(filasLoteDesdeNombres(["T1"]), [" t1 "]);
    expect(r.anadidas).toBe(0);
    expect(r.filas).toHaveLength(1);
  });

  it("se planta en el tope del lote y dice cuántos han quedado fuera", () => {
    const previas = filasLoteDesdeNombres(["1", "2"]);
    const r = anadirNombresAlLote(previas, ["3", "4", "5"], PRESET_MESA_POR_DEFECTO, 3);
    expect(r.filas).toHaveLength(3);
    expect(r.anadidas).toBe(1);
    expect(r.error).toContain("3");
    expect(r.error).toMatch(/fuera/i);
  });

  it("las claves siguen siendo únicas al mezclar tandas", () => {
    const r = anadirNombresAlLote(filasLoteDesdeNombres(["1"]), ["2", "3"]);
    expect(new Set(r.filas.map((f) => f.clave)).size).toBe(3);
  });

  it("aguanta listas vacías o nulas", () => {
    expect(anadirNombresAlLote([], []).filas).toEqual([]);
    expect(anadirNombresAlLote(null as unknown as [], null as unknown as string[]).anadidas).toBe(0);
  });
});

describe("aplicarPresetAFilas / aplicarPresetAFila", () => {
  it("aplica el tipo a TODAS las filas de golpe", () => {
    const filas = aplicarPresetAFilas(filasLoteDesdeNombres(["1", "2", "3"]), REDONDA);
    expect(filas.every((f) => f.forma === "circular" && f.capacidad === 6 && f.presetId === "redonda-6p")).toBe(true);
  });

  it("aplica el tipo a una sola fila y deja el resto igual", () => {
    const base = filasLoteDesdeNombres(["1", "2"]);
    const filas = aplicarPresetAFila(base, base[1].clave, REDONDA);
    expect(filas[0]).toEqual(base[0]);
    expect(filas[1]).toMatchObject({ forma: "circular", anchoCm: 150, altoCm: 150, capacidad: 6 });
  });

  it("no revienta con una clave que no existe", () => {
    const base = filasLoteDesdeNombres(["1"]);
    expect(aplicarPresetAFila(base, "no-existe", REDONDA)).toEqual(base);
  });
});

describe("aplicarCapacidadAFilas", () => {
  it("pone la misma capacidad en todas sin tocar forma ni tamaño", () => {
    const filas = aplicarCapacidadAFilas(filasLoteDesdeNombres(["1", "2"], RECT4), 6);
    expect(filas.map((f) => f.capacidad)).toEqual([6, 6]);
    expect(filas.every((f) => f.anchoCm === 120 && f.altoCm === 80)).toBe(true);
  });

  it("recorta una capacidad imposible en vez de guardarla", () => {
    expect(aplicarCapacidadAFilas(filasLoteDesdeNombres(["1"]), 999)[0].capacidad).toBe(MAX_CAPACIDAD_MESA);
  });

  it("deja de estar ligada a un preset si la capacidad ya no encaja", () => {
    const filas = aplicarCapacidadAFilas(filasLoteDesdeNombres(["1"], RECT4), 7);
    expect(filas[0].presetId).toBeNull();
  });

  it("vuelve a reconocer el preset si la capacidad coincide de nuevo", () => {
    const filas = aplicarCapacidadAFilas(filasLoteDesdeNombres(["1"], RECT4), 2);
    // 120×80 con 2 plazas no es ningún preset -> personalizada.
    expect(filas[0].presetId).toBeNull();
    const vuelta = aplicarCapacidadAFilas(filas, 4);
    expect(vuelta[0].presetId).toBe("rect-4p");
  });
});

describe("actualizarFilaLote", () => {
  it("cambia el número de una fila sin tocar su clave (el campo no se remonta)", () => {
    const base = filasLoteDesdeNombres(["1"]);
    const filas = actualizarFilaLote(base, base[0].clave, { nombre: "7" });
    expect(filas[0].nombre).toBe("7");
    expect(filas[0].clave).toBe(base[0].clave);
  });

  it("una circular mantiene ancho y alto iguales (es un diámetro)", () => {
    const base = filasLoteDesdeNombres(["1"]);
    const filas = actualizarFilaLote(base, base[0].clave, { forma: "circular", anchoCm: 140 });
    expect(filas[0].altoCm).toBe(140);
  });

  it("al retocar a mano deja de estar ligada a un preset", () => {
    const base = filasLoteDesdeNombres(["1"]);
    expect(base[0].presetId).toBe("rect-2p");
    const filas = actualizarFilaLote(base, base[0].clave, { anchoCm: 95 });
    expect(filas[0].presetId).toBeNull();
  });

  it("no toca las demás filas", () => {
    const base = filasLoteDesdeNombres(["1", "2"]);
    const filas = actualizarFilaLote(base, base[0].clave, { capacidad: 9 });
    expect(filas[1]).toEqual(base[1]);
  });
});

describe("quitarFilaLote / resumenFilasLote", () => {
  it("quita solo la fila pedida", () => {
    const base = filasLoteDesdeNombres(["1", "2", "3"]);
    expect(quitarFilaLote(base, base[1].clave).map((f) => f.nombre)).toEqual(["1", "3"]);
  });

  it("suma las plazas del lote para poder enseñar el aforo que se va a crear", () => {
    const filas = [
      ...filasLoteDesdeNombres(["1", "2"], RECT4),
      ...filasLoteDesdeNombres(["T1"], REDONDA),
    ];
    expect(resumenFilasLote(filas)).toEqual({ total: 3, plazas: 4 + 4 + 6, circulares: 1 });
  });

  it("una lista vacía suma cero", () => {
    expect(resumenFilasLote([])).toEqual({ total: 0, plazas: 0, circulares: 0 });
  });
});

// ---------------------------------------------------------------------------
// Resultado del alta
// ---------------------------------------------------------------------------

describe("esNumeroDeMesaRepetido", () => {
  it("reconoce el 23505 de Postgres", () => {
    expect(esNumeroDeMesaRepetido({ code: "23505" })).toBe(true);
  });

  it("reconoce el nombre del índice en el texto del error", () => {
    expect(
      esNumeroDeMesaRepetido({
        message: 'duplicate key value violates unique constraint "uq_mesas_espacio_nombre_real"',
      }),
    ).toBe(true);
    expect(esNumeroDeMesaRepetido({ details: "Key ... uq_mesas_espacio_nombre_real ..." })).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(esNumeroDeMesaRepetido({ code: "42703", message: "column does not exist" })).toBe(false);
    expect(esNumeroDeMesaRepetido(null)).toBe(false);
    expect(esNumeroDeMesaRepetido("boom")).toBe(false);
    expect(esNumeroDeMesaRepetido(undefined)).toBe(false);
  });
});

describe("motivoFalloAltaMesa", () => {
  it("traduce el choque del índice a algo que el dueño entiende", () => {
    expect(motivoFalloAltaMesa({ code: "23505" })).toBe(MOTIVO_NUMERO_REPETIDO);
  });

  it("cualquier otro fallo no destripa el error de Supabase", () => {
    expect(motivoFalloAltaMesa(new Error("network"))).toBe(MOTIVO_FALLO_GENERICO);
  });
});

describe("resumenAltaLoteMesas", () => {
  it("sin resultados no inventa nada", () => {
    const r = resumenAltaLoteMesas([]);
    expect(r.hayFallos).toBe(false);
    expect(r.creadas).toEqual([]);
    expect(r.mensaje).toMatch(/ninguna mesa que crear/i);
  });

  it("todo bien, una sola mesa", () => {
    const r = resumenAltaLoteMesas([{ nombre: "7", ok: true }]);
    expect(r.hayFallos).toBe(false);
    expect(r.mensaje).toBe("Se ha creado 1 mesa: 7.");
  });

  it("todo bien, varias mesas", () => {
    const r = resumenAltaLoteMesas([
      { nombre: "1", ok: true },
      { nombre: "2", ok: true },
      { nombre: "3", ok: true },
    ]);
    expect(r.mensaje).toBe("Se han creado 3 mesas: 1, 2, 3.");
  });

  // Este es el caso que antes dejaba al dueño adivinando: el alta paraba en el
  // primer fallo y no decía cuáles faltaban.
  it("con fallos dice cuántas se crearon, cuáles no y por qué", () => {
    const r = resumenAltaLoteMesas([
      { nombre: "12", ok: true },
      { nombre: "13", ok: false, motivo: MOTIVO_NUMERO_REPETIDO },
      { nombre: "14", ok: false, motivo: MOTIVO_NUMERO_REPETIDO },
    ]);
    expect(r.hayFallos).toBe(true);
    expect(r.creadas).toEqual(["12"]);
    expect(r.fallidas).toEqual([
      { nombre: "13", motivo: MOTIVO_NUMERO_REPETIDO },
      { nombre: "14", motivo: MOTIVO_NUMERO_REPETIDO },
    ]);
    expect(r.mensaje).toContain("Se han creado 1 de 3 mesas");
    expect(r.mensaje).toContain("13, 14");
    expect(r.mensaje).toContain(MOTIVO_NUMERO_REPETIDO);
    expect(r.mensaje).toMatch(/vuelvas a intentar/i);
  });

  it("agrupa los fallos por motivo en vez de repetirlo mesa a mesa", () => {
    const r = resumenAltaLoteMesas([
      { nombre: "1", ok: true },
      { nombre: "2", ok: false, motivo: MOTIVO_NUMERO_REPETIDO },
      { nombre: "3", ok: false, motivo: MOTIVO_FALLO_GENERICO },
      { nombre: "4", ok: false, motivo: MOTIVO_NUMERO_REPETIDO },
    ]);
    expect(r.mensaje).toContain(`${MOTIVO_NUMERO_REPETIDO}: 2, 4`);
    expect(r.mensaje).toContain(`${MOTIVO_FALLO_GENERICO}: 3`);
  });

  it("si no se creó ninguna lo dice sin fingir éxito parcial", () => {
    const r = resumenAltaLoteMesas([
      { nombre: "1", ok: false, motivo: MOTIVO_NUMERO_REPETIDO },
      { nombre: "2", ok: false, motivo: MOTIVO_NUMERO_REPETIDO },
    ]);
    expect(r.creadas).toEqual([]);
    expect(r.mensaje).toMatch(/no se ha podido crear ninguna mesa/i);
    expect(r.mensaje).toContain("1, 2");
  });

  it("un fallo sin motivo cae en el genérico y no deja el mensaje a medias", () => {
    const r = resumenAltaLoteMesas([{ nombre: "9", ok: false }]);
    expect(r.fallidas[0].motivo).toBe(MOTIVO_FALLO_GENERICO);
    expect(r.mensaje).toContain("9");
  });

  it("con muchas mesas resume en vez de escupir 40 números", () => {
    const resultados = Array.from({ length: 20 }, (_, i) => ({ nombre: String(i + 1), ok: true }));
    const r = resumenAltaLoteMesas(resultados);
    expect(r.creadas).toHaveLength(20);
    expect(r.mensaje).toContain("Se han creado 20 mesas");
    expect(r.mensaje).toMatch(/y 8 más/);
  });

  it("aguanta null y filas nulas dentro de los resultados", () => {
    const r = resumenAltaLoteMesas([null as never, { nombre: "1", ok: true }]);
    expect(r.creadas).toEqual(["1"]);
  });
});

// ---------------------------------------------------------------------------
// "No cabía en el plano": el alta en lote lo cuenta como fallo en vez de
// colocar la mesa encima de otra o partida por una pared.
// ---------------------------------------------------------------------------

describe("resumenAltaLoteMesas con mesas que no caben", () => {
  it("agrupa las que se quedaron sin sitio con su propio motivo", () => {
    const r = resumenAltaLoteMesas([
      { nombre: "1", ok: true },
      { nombre: "2", ok: true },
      { nombre: "3", ok: false, motivo: MOTIVO_SIN_SITIO },
      { nombre: "4", ok: false, motivo: MOTIVO_SIN_SITIO },
    ]);
    expect(r.hayFallos).toBe(true);
    expect(r.creadas).toEqual(["1", "2"]);
    expect(r.fallidas).toEqual([
      { nombre: "3", motivo: MOTIVO_SIN_SITIO },
      { nombre: "4", motivo: MOTIVO_SIN_SITIO },
    ]);
    expect(r.mensaje).toContain(`${MOTIVO_SIN_SITIO}: 3, 4`);
  });

  it("distingue 'no cabe' de 'número repetido' en el mismo lote", () => {
    const r = resumenAltaLoteMesas([
      { nombre: "5", ok: false, motivo: MOTIVO_SIN_SITIO },
      { nombre: "6", ok: false, motivo: MOTIVO_NUMERO_REPETIDO },
    ]);
    expect(r.mensaje).toContain(`${MOTIVO_SIN_SITIO}: 5`);
    expect(r.mensaje).toContain(`${MOTIVO_NUMERO_REPETIDO}: 6`);
  });

  it("si no cabe ninguna lo dice sin fingir que se creó algo", () => {
    const r = resumenAltaLoteMesas([
      { nombre: "1", ok: false, motivo: MOTIVO_SIN_SITIO },
      { nombre: "2", ok: false, motivo: MOTIVO_SIN_SITIO },
    ]);
    expect(r.creadas).toEqual([]);
    expect(r.mensaje).toContain("No se ha podido crear ninguna mesa");
    expect(r.mensaje).toContain(MOTIVO_SIN_SITIO);
  });

  it("el motivo se lee dentro de la frase, en minúsculas", () => {
    expect(MOTIVO_SIN_SITIO).toBe(MOTIVO_SIN_SITIO.toLowerCase());
    expect(MOTIVO_SIN_SITIO).not.toBe(MOTIVO_FALLO_GENERICO);
  });
});
