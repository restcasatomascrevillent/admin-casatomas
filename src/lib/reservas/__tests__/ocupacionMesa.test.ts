import { describe, it, expect } from "vitest";
import {
  conflictoDeMesa,
  franjaDeHora,
  horaDeMinutos,
  minutosDeHora,
  minutosOcupacionMesa,
  nombreCorto,
  ocupacionesDeMesa,
  resumenOcupacionMesa,
  seSolapan,
  textoFranja,
  textoMesaOcupada,
} from "../ocupacionMesa";

const CONFIG_120 = { estanciaComidaMinutos: 120, estanciaCenaMinutos: 120 };

const asig = (reserva_id: string, mesa_id: string, hora: string, nombre = reserva_id) => ({
  id: `a-${reserva_id}-${mesa_id}`,
  reserva_id,
  mesa_id,
  reservas: { nombre, hora, numero_comensales: 2 },
});

describe("ocupacionMesa · franja de una reserva", () => {
  it("lee 'HH:MM' y 'HH:MM:SS'; basura → null", () => {
    expect(minutosDeHora("14:00")).toBe(840);
    expect(minutosDeHora("20:30:00")).toBe(1230);
    expect(minutosDeHora("")).toBeNull();
    expect(minutosDeHora("las dos")).toBeNull();
  });

  it("usa el minutaje del turno de la propia hora (corte 17:00) y 105/120 por defecto", () => {
    expect(minutosOcupacionMesa("14:00")).toBe(105);
    expect(minutosOcupacionMesa("16:59")).toBe(105);
    expect(minutosOcupacionMesa("17:00")).toBe(120);
    expect(minutosOcupacionMesa("14:00", { estanciaComidaMinutos: 90, estanciaCenaMinutos: 150 })).toBe(90);
    expect(minutosOcupacionMesa("21:00", { estanciaComidaMinutos: 90, estanciaCenaMinutos: 150 })).toBe(150);
  });

  it("un ajuste roto (0, negativo, NaN) cae en el valor por defecto, nunca en una franja vacía", () => {
    expect(minutosOcupacionMesa("14:00", { estanciaComidaMinutos: 0, estanciaCenaMinutos: -5 })).toBe(105);
    expect(minutosOcupacionMesa("21:00", { estanciaComidaMinutos: NaN, estanciaCenaMinutos: NaN })).toBe(120);
  });

  it("franja [inicio, fin) y su texto; una cena tardía pasa de medianoche", () => {
    expect(franjaDeHora("14:00", CONFIG_120)).toEqual({ inicio: 840, fin: 960 });
    expect(textoFranja(franjaDeHora("14:00", CONFIG_120)!)).toBe("14:00 a 16:00");
    expect(textoFranja(franjaDeHora("23:30", CONFIG_120)!)).toBe("23:30 a 01:30");
    expect(franjaDeHora("??")).toBeNull();
    expect(horaDeMinutos(1530)).toBe("01:30");
  });

  it("solape con el final abierto: 14:00-16:00 y 16:00-18:00 no se pisan", () => {
    expect(seSolapan({ inicio: 840, fin: 960 }, { inicio: 900, fin: 1020 })).toBe(true);
    expect(seSolapan({ inicio: 840, fin: 960 }, { inicio: 960, fin: 1080 })).toBe(false);
    expect(seSolapan({ inicio: 960, fin: 1080 }, { inicio: 840, fin: 960 })).toBe(false);
  });
});

describe("ocupacionMesa · ¿está libre la mesa PARA esta reserva?", () => {
  const dia = [asig("oscar", "m3", "14:00:00", "Oscar Diaz Vidal")];

  it("el caso del dueño: Oscar 14:00 (comida) no impide sentar a Ezequiel 20:30 (cena) en la mesa 3", () => {
    expect(conflictoDeMesa(dia, "m3", { id: "ezequiel", hora: "20:30" })).toBeNull();
  });

  it("mismo turno: 14:00 y 15:00 con 120 min chocan; 14:00 y 16:00 no", () => {
    const choque = conflictoDeMesa(dia, "m3", { id: "b", hora: "15:00" }, CONFIG_120);
    expect(choque?.asignacion.reserva_id).toBe("oscar");
    expect(choque?.franja).toEqual({ inicio: 840, fin: 960 });
    expect(conflictoDeMesa(dia, "m3", { id: "c", hora: "16:00" }, CONFIG_120)).toBeNull();
  });

  it("cambiar el tiempo de ocupación cambia el resultado", () => {
    expect(conflictoDeMesa(dia, "m3", { id: "e", hora: "15:30" }, CONFIG_120)).not.toBeNull();
    expect(conflictoDeMesa(dia, "m3", { id: "e", hora: "15:30" }, { estanciaComidaMinutos: 90, estanciaCenaMinutos: 120 })).toBeNull();
  });

  it("también choca entre turnos si se pisan (comida de las 16:30 y cena de las 18:00)", () => {
    const tarde = [asig("tarde", "m3", "16:30")];
    expect(conflictoDeMesa(tarde, "m3", { id: "cena", hora: "18:00" })?.asignacion.reserva_id).toBe("tarde");
  });

  it("las mesas de la propia reserva y las de otras mesas no cuentan", () => {
    const lista = [asig("k", "m3", "13:00"), asig("k", "m4", "13:00"), asig("x", "m5", "13:00")];
    expect(conflictoDeMesa(lista, "m3", { id: "k", hora: "13:00" })).toBeNull();
    expect(conflictoDeMesa(lista, "m6", { id: "z", hora: "13:00" })).toBeNull();
  });

  it("si choca con varias, nombra la que empieza antes (como la base de datos)", () => {
    const lista = [asig("tarde", "m3", "15:00", "Tarde"), asig("pronto", "m3", "13:30", "Pronto")];
    const choque = conflictoDeMesa(lista, "m3", { id: "n", hora: "14:30" });
    expect(choque?.asignacion.reserva_id).toBe("pronto");
    expect(textoMesaOcupada("3", choque!)).toBe("La mesa 3 está ocupada de 13:30 a 15:15 por Pronto");
  });

  it("con datos rotos no rompe: hora ilegible, lista null, mesa vacía", () => {
    expect(conflictoDeMesa(dia, "m3", { id: "n", hora: "" })).toBeNull();
    expect(conflictoDeMesa(null as never, "m3", { id: "n", hora: "14:00" })).toBeNull();
    expect(conflictoDeMesa(dia, "", { id: "n", hora: "14:00" })).toBeNull();
    expect(conflictoDeMesa([asig("r", "m3", "")], "m3", { id: "n", hora: "14:00" })).toBeNull();
  });
});

describe("ocupacionMesa · quién ocupa la mesa (cartel del plano)", () => {
  it("en orden de hora, y en una línea «14:00 Oscar · 20:30 Ezequiel»", () => {
    const lista = [asig("ez", "m3", "20:30:00", "Ezequiel Vega"), asig("os", "m3", "14:00:00", "Oscar Diaz Vidal"), asig("x", "m4", "13:00")];
    const enMesa3 = ocupacionesDeMesa(lista, "m3");
    expect(enMesa3.map((a) => a.reserva_id)).toEqual(["os", "ez"]);
    expect(resumenOcupacionMesa(enMesa3)).toBe("14:00 Oscar · 20:30 Ezequiel");
  });

  it("nombre corto: el primer nombre, o «Sin nombre»", () => {
    expect(nombreCorto("  Oscar Diaz Vidal ")).toBe("Oscar");
    expect(nombreCorto(null)).toBe("Sin nombre");
  });
});
