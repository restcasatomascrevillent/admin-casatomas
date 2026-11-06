import { describe, expect, it } from "vitest";
import { conclusionesClaras, etiquetaGrupo, fraseConclusion, MAX_BARRAS, vistaQueFunciona } from "../vistaQueFunciona";
import { QF_CON_DATOS, QF_POCOS } from "./fixturesQueFunciona";

describe("«Qué funciona» en el panel", () => {
  it("etiquetas en castellano: formato, plantilla con su nombre, día, franja y hashtag", () => {
    expect(etiquetaGrupo("formato", "reel")).toBe("Reel");
    expect(etiquetaGrupo("formato", "story")).toBe("Historia");
    expect(etiquetaGrupo("plantilla", "ct-foto-titular")).not.toBe("ct-foto-titular");
    expect(etiquetaGrupo("tipo_foto", "plato")).toBe("Plato");
    expect(etiquetaGrupo("dia", "miércoles")).toBe("Miércoles");
    expect(etiquetaGrupo("franja", "08-10")).toBe("8–10 h");
    expect(etiquetaGrupo("hashtag", "#cocido")).toBe("#cocido");
  });

  it("frases con datos reales: «Los martes…», «Publicar entre las 12 y las 14 h…»", () => {
    const [formato, , , dia, franja, hashtag] = QF_CON_DATOS.conclusiones;
    expect(fraseConclusion(dia)).toBe("Los martes funcionan mejor: 9 % de interacción en 4 publicaciones, frente al 5,5 % de media.");
    expect(fraseConclusion(franja)).toBe("Publicar entre las 12 y las 14 h funciona mejor: 9 % de interacción en 4 publicaciones, frente al 5,5 % de media.");
    expect(fraseConclusion(formato)).toMatch(/^Los reels funcionan mejor: 9 %/);
    expect(fraseConclusion(hashtag)).toMatch(/^Las publicaciones con #cocido funcionan mejor/);
    expect(fraseConclusion({ eje: "dia", estado: "mejor", clave: "sábado", publicaciones: 1, tasa: 7, texto: "" })).toBe(
      "Los sábados funcionan mejor: 7 % de interacción en 1 publicación.",
    );
    expect(fraseConclusion({ eje: "plantilla", estado: "mejor", clave: "ct-foto-titular", publicaciones: 3, tasa: 7, tasa_media: 5, texto: "" })).toMatch(
      /^La plantilla «(?!ct-foto-titular).+» funciona mejor/,
    );
    // Sin «mejor», la frase de la base de datos.
    expect(fraseConclusion(QF_CON_DATOS.conclusiones[1])).toBe("Por plantilla no hay diferencias claras todavía.");
  });

  it("vista: como mucho 4 barras por eje, la mejor marcada y anchos relativos", () => {
    const v = vistaQueFunciona(QF_CON_DATOS);
    expect(v.map((x) => x.eje)).toEqual(["formato", "plantilla", "tipo_foto", "dia", "franja", "hashtag"]);
    const dia = v.find((x) => x.eje === "dia")!;
    expect(dia.grupos).toHaveLength(MAX_BARRAS);
    expect(dia.grupos.filter((x) => x.mejor).map((x) => x.clave)).toEqual(["martes"]);
    // El domingo (1 publicación, 20 %) no sale: hay días con muestra.
    expect(dia.grupos.map((x) => x.clave)).toEqual(["martes", "miércoles", "jueves", "sábado"]);
    expect(dia.grupos.map((x) => x.ancho)).toEqual([100, 56, 44, 33]);
    expect(dia.frase).toMatch(/^Los martes funcionan mejor/);
    expect(v.find((x) => x.eje === "plantilla")!.grupos.some((x) => x.mejor)).toBe(false);
  });

  it("con pocos datos no saca conclusiones", () => {
    expect(conclusionesClaras(QF_POCOS)).toEqual([]);
    const v = vistaQueFunciona(QF_POCOS);
    expect(v.every((x) => x.conclusion?.estado === "faltan_datos" && x.frase === null && x.grupos.every((y) => !y.mejor))).toBe(true);
    // Sin grupos con muestra, salen todos como «pocos datos».
    expect(v.find((x) => x.eje === "dia")!.grupos).toMatchObject([{ clave: "martes", suficiente: false, ancho: 100 }]);
    expect(conclusionesClaras(QF_CON_DATOS)).toHaveLength(4);
    expect(conclusionesClaras(null)).toEqual([]);
  });
});
