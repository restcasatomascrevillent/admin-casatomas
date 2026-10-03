/**
 * `resumirOcupacion` (src/lib/reservas/resumenOcupacion.ts): las cifras de la franja de la pestaña «Hoy»
 * (reservas, comensales, capacidad y %). Que Touza no cuente (decisión del dueño 2026-10-01) se prueba en
 * src/lib/__tests__/negocios.test.ts; aquí, qué estados y qué salas cuentan.
 *
 *   · «Van a venir o han venido» = pendiente, verificada, confirmada y completada («Llegó»): esas suman
 *     reservas y comensales. Cancelada y «No vino» (no_show) no ocupan, pero sí cuentan en el total de
 *     todos los estados (y las canceladas en el suyo).
 *   · La capacidad es la suma de las salas ACTIVAS de Casa Tomás, como el trigger de aforo.
 */
import { describe, it, expect } from "vitest";
import { resumirOcupacion, type EspacioResumen, type ReservaResumen } from "@/lib/reservas/resumenOcupacion";

const r = (estado: string, numero_comensales: number | null, marca: string | null = "casa_tomas"): ReservaResumen => ({
  estado,
  numero_comensales,
  marca,
});

const SALAS: EspacioResumen[] = [
  { capacidad_maxima: 50, activa: true, caracteristicas: {} },
  { capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
];

describe("resumirOcupacion · qué estados cuentan", () => {
  it("«Llegó» (completada) cuenta como las vivas; cancelada y «No vino» no ocupan", () => {
    const cifras = resumirOcupacion(
      [
        r("pendiente", 2),
        r("verificada", 3),
        r("confirmada", 4),
        r("completada", 5),
        r("cancelada", 6),
        r("no_show", 7),
      ],
      SALAS,
    );

    expect(cifras).toEqual({
      totalReservas: 4,
      totalComensales: 14, // 2 + 3 + 4 + 5
      reservasTodasEstados: 6,
      reservasCanceladas: 1,
      reservasConfirmadas: 1,
      reservasPendientes: 1,
      capacidadTotal: 100,
      porcentajeTotal: 14,
    });
  });

  it("un día solo con canceladas y «No vino»: 0 reservas y 0 comensales que ocupen, pero salen en el total", () => {
    const cifras = resumirOcupacion([r("cancelada", 4), r("cancelada", 2), r("no_show", 6)], SALAS);

    expect(cifras).toMatchObject({
      totalReservas: 0,
      totalComensales: 0,
      reservasTodasEstados: 3,
      reservasCanceladas: 2,
      porcentajeTotal: 0,
    });
  });

  it("comensales nulos cuentan como 0 y el % se redondea", () => {
    const cifras = resumirOcupacion([r("confirmada", null), r("confirmada", 9)], [
      { capacidad_maxima: 170, activa: true, caracteristicas: {} },
    ]);

    expect(cifras).toMatchObject({ totalReservas: 2, totalComensales: 9, capacidadTotal: 170, porcentajeTotal: 5 });
  });
});

describe("resumirOcupacion · qué salas suman capacidad", () => {
  it("las salas desactivadas no suman; las que no dicen si están activas, sí (como hasta ahora)", () => {
    const cifras = resumirOcupacion(
      [r("confirmada", 10)],
      [
        { capacidad_maxima: 50, activa: true, caracteristicas: {} },
        { capacidad_maxima: 40, activa: false, caracteristicas: { marca: "casa_tomas" } },
        { capacidad_maxima: 20, activa: null, caracteristicas: null },
        { capacidad_maxima: 30 },
      ],
    );

    expect(cifras.capacidadTotal).toBe(100); // 50 + 20 + 30; la desactivada (40) no
    expect(cifras.porcentajeTotal).toBe(10);
  });

  it("sin salas activas la capacidad es 0 y el % es 0 (no se divide entre cero)", () => {
    const cifras = resumirOcupacion([r("confirmada", 4)], [
      { capacidad_maxima: 50, activa: false, caracteristicas: {} },
    ]);

    expect(cifras).toMatchObject({ totalReservas: 1, totalComensales: 4, capacidadTotal: 0, porcentajeTotal: 0 });
  });
});

describe("resumirOcupacion · el Reservado (sala privada) está fuera de aforo", () => {
  const ESPACIOS: EspacioResumen[] = [
    { id: "comedor", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
    { id: "salon", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
    { id: "terraza", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
    { id: "reservado", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "casa_tomas", privada: true } },
  ];
  const en = (espacio_id: string, estado: string, n: number): ReservaResumen => ({
    estado,
    numero_comensales: n,
    marca: "casa_tomas",
    espacio_id,
  });

  it("la capacidad es 150 (sin el Reservado)", () => {
    expect(resumirOcupacion([], ESPACIOS).capacidadTotal).toBe(150);
  });

  it("sus reservas no suman reservas, comensales ni porcentaje", () => {
    const cifras = resumirOcupacion(
      [en("comedor", "confirmada", 15), en("reservado", "confirmada", 8), en("reservado", "pendiente", 3)],
      ESPACIOS,
    );
    expect(cifras).toMatchObject({
      totalReservas: 1,
      totalComensales: 15,
      reservasConfirmadas: 1,
      reservasPendientes: 0,
      capacidadTotal: 150,
      porcentajeTotal: 10,
    });
  });

  it("sin id de espacio en la reserva (dato antiguo) cuenta como siempre", () => {
    const cifras = resumirOcupacion([r("confirmada", 5)], ESPACIOS);
    expect(cifras.totalComensales).toBe(5);
  });

  it("una sala privada desactivada ya no es privada: sus reservas cuentan", () => {
    const apagada: EspacioResumen[] = [
      ...ESPACIOS.slice(0, 3),
      { id: "reservado", capacidad_maxima: 20, activa: false, caracteristicas: { marca: "casa_tomas", privada: true } },
    ];
    const cifras = resumirOcupacion([en("reservado", "confirmada", 4)], apagada);
    expect(cifras.totalComensales).toBe(4);
    expect(cifras.capacidadTotal).toBe(150);
  });
});
