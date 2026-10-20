/**
 * Sala privada de UNA mesa (el «Reservado» de Casa Tomás, 14 plazas desde
 * 20261013130000; antes 20): la mesa única ES la sala (migración
 * 20261003110000_reservado_mesa_unica.sql).
 *
 * 13/10/2026: el reparto automático solo sienta grupos de hasta 7; los de 8 o
 * más (lo normal en el Reservado) los asigna una persona (`paraRevisar`).
 *
 * No hay código propio de «sala privada»: la exclusividad por turno sale de
 * tener una sola mesa (la base impide dos asignaciones de la misma mesa en el
 * mismo día y turno) y de que el reparto automático nunca usa una mesa dos
 * veces ni combina mesas que no existen. Estos tests fijan ese comportamiento
 * para que un cambio en `calcularDistribucionMesas` o en el cuadre no lo rompa
 * sin que nadie se entere.
 */
import { describe, it, expect } from "vitest";
import { calcularDistribucionMesas, type ReservaSala } from "@/components/reservas/asignacionPlano";
import { calcularCuadreEspacio } from "@/lib/reservas/aforoMesas";

const RESERVADO = {
  id: "78448cb5-29d2-43a2-9c39-d499d4cb2ef3",
  nombre: "Reservado",
  capacidad_maxima: 14,
  activa: true,
  caracteristicas: { marca: "casa_tomas", privada: true },
};

const MESA_UNICA = { id: "mesa-reservado", nombre: "Reservado", capacidad: 14 };

const reserva = (id: string, comensales: number, hora = "13:00:00"): ReservaSala => ({
  id,
  nombre: `Cliente ${id}`,
  hora,
  numero_comensales: comensales,
  estado: "confirmada",
  espacio_id: RESERVADO.id,
});

describe("sala privada con una sola mesa — reparto automático", () => {
  it("una reserva de hasta 7 se queda la mesa entera", () => {
    for (const comensales of [3, 7]) {
      const { propuestas, sinHueco } = calcularDistribucionMesas({
        reservas: [reserva("a", comensales)],
        mesasLibres: [MESA_UNICA],
      });
      expect(propuestas).toHaveLength(1);
      expect(propuestas[0].mesaIds).toEqual([MESA_UNICA.id]);
      expect(propuestas[0].plazas).toBe(14);
      expect(sinHueco).toHaveLength(0);
    }
  });

  it("de 8 en adelante no se reparte solo: lo asigna una persona", () => {
    const { propuestas, sinHueco, paraRevisar } = calcularDistribucionMesas({
      reservas: [reserva("a", 12)],
      mesasLibres: [MESA_UNICA],
    });
    expect(propuestas).toHaveLength(0);
    expect(sinHueco).toHaveLength(0);
    expect(paraRevisar.map((r) => r.id)).toEqual(["a"]);
  });

  it("con dos reservas en el turno, solo una se queda la sala: la de más comensales; la otra queda pendiente de mesa", () => {
    const pequena = reserva("pequena", 3, "13:00:00");
    const grande = reserva("grande", 6, "14:30:00");
    const { propuestas, sinHueco } = calcularDistribucionMesas({
      reservas: [pequena, grande],
      mesasLibres: [MESA_UNICA],
    });
    expect(propuestas.map((p) => p.reserva.id)).toEqual(["grande"]);
    expect(sinHueco.map((r) => r.id)).toEqual(["pequena"]);
  });

  it("nunca reparte la misma mesa a dos reservas, por muchas que haya", () => {
    const { propuestas, sinHueco } = calcularDistribucionMesas({
      reservas: [reserva("a", 4), reserva("b", 5), reserva("c", 6), reserva("d", 2)],
      mesasLibres: [MESA_UNICA],
    });
    const mesasUsadas = propuestas.flatMap((p) => p.mesaIds);
    expect(mesasUsadas).toEqual([MESA_UNICA.id]);
    expect(propuestas).toHaveLength(1);
    expect(sinHueco).toHaveLength(3);
  });

  it("un grupo de más de 14 no se combina con nada: queda para revisar a mano", () => {
    const { propuestas, sinHueco, paraRevisar } = calcularDistribucionMesas({
      reservas: [reserva("enorme", 25)],
      mesasLibres: [MESA_UNICA],
    });
    expect(propuestas).toHaveLength(0);
    expect(sinHueco).toHaveLength(0);
    expect(paraRevisar.map((r) => r.id)).toEqual(["enorme"]);
  });

  it("si la mesa ya está ocupada en el turno (no llega como libre), todas quedan pendientes", () => {
    const { propuestas, sinHueco } = calcularDistribucionMesas({
      reservas: [reserva("a", 6)],
      mesasLibres: [],
    });
    expect(propuestas).toHaveLength(0);
    expect(sinHueco).toHaveLength(1);
  });
});

describe("sala privada con una sola mesa — cuadre de aforo", () => {
  it("sin mesas el Reservado descuadra (estado previo a la migración)", () => {
    const c = calcularCuadreEspacio(RESERVADO, []);
    expect(c.estado).toBe("sin_mesas");
    expect(c.descuadra).toBe(true);
    expect(c.diferencia).toBe(-14);
  });

  it("con la mesa única de 14 plazas el Reservado cuadra", () => {
    const c = calcularCuadreEspacio(RESERVADO, [
      { id: MESA_UNICA.id, espacio_id: RESERVADO.id, capacidad: MESA_UNICA.capacidad, activa: true },
    ]);
    expect(c.estado).toBe("cuadra");
    expect(c.descuadra).toBe(false);
    expect(c.plazasMesas).toBe(14);
    expect(c.mesasReales).toBe(1);
    expect(c.marca).toBe("casa_tomas");
  });
});
