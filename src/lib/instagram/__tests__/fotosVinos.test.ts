/**
 * Vinos de la carta en la biblioteca de Instagram («vino:<id>», tabla "Vinos",
 * bucket «vinos»), igual que las fotos de los platos.
 */
import { describe, expect, it } from "vitest";
import { fotoDesdeVino, fotoPreparable, fotosDesdeVinos, idFotoVino, vinoIdDeFoto, type FilaVinoFoto } from "@/lib/instagram";

const URL_VINO = "https://sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/vinos/combe-carta.webp";
const fila = (o: Partial<FilaVinoFoto> = {}): FilaVinoFoto => ({
  id: "8ae1eafd-7999-4180-93dc-362364091af0",
  nombre: "Domaine de la Combe",
  denominacion_origen: "AOC Côtes du Rhône",
  imagen_url: URL_VINO,
  activado: true,
  restaurante: true,
  touza: false,
  ...o,
});

describe("fotos de vinos de la carta", () => {
  it("ids «vino:<id>» y origen preparable «vino»", () => {
    expect(idFotoVino("abc")).toBe("vino:abc");
    expect(vinoIdDeFoto("vino:abc")).toBe("abc");
    expect(vinoIdDeFoto("vino:../x")).toBeNull();
    expect(vinoIdDeFoto("carta:abc")).toBeNull();
    expect(fotoPreparable("vino:abc")).toEqual({ origen: "vino", id: "abc" });
    expect(fotoPreparable("carta:abc")).toEqual({ origen: "carta", id: "abc" });
  });

  it("fila → foto de tipo «bebida» con nombre · D.O.; sin medidas no es apta pero tampoco se bloquea", () => {
    expect(fotoDesdeVino(fila(), "casa-tomas")).toMatchObject({
      id: "vino:8ae1eafd-7999-4180-93dc-362364091af0",
      tipo: "bebida",
      descripcion: "Domaine de la Combe · AOC Côtes du Rhône",
      vinoId: "8ae1eafd-7999-4180-93dc-362364091af0",
      urlCarta: URL_VINO,
      ancho: 0,
      aptaPost: false,
    });
    expect(fotoDesdeVino(fila({ imagen_url: null }), "casa-tomas")).toBeNull();
  });

  it("solo activos, de la marca y con medidas por id de foto", () => {
    const fotos = fotosDesdeVinos(
      [fila(), fila({ id: "otro", activado: false }), fila({ id: "touza", restaurante: false, touza: true })],
      "casa-tomas",
      { "vino:8ae1eafd-7999-4180-93dc-362364091af0": { ancho: 1080, alto: 1350 } },
    );
    expect(fotos.map((f) => f.id)).toEqual(["vino:8ae1eafd-7999-4180-93dc-362364091af0"]);
    expect(fotos[0]).toMatchObject({ ancho: 1080, alto: 1350, aptaPost: true });
  });
});
