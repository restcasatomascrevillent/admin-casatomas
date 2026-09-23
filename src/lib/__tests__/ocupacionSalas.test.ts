import { describe, it, expect } from "vitest";
import {
  calcularOcupacionSalas,
  construirFranjas,
  evaluarUbicacion,
  horaCorta,
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
