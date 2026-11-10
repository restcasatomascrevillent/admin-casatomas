import { describe, it, expect } from "vitest";
import { bloqueVacio, disenoDePlantilla, huecosPorCompletar, payloadDeDiseno, plantillaBase, TIPOS_BLOQUE, validarBloques } from "../diseno";
import { filaAPlantilla } from "@/hooks/useNewsletterPlantillas";

describe("diseño de la newsletter en el panel", () => {
  it("una plantilla de partida se copia (editarla no cambia el catálogo)", () => {
    const d = disenoDePlantilla(plantillaBase("evento"));
    d.bloques.pop();
    expect(plantillaBase("evento").bloques.length).toBe(d.bloques.length + 1);
    expect(d.insignia).toBe("Fecha especial");
  });

  it("payloadDeDiseno: manda bloques limpios y SIEMPRE la versión de texto en `mensaje`", () => {
    const r = payloadDeDiseno({ tipo: "anuncio", titulo: "  Cerrado por vacaciones ", insignia: "", preheader: "", bloques: [{ tipo: "texto", texto: " Volvemos el 1 " }] });
    expect(r).toEqual({ ok: true, payload: { tipo: "anuncio", titulo: "Cerrado por vacaciones", mensaje: "Volvemos el 1", bloques: [{ tipo: "texto", texto: "Volvemos el 1" }] } });
    expect(payloadDeDiseno({ tipo: "anuncio", titulo: " ", insignia: "", preheader: "", bloques: [{ tipo: "texto", texto: "a" }] }).ok).toBe(false);
  });

  it("huecos: corchetes de la IA y puntos suspensivos de las plantillas", () => {
    expect(huecosPorCompletar({ tipo: "evento", titulo: "Cena", insignia: "", preheader: "", bloques: [{ tipo: "evento", fecha: "[fecha]", precio: "… €" }] })).toEqual(["[fecha]", "…"]);
    expect(huecosPorCompletar({ tipo: "anuncio", titulo: "Hola", insignia: "", preheader: "", bloques: [{ tipo: "texto", texto: "Todo listo" }] })).toEqual([]);
  });

  it("bloques nuevos: los que nacen completos valen; los demás piden rellenarse", () => {
    for (const t of TIPOS_BLOQUE) {
      const ok = validarBloques([{ tipo: "texto", texto: "x" }, bloqueVacio(t)]).ok;
      expect(ok).toBe(["boton", "firma", "separador"].includes(t));
    }
  });

  it("filaAPlantilla descarta filas con bloques no válidos", () => {
    const base = { id: "1", nombre: "A", tipo: "evento", titulo: "T", insignia: "", preheader: "", origen: "ia", created_at: "", updated_at: "" };
    expect(filaAPlantilla({ ...base, bloques: [{ tipo: "texto", texto: "Hola" }] })?.origen).toBe("ia");
    expect(filaAPlantilla({ ...base, bloques: [{ tipo: "boton", texto: "x", url: "javascript:1" }] })).toBeNull();
    expect(filaAPlantilla({ ...base, tipo: "raro", bloques: [{ tipo: "texto", texto: "Hola" }] })?.tipo).toBe("personalizada");
  });
});
