/**
 * `verificarAforoTurno` con `excluirReservaId`: al EDITAR una reserva viva, el
 * aviso previo de aforo no debe contarla contra sí misma (el trigger de la BD
 * tampoco lo hace: `id != NEW.id` en un UPDATE). Sin esto, cambiar la hora de
 * una reserva de un turno justo al límite enseñaría un «aforo superado» falso.
 */
import { describe, it, expect, vi } from "vitest";

const datos = vi.hoisted(() => ({
  tablas: {} as Record<string, unknown[]>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: datos.tablas[tabla] ?? [], error: null }).then(ok, ko);
      return b;
    },
  },
}));

import { verificarAforoTurno } from "@/hooks/useDisponibilidad";

/** Casa Tomás con 10 plazas y dos reservas de cena que suman justo 10 (6 + 4). */
function turnoLlenoConDosReservas() {
  datos.tablas = {
    configuracion_turnos: [],
    espacios_reserva: [{ id: "salon", nombre: "Salón", capacidad_maxima: 10, caracteristicas: { marca: "casa_tomas" } }],
    reservas: [
      { id: "r-seis", hora: "21:00:00", numero_comensales: 6, espacio_id: null },
      { id: "r-cuatro", hora: "21:30:00", numero_comensales: 4, espacio_id: null },
    ],
  };
}

describe("verificarAforoTurno · excluirReservaId", () => {
  it("sin excluir nada cuenta todas las reservas vivas del turno (comportamiento de siempre)", async () => {
    turnoLlenoConDosReservas();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 4, "casa_tomas");

    expect(aforo.comensalesActuales).toBe(10);
    expect(aforo.disponible).toBe(false);
    expect(aforo.mensaje).toMatch(/Aforo superado/);
  });

  it("excluyendo la reserva que se edita no se cuenta contra sí misma", async () => {
    turnoLlenoConDosReservas();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 4, "casa_tomas", "r-cuatro");

    expect(aforo.comensalesActuales).toBe(6);
    expect(aforo.capacidadDisponible).toBe(4);
    expect(aforo.disponible).toBe(true);
  });

  it("excluir una reserva que no está en ese día no cambia nada", async () => {
    turnoLlenoConDosReservas();
    const aforo = await verificarAforoTurno("2026-10-10", "21:00", 4, "casa_tomas", "otra-reserva");

    expect(aforo.comensalesActuales).toBe(10);
    expect(aforo.disponible).toBe(false);
  });

  it("null o undefined equivalen a no excluir", async () => {
    turnoLlenoConDosReservas();
    expect((await verificarAforoTurno("2026-10-10", "21:00", 4, "casa_tomas", null)).comensalesActuales).toBe(10);
    expect((await verificarAforoTurno("2026-10-10", "21:00", 4, "casa_tomas", undefined)).comensalesActuales).toBe(10);
  });
});
