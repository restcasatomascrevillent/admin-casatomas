// Validación de piezas: los mismos casos que el prototipo instagram-studio
// (tests/esquema.test.ts), adaptados a validarPieza síncrona { ok, … }.
import { describe, expect, it } from "vitest";
import { contarPalabras, emojisEn, validarPieza, type OpcionesValidacion } from "../esquema";
import { problemasDePlantilla } from "../plantillas";
import type { Plantilla } from "../tipos";
import { plantillaPrueba } from "./fixtures/plantilla-prueba";

const PRUEBAS: Record<string, Plantilla> = {
  "prueba-casa-tomas": plantillaPrueba("casa-tomas"),
  "prueba-touza": plantillaPrueba("touza"),
};
const opciones: OpcionesValidacion = { buscarPlantilla: (id: string) => PRUEBAS[id] };

const base = {
  marca: "casa-tomas",
  plantilla: "prueba-casa-tomas",
  formato: "post",
  foto: "ct-salon-1",
  antetitulo: "Cocina gallega",
  titular: "Pulpo á feira",
  cta: "Reservar mesa",
};

/** Problemas de la validación ([] si pasa). */
function problemas(json: unknown, opts: OpcionesValidacion = opciones): string[] {
  const r = validarPieza(json, opts);
  return r.ok ? [] : r.problemas;
}

describe("reglas sueltas", () => {
  it("cuenta palabras sin «·» ni guiones sueltos", () => {
    expect(contarPalabras("Jueves · Viernes – Sábado")).toBe(3);
    expect(contarPalabras("  uno   dos\ttres ")).toBe(3);
    expect(contarPalabras("bien-hecho")).toBe(1);
  });
  it("detecta emojis y deja pasar la tipografía", () => {
    expect(emojisEn("Hola 🍷")).toEqual(["🍷"]);
    expect(emojisEn("Corazón ❤️")).toHaveLength(1);
    expect(emojisEn("Bandera 🇪🇸")).not.toHaveLength(0);
    expect(emojisEn("Cocina gallega · Jue–Sáb · 20:00 © Casa Tomás")).toEqual([]);
  });
});

describe("validarPieza", () => {
  it("acepta una pieza válida y recorta espacios", () => {
    const r = validarPieza({ ...base, titular: "  Pulpo á feira  " }, opciones);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.titular).toBe("Pulpo á feira");
    expect(r.datos).not.toHaveProperty("pie");
  });

  it("rechaza un titular de 7 palabras", () => {
    expect(problemas({ ...base, titular: "uno dos tres cuatro cinco seis siete" }).join("\n")).toMatch(/titular tiene 7 palabras/);
  });

  it("no cuenta «·» ni guiones como palabras", () => {
    expect(problemas({ ...base, titular: "Jueves · Viernes — Sábado y Domingo noche" })).toEqual([]);
  });

  it("rechaza emojis en cualquier campo", () => {
    expect(problemas({ ...base, cta: "Reserva 🍷" }).join("\n")).toMatch(/«cta» lleva emojis/);
  });

  it("rechaza una foto de la otra marca", () => {
    expect(problemas({ ...base, foto: "touza-7" }).join("\n")).toMatch(/touza-7.*Touza Cocktail Bar.*su marca/);
  });

  it("rechaza un campo que la plantilla no usa", () => {
    expect(problemas({ ...base, pie: "Crevillente" })).toContain("La plantilla «prueba-casa-tomas» no usa el campo «pie»: quítalo");
  });

  it("rechaza un campo desconocido", () => {
    expect(problemas({ ...base, subtitulo: "x" }).join("\n")).toMatch(/Campo desconocido «subtitulo»/);
  });

  it("rechaza en story una foto que habría que ampliar más de un 5 %", () => {
    expect(problemas({ ...base, formato: "story", foto: "ct-salon-1" }).join("\n")).toMatch(/ct-salon-1.*ampliarse un 37 %.*story/);
    // La misma foto vale para post (1050×1400 → 2,9 %).
    expect(problemas({ ...base, foto: "ct-salon-1" })).toEqual([]);
  });

  it("rechaza una foto que no está en el catálogo", () => {
    expect(problemas({ ...base, foto: "no-existe" }).join("\n")).toMatch(/«no-existe» no está en el catálogo de fotos/);
  });

  it("rechaza un tipo de foto que la plantilla no admite", () => {
    const pl: Plantilla = { ...plantillaPrueba(), tiposFoto: ["plato"] };
    expect(problemas(base, { buscarPlantilla: () => pl }).join("\n")).toMatch(/tipo «sala».*solo admite: plato/);
  });

  it("aplica obligatorios, límites, marca y formato de la plantilla", () => {
    const pl: Plantilla = { ...plantillaPrueba(), formatos: ["post"], obligatorios: ["cta"] };
    const todo = problemas(
      { ...base, marca: "touza", formato: "story", foto: undefined, cta: undefined, antetitulo: "x".repeat(41) },
      { buscarPlantilla: () => pl },
    ).join("\n");
    expect(todo).toMatch(/es de Restaurante Casa Tomás y la pieza es de Touza/);
    expect(todo).toMatch(/no tiene formato story/);
    expect(todo).toMatch(/necesita el campo «cta»/);
    expect(todo).toMatch(/«antetitulo» tiene 41 caracteres; máximo 40/);
  });

  it("rechaza una plantilla que no existe (registro real) y dice cuáles hay", () => {
    expect(problemas({ ...base, plantilla: "no-existe" }, {}).join("\n")).toMatch(
      /La plantilla «no-existe» no existe\. Disponibles: ct-foto-titular, ct-tipografica, tz-foto-titular, tz-tipografica/,
    );
  });

  it("lista TODOS los problemas a la vez", () => {
    expect(problemas({ ...base, titular: "uno dos tres cuatro cinco seis siete 🍷", foto: "touza-7", pie: "x" }).length).toBeGreaterThanOrEqual(4);
  });

  it("da mensajes claros si falta el titular o el formato es raro", () => {
    const { titular: _t, ...sinTitular } = base;
    const p = problemas({ ...sinTitular, formato: "reel" });
    expect(p).toContain("Falta el campo obligatorio «titular»");
    expect(p.join("\n")).toMatch(/«formato» debe ser uno de: post, story/);
  });

  it("no lanza con entradas raras", () => {
    for (const malo of [null, undefined, 3, "x", [], [base]]) {
      const r = validarPieza(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problemas.length).toBeGreaterThan(0);
    }
  });
});

describe("campo «cita» (lema sin límite de palabras)", () => {
  const LEMA = "Nunca é longo o camiño que conduce á casa dun amigo.";
  const ct = { marca: "casa-tomas", plantilla: "ct-tipografica", formato: "post", antetitulo: "Desde 1998" };

  it('acepta en ct-tipografica una cita de 11 palabras sin titular (titular → "")', () => {
    expect(contarPalabras(LEMA)).toBe(11);
    const r = validarPieza({ ...ct, cita: `  ${LEMA}  ` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.cita).toBe(LEMA);
    expect(r.datos.titular).toBe("");
  });

  it("acepta en ct-tipografica titular y cita a la vez, y solo titular", () => {
    const r = validarPieza({ ...ct, titular: "Nuestro lema", cita: LEMA });
    expect(r.ok && [r.datos.titular, r.datos.cita]).toEqual(["Nuestro lema", LEMA]);
    const solo = validarPieza({ ...ct, titular: "De padres a hijos" });
    expect(solo.ok && solo.datos).not.toHaveProperty("cita");
  });

  it("ct-tipografica sin titular ni cita → error claro", () => {
    expect(problemas(ct, {})).toContain("La plantilla «ct-tipografica» necesita un «titular» o una «cita» (al menos uno de los dos)");
  });

  it("el titular de 7 palabras se sigue rechazando en todas partes (también con cita)", () => {
    const siete = "uno dos tres cuatro cinco seis siete";
    expect(problemas({ ...ct, titular: siete, cita: LEMA }, {}).join("\n")).toMatch(/titular tiene 7 palabras/);
    expect(problemas({ ...base, titular: siete }).join("\n")).toMatch(/titular tiene 7 palabras/);
  });

  it("una cita en una plantilla que no la admite → «no usa el campo»", () => {
    expect(problemas({ ...base, cita: LEMA })).toContain("La plantilla «prueba-casa-tomas» no usa el campo «cita»: quítalo");
  });

  it("sin titularOpcional, el titular sigue siendo obligatorio aunque haya cita", () => {
    const { titular: _t, ...sinTitular } = base;
    const p = problemas({ ...sinTitular, cita: LEMA });
    expect(p).toContain("Falta el campo obligatorio «titular»");
    expect(p).toContain("La plantilla «prueba-casa-tomas» no usa el campo «cita»: quítalo");
  });

  it("cita por encima del límite de caracteres (70) → error", () => {
    const larga = `${LEMA} E nunca é curto o tempo que pasamos á mesa.`;
    expect(problemas({ ...ct, cita: larga }, {}).join("\n")).toMatch(
      new RegExp(`«cita» tiene ${[...larga].length} caracteres; máximo 70 en «ct-tipografica»`),
    );
  });

  it("cita con emojis → error", () => {
    expect(problemas({ ...ct, cita: "Nunca é longo o camiño 🍷" }, {}).join("\n")).toMatch(/«cita» lleva emojis/);
  });

  it("cita vacía → error de campo vacío", () => {
    expect(problemas({ ...ct, cita: "   " }, {}).join("\n")).toMatch(/«cita» está vacío/);
  });

  it("si la forma falla, el mensaje del titular ausente respeta titularOpcional", () => {
    const p = problemas({ ...ct, formato: "reel" }, {});
    expect(p.join("\n")).toMatch(/necesita un «titular» o una «cita»/);
    expect(p).not.toContain("Falta el campo obligatorio «titular»");
  });
});

describe("contrato: titularOpcional", () => {
  it("debe ser booleano y exige admitir «cita»", () => {
    const pl = plantillaPrueba();
    expect(problemasDePlantilla({ ...pl, id: "x", titularOpcional: "sí" }).join("\n")).toMatch(/«titularOpcional» debe ser true o false/);
    expect(problemasDePlantilla({ ...pl, id: "x", titularOpcional: true }).join("\n")).toMatch(/debe admitir «cita»/);
    expect(problemasDePlantilla({ ...pl, id: "x", titularOpcional: true, admitidos: [...pl.admitidos, "cita"] })).toEqual([]);
  });
});
