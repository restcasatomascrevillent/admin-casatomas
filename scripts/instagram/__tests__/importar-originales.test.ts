// @vitest-environment node
import { describe, expect, it } from "vitest";
import { csvSugerencias, filasParaSubir, leerCsv, palabras, platosDeJson, sugerir } from "../importar-originales.mjs";

const PLATOS = [
  { id: "p-chuleton", nombre: "Chuletón ternera", categoria: "CARNES", conFoto: true },
  { id: "p-tartar", nombre: "Tartar de atún rojo", categoria: "ENTRANTES FRÍOS", conFoto: true },
  { id: "p-tarta", nombre: "Tarta Santiago", categoria: "POSTRES", conFoto: true },
  { id: "p-ostras", nombre: "Ostras gallegas", categoria: "MARISCO", conFoto: true },
  { id: "p-salazon", nombre: "E. Salazones", categoria: "ENTRANTES", conFoto: true },
];

describe("importar-originales · --sugerir", () => {
  it("palabras sin tildes, plurales ni palabras vacías", () => {
    expect(palabras("Chuletón de vaca gallega")).toEqual(["chuleton", "vaca", "gallega"]);
    expect(palabras("alcachofas.jpg")).toEqual(["alcachofa", "jpg"]);
  });

  it("empareja por nombre y deja vacío lo que no casa de verdad", () => {
    const s = sugerir(["chuleton.jpg", "tartar-atun.jpg", "steak-tartar.jpg", "vitrina-gallega.jpg", "sala.jpg"], PLATOS);
    const por = Object.fromEntries(s.map((x: { fichero: string; mejor: { plato: { id: string } } | null }) => [x.fichero, x.mejor?.plato.id ?? null]));
    expect(por["chuleton.jpg"]).toBe("p-chuleton");
    expect(por["tartar-atun.jpg"]).toBe("p-tartar");
    // Solo una de dos palabras: no se adivina.
    expect(por["steak-tartar.jpg"]).toBeNull();
    expect(por["vitrina-gallega.jpg"]).toBeNull();
    // «sala» no es «salazones» (prefijo de menos de 5 letras).
    expect(por["sala.jpg"]).toBeNull();
  });

  it("el CSV de sugerencias se vuelve a leer y solo sube las filas con id_plato", () => {
    const csv = csvSugerencias(sugerir(["chuleton.jpg", "nada, raro.jpg"], PLATOS));
    const filas = leerCsv(csv);
    expect(filas[0]).toMatchObject({ id_plato: "p-chuleton", fichero: "chuleton.jpg", tabla: "Platos", foto_en_la_web: "sí" });
    expect(filas[1]).toMatchObject({ id_plato: "", fichero: "nada, raro.jpg" });
    const { validas, problemas } = filasParaSubir(filas);
    expect(validas).toEqual([{ id: "p-chuleton", fichero: "chuleton.jpg", tabla: "Platos" }]);
    expect(problemas).toEqual([]);
  });

  it("rechaza filas peligrosas o mal escritas", () => {
    const { validas, problemas } = filasParaSubir(
      leerCsv("id_plato,fichero,tabla\np1,../secreto.jpg,Platos\np 2,a.jpg,\np3,b.jpg,Cocteles\nv1,c.jpg,Vinos\n"),
    );
    expect(validas).toEqual([{ id: "v1", fichero: "c.jpg", tabla: "Vinos" }]);
    expect(problemas).toHaveLength(3);
  });

  it("lee la salida de `supabase db query` ({ rows }) y un array", () => {
    expect(platosDeJson(JSON.stringify({ rows: [{ id: "p1", nombre: "Ostras", categoria: "X", con_foto: false }, { id: "../x", nombre: "Mal" }] }))).toEqual([
      { id: "p1", nombre: "Ostras", categoria: "X", conFoto: false },
    ]);
    expect(platosDeJson(JSON.stringify([{ id: "p2", nombre: "Flan", imagen_url: "https://x" }]))[0].conFoto).toBe(true);
  });
});
