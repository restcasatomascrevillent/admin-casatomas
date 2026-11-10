import { describe, expect, it } from "vitest";
import { contar, enlaceGoogle, estadoDe, filtrar, type ResenaPanel } from "../contestador";

const r = (x: Partial<ResenaPanel>): ResenaPanel => ({
  id: "1", nombre_cliente: "A", valoracion: 5, comentario: null, fecha: "2026-11-01", fuente: "google", estado: "publicada", respuesta: null, fecha_respuesta: null, ...x,
});

describe("contestador (panel)", () => {
  it("estadoDe: una respuesta guardada manda; sin columna nueva, pendiente", () => {
    expect(estadoDe(r({ respuesta: "Gracias", respuesta_estado: "propuesta" }))).toBe("publicada");
    expect(estadoDe(r({}))).toBe("pendiente");
    expect(estadoDe(r({ respuesta_estado: "error" }))).toBe("error");
  });
  it("filtros y cuentas", () => {
    const l = [r({ id: "a" }), r({ id: "b", respuesta_estado: "propuesta" }), r({ id: "c", respuesta_estado: "error" }), r({ id: "d", respuesta_estado: "aprobada" }), r({ id: "e", respuesta: "x" })];
    expect(filtrar(l, "por_responder").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(filtrar(l, "aprobadas").map((x) => x.id)).toEqual(["d"]);
    expect(filtrar(l, "respondidas").map((x) => x.id)).toEqual(["e"]);
    expect(contar(l)).toEqual({ por_responder: 3, aprobadas: 1, respondidas: 1, todas: 5 });
  });
  it("enlace a Google: el de la reseña, o las reseñas de la ficha; nunca algo que no sea https", () => {
    expect(enlaceGoogle({ google_maps_uri: "https://maps.google.com/r" }, "ChIJxxxxxxxxxx")).toBe("https://maps.google.com/r");
    expect(enlaceGoogle({ google_maps_uri: null }, "ChIJxxxxxxxxxx")).toBe("https://search.google.com/local/reviews?placeid=ChIJxxxxxxxxxx");
    expect(enlaceGoogle({ google_maps_uri: "javascript:alert(1)" }, null)).toBeNull();
  });
});
