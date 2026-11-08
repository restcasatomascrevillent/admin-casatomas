import { describe, expect, it } from "vitest";
import { fotosDesdePlatos, fotosDesdeVinos } from "../fotos";
import { aplicarOriginales, indexarOriginales } from "../originalesCarta";

const URL = "https://sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/platos/p1-carta-jpg.webp";
const platos = [
  { id: "p1", nombre: "Chuletón", categoria: "Carnes", imagen_url: URL, activado: true, restaurante: true, touza: false },
  { id: "p2", nombre: "Arroz", categoria: "Arroces", imagen_url: URL, activado: true, restaurante: true, touza: false },
];
const vinos = [{ id: "v1", nombre: "Pidio", denominacion_origen: "Ribera", imagen_url: URL, activado: true, restaurante: true, touza: false }];
// Medidas de la versión web (lo que se ve en la miniatura): 1200×900, no sirve a sangre.
const web = { p1: { ancho: 1200, alto: 900 }, p2: { ancho: 1200, alto: 900 }, "vino:v1": { ancho: 900, alto: 1200 } };

describe("originales de la carta en la biblioteca de Instagram", () => {
  const originales = indexarOriginales([
    { plato_id: "p1", vino_id: null, ancho: 3000, alto: 4000 },
    { plato_id: null, vino_id: "v1", ancho: 2400, alto: 3200 },
    { plato_id: "p2", vino_id: null, ancho: 0, alto: 0 }, // medidas no válidas: se ignora
  ]);

  it("con original: medidas reales y apta a sangre; sin original: «Solo web» con las de la web", () => {
    const [p1, p2] = aplicarOriginales(fotosDesdePlatos(platos, "casa-tomas", web), originales);
    expect(p1).toMatchObject({ id: "carta:p1", ancho: 3000, alto: 4000, aptaPost: true, aptaStory: true, original: true });
    expect(p2).toMatchObject({ id: "carta:p2", ancho: 1200, alto: 900, aptaPost: false, original: false });
  });

  it("vinos por vino_id; las fotos de Drive no se tocan; sin datos, todas «Solo web»", () => {
    const [v1] = aplicarOriginales(fotosDesdeVinos(vinos, "casa-tomas", web), originales);
    expect(v1).toMatchObject({ id: "vino:v1", ancho: 2400, alto: 3200, original: true });
    const drive = { id: "drive:x", marca: "casa-tomas", ruta: "", ancho: 10, alto: 10, tipo: null, aptaPost: false, aptaStory: false, descripcion: "", driveId: "x" } as const;
    expect(aplicarOriginales([drive], originales)[0]).toBe(drive);
    expect(aplicarOriginales(fotosDesdePlatos(platos, "casa-tomas", web), undefined).map((f) => f.original)).toEqual([false, false]);
  });
});
