import { describe, expect, it } from "vitest";
import type {
  CosteFijo,
  FilaCosteMes,
  FilaCostePorModelo,
  FilaCosteSerie,
  FilaFuncionSinRegistro,
  IaCosteEstimado,
} from "@/hooks/useCostes";
import {
  agruparCostesFijos,
  calcularAvisosCostes,
  calcularTotalMensual,
  construirPuntosCoste,
  diasDesde,
  iaUsdMes,
  resumirEstimacion,
  resumirSerieCoste,
} from "../calculos";
import { fmtEur, fmtEurAprox, fmtTokens, fmtUsd, fmtUsdPreciso, SIN_DATOS, USD_EUR } from "../formato";

// ─── Constructores de filas (solo se rellena lo que cada test mira) ──────────
const dia = (d: string, coste: number | null, extra: Partial<FilaCosteSerie> = {}): FilaCosteSerie => ({
  dia: d,
  coste_usd: coste,
  llamadas: coste === null ? null : 1,
  peticiones: coste === null ? null : 1,
  errores: 0,
  prompt_tokens: coste === null ? null : 1000,
  completion_tokens: coste === null ? null : 500,
  razonamiento_tokens: coste === null ? null : 200,
  media_7: null,
  media_30: null,
  desv_30: null,
  z_30: null,
  desviacion_pct: null,
  es_anomalia: null,
  ...extra,
});

const fijo = (e: Partial<CosteFijo>): CosteFijo => ({
  id: e.concepto ?? "id",
  concepto: "Supabase Pro",
  proveedor: "Supabase",
  categoria: "infraestructura",
  eur_mes: 25,
  naturaleza: "fijo",
  notas: null,
  verificado_en: "2026-09-01",
  activo: true,
  orden: 0,
  creado_en: "2026-01-01T00:00:00Z",
  actualizado_en: "2026-01-01T00:00:00Z",
  ...e,
});

const modelo = (e: Partial<FilaCostePorModelo>): FilaCostePorModelo => ({
  modelo: "gpt-5-mini",
  llamadas: 1,
  peticiones: 1,
  prompt_tokens: 0,
  cached_tokens: 0,
  completion_tokens: 0,
  razonamiento_tokens: 0,
  pct_razonamiento: null,
  coste_usd: 1,
  pct: 100,
  usd_por_peticion: 1,
  tarifado: true,
  ...e,
});

const sinRegistro = (e: Partial<FilaFuncionSinRegistro>): FilaFuncionSinRegistro => ({
  funcion: "ocr_facturas",
  descripcion: "OCR de facturas",
  instrumentada: false,
  ultima_fila: null,
  dias_sin_registro: null,
  ...e,
});

const mes = (e: Partial<FilaCosteMes> = {}): FilaCosteMes => ({
  mes: "2026-09-01",
  coste_acumulado_usd: 10,
  peticiones: 100,
  dias_con_dato: 10,
  dias_mes: 30,
  dias_restantes: 20,
  usd_medio_dia: 1,
  proy_lineal_usd: 30,
  proy_media7_usd: 28,
  fijos_eur_mes: 50,
  fijos_sin_verificar: 0,
  estimado_ia_usd_mes: 40,
  ...e,
});

const estimado = (e: Partial<IaCosteEstimado>): IaCosteEstimado => ({
  funcion: "chat_web",
  unidad: "pregunta",
  usd_por_unidad: 0.002,
  unidades_mes_estimadas: 1000,
  modelo: "gpt-5-mini",
  medido_en: "2026-09-01",
  nota: null,
  ...e,
});

describe("resumirSerieCoste", () => {
  it("ignora los días NULL en vez de contarlos como 0", () => {
    const r = resumirSerieCoste([dia("2026-09-01", 1), dia("2026-09-02", null), dia("2026-09-03", 3)]);
    expect(r.costeUsd).toBe(4);
    expect(r.diasConDato).toBe(2);
    expect(r.mediaDiaUsd).toBe(2);
  });

  it("sin ningún dato devuelve NULL, no 0", () => {
    const r = resumirSerieCoste([dia("2026-09-01", null)]);
    expect(r.costeUsd).toBeNull();
    expect(r.mediaDiaUsd).toBeNull();
    expect(r.peticiones).toBeNull();
  });

  it("cuenta las peticiones aunque el coste sea NULL (modelo sin tarifa)", () => {
    // Un modelo sin fila en ia_precios da coste NULL pero sí tiene tráfico:
    // perder esas peticiones haría creer que no se usó nada.
    const r = resumirSerieCoste([dia("2026-09-01", null, { peticiones: 40, llamadas: 5 })]);
    expect(r.costeUsd).toBeNull();
    expect(r.diasConDato).toBe(0);
    expect(r.peticiones).toBe(40);
    expect(r.llamadas).toBe(5);
  });

  it("cuenta anomalías solo cuando es_anomalia === true", () => {
    const r = resumirSerieCoste([
      dia("2026-09-01", 1, { es_anomalia: true }),
      dia("2026-09-02", 1, { es_anomalia: null }),
      dia("2026-09-03", 1, { es_anomalia: false }),
    ]);
    expect(r.anomalias).toBe(1);
  });

  it("suma los tokens de razonamiento aparte", () => {
    const r = resumirSerieCoste([dia("2026-09-01", 1), dia("2026-09-02", 1)]);
    expect(r.tokensRazonamiento).toBe(400);
    expect(r.tokensPrompt).toBe(2000);
  });
});

describe("construirPuntosCoste", () => {
  it("banda ±2σ recortada a 0 y NULL cuando falta la desviación", () => {
    const p = construirPuntosCoste([
      dia("2026-09-01", 2, { media_30: 1, desv_30: 0.8 }),
      dia("2026-09-02", 2, { media_30: 1, desv_30: null }),
    ]);
    expect(p[0].banda2).toEqual([0, 2.6]);
    expect(p[1].banda2).toBeNull();
    expect(p[0].dia).toBe("2026-09-01");
  });
});

describe("diasDesde", () => {
  const ahora = new Date("2026-09-28T12:00:00");
  it("cuenta días enteros desde una fecha sin hora", () => {
    expect(diasDesde("2026-09-28", ahora)).toBe(0);
    expect(diasDesde("2026-09-18", ahora)).toBe(10);
  });
  it("NULL si no hay fecha", () => {
    expect(diasDesde(null, ahora)).toBeNull();
  });
});

describe("calcularAvisosCostes", () => {
  const ahora = new Date("2026-09-28T12:00:00");

  it("separa las que no registran de las que deberían registrar y no lo hacen", () => {
    const a = calcularAvisosCostes({
      sinRegistro: [
        sinRegistro({ funcion: "ocr_facturas", instrumentada: false }),
        sinRegistro({ funcion: "chat_web", instrumentada: true, dias_sin_registro: 12 }),
      ],
      modelos: [],
      fijos: [],
      fijosSinVerificarRpc: 0,
      ahora,
    });
    expect(a.sinInstrumentar.map((f) => f.funcion)).toEqual(["ocr_facturas"]);
    expect(a.instrumentadasMudas.map((f) => f.funcion)).toEqual(["chat_web"]);
    expect(a.hayAvisos).toBe(true);
  });

  it("avisa de los modelos sin tarifa (coste NULL, que no es coste 0)", () => {
    const a = calcularAvisosCostes({
      sinRegistro: [],
      modelos: [modelo({ modelo: "gpt-6", tarifado: false, coste_usd: null }), modelo({})],
      fijos: [],
      fijosSinVerificarRpc: 0,
      ahora,
    });
    expect(a.modelosSinTarifa).toEqual(["gpt-6"]);
  });

  it("cuenta los fijos sin importe y marca los verificados hace más de 90 días", () => {
    const a = calcularAvisosCostes({
      sinRegistro: [],
      modelos: [],
      fijos: [
        fijo({ concepto: "VAPI", eur_mes: null }),
        fijo({ concepto: "Vercel", eur_mes: 20, verificado_en: "2026-01-01" }),
        fijo({ concepto: "Resend", eur_mes: 10, verificado_en: "2026-09-20" }),
        fijo({ concepto: "Dominio viejo", eur_mes: 12, activo: false, verificado_en: "2020-01-01" }),
      ],
      fijosSinVerificarRpc: 99,
      ahora,
    });
    // La tabla manda sobre el número de la RPC cuando está cargada.
    expect(a.fijosSinVerificar).toBe(1);
    expect(a.fijosCaducados.map((f) => f.concepto)).toEqual(["Vercel"]);
  });

  it("un fijo con importe pero sin fecha de verificación también avisa", () => {
    const a = calcularAvisosCostes({
      sinRegistro: [],
      modelos: [],
      fijos: [fijo({ concepto: "Supabase", eur_mes: 25, verificado_en: null })],
      fijosSinVerificarRpc: 0,
      ahora,
    });
    expect(a.fijosCaducados).toEqual([{ concepto: "Supabase", verificadoEn: null, dias: null }]);
  });

  it("usa el número de la RPC solo si la tabla no ha cargado", () => {
    const a = calcularAvisosCostes({
      sinRegistro: [],
      modelos: [],
      fijos: undefined,
      fijosSinVerificarRpc: 3,
      ahora,
    });
    expect(a.fijosSinVerificar).toBe(3);
  });

  it("sin nada que decir no hay avisos", () => {
    const a = calcularAvisosCostes({
      sinRegistro: [],
      modelos: [modelo({})],
      fijos: [fijo({ verificado_en: "2026-09-20" })],
      fijosSinVerificarRpc: 0,
      ahora,
    });
    expect(a.hayAvisos).toBe(false);
  });
});

describe("agruparCostesFijos", () => {
  it("agrupa por categoría, ignora los inactivos y no suma los NULL como 0", () => {
    const r = agruparCostesFijos([
      fijo({ concepto: "Supabase", categoria: "infraestructura", eur_mes: 25 }),
      fijo({ concepto: "Vercel", categoria: "infraestructura", eur_mes: null }),
      fijo({ concepto: "Dominio", categoria: "dominio", eur_mes: 1.5 }),
      fijo({ concepto: "Antiguo", categoria: "otros", eur_mes: 100, activo: false }),
    ]);
    expect(r.grupos.map((g) => g.categoria)).toEqual(["infraestructura", "dominio"]);
    expect(r.grupos[0].totalEur).toBe(25);
    expect(r.grupos[0].sinDato).toBe(1);
    expect(r.totalEur).toBe(26.5);
    expect(r.sinDato).toBe(1);
    expect(r.conDato).toBe(2);
  });

  it("si ningún importe está verificado el total es NULL, nunca 0", () => {
    const r = agruparCostesFijos([fijo({ concepto: "VAPI", eur_mes: null })]);
    expect(r.totalEur).toBeNull();
    expect(r.grupos[0].totalEur).toBeNull();
  });
});

describe("resumirEstimacion", () => {
  it("multiplica coste por unidad × volumen y totaliza", () => {
    const r = resumirEstimacion([
      estimado({ funcion: "chat_web", usd_por_unidad: 0.002, unidades_mes_estimadas: 1000 }),
      estimado({ funcion: "ocr", usd_por_unidad: 0.01, unidades_mes_estimadas: 200 }),
    ]);
    expect(r.filas[0].usdMes).toBeCloseTo(2);
    expect(r.filas[1].usdMes).toBeCloseTo(2);
    expect(r.totalUsdMes).toBeCloseTo(4);
  });

  it("sin filas el total es NULL, no 0", () => {
    expect(resumirEstimacion([]).totalUsdMes).toBeNull();
  });
});

describe("iaUsdMes", () => {
  it("prefiere la media de 7 días", () => {
    expect(iaUsdMes(mes())).toEqual({ usd: 28, origen: "media7" });
  });
  it("cae a la lineal y luego a la estimación medida a mano", () => {
    expect(iaUsdMes(mes({ proy_media7_usd: null }))).toEqual({ usd: 30, origen: "lineal" });
    expect(iaUsdMes(mes({ proy_media7_usd: null, proy_lineal_usd: null }))).toEqual({
      usd: 40,
      origen: "estimacion",
    });
  });
  it("sin ninguna cifra devuelve NULL", () => {
    const vacio = mes({ proy_media7_usd: null, proy_lineal_usd: null, estimado_ia_usd_mes: null });
    expect(iaUsdMes(vacio)).toEqual({ usd: null, origen: "ninguno" });
    expect(iaUsdMes(null)).toEqual({ usd: null, origen: "ninguno" });
  });
});

describe("calcularTotalMensual", () => {
  it("sin tarifa guardada conserva el coste conocido pero no inventa un margen", () => {
    const t = calcularTotalMensual(100, 50, null);
    expect(t.totalEurAprox).toBeCloseTo(100 * USD_EUR + 50);
    expect(t.margenEur).toBeNull();
    expect(t.margenPct).toBeNull();
  });
  it("convierte los dólares a euros y calcula el margen sobre lo facturado", () => {
    const t = calcularTotalMensual(100, 50, 246);
    expect(t.iaEurAprox).toBeCloseTo(100 * USD_EUR);
    expect(t.totalEurAprox).toBeCloseTo(100 * USD_EUR + 50);
    expect(t.margenEur).toBeCloseTo(246 - (100 * USD_EUR + 50));
    expect(t.margenPct).toBeCloseTo((100 * (246 - (100 * USD_EUR + 50))) / 246);
  });

  it("si falta una de las dos mitades el total es NULL: media suma no es un total", () => {
    expect(calcularTotalMensual(null, 50, 246).totalEurAprox).toBeNull();
    expect(calcularTotalMensual(100, null, 246).totalEurAprox).toBeNull();
    expect(calcularTotalMensual(null, 50, 246).margenEur).toBeNull();
  });

  it("un coste mayor que lo facturado da margen negativo", () => {
    expect(calcularTotalMensual(100, 200, 246).margenEur).toBeLessThan(0);
  });
});

describe("formato de dinero", () => {
  it("NULL se pinta como 'sin datos', nunca 0", () => {
    expect(fmtUsd(null)).toBe(SIN_DATOS);
    expect(fmtEur(undefined)).toBe(SIN_DATOS);
    expect(fmtUsdPreciso(null)).toBe(SIN_DATOS);
    expect(fmtTokens(null)).toBe(SIN_DATOS);
    expect(fmtUsd(0)).toBe("0,00 $");
  });

  it("los costes por unidad llevan 4 decimales: con 2 parecerían gratis", () => {
    expect(fmtUsd(0.0032)).toBe("0,00 $");
    expect(fmtUsdPreciso(0.0032)).toBe("0,0032 $");
  });

  it("toda cifra convertida de dólares lleva '≈' delante", () => {
    expect(fmtEurAprox(9.2)).toBe("≈ 9,20 €");
    expect(fmtEurAprox(null)).toBe(SIN_DATOS);
  });

  it("los tokens van en notación compacta", () => {
    // Intl mete un espacio duro (U+00A0) entre número y sufijo: se normaliza
    // para que el test no dependa de qué espacio use cada versión de ICU.
    expect(fmtTokens(1200000).replace(/\s/g, " ")).toBe("1,2 M");
  });
});
