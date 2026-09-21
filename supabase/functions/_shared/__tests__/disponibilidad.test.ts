// ============================================================
// BATERÍA DEL MOTOR DE DISPONIBILIDAD
// ============================================================
// Corre contra el MÓDULO PURO: sin red, sin Supabase, sin mocks, sin
// reloj real. Todo lo que depende del tiempo entra por parámetro.
//
//   npx vitest run supabase/functions/_shared
// ============================================================

import { describe, it, expect } from "vitest";
import {
  calcularDisponibilidad,
  horasOfrecidas,
  validarHoraOfrecida,
  BASE_UMBRAL_POR_DEFECTO,
  ahoraEnMadrid,
  diaDeLaSemana,
  diferenciaDias,
  horaAMinutos,
  minutosAHora,
  turnoDeHora,
  turnoSegunOcupacionDiaria,
  enFranjaDeDesajuste,
  normalizarEscalera,
  resolverEscalera,
  seleccionarConfiguraciones,
  HORA_CORTE_TURNO,
  HORA_CORTE_OCUPACION_DIARIA,
  AVISO_DESAJUSTE_TURNO,
  AVISO_UMBRALES_NO_MONOTONOS,
  AVISO_PERIODO_INVALIDO,
  AVISO_PERIODO_SIN_HUECOS,
  AVISO_OCULTAR_ANULADO,
  AVISO_CRUZA_MEDIANOCHE,
  AVISO_SIN_CAPACIDAD,
  AVISO_TOPE_HUECOS,
  AVISO_UMBRAL_FUERA_DE_RANGO,
  type ConfiguracionTurnoInput,
  type EntradaDisponibilidad,
  type NivelEscalera,
  type ReservaOcupante,
  type ResultadoDisponibilidad,
} from "../disponibilidad";

// ------------------------------------------------------------
// FIXTURES — la configuración REAL de producción
// ------------------------------------------------------------

/** 3 espacios activos x 50 = 150, igual que `espacios_reserva` hoy. */
const CAPACIDAD = 150;

/**
 * Capacidad elegida para que el DIVISOR salga redondo: los turnos de estas
 * pruebas tienen tres horas en punto, y el modo por defecto
 * (`reparto_nivel_base`) reparte el aforo entre ellas -> 300 / 3 = 100.
 * Así "70 comensales" es exactamente el 70%.
 */
const CAPACIDAD_100 = 300;

const LUNES = "2026-06-15";
const DOMINGO = "2026-06-21";
const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6];

const COMIDA: ConfiguracionTurnoInput = {
  id: "cfg-comida",
  nombre_periodo: "Comida",
  hora_inicio: "13:00:00",
  hora_fin: "16:00:00",
  intervalo_base_minutos: 30,
  umbral_apertura_secundario: 40,
  ocultar_primario_si_secundario: false,
  dias_semana: TODOS_LOS_DIAS,
  activo: true,
  espacio_id: null,
};

const CENA: ConfiguracionTurnoInput = {
  ...COMIDA,
  id: "cfg-cena",
  nombre_periodo: "Cena",
  hora_inicio: "20:00:00",
  hora_fin: "23:00:00",
};

const r = (hora: string, comensales: number, espacio_id: string | null = null): ReservaOcupante => ({
  hora,
  numero_comensales: comensales,
  espacio_id,
});

const escalera = (...niveles: [number, number][]): NivelEscalera[] =>
  niveles.map(([minutos, umbral]) => ({ minutos, umbral }));

function calcular(entrada: Partial<EntradaDisponibilidad> = {}): ResultadoDisponibilidad {
  return calcularDisponibilidad({
    fecha: LUNES,
    comensales: 2,
    configuraciones: [COMIDA, CENA],
    reservas: [],
    capacidadTotal: CAPACIDAD,
    ahora: null,
    ...entrada,
  });
}

const horasDe = (res: ResultadoDisponibilidad) => res.huecos.map((h) => h.hora);
const hueco = (res: ResultadoDisponibilidad, hora: string) => res.huecos.find((h) => h.hora === hora);

// ============================================================
// 0. SANIDAD DE LOS AYUDANTES DE TIEMPO
// ============================================================
describe("ayudantes de tiempo", () => {
  it("parsea y formatea horas con y sin segundos", () => {
    expect(horaAMinutos("13:00")).toBe(780);
    expect(horaAMinutos("13:00:00")).toBe(780);
    expect(horaAMinutos("00:30")).toBe(30);
    expect(horaAMinutos("basura")).toBeNull();
    expect(horaAMinutos(null)).toBeNull();
    expect(horaAMinutos("25:00")).toBeNull();
    expect(minutosAHora(780)).toBe("13:00");
    expect(minutosAHora(1470)).toBe("00:30"); // pasa de medianoche
  });

  it("calcula el día de la semana sin depender de la zona horaria del proceso", () => {
    // Bug del panel: `new Date(fecha).getDay()` devolvía el día ANTERIOR en
    // zonas al oeste de Greenwich, así que un domingo se comprobaba contra
    // la configuración del sábado.
    expect(diaDeLaSemana(LUNES)).toBe(1);
    expect(diaDeLaSemana(DOMINGO)).toBe(0);
    expect(diaDeLaSemana("2026-02-30")).toBeNull(); // fecha que no existe
    expect(diaDeLaSemana("15/06/2026")).toBeNull();
  });

  it("cuenta días naturales entre fechas", () => {
    expect(diferenciaDias(LUNES, LUNES)).toBe(0);
    expect(diferenciaDias(LUNES, "2026-06-16")).toBe(1);
    expect(diferenciaDias("2026-06-16", LUNES)).toBe(-1);
    // A través del cambio de horario de verano sigue siendo 1 día natural.
    expect(diferenciaDias("2026-03-28", "2026-03-29")).toBe(1);
    expect(diferenciaDias("2026-10-24", "2026-10-25")).toBe(1);
  });
});

// ============================================================
// 1. LA ESCALERA: SEGUNDO NIVEL (las medias)
// ============================================================
describe("segundo nivel — las medias", () => {
  it("por debajo del umbral NO ofrece la media", () => {
    // El umbral se mide sobre las plazas REPARTIDAS por hora: 150 entre las
    // tres horas en punto de la comida = 50. El 40% son 20 comensales, así
    // que 19 se queda por debajo.
    const res = calcular({ reservas: [r("13:00", 19)] });
    expect(horasDe(res)).toEqual(["13:00", "14:00", "15:00", "20:00", "21:00", "22:00"]);
    expect(hueco(res, "13:30")).toBeUndefined();
    const descarte = res.descartados.find((d) => d.hora === "13:30");
    expect(descarte?.motivo).toBe("nivel_sin_abrir");
    expect(descarte?.detalle).toContain("13:00");
  });

  it("JUSTO en el umbral SÍ abre la media (comparación >=, no >)", () => {
    const res = calcular({ reservas: [r("13:00", 20)] }); // 20/50 = 40% exacto
    expect(horasDe(res)).toContain("13:30");
    expect(hueco(res, "13:30")?.nivel).toBe(1);
    expect(hueco(res, "13:30")?.abierto_por).toBe("13:00");
    expect(hueco(res, "13:30")?.abierto_con_porcentaje).toBe(40);
  });

  it("uno por debajo y uno por encima del umbral exacto", () => {
    expect(horasDe(calcular({ reservas: [r("13:00", 19)] }))).not.toContain("13:30");
    expect(horasDe(calcular({ reservas: [r("13:00", 20)] }))).toContain("13:30");
    expect(horasDe(calcular({ reservas: [r("13:00", 21)] }))).toContain("13:30");
  });

  it("cada media cuelga de SU hora, no de la ocupación global del turno", () => {
    // 14:00 lleno, 13:00 y 15:00 vacíos: solo se abre 14:30.
    const res = calcular({ reservas: [r("14:00", 20)] });
    expect(horasDe(res)).toContain("14:30");
    expect(horasDe(res)).not.toContain("13:30");
    expect(horasDe(res)).not.toContain("15:30");
  });

  it("sin reservas no se abre ninguna media", () => {
    const res = calcular();
    expect(horasDe(res)).toEqual(["13:00", "14:00", "15:00", "20:00", "21:00", "22:00"]);
  });
});

// ============================================================
// 2. ocultar_primario_si_secundario / ocultar_nivel_anterior
// ============================================================
describe("ocultar el nivel anterior", () => {
  it("en false se ofrecen las dos: la entera y la media", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, ocultar_primario_si_secundario: false }],
      reservas: [r("13:00", 20)],
    });
    expect(horasDe(res)).toEqual(["13:00", "13:30", "14:00", "15:00"]);
  });

  it("en true la entera deja de ofrecerse cuando se abre la media", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, ocultar_primario_si_secundario: true }],
      reservas: [r("13:00", 20)],
    });
    expect(horasDe(res)).toEqual(["13:30", "14:00", "15:00"]);
    const descarte = res.descartados.find((d) => d.hora === "13:00");
    expect(descarte?.motivo).toBe("oculto_por_nivel_inferior");
  });

  it("la columna nueva `ocultar_nivel_anterior` manda sobre la antigua", () => {
    const res = calcular({
      configuraciones: [
        { ...COMIDA, ocultar_primario_si_secundario: false, ocultar_nivel_anterior: true },
      ],
      reservas: [r("13:00", 20)],
    });
    expect(horasDe(res)).not.toContain("13:00");
  });

  it("al ocultar, la hora entera desaparece pero la media se queda", () => {
    const res = calcular({
      configuraciones: [
        {
          ...COMIDA,
          hora_inicio: "13:00",
          hora_fin: "13:31",
          niveles_escalera: escalera([60, 0], [30, 0]),
          ocultar_nivel_anterior: true,
        },
      ],
      reservas: [],
    });
    expect(horasDe(res)).toEqual(["13:30"]);
  });

  it("ocultar NUNCA deja un periodo sin una sola hora (invariante)", () => {
    // Es LA garantía: pase lo que pase con la escalera y la ocupación, si el
    // periodo abre, el cliente ve algo que pulsar. Si alguna combinación la
    // rompiera, el motor anula el ocultado y levanta AVISO_OCULTAR_ANULADO.
    const escaleras = [
      escalera([60, 0], [30, 0]),
      escalera([60, 0], [30, 0], [15, 0]),
      escalera([60, 0], [30, 0], [15, 0], [10, 0]),
      escalera([60, 0], [30, 50]),
      escalera([120, 0], [60, 0], [30, 0]),
    ];
    const ocupaciones = [[], [r("13:00", 150)], [r("13:00", 75), r("13:30", 150)]];
    for (const niveles_escalera of escaleras) {
      for (const reservas of ocupaciones) {
        const res = calcular({
          configuraciones: [{ ...COMIDA, niveles_escalera, ocultar_nivel_anterior: true }],
          reservas,
        });
        expect(res.huecos.length).toBeGreaterThan(0);
        if (res.avisos.includes(AVISO_OCULTAR_ANULADO)) {
          expect(horasDe(res)).toContain("13:00");
        }
      }
    }
  });
});

// ============================================================
// 3. TERCER NIVEL: LOS CUARTOS
// ============================================================
describe("tercer nivel — los cuartos", () => {
  const CON_CUARTOS: ConfiguracionTurnoInput = {
    ...COMIDA,
    niveles_escalera: escalera([60, 0], [30, 70], [15, 85]),
  };
  const base = (reservas: ReservaOcupante[]) =>
    calcular({ configuraciones: [CON_CUARTOS], reservas, capacidadTotal: CAPACIDAD_100 });

  it("no se abre antes de su umbral, aunque la media ya esté abierta", () => {
    const res = base([r("13:00", 70)]); // 70% exacto: abre la media, no el cuarto
    expect(horasDe(res)).toContain("13:30");
    expect(horasDe(res)).not.toContain("13:15");
    const descarte = res.descartados.find((d) => d.hora === "13:15");
    expect(descarte?.detalle).toContain("85%");
  });

  it("se abre JUSTO al alcanzar su umbral", () => {
    expect(horasDe(base([r("13:00", 84)]))).not.toContain("13:15");
    expect(horasDe(base([r("13:00", 85)]))).toContain("13:15");
    expect(horasDe(base([r("13:00", 86)]))).toContain("13:15");
  });

  it("el cuarto de después de la media cuelga de LA MEDIA, no de la entera", () => {
    // 13:45 sólo puede abrirse si 13:30 (su padre) llega al 85%.
    const soloEntera = base([r("13:00", 90)]);
    expect(horasDe(soloEntera)).toContain("13:15");
    expect(horasDe(soloEntera)).not.toContain("13:45");

    const tambienMedia = base([r("13:00", 90), r("13:30", 85)]);
    expect(horasDe(tambienMedia)).toContain("13:45");
    expect(hueco(tambienMedia, "13:45")?.abierto_por).toBe("13:30");
  });

  it("un cuarto NUNCA se ofrece si su media padre no se ofrece", () => {
    // Umbral de la media altísimo: 13:30 no abre, así que 13:45 tampoco,
    // pase lo que pase con la ocupación de 13:30.
    const res = calcular({
      configuraciones: [{ ...COMIDA, niveles_escalera: escalera([60, 0], [30, 99], [15, 0]) }],
      reservas: [r("13:00", 10), r("13:30", 100)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(horasDe(res)).not.toContain("13:30");
    expect(horasDe(res)).not.toContain("13:45");
    // 13:15 tampoco: su umbral (0) se ha subido al 99 del nivel anterior al
    // hacer la escalera monótona, y 13:00 solo va por el 10%.
    expect(horasDe(res)).not.toContain("13:15");
    expect(res.avisos).toContain(AVISO_UMBRALES_NO_MONOTONOS);
  });

  it("la media cerrada bloquea su cuarto aunque el cuarto tenga de sobra", () => {
    // 13:30 está al 100% de ocupación pero NO se ofrece (13:00 va por el 10%
    // y el umbral de la media es 70). 13:45, que cuelga de 13:30, tampoco.
    const res = calcular({
      configuraciones: [{ ...COMIDA, niveles_escalera: escalera([60, 0], [30, 70], [15, 70]) }],
      reservas: [r("13:00", 10), r("13:30", 100)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(horasDe(res)).not.toContain("13:30");
    expect(horasDe(res)).not.toContain("13:45");
    expect(res.descartados.find((d) => d.hora === "13:45")?.motivo).toBe("nivel_sin_abrir");
  });

  it("la escalera entera de un tirón: 13:00 -> +13:30 -> +13:15", () => {
    expect(horasDe(base([]))).toEqual(["13:00", "14:00", "15:00"]);
    expect(horasDe(base([r("13:00", 70)]))).toEqual(["13:00", "13:30", "14:00", "15:00"]);
    expect(horasDe(base([r("13:00", 85)]))).toEqual([
      "13:00",
      "13:15",
      "13:30",
      "14:00",
      "15:00",
    ]);
  });

  it("los niveles que se solapan en la misma hora no la duplican", () => {
    // 13:00 está en la rejilla de 60, en la de 30 y en la de 15. Debe salir
    // UNA vez y con el nivel MÁS GRUESO (0).
    const res = base([r("13:00", 90), r("13:30", 90)]);
    expect(res.huecos.filter((h) => h.hora === "13:00")).toHaveLength(1);
    expect(hueco(res, "13:00")?.nivel).toBe(0);
    expect(hueco(res, "13:30")?.nivel).toBe(1);
    expect(hueco(res, "13:15")?.nivel).toBe(2);
    const horas = horasDe(res);
    expect(new Set(horas).size).toBe(horas.length);
  });

  it("ocultar con tres niveles va escalón a escalón", () => {
    const res = calcular({
      configuraciones: [
        { ...CON_CUARTOS, ocultar_nivel_anterior: true },
      ],
      reservas: [r("13:00", 90), r("13:30", 90)],
      capacidadTotal: CAPACIDAD_100,
    });
    // 13:15 oculta a 13:00; 13:45 oculta a 13:30.
    expect(horasDe(res)).toEqual(["13:15", "13:45", "14:00", "15:00"]);
  });
});

// ============================================================
// 4. LA ESCALERA ES DE N NIVELES, NO DE TRES
// ============================================================
describe("escalera de N niveles", () => {
  it("acepta un CUARTO nivel arbitrario (10 min) que hoy no existe", () => {
    const res = calcular({
      configuraciones: [
        { ...COMIDA, niveles_escalera: escalera([60, 0], [30, 50], [15, 70], [10, 90]) },
      ],
      reservas: [r("13:00", 95)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(horasDe(res)).toContain("13:10");
    expect(hueco(res, "13:10")?.nivel).toBe(3);
    expect(hueco(res, "13:10")?.minutos_nivel).toBe(10);
    expect(hueco(res, "13:10")?.etiqueta_nivel).toBe("cada 10 min");
    // Por debajo del 90% el cuarto escalón no aparece.
    const flojo = calcular({
      configuraciones: [
        { ...COMIDA, niveles_escalera: escalera([60, 0], [30, 50], [15, 70], [10, 90]) },
      ],
      reservas: [r("13:00", 80)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(horasDe(flojo)).toContain("13:15");
    expect(horasDe(flojo)).not.toContain("13:10");
  });

  it("funciona con UN SOLO nivel (sin escalera)", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, niveles_escalera: escalera([60, 0]) }],
      reservas: [r("13:00", 150)],
    });
    expect(horasDe(res)).toEqual(["13:00", "14:00", "15:00"]);
  });

  it("funciona con CINCO niveles", () => {
    const res = calcular({
      configuraciones: [
        { ...COMIDA, niveles_escalera: escalera([60, 0], [30, 20], [20, 40], [15, 60], [5, 80]) },
      ],
      reservas: [r("13:00", 100)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(res.periodos[0].escalera).toHaveLength(5);
    expect(horasDe(res)).toContain("13:30");
    expect(horasDe(res)).toContain("13:15");
    expect(horasDe(res)).toContain("13:05");
  });

  it("el orden de guardado da igual: se ordena de grueso a fino", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, niveles_escalera: escalera([15, 85], [60, 99], [30, 70]) }],
      reservas: [],
    });
    expect(res.periodos[0].escalera.map((n) => n.minutos)).toEqual([60, 30, 15]);
    // El umbral del nivel más grueso se ignora: siempre está abierto.
    expect(res.periodos[0].escalera[0].umbral).toBe(0);
    expect(horasDe(res)).toContain("13:00");
  });

  it("acepta la escalera como texto JSON (por si jsonb llega serializado)", () => {
    const res = calcular({
      configuraciones: [
        { ...COMIDA, niveles_escalera: '[{"minutos":60,"umbral":0},{"minutos":30,"umbral":10}]' },
      ],
      reservas: [r("13:00", 15)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(res.periodos[0].origen_escalera).toBe("niveles_escalera");
    expect(horasDe(res)).toContain("13:30");
  });
});

// ============================================================
// 5. COMPATIBILIDAD HACIA ATRÁS
// ============================================================
describe("compatibilidad con la configuración de producción", () => {
  it("sin `niveles_escalera` deriva [60/0, 30/40] de las columnas viejas", () => {
    const { escalera: e, origen } = resolverEscalera(COMIDA, new Set());
    expect(origen).toBe("legacy");
    expect(e).toEqual([
      { minutos: 60, umbral: 0 },
      { minutos: 30, umbral: 40 },
    ]);
  });

  it("con el umbral nuevo (70) la media se abre más tarde", () => {
    const conf = { ...COMIDA, umbral_apertura_secundario: 70 };
    // 70% de las 50 plazas por hora = 35 personas a esa misma hora.
    expect(horasDe(calcular({ configuraciones: [conf], reservas: [r("13:00", 34)] }))).not.toContain("13:30");
    expect(horasDe(calcular({ configuraciones: [conf], reservas: [r("13:00", 35)] }))).toContain("13:30");
  });

  it("un intervalo >= 60 colapsa a un solo nivel en vez de duplicarlo", () => {
    const { escalera: e } = resolverEscalera(
      { ...COMIDA, intervalo_base_minutos: 60 },
      new Set(),
    );
    expect(e).toEqual([{ minutos: 60, umbral: 0 }]);
  });

  it("`niveles_escalera` basura cae a las columnas viejas sin romper", () => {
    for (const basura of [null, undefined, [], "{}", "no-json", 42, { minutos: 30 }, [{ x: 1 }]]) {
      const { escalera: e, origen } = resolverEscalera(
        { ...COMIDA, niveles_escalera: basura },
        new Set(),
      );
      expect(origen).toBe("legacy");
      expect(e[0]).toEqual({ minutos: 60, umbral: 0 });
    }
  });
});

// ============================================================
// 6. TURNO COMPLETO vs DÍA CERRADO vs ERROR
// ============================================================
describe("turno completo, día cerrado y error son TRES cosas distintas", () => {
  it("turno de comida lleno: se siguen listando sus horas, pero completas", () => {
    const res = calcular({ comensales: 2, reservas: [r("13:00", 150)] });
    expect(res.cerrado).toBe(false);
    const comida = res.huecos.filter((h) => h.turno === "comida");
    expect(comida.length).toBeGreaterThan(0);
    expect(comida.every((h) => h.estado === "completo")).toBe(true);
    expect(comida.every((h) => h.motivo === "aforo_turno_completo")).toBe(true);
    expect(horasOfrecidas(res)).toEqual(["20:00", "21:00", "22:00"]); // la cena sigue viva
    expect(res.aforo.comida.completo).toBe(true);
    expect(res.aforo.cena.completo).toBe(false);
  });

  it("día CERRADO: cero periodos, cero huecos, y `cerrado` explícito", () => {
    const res = calcular({
      fecha: DOMINGO,
      configuraciones: [{ ...COMIDA, dias_semana: [1, 2, 3, 4, 5, 6] }], // sin domingo
    });
    expect(res.cerrado).toBe(true);
    expect(res.motivoCierre).toBe("dia_no_configurado");
    expect(res.periodos).toHaveLength(0);
    expect(res.huecos).toHaveLength(0);
  });

  it("un día lleno NO es un día cerrado", () => {
    const lleno = calcular({ reservas: [r("13:00", 150), r("20:00", 150)] });
    expect(lleno.cerrado).toBe(false);
    expect(lleno.huecos.length).toBeGreaterThan(0);
    expect(horasOfrecidas(lleno)).toHaveLength(0);
  });

  it("sin configuración ninguna: cerrado con motivo distinto", () => {
    const res = calcular({ configuraciones: [] });
    expect(res.cerrado).toBe(true);
    expect(res.motivoCierre).toBe("sin_configuracion");
  });

  it("el motor NUNCA lanza: un error de verdad solo puede venir de fuera", () => {
    // Esto es lo que permite distinguir "error" de las otras dos respuestas:
    // si el motor devuelve algo, no es un error.
    const basuras: Partial<EntradaDisponibilidad>[] = [
      { fecha: "" },
      { fecha: "no-es-una-fecha" },
      { configuraciones: [null as any, undefined as any] },
      { reservas: [null as any, { hora: "x", numero_comensales: NaN } as any] },
      { capacidadTotal: NaN as any },
      { comensales: -5 },
      { configuraciones: [{ hora_inicio: "", hora_fin: "" } as any] },
    ];
    for (const basura of basuras) {
      expect(() => calcular(basura)).not.toThrow();
    }
  });
});

// ============================================================
// 7. DÍAS DE LA SEMANA
// ============================================================
describe("dias_semana", () => {
  it("un día que no está en `dias_semana` sale cerrado", () => {
    const soloFinde = { ...COMIDA, dias_semana: [0, 6] };
    expect(calcular({ fecha: LUNES, configuraciones: [soloFinde] }).cerrado).toBe(true);
    expect(calcular({ fecha: DOMINGO, configuraciones: [soloFinde] }).cerrado).toBe(false);
  });

  it("`dias_semana` vacío o nulo significa TODOS los días", () => {
    expect(calcular({ configuraciones: [{ ...COMIDA, dias_semana: [] }] }).cerrado).toBe(false);
    expect(calcular({ configuraciones: [{ ...COMIDA, dias_semana: null }] }).cerrado).toBe(false);
  });

  it("`activo: false` no cuenta", () => {
    expect(calcular({ configuraciones: [{ ...COMIDA, activo: false }] }).cerrado).toBe(true);
  });

  it("un turno cerrado y otro abierto el mismo día: solo se ofrece el abierto", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, dias_semana: [0] }, CENA],
      fecha: LUNES,
    });
    expect(res.periodos.map((p) => p.nombre_periodo)).toEqual(["Cena"]);
    expect(horasDe(res)).toEqual(["20:00", "21:00", "22:00"]);
  });
});

// ============================================================
// 8. COMENSALES: HAY HUECO DE HORA PERO NO DE SITIO
// ============================================================
describe("aforo por número de comensales", () => {
  it("la misma hora está libre para 2 y completa para 10", () => {
    const reservas = [r("13:00", 145)]; // quedan 5 plazas en el turno
    expect(hueco(calcular({ comensales: 2, reservas }), "13:00")?.estado).toBe("libre");
    expect(hueco(calcular({ comensales: 5, reservas }), "13:00")?.estado).toBe("libre");
    expect(hueco(calcular({ comensales: 6, reservas }), "13:00")?.estado).toBe("completo");
    expect(hueco(calcular({ comensales: 10, reservas }), "13:00")?.estado).toBe("completo");
  });

  it("una media recién abierta puede nacer ya completa", () => {
    // 13:00 al 100% abre la media... y el turno está lleno, así que la
    // media se ofrece como "completo", no como hueco real.
    const res = calcular({ comensales: 4, reservas: [r("13:00", 150)] });
    expect(hueco(res, "13:30")?.estado).toBe("completo");
    expect(hueco(res, "13:30")?.nivel).toBe(1);
  });

  it("el aforo es del TURNO entero, como el trigger, no de la hora suelta", () => {
    // 90 a las 13:00 + 60 a las 15:00 = 150 en el turno de comida. Las
    // 14:00 están vacías de reservas y aun así no cabe nadie más.
    const res = calcular({ comensales: 1, reservas: [r("13:00", 90), r("15:00", 60)] });
    expect(hueco(res, "14:00")?.comensales_hora).toBe(0);
    expect(hueco(res, "14:00")?.estado).toBe("completo");
    expect(res.aforo.comida.ocupacion).toBe(150);
    expect(res.aforo.comida.disponible).toBe(0);
  });

  it("comensales ausente o inválido se trata como 1", () => {
    expect(calcular({ comensales: null }).comensales).toBe(1);
    expect(calcular({ comensales: 0 }).comensales).toBe(1);
    expect(calcular({ comensales: NaN as any }).comensales).toBe(1);
  });
});

// ============================================================
// 9. FRONTERA COMIDA/CENA Y EL DESAJUSTE 16:00 / 17:00
// ============================================================
describe("frontera de turno y desajuste 16:00/17:00", () => {
  it("el corte del motor es el del trigger de aforo: 17:00", () => {
    expect(HORA_CORTE_TURNO).toBe("17:00");
    expect(HORA_CORTE_OCUPACION_DIARIA).toBe("16:00");
    expect(turnoDeHora("16:59")).toBe("comida");
    expect(turnoDeHora("17:00")).toBe("cena");
    expect(turnoDeHora("13:00")).toBe("comida");
  });

  it("la franja [16:00,17:00) es donde los dos triggers discrepan", () => {
    expect(turnoDeHora("16:30")).toBe("comida"); // trg_validar_capacidad
    expect(turnoSegunOcupacionDiaria("16:30")).toBe("cena"); // ocupacion_diaria
    expect(enFranjaDeDesajuste("16:30")).toBe(true);
    expect(enFranjaDeDesajuste("15:59")).toBe(false);
    expect(enFranjaDeDesajuste("17:00")).toBe(false);
  });

  it("una reserva de las 16:30 suma al turno de COMIDA, como el trigger", () => {
    const res = calcular({ reservas: [r("16:30", 20)] });
    expect(res.aforo.comida.ocupacion).toBe(20);
    expect(res.aforo.cena.ocupacion).toBe(0);
  });

  it("con la configuración de HOY el desajuste no llega a morder", () => {
    // Comida 13-16 y cena 20-23: ningún hueco cae en [16:00,17:00).
    const res = calcular();
    expect(res.avisos).not.toContain(AVISO_DESAJUSTE_TURNO);
    expect(res.huecos.every((h) => !enFranjaDeDesajuste(h.hora))).toBe(true);
  });

  it("un periodo que pisa la franja levanta el aviso", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, hora_fin: "17:00" }],
    });
    expect(res.avisos).toContain(AVISO_DESAJUSTE_TURNO);
    expect(hueco(res, "16:00")?.turno).toBe("comida");
  });

  it("un periodo que cruza medianoche avisa de que el turno es engañoso", () => {
    // El trigger clasifica las 00:30 como COMIDA (00:30 < 17:00), aunque
    // para el restaurante sea el final de la cena. El motor replica al
    // trigger (es quien manda) y avisa.
    const res = calcular({
      configuraciones: [{ ...CENA, hora_inicio: "22:00", hora_fin: "01:00" }],
    });
    expect(res.avisos).toContain(AVISO_CRUZA_MEDIANOCHE);
    expect(horasDe(res)).toEqual(["22:00", "23:00", "00:00"]); // orden de SERVICIO
    expect(hueco(res, "00:00")?.turno).toBe("comida");
  });
});

// ============================================================
// 10. ZONA HORARIA: Europe/Madrid, horario de verano y corte
// ============================================================
describe("Europe/Madrid", () => {
  it("resuelve la hora local aunque el proceso corra en UTC", () => {
    // Deno Deploy y Vercel corren en UTC; el navegador, en cualquier zona.
    const invierno = ahoraEnMadrid(new Date("2026-01-15T12:00:00Z")); // CET = +1
    expect(invierno).toEqual({ fechaHoy: "2026-01-15", minutosDelDia: 13 * 60 });

    const verano = ahoraEnMadrid(new Date("2026-07-15T12:00:00Z")); // CEST = +2
    expect(verano).toEqual({ fechaHoy: "2026-07-15", minutosDelDia: 14 * 60 });
  });

  it("salto de primavera: la hora 02:xx del 29/03 no existe", () => {
    expect(ahoraEnMadrid(new Date("2026-03-29T00:30:00Z")).minutosDelDia).toBe(90); // 01:30 CET
    expect(ahoraEnMadrid(new Date("2026-03-29T01:30:00Z")).minutosDelDia).toBe(210); // 03:30 CEST
  });

  it("salto de otoño: el 25/10 las 02:30 ocurren dos veces", () => {
    const primera = ahoraEnMadrid(new Date("2026-10-25T00:30:00Z")); // CEST
    const segunda = ahoraEnMadrid(new Date("2026-10-25T01:30:00Z")); // CET
    expect(primera.minutosDelDia).toBe(150);
    expect(segunda.minutosDelDia).toBe(150);
    expect(primera.fechaHoy).toBe("2026-10-25");
    expect(segunda.fechaHoy).toBe("2026-10-25");
  });

  it("cerca de medianoche el día de Madrid ya es el siguiente", () => {
    // 23:30 UTC del 15 = 00:30 del 16 en Madrid (invierno). Si se usara la
    // fecha UTC, "hoy" sería el día equivocado y el corte horario fallaría.
    expect(ahoraEnMadrid(new Date("2026-01-15T23:30:00Z")).fechaHoy).toBe("2026-01-16");
    expect(ahoraEnMadrid(new Date("2026-07-15T22:30:00Z")).fechaHoy).toBe("2026-07-16");
  });

  it("el corte horario tapa las horas demasiado cercanas SOLO hoy", () => {
    const ahora = { fechaHoy: LUNES, minutosDelDia: 13 * 60 }; // 13:00 en Madrid
    const hoy = calcular({
      fecha: LUNES,
      ahora,
      politica: { permitirMismoDia: true, minutosCorte: 60 },
    });
    // 13:00 y 13:30 quedan dentro de los 60 min de corte; 14:00 justo fuera.
    expect(horasDe(hoy)).toEqual(["14:00", "15:00", "20:00", "21:00", "22:00"]);
    expect(hoy.descartados.find((d) => d.hora === "13:00")?.motivo).toBe("corte_horario");

    // Mañana el corte no aplica: se ofrecen todas.
    const manana = calcular({
      fecha: "2026-06-16",
      ahora,
      politica: { permitirMismoDia: true, minutosCorte: 60 },
    });
    expect(horasDe(manana)).toContain("13:00");
  });

  it("el corte compara con el minuto exacto, no con la hora", () => {
    const enPunto = (minutosDelDia: number) =>
      horasDe(
        calcular({
          fecha: LUNES,
          configuraciones: [COMIDA],
          ahora: { fechaHoy: LUNES, minutosDelDia },
          politica: { permitirMismoDia: true, minutosCorte: 60 },
        }),
      );
    expect(enPunto(12 * 60)).toContain("13:00"); // 13:00 - 12:00 = 60 >= 60
    expect(enPunto(12 * 60 + 1)).not.toContain("13:00"); // 59 < 60
  });

  it("la web no ofrece huecos de HOY, porque /crear los rechaza", () => {
    const res = calcular({
      fecha: LUNES,
      ahora: { fechaHoy: LUNES, minutosDelDia: 9 * 60 },
      politica: { permitirMismoDia: false, minutosCorte: 60 },
    });
    expect(res.cerrado).toBe(false); // el restaurante SÍ abre
    expect(res.reservable).toBe(false); // pero no por este canal
    expect(res.motivoNoReservable).toBe("reserva_hoy");
    expect(res.huecos).toHaveLength(0);
    expect(res.descartados.every((d) => d.motivo === "reserva_hoy")).toBe(true);
  });

  it("fecha pasada y fecha demasiado lejana se distinguen de día cerrado", () => {
    const ahora = { fechaHoy: LUNES, minutosDelDia: 600 };
    const pasada = calcular({ fecha: "2026-06-01", ahora, politica: {} });
    expect(pasada.cerrado).toBe(false);
    expect(pasada.motivoNoReservable).toBe("fecha_pasada");

    const lejana = calcular({
      fecha: "2026-12-25",
      ahora,
      politica: { diasMaxAntelacion: 60 },
    });
    expect(lejana.motivoNoReservable).toBe("fecha_demasiado_lejana");
  });

  it("sin `ahora` no se aplica ninguna regla temporal (uso del panel)", () => {
    const res = calcular({ fecha: "2020-01-01", ahora: null });
    expect(res.reservable).toBe(true);
    expect(res.motivoNoReservable).toBeNull();
  });
});

// ============================================================
// 11. CONFIGURACIÓN POR ZONA (espacio_id)
// ============================================================
describe("espacio_id", () => {
  const TERRAZA = "5888d22a-f228-41f5-8a9d-c8b3ee255863";
  const SALON = "db8be4e2-2e67-4110-99b1-9e1d779514cc";

  const GLOBAL = { ...COMIDA, id: "global", espacio_id: null };
  const DE_TERRAZA: ConfiguracionTurnoInput = {
    ...COMIDA,
    id: "terraza",
    nombre_periodo: "Comida terraza",
    hora_inicio: "12:00",
    hora_fin: "15:00",
    espacio_id: TERRAZA,
  };

  it("sin espacio se usan SOLO las globales", () => {
    const res = calcular({ configuraciones: [GLOBAL, DE_TERRAZA], espacioId: null });
    expect(res.periodos.map((p) => p.id)).toEqual(["global"]);
    expect(horasDe(res)).toEqual(["13:00", "14:00", "15:00"]);
  });

  it("la configuración del espacio gana sobre la global", () => {
    const res = calcular({ configuraciones: [GLOBAL, DE_TERRAZA], espacioId: TERRAZA });
    expect(res.periodos.map((p) => p.id)).toEqual(["terraza"]);
    expect(horasDe(res)).toEqual(["12:00", "13:00", "14:00"]);
  });

  it("un espacio SIN configuración propia cae a la global", () => {
    const res = calcular({ configuraciones: [GLOBAL, DE_TERRAZA], espacioId: SALON });
    expect(res.periodos.map((p) => p.id)).toEqual(["global"]);
  });

  it("cada zona puede tener su propia escalera", () => {
    const res = calcular({
      configuraciones: [
        GLOBAL,
        { ...DE_TERRAZA, niveles_escalera: escalera([60, 0], [30, 10]) },
      ],
      espacioId: TERRAZA,
      reservas: [r("13:00", 20)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(horasDe(res)).toContain("13:30");
    // Con la global (umbral 40) esa misma ocupación NO abriría la media.
    const global = calcular({
      configuraciones: [GLOBAL],
      espacioId: null,
      reservas: [r("13:00", 20)],
      capacidadTotal: CAPACIDAD_100,
    });
    expect(horasDe(global)).not.toContain("13:30");
  });

  it("`seleccionarConfiguraciones` cruza espacio y día de la semana", () => {
    const soloDomingoTerraza = { ...DE_TERRAZA, dias_semana: [0] };
    expect(seleccionarConfiguraciones([GLOBAL, soloDomingoTerraza], TERRAZA, 1)).toHaveLength(0);
    expect(seleccionarConfiguraciones([GLOBAL, soloDomingoTerraza], TERRAZA, 0)).toHaveLength(1);
  });
});

// ============================================================
// 12. DATOS CORRUPTOS Y CONFIGURACIÓN ABSURDA
// ============================================================
describe("datos corruptos", () => {
  it("una reserva fuera de cualquier turno cuenta al aforo pero no crea hueco", () => {
    const res = calcular({ reservas: [r("09:30", 20)] });
    expect(res.aforo.comida.ocupacion).toBe(20); // 09:30 < 17:00 -> comida
    expect(horasDe(res)).not.toContain("09:30");
    expect(res.ocupacion.find((o) => o.hora === "09:30")?.total_comensales).toBe(20);
  });

  it("umbral 0 abre el nivel siempre, incluso sin una sola reserva", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, umbral_apertura_secundario: 0 }],
      reservas: [],
    });
    expect(horasDe(res)).toEqual(["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]);
  });

  it("umbral 100 solo abre con el aforo al tope", () => {
    const conf = { ...COMIDA, umbral_apertura_secundario: 100 };
    expect(horasDe(calcular({ configuraciones: [conf], reservas: [r("13:00", 49)] }))).not.toContain("13:30");
    expect(horasDe(calcular({ configuraciones: [conf], reservas: [r("13:00", 50)] }))).toContain("13:30");
  });

  it("umbrales fuera de 0..100 se recortan y se avisa", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, niveles_escalera: escalera([60, 0], [30, -20], [15, 500]) }],
    });
    expect(res.avisos).toContain(AVISO_UMBRAL_FUERA_DE_RANGO);
    expect(res.periodos[0].escalera.map((n) => n.umbral)).toEqual([0, 0, 100]);
  });

  it("umbrales en orden ilógico: se hacen monótonos y se avisa", () => {
    // El nivel 3 (cuartos) al 10% sería MÁS fácil de abrir que el nivel 2
    // (medias) al 70%. Se sube al 70 para que la escalera siga siendo una
    // escalera. Comportamiento documentado, no una excepción.
    const conf = { ...COMIDA, niveles_escalera: escalera([60, 0], [30, 70], [15, 10]) };
    const res = calcular({ configuraciones: [conf], reservas: [r("13:00", 70)], capacidadTotal: CAPACIDAD_100 });
    expect(res.avisos).toContain(AVISO_UMBRALES_NO_MONOTONOS);
    expect(res.periodos[0].escalera).toEqual([
      { minutos: 60, umbral: 0 },
      { minutos: 30, umbral: 70 },
      { minutos: 15, umbral: 70 },
    ]);
    // Al 70% se abren los dos a la vez; 13:45 sigue esperando a 13:30.
    expect(horasDe(res)).toEqual(["13:00", "13:15", "13:30", "14:00", "15:00"]);
  });

  it("un intervalo que no divide el turno no rompe nada", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, niveles_escalera: escalera([60, 0], [7, 0]) }],
    });
    expect(res.huecos.length).toBeGreaterThan(0);
    expect(res.huecos.every((h) => /^\d{2}:\d{2}$/.test(h.hora))).toBe(true);
    // La rejilla está anclada a MEDIANOCHE, no al inicio del turno: el primer
    // múltiplo de 7 minutos que cae dentro de la comida es 13:04 (784 min).
    expect(horasDe(res)).toContain("13:04");
    expect(horasDe(res)).not.toContain("13:07");
    expect(horasDe(res)).toContain("13:00");
    // Y nada se sale del periodo.
    expect(res.huecos.every((h) => h.hora >= "13:00" && h.hora < "16:00")).toBe(true);
  });

  it("hora_fin == hora_inicio no cuelga el proceso", () => {
    // La versión anterior del panel entraba en bucle infinito con esto.
    const res = calcular({ configuraciones: [{ ...COMIDA, hora_fin: "13:00" }] });
    expect(res.avisos).toContain(AVISO_PERIODO_INVALIDO);
    expect(res.huecos).toHaveLength(0);
  });

  it("horas ilegibles descartan el periodo con aviso", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, hora_inicio: "a las tres", hora_fin: "16:00" }],
    });
    expect(res.avisos).toContain(AVISO_PERIODO_INVALIDO);
    expect(res.cerrado).toBe(true);
  });

  it("niveles con minutos absurdos se descartan sin tumbar la escalera", () => {
    const res = calcular({
      configuraciones: [
        {
          ...COMIDA,
          niveles_escalera: [
            { minutos: 60, umbral: 0 },
            { minutos: 0, umbral: 50 },
            { minutos: -30, umbral: 50 },
            { minutos: 30, umbral: 40 },
          ],
        },
      ],
      reservas: [r("13:00", 60)],
    });
    expect(res.periodos[0].escalera).toEqual([
      { minutos: 60, umbral: 0 },
      { minutos: 30, umbral: 40 },
    ]);
    expect(horasDe(res)).toContain("13:30");
  });

  it("niveles duplicados se deduplican", () => {
    const avisos = new Set<string>();
    expect(normalizarEscalera(escalera([60, 0], [30, 40], [30, 90]), avisos)).toEqual([
      { minutos: 60, umbral: 0 },
      { minutos: 30, umbral: 40 },
    ]);
  });

  it("capacidad 0 no produce NaN ni Infinity", () => {
    const res = calcular({ capacidadTotal: 0, reservas: [r("13:00", 10)] });
    expect(res.avisos).toContain(AVISO_SIN_CAPACIDAD);
    expect(res.aforo.comida.porcentaje).toBe(0);
    expect(res.huecos.every((h) => Number.isFinite(h.porcentaje_hora))).toBe(true);
    expect(res.huecos.every((h) => h.estado === "completo")).toBe(true);
  });

  it("un periodo sin ningún hueco posible avisa en vez de quedarse mudo", () => {
    // 13:20-13:50 con la rejilla de horas enteras: no hay ninguna en punto.
    // El primer hueco fino se PROMUEVE para no dejar el periodo vacío.
    const res = calcular({
      configuraciones: [{ ...COMIDA, hora_inicio: "13:20", hora_fin: "13:50" }],
    });
    expect(horasDe(res)).toEqual(["13:30"]);
    expect(hueco(res, "13:30")?.promovido).toBe(true);

    // Y si NINGÚN nivel encaja, se avisa y no se ofrece nada.
    const imposible = calcular({
      configuraciones: [
        { ...COMIDA, hora_inicio: "13:20", hora_fin: "13:25", niveles_escalera: escalera([60, 0]) },
      ],
    });
    expect(imposible.avisos).toContain(AVISO_PERIODO_SIN_HUECOS);
    expect(imposible.huecos).toHaveLength(0);
  });

  it("reservas con hora ilegible se ignoran sin contaminar el aforo", () => {
    const res = calcular({
      reservas: [r("13:00", 10), { hora: "ayer", numero_comensales: 99 } as any],
    });
    expect(res.aforo.comida.ocupacion).toBe(10);
  });

  it("reservas con comensales no numéricos cuentan como 0", () => {
    const res = calcular({
      reservas: [{ hora: "13:00", numero_comensales: null } as any, r("13:00", 5)],
    });
    expect(res.aforo.comida.ocupacion).toBe(5);
    expect(hueco(res, "13:00")?.reservas_hora).toBe(2);
  });

  it("nunca genera un número desbocado de huecos", () => {
    const res = calcular({
      configuraciones: [
        { ...COMIDA, hora_inicio: "00:00", hora_fin: "23:59", niveles_escalera: escalera([1, 0]) },
      ],
    });
    expect(res.huecos.length).toBeLessThanOrEqual(400);
    expect(res.avisos).toContain(AVISO_TOPE_HUECOS);
  });
});

// ============================================================
// 13. REGRESIONES: los bugs que traía la lógica del panel
// ============================================================
describe("regresiones de la lógica vieja del panel", () => {
  it("13:30 NO es una hora primaria (el bug del módulo)", () => {
    // `esTurnoPrimario = min % intervalo_base_minutos === 0` con intervalo
    // 30 daba `true` para :00 Y para :30, así que la media se ofrecía
    // siempre, estuviera vacía o llena. Es justo lo contrario de la regla.
    const res = calcular({ reservas: [] });
    expect(horasDe(res)).not.toContain("13:30");
    expect(hueco(calcular({ reservas: [r("13:00", 20)] }), "13:30")?.nivel).toBe(1);
  });

  it("13:15 y 13:45 NO son el segundo nivel de la configuración actual", () => {
    // El panel avanzaba de 15 en 15 y trataba :15 y :45 como "secundarios";
    // `ReservationForm.tsx` usaba directamente `secondaryOffsets = [15,45]`.
    // Con la configuración de hoy (intervalo 30) el segundo nivel es :30.
    const res = calcular({ reservas: [r("13:00", 150)] });
    expect(horasDe(res)).toContain("13:30");
    expect(horasDe(res)).not.toContain("13:15");
    expect(horasDe(res)).not.toContain("13:45");
  });

  it("un hueco con 1 plaza libre ya no se anuncia como disponible para 6", () => {
    // `disponible: capacidadDisponible > 0` ignoraba el tamaño del grupo.
    const res = calcular({ comensales: 6, reservas: [r("13:00", 149)] });
    expect(res.aforo.comida.disponible).toBe(1);
    expect(hueco(res, "13:00")?.ofrecido).toBe(false);
  });

  it("el motivo de apertura usa >= y no >", () => {
    // `ReservationForm.tsx` comparaba `porcentaje > umbral`, así que en el
    // umbral exacto NO abría la media. El panel usaba `>=`. Divergían.
    expect(horasDe(calcular({ reservas: [r("13:00", 20)] }))).toContain("13:30");
  });

  it("no se pierde ninguna hora por deduplicar entre turnos", () => {
    // El panel hacía `acc.find(t => t.hora === turno.hora)` sobre TODOS los
    // periodos juntos: dos turnos que compartieran una hora perdían uno.
    const res = calcular({
      configuraciones: [
        { ...COMIDA, id: "a", nombre_periodo: "A", hora_inicio: "13:00", hora_fin: "15:00" },
        { ...COMIDA, id: "b", nombre_periodo: "B", hora_inicio: "14:00", hora_fin: "16:00" },
      ],
    });
    expect(horasDe(res)).toEqual(["13:00", "14:00", "14:00", "15:00"]);
    expect(res.periodos.map((p) => p.huecos_ofrecidos)).toEqual([2, 2]);
  });
});

// ============================================================
// 14. EL CONTRATO DE SALIDA
// ============================================================
describe("contrato de salida", () => {
  it("cada hueco dice qué es, si se ofrece y por qué no", () => {
    const res = calcular({ comensales: 2, reservas: [r("13:00", 20)] });
    expect(hueco(res, "13:00")).toMatchObject({
      hora: "13:00",
      turno: "comida",
      nivel: 0,
      minutos_nivel: 60,
      etiqueta_nivel: "hora en punto",
      estado: "libre",
      ofrecido: true,
      motivo: null,
      periodo: "Comida",
      abierto_por: null,
      promovido: false,
      comensales_hora: 20,
      reservas_hora: 1,
      porcentaje_hora: 13,          // 20 de las 150 plazas del turno
      porcentaje_para_umbral: 40,   // 20 de las 50 repartidas a esa hora
      capacidad_maxima: 150,
      capacidad_disponible: 130,
      porcentaje_ocupacion: 13,
    });
    expect(hueco(res, "13:30")).toMatchObject({
      nivel: 1,
      minutos_nivel: 30,
      etiqueta_nivel: "media hora",
      umbral_nivel: 40,
      abierto_por: "13:00",
      abierto_con_porcentaje: 40,
      comensales_hora: 0,
    });
  });

  it("`horasOfrecidas` devuelve solo lo reservable", () => {
    const res = calcular({ comensales: 2, reservas: [r("20:00", 150)] });
    expect(horasOfrecidas(res)).toEqual(["13:00", "14:00", "15:00"]);
  });

  it("los periodos resueltos explican la escalera aplicada", () => {
    const res = calcular({ configuraciones: [COMIDA] });
    expect(res.periodos[0]).toMatchObject({
      id: "cfg-comida",
      nombre_periodo: "Comida",
      hora_inicio: "13:00",
      hora_fin: "16:00",
      origen_escalera: "legacy",
      ocultar_nivel_anterior: false,
      huecos_ofrecidos: 3,
      huecos_completos: 0,
    });
    expect(res.periodos[0].escalera).toEqual([
      { minutos: 60, umbral: 0 },
      { minutos: 30, umbral: 40 },
    ]);
  });

  it("la ocupación por hora sale de `reservas`, no de `vista_ocupacion`", () => {
    const res = calcular({ reservas: [r("13:00", 4), r("13:00", 6), r("21:30", 8)] });
    expect(res.ocupacion).toEqual([
      { hora: "13:00", turno: "comida", total_reservas: 2, total_comensales: 10, porcentaje_hora: 7 },
      { hora: "21:30", turno: "cena", total_reservas: 1, total_comensales: 8, porcentaje_hora: 5 },
    ]);
  });

  it("los huecos vienen ordenados por orden de servicio", () => {
    const res = calcular();
    const horas = horasDe(res);
    expect(horas).toEqual([...horas].sort());
  });

  it("el mismo escenario da siempre el mismo resultado", () => {
    const escenario = { comensales: 3, reservas: [r("13:00", 70), r("14:00", 20)] };
    expect(JSON.stringify(calcular(escenario))).toBe(JSON.stringify(calcular(escenario)));
  });
});

// ============================================================
// 15. SOBRE QUÉ SE MIDE EL PORCENTAJE (base_umbral)
// ============================================================
describe("base del porcentaje que abre un escalón", () => {
  it("por defecto reparte el aforo entre las horas del nivel grueso", () => {
    const res = calcular();
    expect(BASE_UMBRAL_POR_DEFECTO).toBe("reparto_nivel_base");
    expect(res.periodos[0].base_umbral).toBe("reparto_nivel_base");
    // Comida 13:00-16:00 = tres horas en punto -> 150 / 3 = 50 por hora.
    expect(res.periodos[0].base_umbral_capacidad).toBe(50);
    expect(res.periodos[1].base_umbral_capacidad).toBe(50); // cena, igual
  });

  it("`aforo_total` sigue siendo elegible y mide contra el aforo entero", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, base_umbral: "aforo_total" }],
      reservas: [r("13:00", 20)],
    });
    expect(res.periodos[0].base_umbral).toBe("aforo_total");
    expect(res.periodos[0].base_umbral_capacidad).toBe(150);
    expect(hueco(res, "13:00")?.porcentaje_para_umbral).toBe(13); // 20/150
    expect(horasDe(res)).not.toContain("13:30"); // 13% < 40%
  });

  it("los dos modos dan respuestas distintas con los mismos datos", () => {
    const reservas = [r("13:00", 20)];
    expect(horasDe(calcular({ configuraciones: [COMIDA], reservas }))).toContain("13:30");
    expect(
      horasDe(calcular({ configuraciones: [{ ...COMIDA, base_umbral: "aforo_total" }], reservas })),
    ).not.toContain("13:30");
  });

  it("un valor desconocido de `base_umbral` cae al modo por defecto", () => {
    const res = calcular({ configuraciones: [{ ...COMIDA, base_umbral: "lo-que-sea" }] });
    expect(res.periodos[0].base_umbral).toBe("reparto_nivel_base");
    expect(res.periodos[0].base_umbral_capacidad).toBe(50);
  });

  it("`porcentaje_hora` sigue siendo siempre sobre el aforo total", () => {
    const res = calcular({ configuraciones: [COMIDA], reservas: [r("14:00", 15)] });
    expect(hueco(res, "14:00")?.porcentaje_hora).toBe(10); // 15/150
    expect(hueco(res, "14:00")?.porcentaje_para_umbral).toBe(30); // 15/50
  });

  it("el reparto se adapta al número de horas del nivel base", () => {
    // 13:00-15:00 son dos horas en punto -> 150/2 = 75 por hora.
    expect(
      calcular({ configuraciones: [{ ...COMIDA, hora_fin: "15:00" }] }).periodos[0]
        .base_umbral_capacidad,
    ).toBe(75);
    // 13:00-18:00 son cinco -> 30 por hora.
    expect(
      calcular({ configuraciones: [{ ...COMIDA, hora_fin: "18:00" }] }).periodos[0]
        .base_umbral_capacidad,
    ).toBe(30);
  });

  it("cada turno puede medir de una forma distinta", () => {
    const res = calcular({
      configuraciones: [{ ...COMIDA, base_umbral: "aforo_total" }, CENA],
    });
    expect(res.periodos.map((p) => p.base_umbral)).toEqual(["aforo_total", "reparto_nivel_base"]);
  });
});

// ============================================================
// 16. EL CASO REAL QUE JUSTIFICA LA DECISIÓN (medido en producción)
// ============================================================
describe("el día más lleno de producción (16/02/2026)", () => {
  // Datos REALES: 50 reservas, 200 comensales, turno de comida al 66% del
  // aforo y hora punta de 17 comensales a las 14:00.
  const DIA_REAL = [
    r("13:00", 13), r("14:00", 17), r("15:00", 10),
    r("20:00", 13), r("21:00", 15), r("22:00", 10),
  ];
  // La configuración que deja la migración: umbral 70 para la media, 85
  // para el cuarto. Con 150 plazas y tres horas en punto -> 50 por hora.
  const TRAS_MIGRACION = (c: ConfiguracionTurnoInput): ConfiguracionTurnoInput => ({
    ...c,
    umbral_apertura_secundario: 70,
    niveles_escalera: escalera([60, 0], [30, 70], [15, 85]),
  });
  const conf = [TRAS_MIGRACION(COMIDA), TRAS_MIGRACION(CENA)];

  it("con 17 comensales en la hora punta NO se abre la media", () => {
    const res = calcular({ configuraciones: conf, reservas: DIA_REAL });
    expect(res.periodos[0].base_umbral_capacidad).toBe(50);
    expect(hueco(res, "14:00")?.comensales_hora).toBe(17);
    expect(hueco(res, "14:00")?.porcentaje_para_umbral).toBe(34); // 17/50
    expect(horasDe(res)).toEqual(["13:00", "14:00", "15:00", "20:00", "21:00", "22:00"]);
    expect(horasDe(res)).not.toContain("14:30");
  });

  it("con 34 sigue sin abrirse y con 35 SÍ se abre la media", () => {
    const con = (n: number) =>
      horasDe(calcular({ configuraciones: conf, reservas: [r("14:00", n)] }));
    expect(con(34)).not.toContain("14:30"); // 68%
    expect(con(35)).toContain("14:30"); // 70% exacto
    expect(con(36)).toContain("14:30");
  });

  it("con 42 no hay cuarto y con 43 aparece el cuarto", () => {
    const con = (n: number) =>
      horasDe(calcular({ configuraciones: conf, reservas: [r("14:00", n)] }));
    expect(con(42)).not.toContain("14:15"); // 84%
    expect(con(43)).toContain("14:15"); // 86%
    expect(con(43)).toContain("14:30");
  });

  it("midiendo contra el aforo entero ese mismo día no pasaría NADA nunca", () => {
    // Es el número que justifica la decisión: harían falta 105 personas a
    // la misma hora para abrir la media, y ese día la punta fue de 17.
    const res = calcular({
      configuraciones: conf.map((c) => ({ ...c, base_umbral: "aforo_total" })),
      reservas: DIA_REAL,
    });
    expect(hueco(res, "14:00")?.porcentaje_para_umbral).toBe(11); // 17/150
    expect(res.huecos.every((h) => h.nivel === 0)).toBe(true);

    const con = (n: number) =>
      horasDe(
        calcular({
          configuraciones: [{ ...TRAS_MIGRACION(COMIDA), base_umbral: "aforo_total" }],
          reservas: [r("14:00", n)],
        }),
      );
    expect(con(104)).not.toContain("14:30"); // 69%
    expect(con(105)).toContain("14:30"); // 70%
  });
});

// ============================================================
// 17. /crear: LA HORA TIENE QUE SER UNA DE LAS OFRECIDAS
// ============================================================
describe("validarHoraOfrecida", () => {
  const dia = () => calcular({ comensales: 2, reservas: [r("13:00", 35)] });

  it("acepta una hora del nivel base", () => {
    expect(validarHoraOfrecida(dia(), "14:00").ok).toBe(true);
    expect(validarHoraOfrecida(dia(), "14:00").motivo).toBeNull();
  });

  it("acepta una media que la escalera ha abierto de verdad", () => {
    expect(horasDe(dia())).toContain("13:30");
    expect(validarHoraOfrecida(dia(), "13:30").ok).toBe(true);
  });

  it("RECHAZA una media que la escalera NO ha abierto", () => {
    const flojo = calcular({ reservas: [r("13:00", 10)] });
    expect(horasDe(flojo)).not.toContain("13:30");
    const v = validarHoraOfrecida(flojo, "13:30");
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe("sin_disponibilidad");
    expect(v.codigo).toBe("hora_no_ofrecida");
    expect(v.mensaje).toContain("13:30");
    expect(v.mensaje).toContain("13:00"); // sugiere las que sí hay
  });

  it("RECHAZA una hora inventada fuera de todo turno", () => {
    // Es el agujero que tapa: una petición directa con esta hora entraba.
    for (const hora of ["03:15", "09:00", "17:30", "23:45"]) {
      const v = validarHoraOfrecida(dia(), hora);
      expect(v.ok).toBe(false);
      expect(v.codigo).toBe("hora_no_ofrecida");
      expect(v.motivo).toBe("sin_disponibilidad");
    }
  });

  it("RECHAZA una hora ilegible", () => {
    const v = validarHoraOfrecida(dia(), "a las tres");
    expect(v.ok).toBe(false);
    expect(v.codigo).toBe("hora_invalida");
  });

  it("acepta con y sin segundos", () => {
    expect(validarHoraOfrecida(dia(), "14:00:00").ok).toBe(true);
    expect(validarHoraOfrecida(dia(), "14:00").ok).toBe(true);
    expect(validarHoraOfrecida(dia(), "9:00").ok).toBe(false); // legible, no ofrecida
  });

  it("un día CERRADO rechaza con su propio código", () => {
    const cerrado = calcular({
      fecha: DOMINGO,
      configuraciones: [{ ...COMIDA, dias_semana: [1, 2, 3, 4, 5, 6] }],
    });
    const v = validarHoraOfrecida(cerrado, "13:00");
    expect(v.ok).toBe(false);
    expect(v.codigo).toBe("dia_cerrado");
    expect(v.indeterminado).toBe(false);
  });

  it("una hora COMPLETA sí pasa: del aforo se encarga el trigger", () => {
    // El motor la ofrece (existe en la escalera) aunque no quepa nadie.
    // Rechazarla aquí taparía el mensaje bueno de "no queda aforo".
    const lleno = calcular({ comensales: 4, reservas: [r("13:00", 150)] });
    expect(hueco(lleno, "13:00")?.estado).toBe("completo");
    expect(validarHoraOfrecida(lleno, "13:00").ok).toBe(true);
  });

  it("sin configuración legible NO bloquea (fallo de sistema, no de negocio)", () => {
    const sinConfig = calcular({ configuraciones: [] });
    const v = validarHoraOfrecida(sinConfig, "13:00");
    expect(v.ok).toBe(true);
    expect(v.indeterminado).toBe(true);
  });
});
