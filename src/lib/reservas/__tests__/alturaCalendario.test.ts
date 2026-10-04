import { describe, it, expect } from "vitest";
import {
  ALTURA_CABECERA_MES,
  ALTURA_MINIMA_BLOQUE,
  FILA_COMPLETA,
  FILA_MEDIA,
  SEPARACION_BLOQUE,
  alturaTarjetaCalendario,
  calcularAlturaDisponible,
  medirCasilla,
  semanasDelMes,
  tamanoCasilla,
} from "../alturaCalendario";

describe("calcularAlturaDisponible", () => {
  it("es el viewport visual menos la posición en la página y el relleno inferior", () => {
    // 1080 de ventana; el bloque empieza en 88; el <main> deja 24 abajo.
    expect(calcularAlturaDisponible({ topPagina: 88, altoVisible: 1080, paddingInferior: 24 })).toBe(968);
  });

  it("redondea hacia abajo: el bloque nunca se pasa ni un píxel del fondo", () => {
    expect(calcularAlturaDisponible({ topPagina: 88.6, altoVisible: 768, paddingInferior: 24 })).toBe(655);
  });

  it("con teclado abierto (viewport visual bajo) no baja del suelo: la página hace scroll", () => {
    expect(calcularAlturaDisponible({ topPagina: 150, altoVisible: 400, paddingInferior: 24 })).toBe(ALTURA_MINIMA_BLOQUE);
  });

  it("una ventana de ~600 px de alto cae al suelo (scroll antes que casillas ilegibles)", () => {
    expect(calcularAlturaDisponible({ topPagina: 88, altoVisible: 600, paddingInferior: 24 })).toBe(ALTURA_MINIMA_BLOQUE);
  });

  it("medidas rotas (NaN) caen al suelo", () => {
    expect(calcularAlturaDisponible({ topPagina: Number.NaN, altoVisible: 900, paddingInferior: 0 })).toBe(ALTURA_MINIMA_BLOQUE);
  });
});

describe("alturaTarjetaCalendario (apilado, < lg)", () => {
  it("el calendario ocupa el bloque menos la cabecera y su hueco", () => {
    expect(alturaTarjetaCalendario(1012)).toBe(1012 - ALTURA_CABECERA_MES - SEPARACION_BLOQUE);
  });
});

describe("semanasDelMes", () => {
  it("octubre 2026 (empieza en jueves, 31 días) tiene 5 semanas", () => {
    expect(semanasDelMes(3, 31)).toBe(5);
  });
  it("un mes de 30 días que empieza en domingo ocupa 6", () => {
    expect(semanasDelMes(6, 30)).toBe(6);
  });
  it("febrero de 28 días empezando en lunes ocupa 4", () => {
    expect(semanasDelMes(0, 28)).toBe(4);
  });
});

describe("tamanoCasilla", () => {
  it("descuenta los huecos entre casillas", () => {
    const t = tamanoCasilla({ ancho: 700, alto: 600 }, 6, 4);
    expect(t.ancho).toBeCloseTo((700 - 24) / 7);
    expect(t.alto).toBeCloseTo((600 - 20) / 6);
  });
});

describe("medirCasilla", () => {
  it("fila alta: casilla completa, con la cifra grande", () => {
    const m = medirCasilla({ ancho: 150, alto: 130 });
    expect(m.densidad).toBe("completa");
    expect(m.fuenteComensales).toBeGreaterThanOrEqual(30);
  });

  it("los umbrales de altura son los documentados", () => {
    expect(medirCasilla({ ancho: 120, alto: FILA_COMPLETA }).densidad).toBe("completa");
    expect(medirCasilla({ ancho: 120, alto: FILA_COMPLETA - 1 }).densidad).toBe("media");
    expect(medirCasilla({ ancho: 120, alto: FILA_MEDIA }).densidad).toBe("media");
    expect(medirCasilla({ ancho: 120, alto: FILA_MEDIA - 1 }).densidad).toBe("compacta");
  });

  it("la cifra crece con la fila pero tiene tope y suelo", () => {
    const f = (alto: number) => medirCasilla({ ancho: 400, alto }).fuenteComensales;
    expect(f(110)).toBeLessThanOrEqual(f(400));
    expect(f(400)).toBeLessThanOrEqual(40);
    expect(medirCasilla({ ancho: 100, alto: 44 }).fuenteComensales).toBeGreaterThanOrEqual(16);
  });

  it("una casilla muy estrecha baja un nivel (no cabe número + indicadores + cifra)", () => {
    expect(medirCasilla({ ancho: 50, alto: 130 }).densidad).toBe("media");
    expect(medirCasilla({ ancho: 50, alto: 80 }).densidad).toBe("compacta");
  });
});
