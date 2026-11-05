import { describe, it, expect } from "vitest";
import { obtenerPlantilla, validarPieza } from "@/lib/instagram";
import { borradorVacio, camposConProblemas, humanizarProblema, piezaDesdeBorrador } from "../pieza";
import { contarHashtags, contarMenciones, resumenCaption } from "../contadores";

describe("piezaDesdeBorrador", () => {
  it("solo lleva los campos admitidos y con texto (el motor rechaza los demás)", () => {
    const pl = obtenerPlantilla("ct-foto-titular")!;
    const b = { ...borradorVacio("casa-tomas", "ct-foto-titular", "post"), foto: "ct-salon-1", titular: "  Hola  ", cita: "no se usa", numeral: "01", lista: [{ etiqueta: "x", valor: "" }] };
    const pieza = piezaDesdeBorrador(b, pl);
    expect(pieza).toEqual({ marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: "ct-salon-1", titular: "Hola" });
    expect(validarPieza(pieza)).toMatchObject({ ok: true });
  });

  it("sin titular no manda «titular»: la validación dice que falta", () => {
    const pl = obtenerPlantilla("ct-foto-titular")!;
    const r = validarPieza(piezaDesdeBorrador({ ...borradorVacio("casa-tomas", "ct-foto-titular", "post"), foto: "ct-salon-1" }, pl));
    expect("problemas" in r && r.problemas.join(" ")).toMatch(/titular/);
  });

  it("filas de lista vacías no viajan; las de solo nombre van sin valor", () => {
    const pl = obtenerPlantilla("tz-tipografica")!;
    const b = { ...borradorVacio("touza", "tz-tipografica", "post"), titular: "Cócteles", lista: [{ etiqueta: "Negroni", valor: "9 €" }, { etiqueta: "", valor: "" }, { etiqueta: "Spritz", valor: " " }] };
    expect(piezaDesdeBorrador(b, pl).lista).toEqual([{ etiqueta: "Negroni", valor: "9 €" }, { etiqueta: "Spritz" }]);
  });
});

describe("problemas", () => {
  it("marca el campo nombrado y no se confunde con el id de la plantilla", () => {
    expect([...camposConProblemas(["La plantilla «ct-foto-titular» necesita el campo «foto»"])]).toEqual(["foto"]);
    expect([...camposConProblemas(["El campo «cta» se desborda (3 px de ancho): acórtalo"])]).toEqual(["cta"]);
    expect([...camposConProblemas(["El titular tiene 7 palabras; máximo 6"])]).toEqual(["titular"]);
    expect([...camposConProblemas(["El campo «lista[1].valor» lleva emojis"])]).toEqual(["lista"]);
  });

  it("traduce los nombres internos a los del formulario", () => {
    expect(humanizarProblema("«titular» tiene 54 caracteres; máximo 44 en «ct-foto-titular»")).toBe("«Titular» tiene 54 caracteres; máximo 44 en «Foto con titular»");
    expect(humanizarProblema("El campo «lista[0].etiqueta» lleva emojis")).toBe("El campo «Lista, fila 1 (nombre)» lleva emojis");
  });
});

describe("contadores del texto", () => {
  it("cuenta hashtags y menciones como el servidor", () => {
    expect(contarHashtags("Hola #casatomas y #crevillent, no#esto")).toBe(2);
    expect(contarMenciones("Con @casatomascrevillent y correo a@b.com")).toBe(1);
    expect(resumenCaption("x".repeat(2201)).problemas).toHaveLength(1);
    expect(resumenCaption(Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ")).problemas[0]).toMatch(/30 hashtags/);
  });
});
