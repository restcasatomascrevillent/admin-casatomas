/**
 * Piezas puras de la verificación (`verificacion.ts`): lo que escribe «Aceptar».
 *
 * CAMBIO ACORDADO CON EL DUEÑO (2026-10-01): «Aceptar» —de un clic y en bloque— acepta la
 * reserva TAL COMO ESTÁ AHORA, o sea lo que ve el personal en la lista: NO cambia la hora ni la
 * sala (ni, por el trigger de la BD, las mesas) que ya tiene.
 *
 * Hasta entonces escribía `hora = hora_solicitada` y `espacio_id = espacio_solicitado_id`:
 *   · en Casa Tomás el cliente ya no elige sala (reservas-sin-salas), así que
 *     `espacio_solicitado_id` es null (el trigger BEFORE INSERT lo congela a lo que llegó): al aceptar
 *     se escribía `espacio_id = null` y `trg_reservas_sincronizar_asignaciones` BORRABA la sala y las
 *     mesas que el personal ya hubiera asignado a la solicitud;
 *   · desde «editar siempre» el personal puede cambiar la hora de una pendiente antes de aceptarla:
 *     Aceptar la reescribía con la solicitada y la edición se revertía en silencio.
 *
 * LA REGLA: la hora no se toca nunca. La sala solo se escribe en un caso: ahora NO tiene (`espacio_id`
 * null) y se pidió una (`espacio_solicitado_id`: Touza, donde el espacio ES lo reservado) → se rellena
 * con la pedida. Nunca se escribe `espacio_id = null` ni otra sala distinta de la que hay.
 *
 * Módulo puro: estos tests no necesitan Supabase ni React.
 */
import { describe, it, expect } from "vitest";
import { espacioAlAceptar } from "../verificacion";
// La función del correo REAL (la misma que decide lo que se pinta): para documentar qué correo sale
// con la regla nueva. El correo lo calcula el servidor RELEYENDO la BD tras guardar.
import { hayContraoferta } from "../../../../supabase/functions/emails-reserva/plantillas";

const SALON = "e-salon";
const TERRAZA = "e-terraza";
const RESERVADO = "e-reservado-touza";

describe("espacioAlAceptar · qué sala se escribe al aceptar", () => {
  const casos: Array<[string, { espacio_id: string | null | undefined; espacio_solicitado_id: string | null | undefined }, { espacio_id?: string }]> = [
    // ── Casa Tomás: el cliente no pide sala ────────────────────────────────────────────────────
    ["Casa Tomás, sin sala pedida y sin sala asignada: no hay nada que escribir", { espacio_id: null, espacio_solicitado_id: null }, {}],
    [
      "Casa Tomás, sin sala pedida y con la sala que ya puso el personal (el caso P1: antes se BORRABA y con ella las mesas): se queda como está",
      { espacio_id: SALON, espacio_solicitado_id: null },
      {},
    ],
    // ── Touza (El Reservado): el espacio ES lo reservado ──────────────────────────────────────
    ["Touza con su espacio ya fijado (el normal, igual al pedido): nada que escribir, idéntico a antes", { espacio_id: RESERVADO, espacio_solicitado_id: RESERVADO }, {}],
    ["Touza sin espacio ahora y con el pedido: se RELLENA con el pedido", { espacio_id: null, espacio_solicitado_id: RESERVADO }, { espacio_id: RESERVADO }],
    // ── la sala actual y la pedida difieren ─────────────────────────────────────────────────────
    ["con la sala actual distinta de la pedida: manda la ACTUAL (la que ve el personal)", { espacio_id: SALON, espacio_solicitado_id: TERRAZA }, {}],
    // ── migración sin aplicar (la fila no trae las columnas de lo pedido) ─────────────────────
    ["sin la columna de lo pedido y con sala: se queda", { espacio_id: SALON, espacio_solicitado_id: undefined }, {}],
    ["sin la columna de lo pedido y sin sala: nada", { espacio_id: null, espacio_solicitado_id: undefined }, {}],
    ["sin sala (undefined) y sin pedida: nada", { espacio_id: undefined, espacio_solicitado_id: null }, {}],
  ];

  it.each(casos)("%s", (_nombre, reserva, esperado) => {
    expect(espacioAlAceptar(reserva)).toEqual(esperado);
  });

  it("NUNCA escribe `espacio_id` en null ni vacío: si hay algo que escribir es una sala de verdad", () => {
    for (const actual of [null, undefined, "", SALON, RESERVADO]) {
      for (const pedida of [null, undefined, "", SALON, TERRAZA, RESERVADO]) {
        const r = espacioAlAceptar({ espacio_id: actual as string | null, espacio_solicitado_id: pedida as string | null });
        if ("espacio_id" in r) expect(r.espacio_id, JSON.stringify({ actual, pedida })).toBeTruthy();
      }
    }
  });

  it("solo toca la sala cuando NO hay una y se pidió una (la única excepción de la regla)", () => {
    for (const actual of [SALON, TERRAZA, RESERVADO]) {
      for (const pedida of [null, undefined, SALON, TERRAZA, RESERVADO]) {
        expect(espacioAlAceptar({ espacio_id: actual, espacio_solicitado_id: pedida as string | null }), JSON.stringify({ actual, pedida })).toEqual({});
      }
    }
  });

  it("la hora no es cosa suya: devuelve solo columnas de sala", () => {
    for (const reserva of [
      { espacio_id: null, espacio_solicitado_id: RESERVADO },
      { espacio_id: SALON, espacio_solicitado_id: null },
    ]) {
      expect(Object.keys(espacioAlAceptar(reserva)).every((c) => c === "espacio_id")).toBe(true);
    }
  });
});

describe("el correo que sale tras aceptar (lo calcula el servidor releyendo la BD: plantilla «propuesta»)", () => {
  // `emails-reserva` pinta el bloque «Solicitado / Ofrecido» si y solo si `hayContraoferta()`: la HORA vigente
  // difiere de `hora_solicitada`. La SALA no sale nunca en el correo (decisión del dueño, 2026-09-28).
  const datos = (hora: string, horaSolicitada: string | null) => ({
    nombre: "Ana",
    fecha: "2026-10-02",
    hora,
    comensales: 4,
    espacio: null,
    horaSolicitada,
  });

  it("hora SIN editar (la que pidió el cliente): sin bloque de comparación, como siempre", () => {
    expect(hayContraoferta(datos("14:00:00", "14:00:00"))).toBe(false);
  });

  it("hora EDITADA por el personal antes de aceptar: con la regla nueva la hora se queda y el correo ofrece la nueva («Solicitado 14:00 / Ofrecido 14:30»), correcto", () => {
    // Antes Aceptar la reescribía con la solicitada: la edición se perdía y el correo salía como si nada.
    expect(hayContraoferta(datos("14:30:00", "14:00:00"))).toBe(true);
  });

  it("cambiar o conservar la SALA no cambia el correo: la sala no sale en él", () => {
    // Misma hora, sala distinta de la pedida: el correo es el mismo con o sin sala asignada.
    expect(hayContraoferta({ ...datos("14:00:00", "14:00:00"), espacio: "Salón", espacioSolicitado: null })).toBe(false);
    expect(hayContraoferta({ ...datos("14:00:00", "14:00:00"), espacio: null, espacioSolicitado: "Terraza" })).toBe(false);
  });

  it("sin la columna de la hora pedida (migración sin aplicar) no hay comparación que afirmar", () => {
    expect(hayContraoferta(datos("14:30:00", null))).toBe(false);
  });
});
