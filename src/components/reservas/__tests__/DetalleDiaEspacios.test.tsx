/**
 * Tests de `DetalleDiaEspacios` (el panel del día) a través de
 * `CalendarioOcupacion`, que es quien lo monta y quien selecciona el día.
 * Montar el calendario entero es lo que permite ejercitar DE VERDAD lo que
 * pidió el dueño: "que al hacer click un día se vean los espacios bien puestos".
 *
 * Estrategia: se mockea el CLIENTE de Supabase (doble en memoria) y los dos
 * hooks de solo lectura que dan nombres y mesas (`useEspaciosReserva`,
 * `useMesas`). NO se mockea `useResumenAsignacionDia` ni
 * `src/lib/reservas/asignacionMesas.ts`: la lectura de la vista y el recuento
 * de los tres grados corren de verdad, así que estos tests también cubren que
 * el panel lee bien las cifras.
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA FUENTE: `vista_asignacion_dia`
 * ---------------------------------------------------------------------------
 * La vista existe en producción (migración `20260926140000`, aplicada el
 * 2026-09-26) y es LA fuente del panel. El respaldo que hubo hasta entonces
 * -las reservas del mes del calendario- se ha quitado, así que aquí se prueban
 * los tres estados honestos de la consulta: CARGANDO (esqueleto y ni una
 * cifra), ERROR (mensaje + reintentar, sin ceros inventados) y VACÍO DE VERDAD.
 *
 * La tabla `reservas` sigue mockeada porque la CUADRÍCULA del mes la usa para
 * sus casillas (total, comensales, sin sala). Ya no alimenta el panel.
 *
 * Escenario: estado real de producción resumido a cuatro salas.
 *
 *   Comedor   (casa_tomas) · con mesas
 *   Salón     (casa_tomas) · con mesas
 *   Reservado (casa_tomas) · SIN mesas  ← el grado 2 es imposible ahí
 *   Interior  (touza)      · SIN mesas
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { format, startOfMonth } from "date-fns";

// ─── Doble en memoria del cliente de Supabase ────────────────────────────────
//
// Una entrada por tabla/vista. `error` simula un fallo de la consulta y
// `pendiente` la deja en vuelo para siempre, que es la única forma de ver el
// estado de CARGA del panel ahora que no hay respaldo que pintar mientras.
const tablas: Record<string, { data?: unknown[] | null; error?: unknown; pendiente?: boolean }> = {};

// Los filtros se aplican DE VERDAD (`eq`, `neq`, `gte`, `lte`, `in`): si no, el
// doble devolvería las reservas de hoy para cualquier día y no se podría probar
// ni un día vacío ni el cambio de día.
vi.mock("@/integrations/supabase/client", () => {
  type Fila = Record<string, unknown>;
  const encadenable = (tabla: string) => {
    const filtros: Array<(f: Fila) => boolean> = [];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.eq = (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q);
    q.neq = (c: string, v: unknown) => (filtros.push((f) => f[c] !== v), q);
    q.gte = (c: string, v: string) => (filtros.push((f) => String(f[c]) >= v), q);
    q.lte = (c: string, v: string) => (filtros.push((f) => String(f[c]) <= v), q);
    q.in = (c: string, v: unknown[]) => (filtros.push((f) => v.includes(f[c])), q);
    // El cliente real es "thenable": se espera con await sin llamar a nada más.
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const r = tablas[tabla] ?? { data: [], error: null };
      // Nunca se resuelve: la consulta se queda cargando.
      if (r.pendiente) return new Promise<never>(() => {});
      if (r.error) return Promise.resolve({ data: null, error: r.error }).then(ok, ko);
      const filas = ((r.data ?? []) as Fila[]).filter((f) => filtros.every((p) => p(f)));
      return Promise.resolve({ data: filas, error: null }).then(ok, ko);
    };
    return q;
  };
  return { supabase: { from: vi.fn((tabla: string) => encadenable(tabla)) } };
});

vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/useEspaciosReserva");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useMesas } from "@/hooks/useMesas";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { CalendarioOcupacion } from "@/components/reservas/CalendarioOcupacion";

// ─── Fechas ──────────────────────────────────────────────────────────────────
//
// Sin relojes falsos: el componente selecciona HOY al montarse, así que las
// reservas de prueba se colocan en el hoy real. `OTRO_DIA` es otro día del
// MISMO mes (para que caiga dentro de los datos cargados) y sin reservas.
const HOY = new Date();
const HOY_ISO = format(HOY, "yyyy-MM-dd");
const OTRO_DIA =
  HOY.getDate() === 1 ? new Date(HOY.getFullYear(), HOY.getMonth(), 2) : startOfMonth(HOY);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ESPACIOS = [
  { id: "e-comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, descripcion: null, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-salon", nombre: "Salón", capacidad_maxima: 50, activa: true, descripcion: null, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-reservado", nombre: "Reservado", capacidad_maxima: 20, activa: true, descripcion: null, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-interior-tz", nombre: "Interior", capacidad_maxima: 30, activa: true, descripcion: null, caracteristicas: { marca: "touza" } },
];

// Solo Comedor y Salón tienen mesas: Reservado e Interior no tienen ninguna.
const MESAS = [
  { id: "m-c1", espacio_id: "e-comedor", nombre: "Comedor 1", capacidad: 2, activa: true },
  { id: "m-c2", espacio_id: "e-comedor", nombre: "Comedor 2", capacidad: 4, activa: true },
  { id: "m-s1", espacio_id: "e-salon", nombre: "Salón 1", capacidad: 6, activa: true },
];

/**
 * Las cinco reservas de HOY tal y como salen de la tabla `reservas`. Esto es lo
 * que consulta la CUADRÍCULA del mes; el panel del día lee la vista.
 *
 *   Ana    13:00 · 2 pax · Comedor    · 1 mesa  → con_mesa  (comida)
 *   Bruno  14:00 · 4 pax · Comedor    · 0 mesas → sin_mesa  (comida)
 *   Elena  13:30 · 20 pax · Reservado · 0 mesas → sin_mesa  (comida, sala sin mesas)
 *   Carla  21:00 · 6 pax · Salón      · 1 mesa  → con_mesa  (cena)
 *   Diego  21:30 · 3 pax · SIN SALA            → sin_sala  (cena)
 */
const RESERVAS_TABLA = [
  { id: "r-ana", fecha: HOY_ISO, hora: "13:00:00", numero_comensales: 2, estado: "confirmada", nombre: "Ana", marca: "casa_tomas", espacio_id: "e-comedor" },
  { id: "r-elena", fecha: HOY_ISO, hora: "13:30:00", numero_comensales: 20, estado: "confirmada", nombre: "Elena", marca: "casa_tomas", espacio_id: "e-reservado" },
  { id: "r-bruno", fecha: HOY_ISO, hora: "14:00:00", numero_comensales: 4, estado: "verificada", nombre: "Bruno", marca: "casa_tomas", espacio_id: "e-comedor" },
  { id: "r-carla", fecha: HOY_ISO, hora: "21:00:00", numero_comensales: 6, estado: "confirmada", nombre: "Carla", marca: "casa_tomas", espacio_id: "e-salon" },
  { id: "r-diego", fecha: HOY_ISO, hora: "21:30:00", numero_comensales: 3, estado: "pendiente", nombre: "Diego", marca: "casa_tomas", espacio_id: null },
];

/**
 * Las mismas cinco, como las devuelve `vista_asignacion_dia`: con el turno ya
 * partido en SQL por el corte de las 17:00 y el grado ya calculado.
 */
const filaVista = (
  reserva_id: string,
  hora: string,
  nombre: string,
  numero_comensales: number,
  espacio_id: string | null,
  espacio_nombre: string | null,
  mesas_asignadas: number,
  grado: string,
) => ({
  reserva_id,
  fecha: HOY_ISO,
  hora,
  turno: hora < "17:00:00" ? "comida" : "cena",
  nombre,
  numero_comensales,
  estado: "confirmada",
  marca: "casa_tomas",
  espacio_id,
  espacio_nombre,
  mesas_asignadas,
  plazas_asignadas: mesas_asignadas * 4,
  mesas_nombres: mesas_asignadas > 0 ? ["Mesa"] : [],
  grado,
});

const VISTA_HOY = [
  filaVista("r-ana", "13:00:00", "Ana", 2, "e-comedor", "Comedor", 1, "con_mesa"),
  filaVista("r-elena", "13:30:00", "Elena", 20, "e-reservado", "Reservado", 0, "sin_mesa"),
  filaVista("r-bruno", "14:00:00", "Bruno", 4, "e-comedor", "Comedor", 0, "sin_mesa"),
  filaVista("r-carla", "21:00:00", "Carla", 6, "e-salon", "Salón", 1, "con_mesa"),
  filaVista("r-diego", "21:30:00", "Diego", 3, null, null, 0, "sin_sala"),
];

/** Un fallo cualquiera de la consulta (aquí, un timeout de Postgres). */
const ERROR_VISTA = { code: "57014", message: "canceling statement due to statement timeout" };

// ─── Montaje ─────────────────────────────────────────────────────────────────

/** Sonda: deja la query string de la URL en el DOM para poder afirmar sobre ella. */
function SondaUrl() {
  const { search } = useLocation();
  return <output data-testid="url">{search}</output>;
}

function montar() {
  const onEspacioClick = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    // Se entra con `tab` ya puesto para comprobar que escribir `fecha` no se
    // lleva por delante los parámetros que ya había.
    <MemoryRouter initialEntries={["/reservas?tab=calendario"]}>
      <QueryClientProvider client={qc}>
        <CalendarioOcupacion onEspacioClick={onEspacioClick} />
        <SondaUrl />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, onEspacioClick };
}

/** La tarjeta de una sala, localizada por la acción que ofrece. */
function tarjetaSala(nombre: string) {
  return screen.getByRole("button", { name: `Abrir el plano de ${nombre}` });
}

/** La casilla de un día de la cuadrícula. */
function casillaDia(dia: number) {
  return screen.getByRole("button", { name: new RegExp(`^${dia} de \\p{L}+:`, "u") });
}

const url = () => screen.getByTestId("url").textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tablas)) delete tablas[k];
  tablas.reservas = { data: RESERVAS_TABLA };
  tablas.vista_asignacion_dia = { data: VISTA_HOY };
  vi.mocked(useEspaciosReserva).mockReturnValue({ data: ESPACIOS, isLoading: false } as never);
  vi.mocked(useMesas).mockReturnValue({ data: MESAS, isLoading: false } as never);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DetalleDiaEspacios (panel del día del calendario)", () => {
  // ── El día de hoy sale ya seleccionado ─────────────────────────────────────

  it("al abrir, HOY ya está seleccionado y se ve el reparto sin pulsar nada", async () => {
    montar();
    // Las salas del día se pintan solas, sin pulsar ninguna casilla. Se espera
    // a la tarjeta y no a la cabecera: la cabecera lleva la fecha desde el
    // primer render (aún cargando), así que esperarla no probaría nada.
    expect(
      await screen.findByRole("button", { name: "Abrir el plano de Comedor" }),
    ).toBeInTheDocument();
    expect(tarjetaSala("Salón")).toBeInTheDocument();
    // Y la cabecera del panel lleva escrito el día que se está mirando.
    expect(screen.getByText(new RegExp(`${HOY.getDate()} de `, "i"))).toBeInTheDocument();
  });

  it("marca la casilla de hoy como seleccionada en la cuadrícula", async () => {
    montar();
    await waitFor(() => expect(casillaDia(HOY.getDate())).toHaveAttribute("aria-pressed", "true"));
  });

  // ── Reparto por salas: lo que tiene y lo que le falta ──────────────────────

  it("agrupa el día por salas con sus reservas y sus comensales", async () => {
    montar();
    const comedor = await screen.findByRole("button", { name: "Abrir el plano de Comedor" });
    // Ana (2) + Bruno (4)
    expect(comedor).toHaveTextContent(/2 reservas/);
    expect(comedor).toHaveTextContent(/6 comensales/);

    // Carla, sola en el Salón
    expect(tarjetaSala("Salón")).toHaveTextContent(/1 reserva\b/);
    expect(tarjetaSala("Salón")).toHaveTextContent(/6 comensales/);
  });

  it("ordena las salas por nombre y deja fuera las que no tienen reservas", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });
    const nombres = screen
      .getAllByRole("button", { name: /^Abrir el plano de / })
      .map((b) => b.getAttribute("aria-label"));
    expect(nombres).toEqual([
      "Abrir el plano de Comedor",
      "Abrir el plano de Reservado",
      "Abrir el plano de Salón",
    ]);
    // "Interior" (Touza) no tiene reservas ese día: no aparece.
    expect(screen.queryByRole("button", { name: /Interior/ })).not.toBeInTheDocument();
  });

  it("cuenta los tres grados y los etiqueta sin tratar sin_mesa como fallo", async () => {
    montar();
    const comedor = await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    // Comedor: Ana con mesa, Bruno pendiente.
    expect(comedor).toHaveTextContent(/1 con mesa/);
    expect(comedor).toHaveTextContent(/1 pendiente de mesa/);
    expect(comedor).toHaveTextContent(/50%/);
    // "pendiente", nunca "falta" / "error" / "sin asignar".
    expect(comedor).not.toHaveTextContent(/falta|error|incompleta/i);

    // Salón: su única reserva ya tiene mesa → cerrada.
    expect(tarjetaSala("Salón")).toHaveTextContent(/Cerrada/);

    // Y el resumen del día: 2 de 5 con mesa.
    expect(screen.getByText(/2 de 5 con mesa/)).toBeInTheDocument();
  });

  // ── Grado 2: con sala y sin mesa ──────────────────────────────────────────

  it("una sala entera pendiente de mesa se cuenta como trabajo, no como fallo", async () => {
    // Ana y Bruno en el Comedor, los dos todavía sin mesa concreta.
    tablas.vista_asignacion_dia = {
      data: [
        filaVista("r-ana", "13:00:00", "Ana", 2, "e-comedor", "Comedor", 0, "sin_mesa"),
        filaVista("r-bruno", "14:00:00", "Bruno", 4, "e-comedor", "Comedor", 0, "sin_mesa"),
      ],
    };
    montar();
    const comedor = await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    // El dato es real y se escribe tal cual: dos pendientes y 0% cerrado. Ese
    // 0% ya NO es "no se sabe", es "todavía no se ha bajado al plano".
    expect(comedor).toHaveTextContent(/2 pendientes de mesa/);
    expect(comedor).toHaveTextContent(/0%/);
    expect(comedor).not.toHaveTextContent(/con mesa/);
    // Ni lenguaje de error ni el viejo "no está disponible" del respaldo.
    expect(comedor).not.toHaveTextContent(/falta|error|incompleta|no está disponible|no disponible/i);
    // Ni tono de alarma: el ámbar y el rojo se reservan para otras cosas.
    expect(comedor.className).not.toMatch(/amber|destructive|red-/);
    expect(comedor.querySelector('[class*="amber"], [class*="destructive"], [class*="red-"]')).toBeNull();

    // Y el resumen del día lo dice sin esconderlo.
    expect(screen.getByText(/0 de 2 con mesa/)).toBeInTheDocument();
  });

  it("saca las reservas sin sala a un bloque aparte y bien visible", async () => {
    montar();
    expect(await screen.findByText("Sin sala")).toBeInTheDocument();
    const bloque = screen.getByText("Sin sala").closest("div.rounded-lg") as HTMLElement;
    expect(bloque).toHaveTextContent(/1 reserva\b/); // Diego
    expect(bloque).toHaveTextContent(/3 comensales/);
    expect(bloque).toHaveTextContent(/Todavía no se han repartido por sala/i);
    // No es una sala: no ofrece salto al plano.
    expect(bloque.querySelector("button")).toBeNull();
  });

  it("el resumen del día suma reservas y comensales de los tres grados", async () => {
    montar();
    // 5 reservas y 2+20+4+6+3 = 35 comensales
    expect(await screen.findByText("5 reservas")).toBeInTheDocument();
    expect(screen.getByText("35 comensales")).toBeInTheDocument();
  });

  // ── Salas sin mesas en el plano ───────────────────────────────────────────

  it("dice que una sala no tiene mesas en el plano en vez de pintarle 0%", async () => {
    montar();
    const reservado = await screen.findByRole("button", { name: "Abrir el plano de Reservado" });
    expect(reservado).toHaveTextContent(/no tiene mesas en el plano/i);
    // Ni porcentaje de cierre ni recuento de mesas: ahí el grado 2 es imposible.
    expect(reservado).not.toHaveTextContent(/%/);
    expect(reservado).not.toHaveTextContent(/pendiente de mesa/i);
    // Pero sigue enseñando lo que tiene y se puede entrar a crear las mesas.
    expect(reservado).toHaveTextContent(/1 reserva\b/);
    expect(reservado).toHaveTextContent(/20 comensales/);
  });

  // ── Filtro de turno ──────────────────────────────────────────────────────

  it("filtra por turno de cena y deja fuera las salas de comida", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));

    // Cena: Carla (Salón) y Diego (sin sala).
    expect(tarjetaSala("Salón")).toBeInTheDocument();
    expect(screen.getByText("Sin sala")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir el plano de Comedor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir el plano de Reservado/ })).not.toBeInTheDocument();
    // Cena: Carla en el Salón + Diego sin sala = 2 reservas, 9 comensales.
    expect(screen.getByText("2 reservas")).toBeInTheDocument();
    expect(screen.getByText("9 comensales")).toBeInTheDocument();
  });

  it("filtra por turno de comida y deja fuera las salas de cena", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    fireEvent.click(screen.getByRole("radio", { name: "Comida" }));

    // Comida: Ana y Bruno (Comedor) + Elena (Reservado). Nada sin sala.
    expect(tarjetaSala("Comedor")).toHaveTextContent(/2 reservas/);
    expect(tarjetaSala("Reservado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir el plano de Salón/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Sin sala")).not.toBeInTheDocument();
    // 3 reservas y 2+4+20 = 26 comensales
    expect(screen.getByText("3 reservas")).toBeInTheDocument();
    expect(screen.getByText("26 comensales")).toBeInTheDocument();
  });

  it("vuelve al día entero al pulsar el turno ya activo", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));
    expect(screen.queryByRole("button", { name: /Abrir el plano de Comedor/ })).not.toBeInTheDocument();

    // Radix manda "" al deseleccionar: el filtro debe volver a "Todo el día".
    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));
    expect(tarjetaSala("Comedor")).toBeInTheDocument();
    expect(screen.getByText("5 reservas")).toBeInTheDocument();
  });

  // ── Día vacío ────────────────────────────────────────────────────────────

  it("un día sin reservas lo dice y no inventa salas", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    fireEvent.click(casillaDia(OTRO_DIA.getDate()));

    expect(await screen.findByText("No hay reservas para este día")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Abrir el plano de / })).not.toBeInTheDocument();
    expect(screen.queryByText("Sin sala")).not.toBeInTheDocument();
  });

  it("distingue un día vacío de un turno vacío", async () => {
    // Solo una reserva de cena hoy.
    tablas.reservas = { data: [RESERVAS_TABLA[3]] };
    tablas.vista_asignacion_dia = { data: [VISTA_HOY[3]] };
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Salón" });

    fireEvent.click(screen.getByRole("radio", { name: "Comida" }));

    expect(screen.getByText(/No hay reservas en el turno de comida/i)).toBeInTheDocument();
  });

  // ── Salto al plano ───────────────────────────────────────────────────────

  it("al pulsar una sala avisa al padre y deja la fecha en la URL", async () => {
    const { onEspacioClick } = montar();
    const comedor = await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    fireEvent.click(comedor);

    expect(onEspacioClick).toHaveBeenCalledTimes(1);
    expect(onEspacioClick).toHaveBeenCalledWith("e-comedor");
    // `fecha`, NO `date`: `date` ya lo usa el deep link de la lista.
    expect(url()).toContain(`fecha=${HOY_ISO}`);
    expect(url()).not.toContain("date=");
    // Y no se ha cargado por delante lo que ya había en la URL.
    expect(url()).toContain("tab=calendario");
  });

  it("escribe la fecha del día que está seleccionado, no la de hoy", async () => {
    // El otro día sí tiene una reserva, para que haya sala que pulsar. Va en
    // las DOS fuentes: la tabla la pinta en la cuadrícula, la vista en el panel.
    const otroISO = format(OTRO_DIA, "yyyy-MM-dd");
    tablas.reservas = {
      data: [...RESERVAS_TABLA, { ...RESERVAS_TABLA[0], id: "r-otro", fecha: otroISO }],
    };
    tablas.vista_asignacion_dia = {
      data: [...VISTA_HOY, { ...VISTA_HOY[0], reserva_id: "r-otro", fecha: otroISO }],
    };
    const { onEspacioClick } = montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    fireEvent.click(casillaDia(OTRO_DIA.getDate()));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir el plano de Comedor" }));

    expect(onEspacioClick).toHaveBeenCalledWith("e-comedor");
    expect(url()).toContain(`fecha=${otroISO}`);
  });

  it("lleva también el turno a la URL cuando hay uno filtrado", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });

    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));
    fireEvent.click(tarjetaSala("Salón"));

    expect(url()).toContain("turno=cena");
    expect(url()).toContain(`fecha=${HOY_ISO}`);
  });

  it("sin turno filtrado no deja `turno` en la URL", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir el plano de Comedor" }));
    expect(url()).not.toContain("turno=");
  });

  it("se puede entrar en una sala sin mesas: es donde se crean", async () => {
    const { onEspacioClick } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir el plano de Reservado" }));
    expect(onEspacioClick).toHaveBeenCalledWith("e-reservado");
  });

  // ── Los tres estados de la consulta ──────────────────────────────────────

  it("mientras la vista viaja enseña un esqueleto y ni una cifra", async () => {
    tablas.vista_asignacion_dia = { pendiente: true };
    montar();

    expect(
      await screen.findByRole("status", { name: /Cargando el reparto del día/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Leyendo el reparto del día/i)).toBeInTheDocument();

    // Ni salas, ni "no hay reservas" (que sería mentira), ni ceros, ni una
    // barra a 0% que dentro de un instante salte a otra cifra.
    expect(screen.queryByRole("button", { name: /^Abrir el plano de / })).not.toBeInTheDocument();
    expect(screen.queryByText("No hay reservas para este día")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 reservas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 comensales/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/\d\s?%/);
  });

  it("si la vista falla lo dice, no inventa ceros y ofrece reintentar", async () => {
    tablas.vista_asignacion_dia = { data: null, error: ERROR_VISTA };
    montar();

    expect(
      await screen.findByText(/No se ha podido leer el reparto de este día/i),
    ).toBeInTheDocument();
    // El detalle del error va escrito: sin él no hay forma de reportar el fallo.
    expect(screen.getByText(/statement timeout/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();

    // Nada de pintar el día a medias: ni salas, ni bloque "sin sala", ni el
    // "no hay reservas" que haría creer que el día está vacío.
    expect(screen.queryByRole("button", { name: /^Abrir el plano de / })).not.toBeInTheDocument();
    expect(screen.queryByText("Sin sala")).not.toBeInTheDocument();
    expect(screen.queryByText("No hay reservas para este día")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 reservas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/con mesa/)).not.toBeInTheDocument();
  });

  it("al reintentar vuelve a preguntar y pinta el reparto de verdad", async () => {
    tablas.vista_asignacion_dia = { data: null, error: ERROR_VISTA };
    montar();
    const boton = await screen.findByRole("button", { name: /Reintentar/ });

    // La vista ya responde: el botón tiene que volver a preguntar.
    tablas.vista_asignacion_dia = { data: VISTA_HOY };
    fireEvent.click(boton);

    expect(
      await screen.findByRole("button", { name: "Abrir el plano de Comedor" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No se ha podido leer el reparto/i)).not.toBeInTheDocument();
    expect(screen.getByText(/2 de 5 con mesa/)).toBeInTheDocument();
  });

  it("el fallo de la vista no se lleva por delante la cuadrícula del mes", async () => {
    tablas.vista_asignacion_dia = { data: null, error: ERROR_VISTA };
    montar();
    await screen.findByText(/No se ha podido leer el reparto de este día/i);

    // La cuadrícula come de `reservas`, que sigue respondiendo.
    expect(casillaDia(HOY.getDate())).toHaveAttribute(
      "aria-label",
      expect.stringContaining("5 reservas, 35 comensales, 1 sin sala"),
    );
  });
});

// ─── La cuadrícula del mes (el bug del porcentaje) ───────────────────────────

describe("CalendarioOcupacion · cuadrícula del mes", () => {
  it("cuenta reservas, comensales y las que siguen sin sala en cada casilla", async () => {
    montar();
    await waitFor(() =>
      expect(casillaDia(HOY.getDate())).toHaveAttribute(
        "aria-label",
        expect.stringContaining("5 reservas, 35 comensales, 1 sin sala"),
      ),
    );
    expect(casillaDia(HOY.getDate())).toHaveTextContent("1 sin sala");
  });

  it("no queda rastro del porcentaje de aforo que siempre valía 0", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });
    // Antes cada casilla del mes pintaba "0%" y la leyenda hablaba de una
    // ocupación que nunca se calculó.
    expect(casillaDia(HOY.getDate())).not.toHaveTextContent("0%");
    expect(screen.queryByText(/Baja ocupación/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Media \(50-80%\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Alta \(>80%\)/i)).not.toBeInTheDocument();
  });

  it("la leyenda describe el reparto por sala, que es lo que se pinta", async () => {
    montar();
    await screen.findByRole("button", { name: "Abrir el plano de Comedor" });
    expect(screen.getByText("Todas las reservas tienen sala")).toBeInTheDocument();
    expect(screen.getByText("Quedan reservas por repartir por sala")).toBeInTheDocument();
    expect(screen.getByText("Sin reservas")).toBeInTheDocument();
  });

  it("un día en el que todo está repartido no aparece marcado como pendiente", async () => {
    // Las mismas reservas, pero Diego ya tiene sala.
    tablas.reservas = {
      data: RESERVAS_TABLA.map((r) => (r.id === "r-diego" ? { ...r, espacio_id: "e-salon" } : r)),
    };
    montar();
    await waitFor(() =>
      expect(casillaDia(HOY.getDate())).toHaveAttribute(
        "aria-label",
        expect.stringContaining("todas con sala"),
      ),
    );
    expect(casillaDia(HOY.getDate())).not.toHaveTextContent("sin sala");
  });
});
