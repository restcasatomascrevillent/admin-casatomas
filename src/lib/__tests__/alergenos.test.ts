import { describe, expect, it } from "vitest";
import {
  ALERGENOS_OFICIALES,
  combinarAlergenos,
  esAlergenoOficial,
  etiquetaAlergeno,
  normalizarAlergeno,
  parseAlergenos,
  separarAlergenos,
} from "@/lib/alergenos";

describe("normalizarAlergeno", () => {
  it("reconoce los IDs snake_case que usaba el panel", () => {
    expect(normalizarAlergeno("crustaceos")).toBe("crustáceos");
    expect(normalizarAlergeno("frutos_cascara")).toBe("frutos de cáscara");
    expect(normalizarAlergeno("huevo")).toBe("huevos");
    expect(normalizarAlergeno("sesamo")).toBe("sésamo");
    expect(normalizarAlergeno("lacteos")).toBe("lácteos");
  });

  it("reconoce las etiquetas con acentos que hay en la base de datos", () => {
    expect(normalizarAlergeno("crustáceos")).toBe("crustáceos");
    expect(normalizarAlergeno("frutos de cáscara")).toBe("frutos de cáscara");
    expect(normalizarAlergeno("huevos")).toBe("huevos");
    expect(normalizarAlergeno("sésamo")).toBe("sésamo");
  });

  it("tolera mayúsculas, espacios sobrantes y guiones", () => {
    expect(normalizarAlergeno("  GLUTEN  ")).toBe("gluten");
    expect(normalizarAlergeno("Frutos-Cascara")).toBe("frutos de cáscara");
    expect(normalizarAlergeno("Frutos   De   Cáscara")).toBe("frutos de cáscara");
  });

  it("tolera singular y plural", () => {
    expect(normalizarAlergeno("molusco")).toBe("moluscos");
    expect(normalizarAlergeno("moluscos")).toBe("moluscos");
    expect(normalizarAlergeno("altramuz")).toBe("altramuces");
    expect(normalizarAlergeno("altramuces")).toBe("altramuces");
    expect(normalizarAlergeno("cacahuete")).toBe("cacahuetes");
    expect(normalizarAlergeno("cacahuetes")).toBe("cacahuetes");
  });

  it("los 14 valores canónicos se reconocen a sí mismos", () => {
    for (const { id } of ALERGENOS_OFICIALES) {
      expect(normalizarAlergeno(id)).toBe(id);
    }
  });

  it("las 14 etiquetas de la interfaz se reconocen", () => {
    for (const { id, label } of ALERGENOS_OFICIALES) {
      expect(normalizarAlergeno(label)).toBe(id);
    }
  });

  it("deja fuera lo que no es alérgeno oficial", () => {
    expect(normalizarAlergeno("alcohol")).toBeNull();
    expect(normalizarAlergeno("carne")).toBeNull();
    // `marisco` se deja a propósito sin mapear: en castellano cubre a la vez
    // crustáceos y moluscos y decidirlo no le toca al código.
    expect(normalizarAlergeno("marisco")).toBeNull();
    expect(normalizarAlergeno("")).toBeNull();
    expect(normalizarAlergeno(null)).toBeNull();
    expect(normalizarAlergeno(42)).toBeNull();
  });

  it("esAlergenoOficial acompaña a normalizarAlergeno", () => {
    expect(esAlergenoOficial("Crustaceos")).toBe(true);
    expect(esAlergenoOficial("alcohol")).toBe(false);
  });
});

describe("etiquetaAlergeno", () => {
  it("devuelve la etiqueta bonita venga como venga el dato guardado", () => {
    expect(etiquetaAlergeno("frutos_cascara")).toBe("Frutos de cáscara");
    expect(etiquetaAlergeno("frutos de cáscara")).toBe("Frutos de cáscara");
    expect(etiquetaAlergeno("huevo")).toBe("Huevos");
  });

  it("deja tal cual los personalizados", () => {
    expect(etiquetaAlergeno("alcohol")).toBe("alcohol");
    expect(etiquetaAlergeno("marisco")).toBe("marisco");
  });
});

describe("parseAlergenos", () => {
  it("lee arrays de texto", () => {
    expect(parseAlergenos(["gluten", " apio "])).toEqual(["gluten", "apio"]);
  });

  it("lee el formato objeto { gluten: true, apio: false }", () => {
    expect(parseAlergenos({ gluten: true, apio: false, soja: 1 })).toEqual(["gluten", "soja"]);
  });

  it("lee un array serializado como texto JSON", () => {
    expect(parseAlergenos('["gluten","soja"]')).toEqual(["gluten", "soja"]);
  });

  it("acepta un texto suelto y descarta lo vacío o inesperado", () => {
    expect(parseAlergenos("gluten")).toEqual(["gluten"]);
    expect(parseAlergenos("")).toEqual([]);
    expect(parseAlergenos(null)).toEqual([]);
    expect(parseAlergenos(7)).toEqual([]);
  });
});

describe("separarAlergenos", () => {
  it("marca las casillas oficiales con los datos reales de la base de datos", () => {
    const { oficiales, personalizados } = separarAlergenos([
      "crustáceos",
      "frutos de cáscara",
      "huevos",
      "sésamo",
      "alcohol",
      "marisco",
    ]);

    expect(oficiales).toEqual(["crustáceos", "frutos de cáscara", "huevos", "sésamo"]);
    expect(personalizados).toEqual(["alcohol", "marisco"]);
  });

  it("colapsa las dos formas del mismo alérgeno en una sola casilla", () => {
    const { oficiales, personalizados } = separarAlergenos([
      "crustaceos",
      "crustáceos",
      "Crustáceos",
    ]);

    expect(oficiales).toEqual(["crustáceos"]);
    expect(personalizados).toEqual([]);
  });

  it("no repite personalizados que solo difieren en mayúsculas o acentos", () => {
    const { personalizados } = separarAlergenos(["Alcohol", "alcohol", "ALCOHOL"]);
    expect(personalizados).toEqual(["Alcohol"]);
  });
});

describe("combinarAlergenos", () => {
  it("guarda siempre la forma canónica", () => {
    expect(combinarAlergenos(["crustaceos", "frutos_cascara"])).toEqual([
      "crustáceos",
      "frutos de cáscara",
    ]);
  });

  it("no crea duplicados aunque entren las dos formas", () => {
    expect(combinarAlergenos(["crustáceos"], ["crustaceos", "Crustaceos"])).toEqual([
      "crustáceos",
    ]);
  });

  it("recoloca como oficial lo que se escribió a mano en el campo libre", () => {
    expect(combinarAlergenos([], ["Huevo"])).toEqual(["huevos"]);
  });

  it("respeta los personalizados y descarta lo vacío", () => {
    expect(combinarAlergenos(["gluten"], ["alcohol", "   ", ""])).toEqual(["gluten", "alcohol"]);
  });

  it("es idempotente: normalizar lo ya normalizado no cambia nada", () => {
    const una = combinarAlergenos(["crustaceos", "huevo"], ["marisco"]);
    expect(combinarAlergenos(una)).toEqual(una);
  });
});
