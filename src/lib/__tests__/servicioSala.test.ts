import { describe, it, expect } from "vitest";
import {
  comensalesEnEspacioTurno,
  esErrorColumnaLlegadaInexistente,
  evaluarMovimiento,
  esperandoLlegada,
  puedeMoverReserva,
  aplicarCambioReserva,
  mensajeErrorServicio,
  type ReservaServicio,
} from "@/lib/reservas/servicioSala";

const r = (o: Partial<ReservaServicio> = {}): ReservaServicio => ({
  id: "x",
  nombre: "Cliente",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: null,
  ...o,
});

describe("reglas de estado", () => {
  it("no se mueven canceladas ni no presentadas", () => {
    expect(puedeMoverReserva("cancelada")).toBe(false);
    expect(puedeMoverReserva("no_show")).toBe(false);
    expect(puedeMoverReserva("completada")).toBe(true);
    expect(puedeMoverReserva("pendiente")).toBe(true);
  });

  it("solo se espera llegada en estados activos", () => {
    expect(esperandoLlegada("confirmada")).toBe(true);
    expect(esperandoLlegada("pendiente")).toBe(true);
    expect(esperandoLlegada("completada")).toBe(false);
    expect(esperandoLlegada("cancelada")).toBe(false);
  });
});

describe("comensalesEnEspacioTurno", () => {
  const reservas = [
    r({ id: "a", espacio_id: "comedor", hora: "13:30:00", numero_comensales: 10 }),
    r({ id: "b", espacio_id: "comedor", hora: "21:00:00", numero_comensales: 6 }),
    r({ id: "c", espacio_id: "comedor", hora: "21:30:00", numero_comensales: 5, estado: "completada" }),
    r({ id: "d", espacio_id: "comedor", hora: "22:00:00", numero_comensales: 9, estado: "no_show" }),
    r({ id: "e", espacio_id: "comedor", hora: "22:00:00", numero_comensales: 9, estado: "cancelada" }),
    r({ id: "f", espacio_id: null, hora: "21:00:00", numero_comensales: 2 }),
  ];

  it("separa comida y cena con el corte de las 17:00 y cuenta a los que ya llegaron", () => {
    expect(comensalesEnEspacioTurno(reservas, "comedor", "comida")).toBe(10);
    expect(comensalesEnEspacioTurno(reservas, "comedor", "cena")).toBe(11);
    expect(comensalesEnEspacioTurno(reservas, null, "cena")).toBe(2);
  });

  it("puede excluir la propia reserva", () => {
    expect(comensalesEnEspacioTurno(reservas, "comedor", "cena", "b")).toBe(5);
  });
});

describe("evaluarMovimiento", () => {
  const todas = [
    r({ id: "ya", espacio_id: "terraza", numero_comensales: 18 }),
    r({ id: "mueve", espacio_id: null, numero_comensales: 4 }),
    r({ id: "comida", espacio_id: "terraza", hora: "14:00:00", numero_comensales: 20 }),
  ];

  it("ok cuando cabe en el turno", () => {
    const ev = evaluarMovimiento(todas[1], "terraza", todas, 30);
    expect(ev).toEqual({ tipo: "ok", turno: "cena", ocupacionTras: 22, capacidad: 30 });
  });

  it("excede_capacidad si se pasa (sin mezclar el turno de comida)", () => {
    const ev = evaluarMovimiento(todas[1], "terraza", todas, 20);
    expect(ev).toMatchObject({ tipo: "excede_capacidad", ocupacionTras: 22, capacidad: 20 });
  });

  it("sin_cambio si ya está en el destino", () => {
    expect(evaluarMovimiento(todas[0], "terraza", todas, 30)).toEqual({ tipo: "sin_cambio" });
  });

  it("'Sin asignar' no tiene capacidad", () => {
    expect(evaluarMovimiento(todas[0], null, todas, undefined)).toMatchObject({ tipo: "ok", capacidad: null });
  });

  it("bloquea canceladas y no_show", () => {
    expect(evaluarMovimiento(r({ estado: "cancelada" }), "terraza", todas, 30).tipo).toBe("bloqueado");
    expect(evaluarMovimiento(r({ estado: "no_show" }), "terraza", todas, 30).tipo).toBe("bloqueado");
  });
});

describe("utilidades", () => {
  it("aplicarCambioReserva no muta y solo toca la fila indicada", () => {
    const lista = [r({ id: "a" }), r({ id: "b" })];
    const nueva = aplicarCambioReserva(lista, "b", { espacio_id: "salon" });
    expect(nueva?.[1].espacio_id).toBe("salon");
    expect(lista[1].espacio_id).toBeNull();
    expect(nueva?.[0]).toBe(lista[0]);
    expect(aplicarCambioReserva(undefined, "a", {})).toBeUndefined();
  });

  it("detecta que la columna llegada_at aún no existe", () => {
    expect(esErrorColumnaLlegadaInexistente({ code: "PGRST204", message: "Could not find the 'llegada_at' column of 'reservas' in the schema cache" })).toBe(true);
    expect(esErrorColumnaLlegadaInexistente({ code: "42703", message: 'column "llegada_at" of relation "reservas" does not exist' })).toBe(true);
    expect(esErrorColumnaLlegadaInexistente({ code: "42501", message: "permission denied" })).toBe(false);
    expect(esErrorColumnaLlegadaInexistente(null)).toBe(false);
  });

  it("traduce el error de aforo del trigger", () => {
    expect(mensajeErrorServicio({ code: "23514", message: "Aforo superado para el turno" }, "deshacer la llegada")).toMatch(/turno ya está completo/);
    expect(mensajeErrorServicio({ message: "boom" }, "mover la reserva")).toBe("No se pudo mover la reserva: boom");
  });
});
