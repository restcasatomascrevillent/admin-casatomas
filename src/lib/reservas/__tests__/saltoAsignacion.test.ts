/**
 * Salto "ir a asignar mesa": de una reserva concreta al plano de su sala.
 *
 * Lo que se fija aquí es la DECISIÓN y, sobre todo, el TEXTO del motivo. Los dos
 * importan por igual: el dueño pidió (2026-09-28) que no haya "un botón que
 * lleve a una pantalla vacía sin decir por qué", así que cada caso en el que el
 * salto no se puede hacer tiene que traer su explicación. Y como el mismo texto
 * lo pintan dos pantallas distintas (la lista y la franja de pendientes de la
 * pestaña Hoy), se comprueba aquí una sola vez en vez de en cada una.
 */
import { describe, it, expect } from "vitest";
import {
  puedeSaltarAAsignacion,
  resolverSaltoAsignacion,
  type ReservaParaSalto,
} from "../saltoAsignacion";

const reservaCompleta: ReservaParaSalto = {
  id: "res-1",
  fecha: "2026-10-02",
  espacio_id: "sala-comedor",
  estado: "confirmada",
  hora: "14:00",
};

describe("resolverSaltoAsignacion", () => {
  describe("se puede saltar", () => {
    it("con sala y fecha devuelve el destino exacto que necesita el plano", () => {
      const { destino, motivo } = resolverSaltoAsignacion(reservaCompleta);
      expect(motivo).toBeNull();
      expect(destino).toEqual({
        espacioId: "sala-comedor",
        fecha: "2026-10-02",
        reservaId: "res-1",
        turno: "comida",
      });
    });

    describe("el turno viaja con el destino", () => {
      // Sin esto, el plano abre en el turno del reloj y la reserva que se iba a
      // sentar no sale en el panel (medido en el navegador el 2026-09-28).
      it.each([
        ["13:00", "comida"],
        ["16:59", "comida"],
        ["17:00", "cena"],
        ["22:15", "cena"],
        ["21:30:00", "cena"],
      ])("las %s son turno de %s", (hora, esperado) => {
        expect(resolverSaltoAsignacion({ ...reservaCompleta, hora }).destino?.turno).toBe(esperado);
      });

      it.each([null, undefined, "", "   ", "sin hora"])(
        "una hora inservible (%s) no inventa turno: el plano se queda como esté",
        (hora) => {
          const { destino } = resolverSaltoAsignacion({ ...reservaCompleta, hora });
          expect(destino).not.toBeNull();
          expect(destino?.turno).toBeUndefined();
        },
      );
    });

    it("el día del destino es el de la RESERVA, no hoy", () => {
      // Si el plano abriera en hoy, una reserva de la semana que viene no
      // aparecería en el panel: es el fallo que este campo evita.
      const { destino } = resolverSaltoAsignacion({ ...reservaCompleta, fecha: "2027-01-07" });
      expect(destino?.fecha).toBe("2027-01-07");
    });

    it.each(["pendiente", "verificada", "confirmada"])(
      "el estado «%s» no impide darle mesa",
      (estado) => {
        expect(resolverSaltoAsignacion({ ...reservaCompleta, estado }).destino).not.toBeNull();
      },
    );

    it("sin estado tampoco bloquea: la mesa nunca es obligatoria", () => {
      expect(resolverSaltoAsignacion({ ...reservaCompleta, estado: null }).destino).not.toBeNull();
    });

    it("nombra la sala en el título cuando se le pasa", () => {
      const { titulo } = resolverSaltoAsignacion(reservaCompleta, { nombreSala: "Comedor" });
      expect(titulo).toContain("Comedor");
      expect(titulo).toMatch(/darle mesa/i);
    });

    it("con mesa ya puesta el salto sigue disponible, pero el texto cambia", () => {
      // Entrar al plano con la mesa puesta sigue siendo útil (moverla, juntar
      // otra); lo único que cambia es que ahí no queda trabajo pendiente.
      const conMesa = resolverSaltoAsignacion(reservaCompleta, { yaTieneMesa: true });
      expect(conMesa.destino).not.toBeNull();
      expect(conMesa.titulo).toMatch(/ya tiene mesa/i);

      const sinMesa = resolverSaltoAsignacion(reservaCompleta, { yaTieneMesa: false });
      expect(sinMesa.titulo).not.toMatch(/ya tiene mesa/i);
    });
  });

  describe("no se puede saltar — y cada caso dice por qué", () => {
    it("sin sala: no salta y manda a «Gestionar», que es donde se pone la sala", () => {
      // El plano se abre siempre sobre UNA sala y su panel solo lista las
      // reservas de esa sala. Sin sala no hay ninguna donde aparecería, y
      // "la sala por defecto" no existe: `espacios_reserva` no tiene columna
      // de orden ni de prioridad.
      const { destino, motivo, titulo } = resolverSaltoAsignacion({
        ...reservaCompleta,
        espacio_id: null,
      });
      expect(destino).toBeNull();
      expect(motivo).toBe("sin_sala");
      expect(titulo).toMatch(/sala/i);
      expect(titulo).toContain("Gestionar");
    });

    it("una sala en blanco cuenta como sin sala", () => {
      expect(resolverSaltoAsignacion({ ...reservaCompleta, espacio_id: "" }).motivo).toBe("sin_sala");
    });

    it("cancelada: no hay nada que sentar", () => {
      const { destino, motivo, titulo } = resolverSaltoAsignacion({
        ...reservaCompleta,
        estado: "cancelada",
      });
      expect(destino).toBeNull();
      expect(motivo).toBe("cancelada");
      expect(titulo).toMatch(/cancelada/i);
    });

    it("cancelada manda incluso si además le falta la sala", () => {
      // Orden a propósito: lo primero que hay que contar es que ya no hay nada
      // que hacer con ella, no que le falte un dato.
      const { motivo } = resolverSaltoAsignacion({
        ...reservaCompleta,
        estado: "cancelada",
        espacio_id: null,
      });
      expect(motivo).toBe("cancelada");
    });

    it("sin fecha: sin día no se puede abrir el plano", () => {
      const { destino, motivo, titulo } = resolverSaltoAsignacion({
        ...reservaCompleta,
        fecha: null,
      });
      expect(destino).toBeNull();
      expect(motivo).toBe("sin_fecha");
      expect(titulo).toMatch(/fecha|día/i);
    });

    it("lo que no es una reserva (solicitud del bot) explica que hay que aceptarla antes", () => {
      for (const noReserva of [null, undefined, { id: "" } as ReservaParaSalto]) {
        const { destino, motivo, titulo } = resolverSaltoAsignacion(noReserva);
        expect(destino).toBeNull();
        expect(motivo).toBe("no_es_reserva");
        expect(titulo).toMatch(/todavía no es una reserva/i);
      }
    });
  });

  it("el título NUNCA viene vacío, salte o no", () => {
    // De esto vive el `title` del botón: deshabilitado sin explicación es
    // justo lo que el dueño no quiere.
    const casos: (ReservaParaSalto | null)[] = [
      reservaCompleta,
      { ...reservaCompleta, espacio_id: null },
      { ...reservaCompleta, fecha: null },
      { ...reservaCompleta, estado: "cancelada" },
      null,
    ];
    for (const caso of casos) {
      expect(resolverSaltoAsignacion(caso).titulo.trim().length).toBeGreaterThan(0);
    }
  });

  it("no habla nunca en tono de error ni de aviso", () => {
    // "Con sala pero sin mesa" es trabajo pendiente normal (petición explícita
    // del dueño). Ni el caso bueno ni el de "sin sala" pueden sonar a fallo.
    for (const caso of [reservaCompleta, { ...reservaCompleta, espacio_id: null }]) {
      expect(resolverSaltoAsignacion(caso).titulo).not.toMatch(/error|fallo|inválid|incorrect/i);
    }
  });
});

describe("puedeSaltarAAsignacion", () => {
  it("resume la decisión en un booleano", () => {
    expect(puedeSaltarAAsignacion(reservaCompleta)).toBe(true);
    expect(puedeSaltarAAsignacion({ ...reservaCompleta, espacio_id: null })).toBe(false);
    expect(puedeSaltarAAsignacion(null)).toBe(false);
  });
});
