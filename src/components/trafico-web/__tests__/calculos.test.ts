import { describe, expect, it } from "vitest";
import type { EstadoSync, FilaSerie, Tendencia } from "@/hooks/useTraficoWeb";
import { construirPuntos, deltaMediaPct, detectarProblemasSync, esErrorAnalyticsDesactivado, resumirSerie } from "../calculos";
import { fmtBytes, fmtNumero, SIN_DATOS } from "../formato";

const fila = (fecha: string, visitas: number | null, extra: Partial<FilaSerie> = {}): FilaSerie => ({
  fecha,
  visitas,
  visitantes: visitas === null ? null : Math.round(visitas / 2),
  media_7: null,
  media_30: null,
  desv_30: null,
  media_dow: null,
  desv_dow: null,
  n_dow: 0,
  z_dow: null,
  desviacion_pct: null,
  es_anomalia: null,
  ...extra,
});

describe("resumirSerie", () => {
  it("ignora los días NULL en vez de contarlos como 0", () => {
    const r = resumirSerie([fila("2026-09-01", 10), fila("2026-09-02", null), fila("2026-09-03", 30)]);
    expect(r.total).toBe(40);
    expect(r.diasConDato).toBe(2);
    expect(r.media).toBe(20);
  });

  it("sin ningún dato devuelve NULL, no 0", () => {
    const r = resumirSerie([fila("2026-09-01", null)]);
    expect(r.total).toBeNull();
    expect(r.media).toBeNull();
    expect(r.visitantes).toBeNull();
  });

  it("visitantes NULL si algún día no lo trae", () => {
    const r = resumirSerie([fila("2026-09-01", 10), fila("2026-09-02", 5, { visitantes: null })]);
    expect(r.visitantes).toBeNull();
  });

  it("cuenta anomalías solo cuando es_anomalia === true", () => {
    const r = resumirSerie([
      fila("2026-09-01", 10, { es_anomalia: true }),
      fila("2026-09-02", 10, { es_anomalia: null }),
      fila("2026-09-03", 10, { es_anomalia: false }),
    ]);
    expect(r.anomalias).toBe(1);
  });
});

describe("deltaMediaPct", () => {
  it("compara medias diarias", () => {
    const a = resumirSerie([fila("2026-09-10", 30)]);
    const b = resumirSerie([fila("2026-09-01", 20), fila("2026-09-02", null)]);
    expect(deltaMediaPct(a, b)).toBeCloseTo(50);
  });
  it("NULL si el periodo anterior no tiene datos", () => {
    expect(deltaMediaPct(resumirSerie([fila("2026-09-10", 30)]), resumirSerie([]))).toBeNull();
  });
});

describe("detectarProblemasSync", () => {
  const ahora = new Date("2026-09-23T12:00:00Z");
  const estado = (e: Partial<EstadoSync>): EstadoSync => ({
    proyecto: "casa-tomas-story",
    ultimo_ok_en: null,
    ultimo_intento_en: null,
    ultimo_error: null,
    fallos_consecutivos: 0,
    dias_ultimo_sync: null,
    ...e,
  });

  it("sin problemas con sync reciente", () => {
    const r = detectarProblemasSync(["casa-tomas-story"], [estado({ ultimo_ok_en: "2026-09-23T03:31:00Z" })], ahora);
    expect(r).toEqual([]);
  });

  it("avisa si el último sync correcto tiene más de 48 h", () => {
    const r = detectarProblemasSync(["casa-tomas-story"], [estado({ ultimo_ok_en: "2026-09-20T03:31:00Z" })], ahora);
    expect(r).toHaveLength(1);
  });

  it("avisa si el último intento (posterior al último ok) falló", () => {
    const r = detectarProblemasSync(
      ["casa-tomas-story"],
      [
        estado({
          ultimo_ok_en: "2026-09-22T03:31:00Z",
          ultimo_intento_en: "2026-09-23T03:31:00Z",
          ultimo_error: "Vercel 502",
        }),
      ],
      ahora,
    );
    expect(r[0].motivo).toContain("Vercel 502");
  });

  it("nunca intentado → sin aviso (lo cubre el estado vacío)", () => {
    expect(detectarProblemasSync(["casa-tomas-story", "touza-restaurant-website"], [], ahora)).toEqual([]);
  });

  it("Web Analytics desactivado (el error que hay hoy en PROD) → explica qué activar en Vercel", () => {
    const r = detectarProblemasSync(
      ["casa-tomas-story"],
      [
        estado({
          ultimo_ok_en: "2026-10-27T03:30:03Z",
          ultimo_intento_en: "2026-11-01T03:30:03Z",
          ultimo_error: "Vercel 400 (by=day): Web Analytics is not enabled for this project",
          fallos_consecutivos: 5,
        }),
      ],
      new Date("2026-11-01T12:00:00Z"),
    );
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toContain("Web Analytics está desactivado en Vercel");
    expect(r[0].motivo).toContain("Analytics → Enable");
    expect(r[0].motivo).not.toContain("Web Analytics is not enabled");
  });

  it("esErrorAnalyticsDesactivado reconoce el mensaje de Vercel y el código, y nada más", () => {
    expect(esErrorAnalyticsDesactivado("… [web_analytics_not_enabled] Vercel 400 …")).toBe(true);
    expect(esErrorAnalyticsDesactivado("Vercel 502")).toBe(false);
    expect(esErrorAnalyticsDesactivado(null)).toBe(false);
  });
});

describe("construirPuntos", () => {
  it("bandas por día de semana, recortadas a 0, y proyección enganchada al último dato", () => {
    const serie = [fila("2026-09-21", 10, { media_dow: 8, desv_dow: 5, es_anomalia: false }), fila("2026-09-22", 12)];
    const tendencia: Tendencia = {
      pendiente: 1,
      intercepto: 13,
      r2: 0.5,
      n: 2,
      fiable: false,
      total_30d: 100,
      proyeccion: [{ fecha: "2026-09-24", visitas: 14 }],
    };
    const p = construirPuntos(serie, tendencia, "2026-09-23");
    expect(p[0].banda1).toEqual([3, 13]);
    expect(p[0].banda2).toEqual([0, 18]);
    expect(p[1].banda1).toBeNull();
    expect(p[1].proyeccion).toBe(12);
    expect(p.map((x) => x.fecha)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(p[2]).toEqual({ fecha: "2026-09-23", proyeccion: 13 });
  });

  it("sin tendencia no añade proyección", () => {
    expect(construirPuntos([fila("2026-09-22", 1)], null, "2026-09-23")).toHaveLength(1);
  });
});

describe("formato", () => {
  it("NULL se pinta como 'sin datos', nunca 0", () => {
    expect(fmtNumero(null)).toBe(SIN_DATOS);
    expect(fmtBytes(null)).toBe(SIN_DATOS);
    expect(fmtNumero(0)).toBe("0");
  });
  it("bytes en unidades decimales", () => {
    expect(fmtBytes(80e9)).toBe("80,00 GB");
    expect(fmtBytes(470000)).toBe("470 KB");
  });
});
