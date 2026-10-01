/**
 * Tests de `src/lib/reservas/ocupacionCalendario.ts`: la lógica pura del color
 * y de las cifras de la cuadrícula del mes (y de la cabecera del panel del día).
 *
 * Qué se fija aquí, y por qué:
 *   · LA ESCALA (umbrales → nivel → etiqueta). Se prueba en los BORDES: 29 % no
 *     es 30 %, 84 % no es 85 %, 99 % no es completo. Un solo sitio los define
 *     (`UMBRALES_OCUPACION`) y la leyenda sale de ahí.
 *   · EL PORCENTAJE NUNCA MIENTE: se trunca (no se redondea), así 99,4 % es 99 %
 *     y solo es 100 % lo que de verdad no tiene hueco; y algo con reservas nunca
 *     es 0 %.
 *   · QUÉ ESTADOS CUENTAN: solo las vivas (pendiente, verificada, confirmada), que
 *     es lo que cuenta el trigger de aforo y lo que enseña el panel del día. Las
 *     canceladas, las completadas («Llegó») y las «No vino» no.
 *   · UN SOLO NEGOCIO: Casa Tomás, con su aforo por turno (corte a las 17:00).
 *     Touza ya no admite reservas (decisión del dueño, 2026-10-01): si aparece una
 *     reserva antigua de `marca = 'touza'` se IGNORA, no suma ni a las cifras ni al %.
 *     El día se colorea por el turno MÁS LLENO (comida o cena).
 *   · «SIN SALA» solo cuenta dentro de la ventana de asignación (reservas entre
 *     ahora y ahora + N horas), no como estado del día.
 */
import { describe, it, expect } from "vitest";
import {
  NIVELES_ESCALA,
  UMBRALES_OCUPACION,
  aforoCasaTomas,
  describirDia,
  estiloNivel,
  esDeCasaTomas,
  etiquetaNivel,
  nivelDeOcupacion,
  ocupacionPorTurno,
  porcentajeOcupacion,
  rangoNivel,
  resumirDia,
  resumirMes,
  textoTurno,
  type ContextoCalendario,
  type ReservaCalendario,
} from "../ocupacionCalendario";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Aforo REAL de producción de Casa Tomás por turno: Comedor 50 + Salón 50 + Terraza 50 + Reservado 20. */
const AFORO = 170;

/** "Ahora" = miércoles 14/10/2026 10:30 en Madrid (CEST, +02:00). */
const AHORA = new Date("2026-10-14T10:30:00+02:00").getTime();

const CONTEXTO: ContextoCalendario = { hoy: "2026-10-14", ahora: AHORA, ventanaHoras: 48 };

let seq = 0;
function reserva(
  fecha: string,
  hora: string,
  comensales: number,
  extra: Partial<ReservaCalendario> = {},
): ReservaCalendario {
  seq++;
  return {
    id: `r-${seq}`,
    fecha,
    hora,
    numero_comensales: comensales,
    estado: "confirmada",
    marca: "casa_tomas",
    espacio_id: "sala-1",
    ...extra,
  };
}

// ─── La escala ───────────────────────────────────────────────────────────────

describe("nivelDeOcupacion: umbrales y bordes", () => {
  it.each<[number, number, string]>([
    [0, 170, "vacio"],
    [1, 170, "bajo"],
    [50, 170, "bajo"], // 29,4 %
    [51, 170, "medio"], // 30 % justo: ya es medio
    [101, 170, "medio"], // 59,4 %
    [102, 170, "alto"], // 60 % justo
    [144, 170, "alto"], // 84,7 %
    [145, 170, "casi_lleno"], // 85,3 %
    [169, 170, "casi_lleno"], // 99,4 %: aún queda un hueco
    [170, 170, "completo"], // 100 %: sin hueco
    [181, 170, "completo"], // aforo superado: sigue siendo completo
  ])("%i de %i comensales → %s", (ocupados, capacidad, esperado) => {
    expect(nivelDeOcupacion(ocupados, capacidad)).toBe(esperado);
  });

  it("los cuatro umbrales son los de la constante (un único sitio para ajustarlos)", () => {
    expect(UMBRALES_OCUPACION).toEqual({ medio: 30, alto: 60, casiLleno: 85, completo: 100 });
  });

  it("sin reservas es «vacio» aunque no se conozca el aforo", () => {
    expect(nivelDeOcupacion(0, null)).toBe("vacio");
    expect(nivelDeOcupacion(0, undefined)).toBe("vacio");
    expect(nivelDeOcupacion(0, 0)).toBe("vacio");
  });

  it("con reservas pero sin aforo conocido es «sin_aforo», nunca «completo»", () => {
    expect(nivelDeOcupacion(5, null)).toBe("sin_aforo");
    expect(nivelDeOcupacion(5, undefined)).toBe("sin_aforo");
    expect(nivelDeOcupacion(5, 0)).toBe("sin_aforo");
    expect(nivelDeOcupacion(5, -10)).toBe("sin_aforo");
  });

  it("ignora comensales basura (NaN, negativos) como si fueran 0", () => {
    expect(nivelDeOcupacion(Number.NaN, 170)).toBe("vacio");
    expect(nivelDeOcupacion(-4, 170)).toBe("vacio");
  });
});

describe("porcentajeOcupacion: se trunca, no se redondea", () => {
  it.each<[number, number, number]>([
    [1, 170, 1], // 0,59 %: con reservas nunca enseña 0 %
    [50, 170, 29],
    [51, 170, 30],
    [145, 170, 85],
    [169, 170, 99], // 99,4 %: NO puede decir 100 con un hueco libre
    [170, 170, 100],
    [175, 170, 102], // aforo superado: se dice tal cual
    [29, 100, 29], // 29/100*100 en coma flotante es 28,999…: debe seguir siendo 29
    [17, 20, 85],
  ])("%i de %i → %i %%", (ocupados, capacidad, esperado) => {
    expect(porcentajeOcupacion(ocupados, capacidad)).toBe(esperado);
  });

  it("0 comensales es 0 % y sin aforo conocido es null (no se inventa)", () => {
    expect(porcentajeOcupacion(0, 170)).toBe(0);
    expect(porcentajeOcupacion(5, 0)).toBeNull();
    expect(porcentajeOcupacion(5, null)).toBeNull();
    expect(porcentajeOcupacion(5, undefined)).toBeNull();
  });
});

describe("etiquetas, rangos y estilos de la escala", () => {
  it("la escala va de menos a más ocupación y termina en «completo»", () => {
    expect([...NIVELES_ESCALA]).toEqual(["bajo", "medio", "alto", "casi_lleno", "completo"]);
  });

  it("cada nivel tiene su palabra, en el vocabulario del dueño", () => {
    expect(etiquetaNivel("vacio")).toBe("Sin reservas");
    expect(etiquetaNivel("bajo")).toBe("Tranquilo");
    expect(etiquetaNivel("medio")).toBe("Moderado");
    expect(etiquetaNivel("alto")).toBe("Concurrido");
    expect(etiquetaNivel("casi_lleno")).toBe("Casi lleno");
    expect(etiquetaNivel("completo")).toBe("Completo");
    expect(etiquetaNivel("pasado")).toBe("Día pasado");
    expect(etiquetaNivel("sin_aforo")).toBe("Sin aforo");
  });

  it("los rangos de la leyenda salen de los umbrales y no dejan huecos", () => {
    expect(rangoNivel("bajo")).toBe("menos del 30%");
    expect(rangoNivel("medio")).toBe("30–59%");
    expect(rangoNivel("alto")).toBe("60–84%");
    expect(rangoNivel("casi_lleno")).toBe("85–99%");
    expect(rangoNivel("completo")).toBe("100%");
  });

  it("cada nivel de la escala tiene un estilo propio y distinto", () => {
    const celdas = NIVELES_ESCALA.map((n) => estiloNivel(n).celda);
    expect(celdas.every((c) => c.length > 0)).toBe(true);
    expect(new Set(celdas).size).toBe(NIVELES_ESCALA.length);
  });

  it("ningún nivel de ocupación usa rojo ni ámbar: el ámbar es solo «sin sala»", () => {
    for (const nivel of [...NIVELES_ESCALA, "vacio", "pasado", "sin_aforo"] as const) {
      const e = estiloNivel(nivel);
      expect(`${e.celda} ${e.hoy} ${e.muestra} ${e.relleno}`, nivel).not.toMatch(/amber|red-|destructive|orange/);
    }
  });

  it("«completo» y «casi lleno» llevan texto blanco: son los dos fondos oscuros (tema claro)", () => {
    // Solo las clases del tema claro: las `dark:` van al revés a propósito.
    const clasesClaras = (clases: string) =>
      clases
        .split(/\s+/)
        .filter((c) => !c.startsWith("dark:"))
        .join(" ");
    expect(clasesClaras(estiloNivel("completo").celda)).toMatch(/text-white/);
    expect(clasesClaras(estiloNivel("casi_lleno").celda)).toMatch(/text-white/);
    for (const claro of ["bajo", "medio", "alto"] as const) {
      expect(clasesClaras(estiloNivel(claro).celda), claro).not.toMatch(/text-white/);
    }
  });
});

// ─── Aforo de Casa Tomás ─────────────────────────────────────────────────────

describe("aforoCasaTomas", () => {
  it("suma el aforo de los espacios ACTIVOS de Casa Tomás (como el trigger)", () => {
    const espacios = [
      { id: "a", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "b", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "c", capacidad_maxima: 50, activa: false, caracteristicas: { marca: "casa_tomas" } }, // inactivo: no cuenta
    ];
    expect(aforoCasaTomas(espacios)).toBe(70);
  });

  it("NO suma los espacios de Touza: no se mezclan ni se enseñan", () => {
    const espacios = [
      { id: "a", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "d", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
      { id: "e", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "touza" } },
    ];
    expect(aforoCasaTomas(espacios)).toBe(50);
  });

  it("un espacio sin marca cuenta como Casa Tomás y uno sin `activa` como activo", () => {
    const espacios = [
      { id: "a", capacidad_maxima: 40, caracteristicas: null },
      { id: "b", capacidad_maxima: 10, activa: true, caracteristicas: {} },
    ];
    expect(aforoCasaTomas(espacios)).toBe(50);
  });

  it("sin aforo conocido es null (no un 0 que parezca un dato): lista vacía, nula o solo de Touza", () => {
    expect(aforoCasaTomas([])).toBeNull();
    expect(aforoCasaTomas(null)).toBeNull();
    expect(aforoCasaTomas(undefined)).toBeNull();
    expect(aforoCasaTomas([{ id: "a", capacidad_maxima: 30, caracteristicas: { marca: "touza" } }])).toBeNull();
    expect(aforoCasaTomas([{ id: "a", capacidad_maxima: "x" as unknown as number }])).toBeNull();
  });
});

describe("esDeCasaTomas: Touza ya no admite reservas", () => {
  it("Casa Tomás y lo que no tiene marca sí; Touza no", () => {
    expect(esDeCasaTomas("casa_tomas")).toBe(true);
    expect(esDeCasaTomas(null)).toBe(true);
    expect(esDeCasaTomas(undefined)).toBe(true);
    expect(esDeCasaTomas("")).toBe(true);
    expect(esDeCasaTomas("touza")).toBe(false);
  });
});

// ─── Ocupación por turno ─────────────────────────────────────────────────────

describe("ocupacionPorTurno", () => {
  it("separa comida y cena y suma varias reservas del mismo turno", () => {
    const r = ocupacionPorTurno(
      [
        { turno: "comida", comensales: 10 },
        { turno: "comida", comensales: 7 },
        { turno: "cena", comensales: 5 },
      ],
      AFORO,
    );
    expect(r.turnos.comida).toMatchObject({ turno: "comida", comensales: 17, reservas: 2, porcentaje: 10, capacidad: 170 });
    expect(r.turnos.cena).toMatchObject({ turno: "cena", comensales: 5, reservas: 1, porcentaje: 2 });
    expect(r).toMatchObject({ comensales: 22, reservas: 3 });
  });

  it("el turno más lleno manda: comida al 20 % y cena al 90 % → el día es «casi lleno»", () => {
    const r = ocupacionPorTurno(
      [
        { turno: "comida", comensales: 34 }, // 20 %
        { turno: "cena", comensales: 153 }, // 90 %
      ],
      AFORO,
    );
    expect(r.nivel).toBe("casi_lleno");
    expect(r.masLleno).toMatchObject({ turno: "cena", porcentaje: 90 });
    // NO es una media: la media (55 %) escondería que la cena casi no tiene hueco.
    expect(r.porcentaje).toBe(90);
  });

  it("el turno sin reservas sale a cero, no desaparece", () => {
    const r = ocupacionPorTurno([{ turno: "cena", comensales: 85 }], AFORO);
    expect(r.turnos.comida).toMatchObject({ comensales: 0, reservas: 0, porcentaje: 0, nivel: "vacio", libres: 170 });
    expect(r.turnos.cena).toMatchObject({ porcentaje: 50, nivel: "medio", libres: 85 });
  });

  it("IGNORA las reservas de Touza (datos antiguos): ni comensales, ni reservas, ni %", () => {
    const r = ocupacionPorTurno(
      [
        { marca: "casa_tomas", turno: "cena", comensales: 85 },
        { marca: "touza", turno: "cena", comensales: 40 },
        { marca: "touza", turno: "comida", comensales: 20 },
      ],
      AFORO,
    );
    expect(r.turnos.cena).toMatchObject({ comensales: 85, reservas: 1, porcentaje: 50 });
    expect(r.turnos.comida).toMatchObject({ comensales: 0, reservas: 0 });
    expect(r).toMatchObject({ comensales: 85, reservas: 1, nivel: "medio" });
  });

  it("un día que solo tiene reservas de Touza es un día vacío", () => {
    const r = ocupacionPorTurno([{ marca: "touza", turno: "cena", comensales: 40 }], AFORO);
    expect(r).toMatchObject({ nivel: "vacio", comensales: 0, reservas: 0, masLleno: null, porcentaje: null });
  });

  it("una marca vacía o nula cuenta como Casa Tomás", () => {
    const r = ocupacionPorTurno(
      [
        { marca: "", turno: "cena", comensales: 17 },
        { marca: null, turno: "cena", comensales: 17 },
      ],
      AFORO,
    );
    expect(r.turnos.cena).toMatchObject({ comensales: 34, reservas: 2, porcentaje: 20 });
  });

  it("sin aforo conocido enseña los comensales pero no inventa porcentaje", () => {
    const r = ocupacionPorTurno([{ turno: "cena", comensales: 12 }], null);
    expect(r.turnos.cena).toMatchObject({ comensales: 12, capacidad: null, porcentaje: null, nivel: "sin_aforo", libres: null });
    expect(r.nivel).toBe("sin_aforo");
    expect(r.masLleno).toBeNull();
    expect(r.porcentaje).toBeNull();
  });

  it("un día vacío es «vacio» y no tiene turno más lleno", () => {
    const r = ocupacionPorTurno([], AFORO);
    expect(r.nivel).toBe("vacio");
    expect(r.masLleno).toBeNull();
    expect(r).toMatchObject({ comensales: 0, reservas: 0 });
    expect(r.turnos.comida.nivel).toBe("vacio");
    expect(r.turnos.cena.nivel).toBe("vacio");
  });

  it("un turno completo se marca como tal (sin hueco) y deja 0 libres, aunque se pase del aforo", () => {
    const r = ocupacionPorTurno([{ turno: "cena", comensales: 175 }], AFORO);
    expect(r.nivel).toBe("completo");
    expect(r.turnos.cena).toMatchObject({ porcentaje: 102, libres: 0, nivel: "completo", sobreaforo: 5 });
  });

  it("si dos turnos empatan, gana la comida", () => {
    const r = ocupacionPorTurno(
      [
        { turno: "cena", comensales: 85 },
        { turno: "comida", comensales: 85 },
      ],
      AFORO,
    );
    expect(r.masLleno?.turno).toBe("comida");
  });
});

// ─── Un día ──────────────────────────────────────────────────────────────────

describe("resumirDia: qué estados cuentan", () => {
  const dia = "2026-10-20"; // futuro

  it("para el aforo cuentan SOLO las vivas: pendiente, verificada y confirmada", () => {
    const r = resumirDia(
      dia,
      [
        reserva(dia, "21:00", 10, { estado: "pendiente" }),
        reserva(dia, "21:00", 10, { estado: "verificada" }),
        reserva(dia, "21:00", 10, { estado: "confirmada" }),
        reserva(dia, "21:00", 99, { estado: "cancelada" }),
        reserva(dia, "21:00", 99, { estado: "completada" }),
        reserva(dia, "21:00", 99, { estado: "no_show" }),
      ],
      AFORO,
      CONTEXTO,
    );
    expect(r.reservas).toBe(3);
    expect(r.comensales).toBe(30);
    expect(r.esPasado).toBe(false);
  });

  it("la cifra grande son los comensales y el nº de reservas va aparte", () => {
    const r = resumirDia(dia, [reserva(dia, "13:00", 4), reserva(dia, "13:30", 6), reserva(dia, "21:00", 3)], AFORO, CONTEXTO);
    expect(r).toMatchObject({ comensales: 13, reservas: 3 });
  });

  it("el corte de turno es a las 17:00: 16:59 es comida y 17:00 ya es cena", () => {
    const r = resumirDia(dia, [reserva(dia, "16:59", 17), reserva(dia, "17:00", 34)], AFORO, CONTEXTO);
    expect(r.turnos.comida.comensales).toBe(17);
    expect(r.turnos.cena.comensales).toBe(34);
  });

  it("acepta la hora con segundos, como la devuelve Postgres", () => {
    const r = resumirDia(dia, [reserva(dia, "13:00:00", 17), reserva(dia, "21:30:00", 34)], AFORO, CONTEXTO);
    expect(r.turnos.comida.comensales).toBe(17);
    expect(r.turnos.cena.comensales).toBe(34);
  });

  it("los comensales que llegan como texto se suman bien y los rotos cuentan 0", () => {
    const r = resumirDia(
      dia,
      [
        reserva(dia, "13:00", 0, { numero_comensales: "6" as unknown as number }),
        reserva(dia, "13:00", 0, { numero_comensales: "x" as unknown as number }),
      ],
      AFORO,
      CONTEXTO,
    );
    expect(r.comensales).toBe(6);
    expect(r.reservas).toBe(2);
  });

  it("un día completo en cena: 170 de 170 → «completo», 100 %", () => {
    const r = resumirDia(dia, [reserva(dia, "21:00", 100), reserva(dia, "21:30", 70)], AFORO, CONTEXTO);
    expect(r.nivel).toBe("completo");
    expect(r.porcentaje).toBe(100);
    expect(r.masLleno).toMatchObject({ turno: "cena", libres: 0 });
  });

  it("hoy NO es un día pasado: cuenta solo lo vivo y tiene escala", () => {
    const r = resumirDia(
      "2026-10-14",
      [reserva("2026-10-14", "21:00", 85), reserva("2026-10-14", "13:00", 50, { estado: "completada" })],
      AFORO,
      CONTEXTO,
    );
    expect(r.esPasado).toBe(false);
    expect(r.comensales).toBe(85);
    expect(r.nivel).toBe("medio");
  });

  it("las reservas antiguas de Touza no cuentan: ni comensales, ni reservas, ni %", () => {
    const r = resumirDia(
      dia,
      [reserva(dia, "21:00", 85), reserva(dia, "21:00", 40, { marca: "touza", espacio_id: "otra" })],
      AFORO,
      CONTEXTO,
    );
    expect(r).toMatchObject({ comensales: 85, reservas: 1, porcentaje: 50, nivel: "medio" });
  });

  it("un día con solo reservas de Touza es un día vacío (y `resumirMes` no le da entrada)", () => {
    const touza = reserva(dia, "21:00", 40, { marca: "touza" });
    expect(resumirDia(dia, [touza], AFORO, CONTEXTO)).toMatchObject({ reservas: 0, comensales: 0, nivel: "vacio" });
    expect(resumirMes([touza], AFORO, CONTEXTO)[dia]).toBeUndefined();
  });
});

describe("resumirDia: días pasados (histórico)", () => {
  const dia = "2026-10-10";

  it("no tienen escala: se enseñan atenuados con lo que se reservó (sin canceladas)", () => {
    const r = resumirDia(
      dia,
      [
        reserva(dia, "13:00", 8, { estado: "completada" }),
        reserva(dia, "13:30", 6, { estado: "no_show" }),
        reserva(dia, "21:00", 4, { estado: "confirmada" }),
        reserva(dia, "21:00", 50, { estado: "cancelada" }),
      ],
      AFORO,
      CONTEXTO,
    );
    expect(r.esPasado).toBe(true);
    expect(r.nivel).toBe("pasado");
    expect(r.reservas).toBe(3);
    expect(r.comensales).toBe(18);
    // Sin porcentaje: el aforo no mide algo que ya ocurrió (y el «No vino» no es un cliente sentado).
    expect(r.porcentaje).toBeNull();
    expect(r.masLleno).toBeNull();
    expect(r.sinSalaEnVentana).toBe(0);
  });

  it("también ignoran Touza", () => {
    const r = resumirDia(dia, [reserva(dia, "21:00", 4), reserva(dia, "21:00", 9, { marca: "touza" })], AFORO, CONTEXTO);
    expect(r).toMatchObject({ comensales: 4, reservas: 1 });
  });

  it("un día pasado sin reservas es «vacio»", () => {
    expect(resumirDia(dia, [], AFORO, CONTEXTO)).toMatchObject({ nivel: "vacio", esPasado: true, comensales: 0 });
  });

  it("un día pasado con solo canceladas es «vacio»", () => {
    const r = resumirDia(dia, [reserva(dia, "21:00", 20, { estado: "cancelada" })], AFORO, CONTEXTO);
    expect(r.nivel).toBe("vacio");
  });
});

describe("resumirDia: «sin sala» solo dentro de la ventana de asignación", () => {
  it("cuenta las reservas sin sala entre ahora y ahora + 48 h", () => {
    const r = resumirDia(
      "2026-10-15",
      [
        reserva("2026-10-15", "21:00", 4, { espacio_id: null }),
        reserva("2026-10-15", "13:00", 4, { espacio_id: null }),
        reserva("2026-10-15", "13:00", 4, { espacio_id: "sala-1" }), // con sala: no cuenta
      ],
      AFORO,
      CONTEXTO,
    );
    expect(r.sinSalaEnVentana).toBe(2);
  });

  it("fuera de la ventana (más de 48 h) no hay indicador aunque falte la sala", () => {
    // 16/10 13:00 = 50 h y media desde las 10:30 del 14/10: queda fuera.
    const r = resumirDia("2026-10-16", [reserva("2026-10-16", "13:00", 4, { espacio_id: null })], AFORO, CONTEXTO);
    expect(r.sinSalaEnVentana).toBe(0);
  });

  it("los días lejanos, que es donde casi todo está sin sala, no llevan indicador", () => {
    const r = resumirDia(
      "2026-10-28",
      [reserva("2026-10-28", "21:00", 4, { espacio_id: null }), reserva("2026-10-28", "21:30", 4, { espacio_id: null })],
      AFORO,
      CONTEXTO,
    );
    expect(r.sinSalaEnVentana).toBe(0);
    expect(r.comensales).toBe(8);
  });

  it("lo que ya ha empezado hoy no se cuenta: ya no hay nada que repartir", () => {
    const r = resumirDia(
      "2026-10-14",
      [
        reserva("2026-10-14", "09:00", 4, { espacio_id: null }), // antes de las 10:30
        reserva("2026-10-14", "21:00", 4, { espacio_id: null }), // dentro de la ventana
      ],
      AFORO,
      CONTEXTO,
    );
    expect(r.sinSalaEnVentana).toBe(1);
  });

  it("respeta la ventana configurada: con 24 h, el 15/10 a las 13:00 queda fuera", () => {
    const reservas = [reserva("2026-10-15", "13:00", 4, { espacio_id: null })];
    expect(resumirDia("2026-10-15", reservas, AFORO, { ...CONTEXTO, ventanaHoras: 24 }).sinSalaEnVentana).toBe(0);
    expect(resumirDia("2026-10-15", reservas, AFORO, { ...CONTEXTO, ventanaHoras: 48 }).sinSalaEnVentana).toBe(1);
  });

  it("una sala en blanco o solo con espacios cuenta como sin sala", () => {
    const r = resumirDia(
      "2026-10-15",
      [reserva("2026-10-15", "21:00", 4, { espacio_id: "   " }), reserva("2026-10-15", "21:00", 4, { espacio_id: "" })],
      AFORO,
      CONTEXTO,
    );
    expect(r.sinSalaEnVentana).toBe(2);
  });

  it("las no vivas no cuentan como pendientes de sala", () => {
    const r = resumirDia(
      "2026-10-15",
      [
        reserva("2026-10-15", "21:00", 4, { espacio_id: null, estado: "cancelada" }),
        reserva("2026-10-15", "21:00", 4, { espacio_id: null, estado: "completada" }),
      ],
      AFORO,
      CONTEXTO,
    );
    expect(r.sinSalaEnVentana).toBe(0);
  });

  it("una reserva sin sala de Touza no pone el punto", () => {
    const r = resumirDia("2026-10-15", [reserva("2026-10-15", "21:00", 4, { espacio_id: null, marca: "touza" })], AFORO, CONTEXTO);
    expect(r.sinSalaEnVentana).toBe(0);
  });
});

// ─── Un mes ──────────────────────────────────────────────────────────────────

describe("resumirMes", () => {
  it("agrupa por día y deja sin entrada los días sin reservas", () => {
    const m = resumirMes(
      [reserva("2026-10-20", "21:00", 10), reserva("2026-10-20", "13:00", 5), reserva("2026-10-21", "21:00", 7)],
      AFORO,
      CONTEXTO,
    );
    expect(Object.keys(m).sort()).toEqual(["2026-10-20", "2026-10-21"]);
    expect(m["2026-10-20"]).toMatchObject({ comensales: 15, reservas: 2 });
    expect(m["2026-10-21"]).toMatchObject({ comensales: 7, reservas: 1 });
  });

  it("un día que solo tiene canceladas o completadas futuras no sale en el mapa", () => {
    const m = resumirMes([reserva("2026-10-22", "21:00", 10, { estado: "cancelada" })], AFORO, CONTEXTO);
    expect(m["2026-10-22"]).toBeUndefined();
  });

  it("mezcla cargas del 20 % al 100 %: cada día cae en su nivel", () => {
    const m = resumirMes(
      [
        reserva("2026-10-20", "21:00", 34), // 20 %
        reserva("2026-10-21", "21:00", 85), // 50 %
        reserva("2026-10-22", "21:00", 128), // 75 %
        reserva("2026-10-23", "21:00", 153), // 90 %
        reserva("2026-10-24", "21:00", 170), // 100 %
      ],
      AFORO,
      CONTEXTO,
    );
    expect(Object.values(m).map((d) => d.nivel)).toEqual(["bajo", "medio", "alto", "casi_lleno", "completo"]);
    expect(Object.values(m).map((d) => d.porcentaje)).toEqual([20, 50, 75, 90, 100]);
  });

  it("maneja un mes de más de mil reservas sin perder ninguna", () => {
    const filas: ReservaCalendario[] = [];
    for (let i = 0; i < 1500; i++) filas.push(reserva("2026-10-25", i % 2 ? "13:00" : "21:00", 1));
    const m = resumirMes(filas, 5000, CONTEXTO);
    expect(m["2026-10-25"]).toMatchObject({ reservas: 1500, comensales: 1500 });
  });
});

// ─── Textos ──────────────────────────────────────────────────────────────────

describe("textoTurno y describirDia", () => {
  it("cada turno se dice con su % y sus cifras", () => {
    const r = ocupacionPorTurno(
      [
        { turno: "comida", comensales: 77 },
        { turno: "cena", comensales: 170 },
      ],
      AFORO,
    );
    expect(textoTurno(r.turnos.comida)).toBe("Comida: 45% (77 de 170)");
    expect(textoTurno(r.turnos.cena)).toBe("Cena: completo (170 de 170)");
  });

  it("un turno por encima del aforo dice cuántos comensales se pasa", () => {
    const r = ocupacionPorTurno([{ turno: "cena", comensales: 175 }], AFORO);
    expect(textoTurno(r.turnos.cena)).toBe("Cena: completo (170 de 170, 5 comensales por encima del aforo)");
  });

  it("sin aforo dice los comensales y que falta el aforo, sin porcentaje", () => {
    const r = ocupacionPorTurno([{ turno: "cena", comensales: 12 }], null);
    expect(textoTurno(r.turnos.cena)).toBe("Cena: 12 comensales (aforo sin configurar)");
  });

  it("un día futuro con reservas: total, turno más lleno, desglose y «sin sala» en ventana", () => {
    const r = resumirDia(
      "2026-10-15",
      [
        reserva("2026-10-15", "13:00", 77),
        reserva("2026-10-15", "21:00", 102, { espacio_id: null }),
      ],
      AFORO,
      CONTEXTO,
    );
    const d = describirDia(r, 48);
    expect(d.aria).toBe(
      "179 comensales en 2 reservas; ocupación 60% (concurrido) en la cena; 1 reserva sin sala en las próximas 48 h",
    );
    expect(d.lineas).toEqual([
      "179 comensales en 2 reservas",
      "Comida: 45% (77 de 170)",
      "Cena: 60% (102 de 170)",
      "1 reserva sin sala en las próximas 48 h",
    ]);
  });

  it("un día pasado se cuenta como histórico, sin porcentaje", () => {
    const r = resumirDia("2026-10-10", [reserva("2026-10-10", "21:00", 4, { estado: "no_show" })], AFORO, CONTEXTO);
    const d = describirDia(r, 48);
    expect(d.aria).toBe("día pasado, 4 comensales en 1 reserva");
    expect(d.lineas.join(" ")).not.toMatch(/%/);
  });

  it("un día sin reservas o sin datos dice «sin reservas»", () => {
    expect(describirDia(undefined, 48).aria).toBe("sin reservas");
  });
});
