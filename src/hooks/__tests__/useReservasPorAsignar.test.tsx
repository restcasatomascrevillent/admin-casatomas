/**
 * `useReservasPorAsignar` — la LECTURA del panel «Asignación» (la mutación de sala tiene sus
 * propios tests en `useCambiarSalaReserva.test.tsx`).
 *
 * Hasta el 2026-10-01 pedía todo el rango (hasta 30 días) en UNA consulta, y PostgREST corta cada
 * consulta a 1000 filas: con más reservas en el rango se perdían las últimas en silencio (el
 * panel solo avisaba). Ahora lee el rango por lotes (`paginarConsulta`, que tiene sus tests
 * aparte) y aquí se comprueba lo que el hook añade, contra un doble en memoria del cliente de
 * Supabase que aplica filtros, orden, `range`, el recuento y el tope de 1000 filas por petición:
 *
 *   · llegan TODAS las reservas del rango (0, 1.001 y 2.500 filas; el tope de seguridad, con 10.001);
 *   · la consulta mantiene sus filtros y su orden en cada lote, con `reserva_id` de desempate:
 *     con muchas reservas a la misma hora y un servidor que desordena los empates, no se repite
 *     ni se salta ninguna;
 *   · TODO O NADA: mientras faltan lotes no se enseñan filas a medias (ni al cargar ni al
 *     refrescar) y si un lote falla el hook da error, no un trozo de la lista;
 *   · sigue siendo la misma clave de caché (invalidar el prefijo relee el rango entero) y las
 *     filas siguen saneadas (`normalizarFila`);
 *   · COHERENCIA: si los datos cambian mientras se leen los lotes (una reserva sale de la vista al
 *     pasar a «completada», o entra otra y una fila llega dos veces) el primer intento se rechaza
 *     (`ErrorLecturaInconsistente`) y TanStack Query reintenta: con `retry: 1` el reintento trae el
 *     rango completo y sin repetidas, y en ningún momento se pinta un conjunto con huecos;
 *   · CANCELACIÓN: el `signal` de TanStack Query llega a cada lote y, cuando un evento realtime
 *     invalida la consulta a mitad de una lectura (o el panel se desmonta), la lectura vieja
 *     aborta su señal y no lanza más lotes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleSupabase } = await import("@/lib/reservas/__tests__/dobleSupabaseLotes");
  return { supabase: crearDobleSupabase() };
});

import { supabase } from "@/integrations/supabase/client";
import { useReservasPorAsignar } from "@/hooks/useReservasPorAsignar";
import { CLAVE_RESUMEN_ASIGNACION_DIA } from "@/hooks/useResumenAsignacionDia";
import type { DobleSupabase, FilaDoble } from "@/lib/reservas/__tests__/dobleSupabaseLotes";

const doble = supabase as unknown as DobleSupabase;

const DESDE = "2026-10-01";
const HASTA = "2026-10-30";

// ─── Datos: filas de `vista_asignacion_dia` ──────────────────────────────────

const relleno = (n: number, ancho = 5) => String(n).padStart(ancho, "0");

/** Una fila de la vista, con los grados repartidos (sin sala / sin mesa / con mesa). */
function filaVista(i: number, fecha: string, hora: string): FilaDoble {
  const grado = (["sin_sala", "sin_mesa", "con_mesa"] as const)[i % 3];
  return {
    reserva_id: `res-${relleno(i)}`,
    fecha,
    hora,
    turno: hora < "17:00:00" ? "comida" : "cena",
    nombre: `Cliente ${i}`,
    numero_comensales: 2 + (i % 5),
    estado: "confirmada",
    marca: "casa_tomas",
    espacio_id: grado === "sin_sala" ? null : "salon",
    espacio_nombre: grado === "sin_sala" ? null : "Salón",
    mesas_asignadas: grado === "con_mesa" ? 1 : 0,
    plazas_asignadas: grado === "con_mesa" ? 4 : 0,
    mesas_nombres: grado === "con_mesa" ? ["Mesa 1"] : [],
    grado,
  };
}

/**
 * `n` reservas DENTRO del rango, repartidas entre el 1 y el 30 de octubre y solo en tres horas
 * (muchísimos empates de fecha y hora), más tres FUERA del rango que el filtro tiene que dejar fuera.
 */
function tablaDeLaVista(n: number): FilaDoble[] {
  const dentro = Array.from({ length: n }, (_, i) =>
    filaVista(i, `2026-10-${relleno(1 + (i % 30), 2)}`, ["13:00:00", "14:00:00", "21:00:00"][i % 3]),
  );
  const fuera = [
    filaVista(90001, "2026-09-30", "21:00:00"),
    filaVista(90002, "2026-10-31", "13:00:00"),
    filaVista(90003, "2026-11-02", "21:00:00"),
  ];
  return [...fuera, ...dentro];
}

// ─── Montaje ─────────────────────────────────────────────────────────────────

let queryClient: QueryClient;

/**
 * `reintentos`: lo que reintenta TanStack Query una consulta que falla (sin espera entre intentos).
 * `vistos`: el nº de filas de `data` en CADA render del hook (`undefined` mientras no hay datos), para
 * comprobar que en ningún momento se pintó un conjunto a medias.
 */
function montar(opciones?: { enabled?: boolean; reintentos?: number }) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: opciones?.reintentos ?? false, retryDelay: 0, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const vistos: Array<number | undefined> = [];
  const montado = renderHook(
    () => {
      const lectura = useReservasPorAsignar(DESDE, HASTA, { enabled: opciones?.enabled });
      vistos.push(lectura.data?.length);
      return lectura;
    },
    { wrapper },
  );
  return { ...montado, vistos };
}

const cederTurno = (ms = 0) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/** Comparación de cadenas por código (como la del doble), sin depender del idioma del entorno. */
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** Las filas DENTRO del rango, en el orden de la consulta (fecha, hora, reserva_id). */
const enOrdenDeLaConsulta = (tabla: FilaDoble[]) =>
  tabla
    .filter((f) => String(f.fecha) >= DESDE && String(f.fecha) <= HASTA)
    .sort((a, b) => cmp(a.fecha, b.fecha) || cmp(a.hora, b.hora) || cmp(a.reserva_id, b.reserva_id));

/** Quita una reserva de la tabla de la vista (sale de la vista: pasa a «completada», se cancela…). */
const sacarDeLaVista = (reservaId: string) => {
  doble.tablas.vista_asignacion_dia = doble.tablas.vista_asignacion_dia.filter((f) => f.reserva_id !== reservaId);
};

const diferido = () => {
  let resolver!: () => void;
  const promesa = new Promise<void>((ok) => {
    resolver = ok;
  });
  return { promesa, resolver };
};

/** Con la máquina cargada (la suite entera en paralelo) leer 2.500 filas puede pasar del segundo que espera `waitFor` por defecto. */
const ESPERA = { timeout: 5_000 };
const GRANDE = { timeout: 15_000 };

beforeEach(() => {
  doble.reiniciar();
  vi.clearAllMocks();
});

// ─── 1. Cuántas reservas llegan ──────────────────────────────────────────────

describe("useReservasPorAsignar · lee el rango entero", () => {
  it("sin reservas: lista vacía, sin aviso de tope y una sola petición", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(0);

    const { result } = montar();

    await waitFor(() => expect(result.current.isLoading).toBe(false), ESPERA);
    expect(result.current.data).toEqual([]);
    expect(result.current.truncado).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(doble.peticiones).toHaveLength(1);
  });

  it("999 reservas caben en un lote: una sola petición", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(999);

    const { result } = montar();

    await waitFor(() => expect(result.current.data).toHaveLength(999), ESPERA);
    expect(doble.peticiones).toHaveLength(1);
  });

  it("1.001 reservas (una más de las que caben en una consulta): llegan todas, en dos lotes", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(1001);

    const { result } = montar();

    await waitFor(() => expect(result.current.data).toHaveLength(1001), ESPERA);
    expect(result.current.truncado).toBe(false);
    expect(doble.peticiones.map((p) => p.rango)).toEqual([[0, 999], [1000, 1000]]);
  });

  it("2.500 reservas con empates de hora y un servidor que desordena los empates: todas, ordenadas y sin repetir", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    doble.opciones.desordenarEmpates = true;

    const { result } = montar();

    await waitFor(() => expect(result.current.data).toHaveLength(2500), ESPERA);
    const filas = result.current.data!;
    expect(new Set(filas.map((f) => f.reserva_id)).size).toBe(2500);
    const claves = filas.map((f) => `${f.fecha} ${f.hora} ${f.reserva_id}`);
    expect(claves).toEqual([...claves].sort());
    expect(result.current.truncado).toBe(false);
  });

  it("las filas siguen saneadas (`normalizarFila`): turno y grado se recalculan si no son válidos, los números son enteros", async () => {
    doble.tablas.vista_asignacion_dia = [
      { ...filaVista(1, "2026-10-05", "21:30:00"), turno: null, grado: null, numero_comensales: "4", mesas_asignadas: null, espacio_id: null },
    ];

    const { result } = montar();

    await waitFor(() => expect(result.current.data).toHaveLength(1), ESPERA);
    expect(result.current.data![0]).toMatchObject({
      reserva_id: "res-00001",
      turno: "cena",
      grado: "sin_sala",
      numero_comensales: 4,
      mesas_asignadas: 0,
      espacio_id: null,
    });
  });
});

// ─── 2. La consulta ──────────────────────────────────────────────────────────

describe("useReservasPorAsignar · la consulta de cada lote", () => {
  it("mantiene tabla, select, filtros y orden (con `reserva_id` de desempate) y deja fuera lo de fuera del rango", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);

    const { result } = montar();

    await waitFor(() => expect(result.current.data).toHaveLength(2500), ESPERA);
    // Las tres de fuera del rango (30/09, 31/10, 02/11) no están.
    expect(result.current.data!.every((f) => f.fecha >= DESDE && f.fecha <= HASTA)).toBe(true);

    expect(doble.peticiones).toHaveLength(3);
    for (const p of doble.peticiones) {
      expect(p.tabla).toBe("vista_asignacion_dia");
      expect(p.columnas).toBe("*");
      expect(p.filtros).toEqual([`fecha>=${DESDE}`, `fecha<=${HASTA}`]);
      expect(p.orden).toEqual([
        { columna: "fecha", ascendente: true },
        { columna: "hora", ascendente: true },
        { columna: "reserva_id", ascendente: true },
      ]);
    }
    // Solo el primer lote pide el recuento.
    expect(doble.peticiones.map((p) => p.contar)).toEqual([true, false, false]);
  });

  it("no lee nada si está desactivado", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(10);

    const { result } = montar({ enabled: false });

    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 20));
    });
    expect(result.current.data).toBeUndefined();
    expect(doble.peticiones).toHaveLength(0);
  });
});

// ─── 3. Todo o nada ─────────────────────────────────────────────────────────

describe("useReservasPorAsignar · todo o nada", () => {
  it("mientras falta un lote no se enseña ninguna fila: sigue «cargando», como cuando era una sola consulta", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    const puerta = diferido();
    doble.opciones.antesDeResponder = (p) => (p.numero === 2 ? puerta.promesa : undefined);

    const { result } = montar();

    // Los otros dos lotes ya han llegado; el segundo está retenido.
    await waitFor(() => expect(doble.peticiones).toHaveLength(3), ESPERA);
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 20));
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    puerta.resolver();

    await waitFor(() => expect(result.current.data).toHaveLength(2500), ESPERA);
    expect(result.current.isLoading).toBe(false);
  });

  it("al refrescar se sigue viendo la lista de antes hasta que llegan TODOS los lotes (sin parpadeos ni filas a medias)", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(1500);
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1500), ESPERA);
    const antes = result.current.data;

    // Entran 1.000 reservas más; el segundo lote de la lectura nueva queda retenido.
    const puerta = diferido();
    const peticionesDeLaPrimeraCarga = doble.peticiones.length;
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    doble.opciones.antesDeResponder = (p) => (p.numero === peticionesDeLaPrimeraCarga + 2 ? puerta.promesa : undefined);

    let refresco!: Promise<unknown>;
    act(() => {
      refresco = result.current.refetch();
    });
    await waitFor(() => expect(doble.peticiones.length).toBe(peticionesDeLaPrimeraCarga + 3), ESPERA);
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 20));
    });

    // Con la lectura nueva a medias, la pantalla sigue con la de antes: ni filas nuevas sueltas ni «cargando».
    expect(result.current.data).toBe(antes);
    expect(result.current.isLoading).toBe(false);

    puerta.resolver();
    await act(async () => {
      await refresco;
    });

    // React Query avisa a los componentes en el turno siguiente del reloj: se espera a verlo pintado.
    await waitFor(() => expect(result.current.data).toHaveLength(2500), ESPERA);
  });

  it("si falla el SEGUNDO lote, el hook da error y no enseña un trozo de la lista", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    doble.opciones.fallar = (p) => (p.rango?.[0] === 1000 ? { code: "57014", message: "statement timeout" } : undefined);

    const { result } = montar();

    await waitFor(() => expect(result.current.isError).toBe(true), ESPERA);
    expect(result.current.data).toBeUndefined();
    expect(result.current.truncado).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("tras un fallo, «Reintentar» (`refetch`) vuelve a leer y, si ya funciona, trae todo", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    doble.opciones.fallar = (p) => (p.rango?.[0] === 1000 ? { message: "red caída" } : undefined);
    const { result } = montar();
    await waitFor(() => expect(result.current.isError).toBe(true), ESPERA);

    doble.opciones.fallar = undefined;
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2500), ESPERA);
    expect(result.current.isError).toBe(false);
  });
});

// ─── 4. Caché y tope ─────────────────────────────────────────────────────────

describe("useReservasPorAsignar · caché y tope de seguridad", () => {
  it("invalidar el prefijo de la caché de asignación (lo que hacen las mutaciones de mesas) relee el rango ENTERO", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(1500);
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1500), ESPERA);
    expect(queryClient.getQueryCache().find({ queryKey: [CLAVE_RESUMEN_ASIGNACION_DIA, "rango", DESDE, HASTA] })).toBeDefined();

    // Mientras tanto entran 600 reservas más.
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2100);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [CLAVE_RESUMEN_ASIGNACION_DIA] });
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2100), ESPERA);
  });

  it("con más de 10.000 reservas en el rango trae las primeras 10.000 y lo dice (`truncado`)", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(10_001);

    const { result } = montar();

    await waitFor(() => expect(result.current.truncado).toBe(true), GRANDE);
    expect(result.current.data).toHaveLength(10_000);
    expect(doble.peticiones).toHaveLength(10);
  }, 30_000);

  it("con 10.000 justas están completas: sin aviso", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(10_000);

    const { result } = montar();

    await waitFor(() => expect(result.current.data).toHaveLength(10_000), GRANDE);
    expect(result.current.truncado).toBe(false);
  }, 30_000);
});

// ─── 5. Coherencia: los datos cambian mientras se leen los lotes ─────────────

describe("useReservasPorAsignar · los datos cambian entre lotes", () => {
  it("una reserva SALE de la vista entre el lote 1 y el 2 (pasa a «completada»): el primer intento se rechaza y el reintento trae el rango completo, sin la que salió y sin repetidas", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    const saliente = String(enOrdenDeLaConsulta(doble.tablas.vista_asignacion_dia)[10].reserva_id);
    let cambiado = false;
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2 && !cambiado) {
        cambiado = true;
        sacarDeLaVista(saliente);
      }
    };

    const { result, vistos } = montar({ reintentos: 1 });

    await waitFor(() => expect(result.current.data).toHaveLength(2499), ESPERA);
    const ids = result.current.data!.map((f) => f.reserva_id);
    expect(new Set(ids).size).toBe(2499);
    expect(ids).not.toContain(saliente);
    expect(result.current.isError).toBe(false);
    expect(doble.peticiones).toHaveLength(6); // los 3 lotes del primer intento y los 3 del reintento
    // En ningún render hubo un conjunto con huecos: solo «cargando» y, al final, el rango completo.
    expect(new Set(vistos)).toEqual(new Set([undefined, 2499]));
  });

  it("entra una reserva entre lotes (todo se desplaza y una fila llega dos veces): se descarta por `clave`, la cuenta no cuadra y el reintento trae las 2.501 sin repetidas", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    let cambiado = false;
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2 && !cambiado) {
        cambiado = true;
        // Cae la PRIMERA del orden (a las 00:00; el resto, desde las 13:00).
        doble.tablas.vista_asignacion_dia.push(filaVista(90100, "2026-10-01", "00:00:00"));
      }
    };

    const { result, vistos } = montar({ reintentos: 1 });

    await waitFor(() => expect(result.current.data).toHaveLength(2501), ESPERA);
    const ids = result.current.data!.map((f) => f.reserva_id);
    expect(new Set(ids).size).toBe(2501); // sin repetidas…
    expect(ids).toContain("res-90100"); // …con la nueva…
    expect(ids).toContain("res-02499"); // …y sin perder la última de las que había
    expect(doble.peticiones).toHaveLength(6); // el primer intento se rechazó y se reintentó
    expect(new Set(vistos)).toEqual(new Set([undefined, 2501]));
  });

  it("si la inconsistencia persiste en todos los intentos, el hook acaba en error y no enseña ninguna fila", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    // Sale una reserva del primer lote en cada intento, justo después de leer el primer lote.
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2 || p.numero === 5) {
        sacarDeLaVista(String(enOrdenDeLaConsulta(doble.tablas.vista_asignacion_dia)[10].reserva_id));
      }
    };

    const { result, vistos } = montar({ reintentos: 1 });

    await waitFor(() => expect(result.current.isError).toBe(true), ESPERA);
    expect(result.current.data).toBeUndefined();
    expect(doble.peticiones).toHaveLength(6);
    expect(new Set(vistos)).toEqual(new Set([undefined])); // nunca hubo filas
  });

  it("sin reintentos, un solo intento inconsistente ya es error (no datos con huecos)", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2) sacarDeLaVista(String(enOrdenDeLaConsulta(doble.tablas.vista_asignacion_dia)[10].reserva_id));
    };

    const { result } = montar();

    await waitFor(() => expect(result.current.isError).toBe(true), ESPERA);
    expect(result.current.data).toBeUndefined();
  });

  it("con la lista de antes en pantalla, un refresco inconsistente no enseña nunca un conjunto con huecos: sigue la de antes hasta que el reintento trae la nueva", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(1500);
    const { result, vistos } = montar({ reintentos: 1 });
    await waitFor(() => expect(result.current.data).toHaveLength(1500), ESPERA);
    const antes = result.current.data;

    // Entran 1.000 reservas más y, en el primer intento del refresco, sale una entre el lote 1 y el 2.
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    const peticionesDeLaPrimeraCarga = doble.peticiones.length;
    let cambiado = false;
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === peticionesDeLaPrimeraCarga + 2 && !cambiado) {
        cambiado = true;
        sacarDeLaVista(String(enOrdenDeLaConsulta(doble.tablas.vista_asignacion_dia)[10].reserva_id));
      }
    };

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2499), ESPERA);
    expect(result.current.data).not.toBe(antes);
    expect(result.current.isError).toBe(false);
    // Primero la lista de antes (1.500) y luego la completa (2.499): nada intermedio.
    expect(new Set(vistos)).toEqual(new Set([undefined, 1500, 2499]));
  });
});

// ─── 6. Cancelación ──────────────────────────────────────────────────────────

describe("useReservasPorAsignar · cancelación", () => {
  it("pasa el `signal` de TanStack Query a cada lote (`.abortSignal`): el mismo en toda la lectura y sin abortar", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);

    const { result } = montar();

    await waitFor(() => expect(result.current.data).toHaveLength(2500), ESPERA);
    expect(doble.peticiones).toHaveLength(3);
    const senales = doble.peticiones.map((p) => p.signal);
    for (const senal of senales) {
      expect(senal).toBeInstanceOf(AbortSignal);
      expect(senal!.aborted).toBe(false);
    }
    expect(new Set(senales).size).toBe(1);
  });

  it("cuando un evento realtime invalida la consulta a mitad de una lectura, la vieja aborta su señal y no lanza más lotes; la nueva se lee entera", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(1500); // 2 lotes
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1500), ESPERA);
    const peticionesDeLaPrimeraCarga = doble.peticiones.length;

    // El primer lote del refresco queda retenido. `noAbortarEnVuelo`: el doble no lo aborta por su cuenta,
    // así que solo se comprueba que quien lee deja de pedir lotes.
    const puerta = diferido();
    doble.opciones.noAbortarEnVuelo = true;
    doble.opciones.antesDeResponder = (p) => (p.numero === peticionesDeLaPrimeraCarga + 1 ? puerta.promesa : undefined);
    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => expect(doble.peticiones).toHaveLength(peticionesDeLaPrimeraCarga + 1), ESPERA);
    const lecturaVieja = doble.peticiones[peticionesDeLaPrimeraCarga].signal!;

    // Llega un evento realtime (lo que hace `refrescar`): invalida y cancela la lectura en curso, que arranca otra.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [CLAVE_RESUMEN_ASIGNACION_DIA, "rango"] });
    });

    expect(lecturaVieja.aborted).toBe(true);
    expect(doble.peticiones).toHaveLength(peticionesDeLaPrimeraCarga + 1 + 2); // la lectura nueva: 2 lotes
    const lecturaNueva = doble.peticiones[peticionesDeLaPrimeraCarga + 1].signal!;
    expect(lecturaNueva).not.toBe(lecturaVieja);
    expect(lecturaNueva.aborted).toBe(false);

    // La vieja termina su primer lote y NO pide el segundo.
    puerta.resolver();
    await cederTurno(30);
    expect(doble.peticiones).toHaveLength(peticionesDeLaPrimeraCarga + 1 + 2);
    expect(result.current.data).toHaveLength(1500);
  });

  it("si el panel se desmonta a mitad de una lectura, aborta su señal y no lanza más lotes", async () => {
    doble.tablas.vista_asignacion_dia = tablaDeLaVista(2500);
    const puerta = diferido();
    doble.opciones.noAbortarEnVuelo = true;
    doble.opciones.antesDeResponder = (p) => (p.numero === 1 ? puerta.promesa : undefined);

    const { unmount } = montar();
    await waitFor(() => expect(doble.peticiones).toHaveLength(1), ESPERA);
    const senal = doble.peticiones[0].signal!;
    expect(senal.aborted).toBe(false);

    unmount();
    expect(senal.aborted).toBe(true);
    puerta.resolver();
    await cederTurno(30);

    expect(doble.peticiones).toHaveLength(1); // el primer lote terminó y no se lanzó ninguno más
  });
});
