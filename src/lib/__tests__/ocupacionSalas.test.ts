import { describe, it, expect } from "vitest";
import {
  calcularOcupacionSalas,
  clasificarOrigenFranjas,
  construirFranjas,
  evaluarUbicacion,
  horaCorta,
  horasBaseDelDia,
  nivelOcupacion,
  recomendarUbicacion,
  type EspacioSala,
  type ReservaOcupacionSala,
} from "@/lib/reservas/ocupacionSalas";

const ESPACIOS: EspacioSala[] = [
  { id: "salon", nombre: "Salón", capacidad_maxima: 50 },
  { id: "comedor", nombre: "Comedor", capacidad_maxima: 50 },
  { id: "terraza", nombre: "Terraza", capacidad_maxima: 30 },
];
const HORAS = ["13:00", "14:00", "15:00", "20:00", "21:00", "22:00"];

const r = (o: Partial<ReservaOcupacionSala>): ReservaOcupacionSala => ({
  hora: "14:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: "salon",
  ...o,
});

const calcular = (reservas: ReservaOcupacionSala[], comensales = 20, extra: string[] = []) =>
  calcularOcupacionSalas({ espacios: ESPACIOS, reservas, horasBase: HORAS, horasExtra: extra, comensales });

describe("horaCorta / nivelOcupacion", () => {
  it("normaliza horas", () => {
    expect(horaCorta("14:00:00")).toBe("14:00");
    expect(horaCorta("9:5")).toBe("09:05");
    expect(horaCorta("")).toBeNull();
    expect(horaCorta("xx")).toBeNull();
  });
  it("clasifica libre / justo / lleno", () => {
    expect(nivelOcupacion(10, 50)).toBe("libre");
    expect(nivelOcupacion(38, 50)).toBe("justo");
    expect(nivelOcupacion(50, 50)).toBe("lleno");
    expect(nivelOcupacion(0, 0)).toBe("lleno");
    expect(nivelOcupacion(5, null)).toBe("libre");
  });
});

describe("construirFranjas", () => {
  it("separa comida y cena con el corte de las 17:00 del trigger, sin duplicados", () => {
    const f = construirFranjas(["14:00", "13:00", "20:00:00"], ["16:30", "14:00", null, "17:00"]);
    expect(f.comida).toEqual(["13:00", "14:00", "16:30"]);
    expect(f.cena).toEqual(["17:00", "20:00"]);
  });
});

describe("calcularOcupacionSalas", () => {
  it("cuenta por sala y por TURNO, no por hora suelta", () => {
    const o = calcular([
      r({ hora: "13:00", numero_comensales: 10 }),
      r({ hora: "15:00", numero_comensales: 22 }),
      r({ hora: "21:00", numero_comensales: 6 }),
    ]);
    const salon = o.salas.find((s) => s.espacioId === "salon")!;
    expect(salon.turnos.comida.ocupados).toBe(32);
    expect(salon.turnos.cena.ocupados).toBe(6);
    expect(salon.porHora["15:00"]).toEqual({ pax: 22, reservas: 1 });
    // 32 + 20 = 52 > 50
    expect(salon.turnos.comida.cabe).toBe(false);
    expect(salon.turnos.comida.nivel).toBe("libre");
    expect(salon.turnos.cena.cabe).toBe(true);
  });

  it("canceladas y no_show no ocupan; 'completada' ocupa sala pero NO aforo (como el trigger)", () => {
    const o = calcular([
      r({ estado: "cancelada", numero_comensales: 40 }),
      r({ estado: "no_show", numero_comensales: 40 }),
      r({ estado: "completada", numero_comensales: 10 }),
      r({ estado: "pendiente", numero_comensales: 5 }),
      r({ estado: "verificada", numero_comensales: 5, espacio_id: "comedor" }),
    ]);
    const salon = o.salas.find((s) => s.espacioId === "salon")!;
    expect(salon.turnos.comida.ocupados).toBe(15);
    expect(o.aforo.comida.ocupados).toBe(10); // pendiente + verificada
    expect(o.aforo.comida.capacidad).toBe(130);
  });

  it("aforo del turno: misma condición que el trigger (ocupación + nuevos > capacidad => no cabe)", () => {
    const llenas = [
      r({ espacio_id: "salon", numero_comensales: 50 }),
      r({ espacio_id: "comedor", numero_comensales: 50 }),
      r({ espacio_id: "terraza", numero_comensales: 10 }),
    ];
    expect(calcular(llenas, 20).aforo.comida.cabe).toBe(true); // 110 + 20 = 130
    expect(calcular(llenas, 21).aforo.comida.cabe).toBe(false);
  });

  it("agrupa en 'Sin asignar' las reservas sin espacio o con un espacio desconocido", () => {
    const o = calcular([r({ espacio_id: null, numero_comensales: 3 }), r({ espacio_id: "otro", numero_comensales: 2 })]);
    expect(o.sinAsignar?.turnos.comida.ocupados).toBe(5);
    expect(o.aforo.comida.ocupados).toBe(5);
    expect(calcular([]).sinAsignar).toBeNull();
  });

  it("añade como columna las horas con reservas fuera de franja y la hora propuesta", () => {
    const o = calcular([r({ hora: "13:30" })], 2, ["22:45"]);
    expect(o.franjas.comida).toContain("13:30");
    expect(o.franjas.cena).toContain("22:45");
  });

  it("excluye la propia reserva al editar", () => {
    const o = calcularOcupacionSalas({
      espacios: ESPACIOS,
      reservas: [r({ id: "yo", numero_comensales: 40 })],
      horasBase: HORAS,
      comensales: 40,
      excluirReservaId: "yo",
    });
    expect(o.salas.find((s) => s.espacioId === "salon")!.turnos.comida.cabe).toBe(true);
  });
});

describe("evaluarUbicacion", () => {
  it("distingue capacidad de sala (orientativa) de aforo del turno (bloqueante)", () => {
    const o = calcular([r({ numero_comensales: 40 })], 20);
    const ev = evaluarUbicacion(o, "salon", "14:00")!;
    expect(ev.turno).toBe("comida");
    expect(ev.cabeSala).toBe(false);
    expect(ev.cabeAforo).toBe(true);
    expect(evaluarUbicacion(o, null, "14:00")!.cabeSala).toBe(true);
    expect(evaluarUbicacion(o, "salon", null)).toBeNull();
  });
});

describe("recomendarUbicacion", () => {
  it("confirma la ubicación elegida cuando cabe", () => {
    const o = calcular([r({ numero_comensales: 12 })], 20);
    const rec = recomendarUbicacion(o, { espacioId: "salon", hora: "14:00" });
    expect(rec.tipo).toBe("cabe");
    expect(rec.texto).toBe("Cabe en Salón a las 14:00 (12/50 ocupadas, quedarían 18 libres).");
  });

  it("sin sala elegida sugiere la más holgada a la misma hora", () => {
    const o = calcular([r({ espacio_id: "comedor", numero_comensales: 30 })], 20);
    const rec = recomendarUbicacion(o, { espacioId: null, hora: "14:00" });
    expect(rec).toMatchObject({ tipo: "sugerencia", espacioId: "salon", hora: "14:00" });
  });

  it("si la sala no cabe, propone otra sala en el mismo turno", () => {
    const o = calcular([r({ espacio_id: "salon", numero_comensales: 45 })], 20);
    const rec = recomendarUbicacion(o, { espacioId: "salon", hora: "14:00" });
    expect(rec).toMatchObject({ tipo: "sugerencia", espacioId: "comedor", hora: "14:00" });
    expect(rec.texto.startsWith("No cabe en Salón.")).toBe(true);
  });

  it("si el turno está completo, propone el otro turno en la hora más tranquila", () => {
    const o = calcular(
      [
        r({ espacio_id: "salon", numero_comensales: 50 }),
        r({ espacio_id: "comedor", numero_comensales: 50 }),
        r({ espacio_id: "terraza", numero_comensales: 30 }),
        r({ espacio_id: "salon", hora: "20:00", numero_comensales: 10 }),
        r({ espacio_id: "comedor", hora: "21:00", numero_comensales: 5 }),
      ],
      20,
    );
    const rec = recomendarUbicacion(o, { espacioId: "salon", hora: "14:00" });
    expect(rec).toMatchObject({ tipo: "sugerencia", espacioId: "comedor", hora: "20:00" });
    expect(rec.texto).toContain("Turno de comida completo (130/130)");
  });

  it("avisa cuando no cabe en ningún sitio ese día", () => {
    const o = calcular([], 80);
    expect(recomendarUbicacion(o, { espacioId: "salon", hora: "14:00" }).tipo).toBe("sin_hueco");
  });

  it("sin salas configuradas", () => {
    const o = calcularOcupacionSalas({ espacios: [], reservas: [], horasBase: HORAS, comensales: 2 });
    expect(recomendarUbicacion(o, { espacioId: null, hora: "14:00" }).tipo).toBe("sin_hueco");
  });
});

// ----------------------------------------------------------------------------
// POR QUÉ ESTÁ CADA COLUMNA (`origenFranja`)
// ----------------------------------------------------------------------------
// El dueño, 2026-09-28, mirando la rejilla: "no sé por qué salen 15:30 y no a
// las y media". Las columnas NO son arbitrarias: unas las ofrece el motor
// (escalera de `configuracion_turnos`) y otras salen porque ya hay una reserva
// a esa hora, o porque es la hora que se está proponiendo. Estos tests fijan
// ese criterio y su precedencia: turno > reserva > propuesta.

describe("clasificarOrigenFranjas", () => {
  it("turno > reserva > propuesta", () => {
    const franjas = construirFranjas(["13:00", "14:00"], ["13:30", "14:45"]);
    const origen = clasificarOrigenFranjas(franjas, ["13:00", "14:00"], ["13:30", "14:00"]);
    expect(origen["14:00"]).toBe("turno"); // la ofrece el motor, aunque tenga reserva
    expect(origen["13:30"]).toBe("reserva");
    expect(origen["14:45"]).toBe("propuesta");
  });

  it("normaliza las horas antes de comparar ('15:30:00' es '15:30')", () => {
    const franjas = construirFranjas(["13:00"], ["15:30"]);
    expect(clasificarOrigenFranjas(franjas, ["13:00:00"], ["15:30:00"])["15:30"]).toBe("reserva");
  });
});

describe("calcularOcupacionSalas: origen de cada franja", () => {
  it("(a) hora que ofrece el motor -> 'turno', aunque ya tenga reservas", () => {
    const o = calcular([r({ hora: "14:00", numero_comensales: 8 })], 2);
    expect(o.franjas.comida).toContain("14:00");
    expect(o.origenFranja["14:00"]).toBe("turno");
  });

  it("(b) hora con reserva que el motor NO ofrece -> 'reserva'", () => {
    const o = calcular([r({ hora: "13:30" })], 2);
    expect(o.origenFranja["13:30"]).toBe("reserva");
    // Y sigue mandando sobre la propuesta si además se está proponiendo esa hora.
    expect(calcular([r({ hora: "13:30" })], 2, ["13:30"]).origenFranja["13:30"]).toBe("reserva");
  });

  it("(c) hora propuesta que ni ofrece el motor ni tiene reservas -> 'propuesta'", () => {
    const o = calcular([], 2, ["22:45"]);
    expect(o.origenFranja["22:45"]).toBe("propuesta");
    // Si el motor sí la ofrece, es del turno aunque se esté proponiendo.
    expect(calcular([], 2, ["22:00"]).origenFranja["22:00"]).toBe("turno");
  });

  it("hay origen para TODAS las franjas y para ninguna más", () => {
    const o = calcular([r({ hora: "13:30" })], 2, ["22:45"]);
    expect(Object.keys(o.origenFranja).sort()).toEqual([...o.franjas.comida, ...o.franjas.cena].sort());
  });

  it("una reserva cancelada no crea columna (ni origen)", () => {
    const o = calcular([r({ hora: "13:30", estado: "cancelada" })], 2);
    expect(o.franjas.comida).not.toContain("13:30");
    expect(o.origenFranja["13:30"]).toBeUndefined();
  });
});

describe("el caso del dueño: 15:30 y 21:30 con el día casi vacío", () => {
  // Escalera real de `configuracion_turnos`: horas en punto siempre, la media
  // se abre al 70 % de SU hora y el cuarto al 85 %. Con la ocupación tan baja
  // no se abre ningún escalón, así que el motor solo ofrece horas enteras.
  const ESCALERA = [
    { minutos: 60, umbral: 0 },
    { minutos: 30, umbral: 70 },
    { minutos: 15, umbral: 85 },
  ];
  const CONFIG = [
    { hora_inicio: "13:00", hora_fin: "16:00", niveles_escalera: ESCALERA, espacio_id: null, activo: true },
    { hora_inicio: "20:00", hora_fin: "23:00", niveles_escalera: ESCALERA, espacio_id: null, activo: true },
  ];
  const SALAS: EspacioSala[] = [
    { id: "comedor", nombre: "Comedor", capacidad_maxima: 50 },
    { id: "salon", nombre: "Salón", capacidad_maxima: 50 },
    { id: "terraza", nombre: "Terraza", capacidad_maxima: 50 },
  ];
  // 2 reservas a las 15:30 y 10 a las 21:30, como en la captura.
  const RESERVAS: ReservaOcupacionSala[] = [
    r({ hora: "15:30", espacio_id: "comedor", numero_comensales: 2 }),
    r({ hora: "15:30", espacio_id: "salon", numero_comensales: 4 }),
    ...Array.from({ length: 10 }, () => r({ hora: "21:30", espacio_id: "salon", numero_comensales: 2 })),
  ];

  it("el motor solo ofrece horas en punto; 15:30 y 21:30 salen marcadas como 'reserva'", () => {
    // Touza no admite reservas (decisión del dueño 2026-10-01): `horasBaseDeNegocio` pasa a ser
    // `horasBaseDelDia`, sin negocio (siempre los turnos generales, que eran los de Casa Tomás).
    const { horasBase, cerrado } = horasBaseDelDia("2026-09-28", { espacios: SALAS, reservas: RESERVAS }, CONFIG);
    expect(cerrado).toBe(false);
    expect([...horasBase].sort()).toEqual(["13:00", "14:00", "15:00", "20:00", "21:00", "22:00"]);

    const o = calcularOcupacionSalas({ espacios: SALAS, reservas: RESERVAS, horasBase, comensales: 4 });
    // Exactamente la rejilla de la captura.
    expect(o.franjas.comida).toEqual(["13:00", "14:00", "15:00", "15:30"]);
    expect(o.franjas.cena).toEqual(["20:00", "21:00", "21:30", "22:00"]);
    expect(o.origenFranja["15:30"]).toBe("reserva");
    expect(o.origenFranja["21:30"]).toBe("reserva");
    expect(o.origenFranja["15:00"]).toBe("turno");
    expect(o.origenFranja["22:00"]).toBe("turno");
    // Ocupación baja: es lo que mantiene la escalera en el escalón de 60 min.
    expect(o.aforo.comida.capacidad).toBe(150);
    expect(o.aforo.comida.ocupados).toBe(6);
    expect(o.aforo.cena.ocupados).toBe(20);
  });
});

describe("sala privada (el Reservado): una reserva se queda la sala entera", () => {
  const ESPACIOS_PRIV: EspacioSala[] = [
    { id: "comedor", nombre: "Comedor", capacidad_maxima: 50 },
    { id: "reservado", nombre: "Reservado", capacidad_maxima: 20, privada: true },
  ];
  const calcularPriv = (reservas: ReservaOcupacionSala[], comensales = 2) =>
    calcularOcupacionSalas({ espacios: ESPACIOS_PRIV, reservas, horasBase: HORAS, comensales });
  const fila = (o: ReturnType<typeof calcularPriv>, id: string) => o.salas.find((s) => s.espacioId === id)!;

  it("una reserva de 5 llena el Reservado (20/20) en su turno y no en el otro", () => {
    const o = calcularPriv([r({ espacio_id: "reservado", numero_comensales: 5, hora: "21:00:00" })]);
    expect(fila(o, "reservado").turnos.cena.ocupados).toBe(20);
    expect(fila(o, "reservado").turnos.cena.nivel).toBe("lleno");
    expect(fila(o, "reservado").turnos.cena.cabe).toBe(false);
    expect(fila(o, "reservado").turnos.comida.ocupados).toBe(0);
    expect(fila(o, "reservado").turnos.comida.cabe).toBe(true);
  });

  it("en el aforo del turno pesa la capacidad de la sala (20), no los comensales (5)", () => {
    const o = calcularPriv([
      r({ espacio_id: "reservado", numero_comensales: 5, hora: "21:00:00" }),
      r({ espacio_id: "comedor", numero_comensales: 10, hora: "21:00:00" }),
    ]);
    expect(o.aforo.cena.ocupados).toBe(30); // 20 + 10, no 5 + 10
    expect(o.aforo.cena.capacidad).toBe(70);
    expect(o.aforo.comida.ocupados).toBe(0);
  });

  it("si trae más comensales que la sala, cuentan los comensales (nunca de menos)", () => {
    const o = calcularPriv([r({ espacio_id: "reservado", numero_comensales: 25, hora: "21:00:00" })]);
    expect(o.aforo.cena.ocupados).toBe(25);
  });

  it("canceladas y «No vino» no llenan la sala", () => {
    const o = calcularPriv([
      r({ espacio_id: "reservado", numero_comensales: 5, hora: "21:00:00", estado: "cancelada" }),
      r({ espacio_id: "reservado", numero_comensales: 5, hora: "21:30:00", estado: "no_show" }),
    ]);
    expect(fila(o, "reservado").turnos.cena.ocupados).toBe(0);
    expect(o.aforo.cena.ocupados).toBe(0);
  });

  it("sin el flag, la misma sala cuenta por comensales como siempre", () => {
    const sinFlag: EspacioSala[] = [{ id: "reservado", nombre: "Reservado", capacidad_maxima: 20 }];
    const o = calcularOcupacionSalas({
      espacios: sinFlag,
      reservas: [r({ espacio_id: "reservado", numero_comensales: 5, hora: "21:00:00" })],
      horasBase: HORAS,
      comensales: 2,
    });
    expect(o.salas[0].turnos.cena.ocupados).toBe(5);
    expect(o.aforo.cena.ocupados).toBe(5);
  });
});
