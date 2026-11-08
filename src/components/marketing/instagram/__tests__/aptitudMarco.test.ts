/**
 * Aptitud de una foto según la plantilla (08/11/2026): a sangre tiene que
 * cubrir el lienzo ampliando ≤ 5 %; enmarcada («Foto enmarcada», encaje
 * «marco») basta con que su lado largo mida 800 px o más. Las fotos de la
 * carta (1200×900) dejan de salir en gris con la enmarcada, y con la de
 * sangre explican «Usa la plantilla Foto enmarcada».
 */
import { describe, expect, it } from "vitest";
import {
  LADO_MINIMO_MARCO,
  esAptaPara,
  encajeDe,
  obtenerPlantilla,
  plantillaEnmarcada,
  validarPieza,
  type Foto,
} from "@/lib/instagram";
import { motivoNoApta } from "../SelectorFoto";

const carta: Foto = {
  id: "carta:chuleta",
  marca: "casa-tomas",
  ruta: "tmp/x.jpg",
  ancho: 1200,
  alto: 900,
  tipo: "plato",
  aptaPost: false,
  aptaStory: false,
  descripcion: "Chuleta de vaca · Carnes",
  platoId: "chuleta",
  urlCarta: "https://x/platos/chuleta.webp",
};
const vertical: Foto = { ...carta, id: "drive:vertical", ancho: 1708, alto: 2560, platoId: undefined, urlCarta: undefined, driveId: "vertical" };
const pequena: Foto = { ...carta, id: "carta:pequena", ancho: 640, alto: 480 };

const sangre = obtenerPlantilla("ct-foto-titular")!;
const marco = obtenerPlantilla("ct-marco")!;

describe("esAptaPara según el encaje de la plantilla", () => {
  it("las plantillas declaran su encaje", () => {
    expect(encajeDe(sangre)).toBe("sangre");
    expect(encajeDe(marco)).toBe("marco");
    expect(encajeDe(obtenerPlantilla("tz-foto-titular"))).toBe("sangre");
    expect(encajeDe(obtenerPlantilla("tz-marco"))).toBe("marco");
    expect(encajeDe(undefined)).toBe("sangre");
    expect(plantillaEnmarcada("casa-tomas", "story")?.id).toBe("ct-portada-marco");
    expect(plantillaEnmarcada("touza", "post")?.id).toBe("tz-portada-marco");
  });

  it("una foto de la carta (1200×900) no vale a sangre y sí enmarcada, en post y en story", () => {
    for (const formato of ["post", "story"] as const) {
      expect(esAptaPara(carta, formato)).toBe(false);
      expect(esAptaPara(carta, formato, sangre)).toBe(false);
      expect(esAptaPara(carta, formato, marco)).toBe(true);
      expect(esAptaPara(carta, formato, "marco")).toBe(true);
    }
  });

  it("enmarcada: el límite es el lado largo de 800 px (apaisada o vertical)", () => {
    expect(LADO_MINIMO_MARCO).toBe(800);
    expect(esAptaPara({ ancho: 800, alto: 600 }, "post", marco)).toBe(true);
    expect(esAptaPara({ ancho: 600, alto: 800 }, "story", marco)).toBe(true);
    expect(esAptaPara({ ancho: 799, alto: 799 }, "post", marco)).toBe(false);
    expect(esAptaPara(pequena, "post", marco)).toBe(false);
  });

  it("a sangre no cambia: una vertical grande vale; una vertical grande también vale enmarcada", () => {
    expect(esAptaPara(vertical, "post", sangre)).toBe(true);
    expect(esAptaPara(vertical, "story", sangre)).toBe(true);
    expect(esAptaPara(vertical, "post", marco)).toBe(true);
  });

  it("validarPieza aplica la misma regla", () => {
    const pieza = (plantilla: string, foto: string) => ({ marca: "casa-tomas", plantilla, formato: "post", foto, titular: "Brasa, sal y paciencia" });
    const fotos = [carta, pequena];
    expect(validarPieza(pieza("ct-marco", carta.id), { fotos }).ok).toBe(true);
    const mal = validarPieza(pieza("ct-foto-titular", carta.id), { fotos });
    expect(mal.problemas?.join(" ")).toMatch(/ampliarse un 50 %.*Usa la plantilla «Foto enmarcada» \(«ct-marco»\)/);
    expect(validarPieza(pieza("ct-marco", pequena.id), { fotos }).problemas?.join(" ")).toMatch(/demasiado pequeña.*800 px/);
    // Pequeña también a sangre: no se recomienda la enmarcada (tampoco le vale).
    expect(validarPieza(pieza("ct-foto-titular", pequena.id), { fotos }).problemas?.join(" ")).not.toMatch(/Foto enmarcada/);
  });
});

describe("motivoNoApta (selector de fotos)", () => {
  it("con la plantilla enmarcada, la foto de la carta no sale en gris", () => {
    expect(motivoNoApta(carta, "post", marco)).toBeNull();
    expect(motivoNoApta(carta, "story", marco)).toBeNull();
  });
  it("con una plantilla a sangre (o sin plantilla) explica que use «Foto enmarcada»", () => {
    expect(motivoNoApta(carta, "post", sangre)).toMatch(/^Es apaisada \(1200×900\): para un post habría que ampliarla un 50 %.*Usa la plantilla Foto enmarcada/);
    expect(motivoNoApta(carta, "story")).toMatch(/Usa la plantilla Foto enmarcada/);
  });
  it("una foto pequeña no vale ni enmarcada (y no se le recomienda)", () => {
    expect(motivoNoApta(pequena, "post", marco)).toMatch(/lado largo mida 800 px/);
    expect(motivoNoApta(pequena, "post", sangre)).not.toMatch(/Foto enmarcada/);
  });
  it("una foto que cubre vale con las dos", () => {
    expect(motivoNoApta(vertical, "post", sangre)).toBeNull();
    expect(motivoNoApta(vertical, "post", marco)).toBeNull();
  });
});
