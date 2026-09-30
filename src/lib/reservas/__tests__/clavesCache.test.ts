/**
 * Claves de caché que hay que refrescar tras tocar una reserva (`clavesCache.ts`).
 *
 * Antes había CINCO listas repartidas (la de `useAccionesServicioReserva`, la de
 * `useCambiarSalaReserva`, `invalidarTodo` del modo servicio, y las dos de
 * `FormularioReserva`) y ninguna era igual que otra: mover de sala no refrescaba el
 * modo servicio ni la disponibilidad, cambiar la sala desde Asignación no refrescaba
 * los contadores, la estrella solo las tres listas… Aquí hay UNA, por tipo de cambio.
 *
 * Es un módulo puro: estos tests no necesitan Supabase ni React Query (el único
 * `vi.mock` es para poder importar las constantes de los hooks y comprobar que los
 * textos coinciden).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client");

import {
  CLAVES_LISTAS_RESERVAS,
  CLAVES_POR_CAMBIO,
  clavesAInvalidar,
  tipoDeCambio,
  type TipoCambioReserva,
} from "../clavesCache";
import { CLAVE_ASIGNACIONES_MESA } from "@/hooks/useAsignacionesMesa";
import { CLAVE_RESUMEN_ASIGNACION_DIA } from "@/hooks/useResumenAsignacionDia";
import { CLAVE_RESERVAS_SERVICIO_DIA } from "@/hooks/useReservasServicioDia";
import { CLAVE_OCUPACION_SALAS_DIA } from "@/hooks/useOcupacionSalasDia";
// Texto de los ficheros donde se DECLARAN las consultas (`?raw` de Vite): sirve para
// comprobar que cada clave de la lista existe de verdad. Una clave con un nombre que
// nadie usa no falla nunca y no refresca nada (es lo que le pasaba a
// `ocupacion-reservas-hoy` en `FormularioReserva`).
import fuenteOcupacionHoy from "@/hooks/useOcupacionHoy.ts?raw";
import fuenteDashboard from "@/hooks/useDashboardStats.ts?raw";
import fuenteDisponibilidad from "@/hooks/useDisponibilidad.ts?raw";
import fuenteCalendario from "@/components/reservas/CalendarioOcupacion.tsx?raw";
import fuentePlano from "@/components/reservas/asignacionPlano.ts?raw";
import fuenteKanban from "@/components/reservas/GestorReservasKanban.tsx?raw";
import fuenteLista from "@/components/reservas/ListaReservasAvanzada.tsx?raw";
import fuenteVistaHoy from "@/components/reservas/VistaHoy.tsx?raw";
import fuenteServicioDia from "@/hooks/useReservasServicioDia.ts?raw";
import fuenteOcupacionSalas from "@/hooks/useOcupacionSalasDia.ts?raw";
import fuenteAsignaciones from "@/hooks/useAsignacionesMesa.ts?raw";
import fuenteResumenAsignacion from "@/hooks/useResumenAsignacionDia.ts?raw";

const TIPOS: TipoCambioReserva[] = ["ocupacion", "importante", "salida"];

describe("las listas por tipo de cambio", () => {
  it("las tres listas de reservas son las que parchean en local las acciones (el orden importa: es el de los snapshots)", () => {
    expect([...CLAVES_LISTAS_RESERVAS]).toEqual(["reservas-kanban", "reservas-hoy", "reservas-lista"]);
  });

  it("«ocupacion» (estado, día, hora, sala, comensales): listas, contadores, vistas del día, disponibilidad y mesas", () => {
    expect([...CLAVES_POR_CAMBIO.ocupacion]).toEqual([
      // Listas de filas (se parchean además en local).
      "reservas-kanban",
      "reservas-hoy",
      "reservas-lista",
      // Contadores y ocupación (los mismos de siempre, en el mismo orden).
      "reservas_hoy_resumen",
      "reservas_hoy_todas",
      "ocupacion_hoy",
      "today-reservations",
      "today-confirmed-reservations",
      "dashboard-stats",
      "reservas_mes",
      "ocupacion-salas-dia",
      // Modo servicio y plano de una sala: leen estado, sala e «importante».
      "reservas-servicio-dia",
      "reservas_sala_dia",
      // Lo que ofrece la rejilla de horas: cancelar o llegar libera / ocupa aforo.
      "disponibilidad",
      "disponibilidad-detallada",
      "disponibilidad-rango",
      "disponibilidad-calculada",
      // Mesas asignadas y panel «Asignación»: cancelar o cambiar de sala las quita
      // (trigger `trg_reservas_sincronizar_asignaciones`) y solo las vivas están en la vista.
      "resumen-asignacion-dia",
      "asignaciones_mesa",
    ]);
  });

  it("«importante»: las listas y lo que enseña la estrella en el modo servicio y en el plano (ningún contador cambia)", () => {
    expect([...CLAVES_POR_CAMBIO.importante]).toEqual([
      "reservas-kanban",
      "reservas-hoy",
      "reservas-lista",
      "reservas-servicio-dia",
      "reservas_sala_dia",
    ]);
  });

  it("«salida» (liberar mesa en el modo servicio): exactamente lo que refrescaba `invalidarTodo`, en su orden", () => {
    expect([...CLAVES_POR_CAMBIO.salida]).toEqual(["reservas-servicio-dia", "asignaciones_mesa", "ocupacion-salas-dia"]);
  });

  it.each(TIPOS)("la lista de «%s» no repite ninguna clave", (tipo) => {
    const claves = CLAVES_POR_CAMBIO[tipo];
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("toda clave de «importante» y de «salida» también está en «ocupacion» (la amplia es la unión)", () => {
    for (const tipo of ["importante", "salida"] as const) {
      for (const clave of CLAVES_POR_CAMBIO[tipo]) expect(CLAVES_POR_CAMBIO.ocupacion, `${tipo}: ${clave}`).toContain(clave);
    }
  });
});

describe("tipoDeCambio: qué tipo es según las columnas que se escriben", () => {
  it.each<[string, Record<string, unknown>, TipoCambioReserva]>([
    ["estado", { estado: "confirmada" }, "ocupacion"],
    ["«Ha llegado»", { estado: "completada", llegada_at: "2026-09-30T19:00:00.000Z" }, "ocupacion"],
    ["sala", { espacio_id: "terraza" }, "ocupacion"],
    ["sala a null", { espacio_id: null }, "ocupacion"],
    ["verificar con hora y sala", { hora: "21:00", espacio_id: "salon", estado: "verificada" }, "ocupacion"],
    ["día", { fecha: "2026-10-02" }, "ocupacion"],
    ["comensales", { numero_comensales: 6 }, "ocupacion"],
    ["solo la estrella", { importante: true }, "importante"],
    ["la estrella con el estado: manda el estado", { importante: true, estado: "cancelada" }, "ocupacion"],
    ["solo la salida de mesa", { salida_at: "2026-09-30T21:00:00.000Z" }, "salida"],
    ["solo llegada_at", { llegada_at: null }, "ocupacion"],
    ["una columna que no conoce: lo más amplio, por si acaso", { notas_cliente: "x" }, "ocupacion"],
    ["nada", {}, "ocupacion"],
  ])("%s", (_nombre, cambios, esperado) => {
    expect(tipoDeCambio(cambios)).toBe(esperado);
  });
});

describe("clavesAInvalidar", () => {
  it("devuelve la lista del tipo de cambio", () => {
    expect([...clavesAInvalidar({ estado: "completada" })]).toEqual([...CLAVES_POR_CAMBIO.ocupacion]);
    expect([...clavesAInvalidar({ importante: false })]).toEqual([...CLAVES_POR_CAMBIO.importante]);
    expect([...clavesAInvalidar({ salida_at: null })]).toEqual([...CLAVES_POR_CAMBIO.salida]);
  });

  it("cambiar la sala refresca lo mismo que cambiar el estado: ya no hay un escritor de sala con menos claves que otro", () => {
    expect([...clavesAInvalidar({ espacio_id: "terraza" })]).toEqual([...clavesAInvalidar({ estado: "no_show" })]);
  });

  it("la estrella NO refresca contadores, disponibilidad ni mesas", () => {
    const claves = clavesAInvalidar({ importante: true });
    for (const clave of ["reservas_hoy_resumen", "dashboard-stats", "disponibilidad", "asignaciones_mesa", "resumen-asignacion-dia"]) {
      expect(claves, clave).not.toContain(clave);
    }
  });
});

describe("las claves son las de verdad", () => {
  it("los nombres con constante propia coinciden con los de sus hooks", () => {
    expect(CLAVES_POR_CAMBIO.ocupacion).toEqual(
      expect.arrayContaining([
        CLAVE_ASIGNACIONES_MESA,
        CLAVE_RESUMEN_ASIGNACION_DIA,
        CLAVE_RESERVAS_SERVICIO_DIA,
        CLAVE_OCUPACION_SALAS_DIA,
      ]),
    );
    expect(CLAVES_POR_CAMBIO.salida).toEqual([CLAVE_RESERVAS_SERVICIO_DIA, CLAVE_ASIGNACIONES_MESA, CLAVE_OCUPACION_SALAS_DIA]);
  });

  it("cada clave está declarada como `queryKey` (o como su constante) en algún fichero de la app", () => {
    const fuentes = [
      fuenteOcupacionHoy,
      fuenteDashboard,
      fuenteDisponibilidad,
      fuenteCalendario,
      fuentePlano,
      fuenteKanban,
      fuenteLista,
      fuenteVistaHoy,
      fuenteServicioDia,
      fuenteOcupacionSalas,
      fuenteAsignaciones,
      fuenteResumenAsignacion,
    ].join("\n");

    const muertas = CLAVES_POR_CAMBIO.ocupacion.filter((clave) => !fuentes.includes(`"${clave}"`));
    expect(muertas).toEqual([]);
  });
});
