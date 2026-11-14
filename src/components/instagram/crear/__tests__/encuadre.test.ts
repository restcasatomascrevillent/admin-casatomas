/**
 * Encuadre de «Solo foto» (12/11/2026): arrastrar mueve el % del eje en que la
 * foto sobra; el encuadre de la imagen viaja a la pieza (posicionX/Y), se
 * conserva al volver a montar y se recupera al abrir un borrador.
 */
import { describe, expect, it } from "vitest";
import { validarPieza } from "@/lib/instagram";
import { encuadreArrastrado, sobrante } from "@/components/instagram/EncuadreFoto";
import { documentoDiapositiva } from "@/components/instagram/movil/documento";
import { alternarFoto, aplicarMontaje, ajusteDe, cambiarAjuste, estadoDesdePieza, estadoInicial, piezaDeImagen } from "../estado";

const A = "drive:1FotoA000000000000001";

describe("arrastrar el encuadre", () => {
  it("una apaisada (1200×900) en un marco 4:5 solo sobra en horizontal; arrastrar a la derecha baja X", () => {
    const sobra = sobrante({ ancho: 1200, alto: 900 }, 240, 300);
    expect(Math.round(sobra.x)).toBe(160);
    expect(sobra.y).toBe(0);
    expect(encuadreArrastrado({ x: 50, y: 50 }, 32, 40, sobra)).toEqual({ x: 30, y: 50 });
    expect(encuadreArrastrado({ x: 50, y: 50 }, -500, 0, sobra)).toEqual({ x: 100, y: 50 });
  });
});

describe("encuadre en el estado de Crear", () => {
  it("va a la pieza como posicionX/Y, valida, se conserva al montar y se recupera del borrador", () => {
    let e = alternarFoto(estadoInicial(), A);
    expect(ajusteDe(e, A).plantilla).toBe("ct-solo-foto");
    e = cambiarAjuste(e, A, { encuadre: { x: 30, y: 60 } });
    const pieza = piezaDeImagen(e, A);
    expect(pieza).toMatchObject({ plantilla: "ct-solo-foto", posicionX: 30, posicionY: 60 });
    expect(validarPieza(pieza, { fotos: [{ id: A, marca: "casa-tomas", ruta: "x.jpg", ancho: 1200, alto: 900, tipo: null, aptaPost: false, aptaStory: false, descripcion: "" }] }).ok).toBe(true);
    const montado = aplicarMontaje(e, { ok: true, formato: "post", diapositivas: [{ foto: A, plantilla: "ct-solo-foto", datos: {}, altText: "" }], caption: "", hashtags: [], resumen: "", avisos: [] });
    expect(ajusteDe(montado, A).encuadre).toEqual({ x: 30, y: 60 });
    const abierto = estadoDesdePieza({ id: "p1", marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", datos: { foto: A, posicionX: 30, posicionY: 60 } });
    expect(ajusteDe(abierto, A).encuadre).toEqual({ x: 30, y: 60 });
    // Con una plantilla con rótulos no viaja.
    const conRotulos = cambiarAjuste(e, A, { plantilla: "ct-portada", datos: { titular: "Chuleta" } });
    expect(piezaDeImagen(conRotulos, A)).not.toHaveProperty("posicionX");
  });

  it("móvil: el encuadre de la diapositiva llega al documento", () => {
    const html = documentoDiapositiva(
      "casa-tomas",
      "post",
      { foto: "subida:1", plantilla: "ct-solo-foto", datos: { posicionX: 30, posicionY: 50 }, altText: "" },
      { id: "subida:1", url: "https://x/a.jpg", ancho: 1200, alto: 900 },
    );
    expect(html).toContain("object-position: 30% 50%");
    expect(html).not.toContain("data-campo");
  });
});
