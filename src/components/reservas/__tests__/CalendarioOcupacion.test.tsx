/**
 * Tests de la CUADRÍCULA del mes de `CalendarioOcupacion` (pestaña Calendario de
 * /reservas): lo que enseña cada casilla y de qué color.
 *
 * Encargo del dueño (2026-10-01):
 *   1. Los COMENSALES en grande en cada casilla; el nº de reservas, pequeño.
 *   2. El color es el % de ocupación (comensales / aforo), no «sin sala».
 *   3. «Sin sala» como indicador discreto, solo dentro de la ventana de asignación.
 *
 * Se monta el calendario ENTERO (sin panel del día desde el 2026-10-15) contra un doble en memoria
 * del cliente de Supabase que respeta filtros, `range` y el recuento, y que puede
 * imitar el tope de filas de PostgREST. La lógica fina (umbrales, estados, aforo,
 * ventana) está en `ocupacionCalendario.test.ts`; aquí se prueba que la pantalla
 * la usa y lo que se ve.
 *
 * SOLO CASA TOMÁS (decisión del dueño, 2026-10-01): Touza ya no admite reservas.
 * La cuadrícula mide la ocupación contra el aforo de Casa Tomás, sin selector ni
 * mezcla de negocios, e IGNORA cualquier reserva antigua de `marca = 'touza'`. Los
 * espacios de Touza siguen en el escenario a propósito, para comprobar que no
 * suman aforo ni se enseñan.
 *
 * El reloj se congela con `Date` falso (solo `Date`: los temporizadores van de
 * verdad) en miércoles 14/10/2026 10:30 de Madrid, así los días «pasados», «hoy»
 * y la ventana de 48 h no dependen de cuándo se pase el test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// ─── Doble en memoria del cliente de Supabase ────────────────────────────────
//
// `maxFilas` imita el tope de PostgREST por petición (1000 por defecto en
// Supabase; aquí se puede bajar para probar que el calendario no se fía de él).
type Tabla = { data?: unknown[] | null; error?: unknown; pendiente?: boolean; maxFilas?: number };
const tablas: Record<string, Tabla> = {};

vi.mock("@/integrations/supabase/client", () => {
  type Fila = Record<string, unknown>;
  const encadenable = (tabla: string) => {
    const filtros: Array<(f: Fila) => boolean> = [];
    let rango: [number, number] | null = null;
    let contar = false;
    let una = false;
    const q: Record<string, unknown> = {};
    q.select = (_columnas?: string, opciones?: { count?: string }) => ((contar = !!opciones?.count), q);
    q.order = () => q;
    q.limit = () => q;
    q.range = (desde: number, hasta: number) => ((rango = [desde, hasta]), q);
    q.single = () => ((una = true), q);
    q.maybeSingle = () => ((una = true), q);
    q.eq = (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q);
    q.neq = (c: string, v: unknown) => (filtros.push((f) => f[c] !== v), q);
    q.gte = (c: string, v: string) => (filtros.push((f) => String(f[c]) >= v), q);
    q.lte = (c: string, v: string) => (filtros.push((f) => String(f[c]) <= v), q);
    q.in = (c: string, v: unknown[]) => (filtros.push((f) => v.includes(f[c])), q);
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const r = tablas[tabla] ?? { data: [], error: null };
      if (r.pendiente) return new Promise<never>(() => {});
      if (r.error) return Promise.resolve({ data: null, error: r.error }).then(ok, ko);
      const todas = ((r.data ?? []) as Fila[]).filter((f) => filtros.every((p) => p(f)));
      let filas = rango ? todas.slice(rango[0], rango[1] + 1) : todas;
      if (r.maxFilas) filas = filas.slice(0, r.maxFilas);
      if (una) {
        const res = filas[0]
          ? { data: filas[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows" } };
        return Promise.resolve(res).then(ok, ko);
      }
      return Promise.resolve({ data: filas, count: contar ? todas.length : null, error: null }).then(ok, ko);
    };
    return q;
  };
  return { supabase: { from: vi.fn((tabla: string) => encadenable(tabla)) } };
});

vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/useEspaciosReserva");
// Permiso de edición de «reservas» (el pop-up de cierre lo mira). Por defecto, con permiso.
const permisos = vi.hoisted(() => ({ editar: true }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (seccion: string, tipo: string = "view") => ({
    canAccess: seccion === "reservas" && (tipo === "view" || permisos.editar),
    loading: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// La suscripción realtime tiene sus tests (useReservasEnVivo.test.tsx); aquí solo se mira que el
// calendario la monte.
vi.mock("@/hooks/useReservasEnVivo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReservasEnVivo")>()),
  useReservasEnVivo: vi.fn(),
}));

import { supabase } from "@/integrations/supabase/client";
import { useMesas } from "@/hooks/useMesas";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { CalendarioOcupacion } from "@/components/reservas/CalendarioOcupacion";
import { NIVELES_ESCALA, UMBRALES_OCUPACION, estiloNivel, rangoNivel } from "@/lib/reservas/ocupacionCalendario";

// ─── Escenario ───────────────────────────────────────────────────────────────

/** Miércoles 14/10/2026 10:30 en Madrid (CEST). La ventana de 48 h llega al viernes 16 a las 10:30. */
const AHORA = new Date("2026-10-14T10:30:00+02:00");

/**
 * Aforo de estos escenarios: Casa Tomás 50+50+20+50 = 170 por turno (+ una sala INACTIVA que no cuenta).
 * Aquí el «Reservado» es una sala NORMAL de 20 plazas; en producción es privado y está FUERA de aforo
 * (150 por turno): eso se prueba en el último bloque de este fichero.
 * Los espacios de Touza (20+30+30) están ahí a propósito: no deben sumar ni enseñarse.
 */
const ESPACIOS = [
  { id: "e-comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-salon", nombre: "Salón", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-reservado", nombre: "Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-terraza", nombre: "Terraza", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-antigua", nombre: "Sala antigua", capacidad_maxima: 40, activa: false, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-t-reservado", nombre: "El Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "touza" } },
  { id: "e-t-interior", nombre: "Interior", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
  { id: "e-t-terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
];

let secuencia = 0;
type Fila = Record<string, unknown>;

/** Una reserva viva de Casa Tomás con sala; `extra` pisa cualquier campo. */
function reserva(fecha: string, hora: string, comensales: number, extra: Fila = {}): Fila {
  secuencia++;
  return {
    id: `r-${secuencia}`,
    fecha,
    hora,
    numero_comensales: comensales,
    estado: "confirmada",
    nombre: "Cliente",
    marca: "casa_tomas",
    espacio_id: "e-comedor",
    ...extra,
  };
}

/** Reparte `total` comensales en reservas de hasta 10 en un mismo turno. */
function carga(fecha: string, total: number, hora = "21:00:00", extra: Fila = {}): Fila[] {
  const filas: Fila[] = [];
  let resto = total;
  while (resto > 0) {
    const n = Math.min(10, resto);
    filas.push(reserva(fecha, hora, n, extra));
    resto -= n;
  }
  return filas;
}

const dia = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

// ─── Montaje ─────────────────────────────────────────────────────────────────

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const vista = render(
    <MemoryRouter initialEntries={["/reservas?tab=calendario"]}>
      <QueryClientProvider client={qc}>
        <CalendarioOcupacion />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return Object.assign(vista, { qc });
}

/** La casilla de un día de octubre. */
const casilla = (n: number) => screen.getByRole("button", { name: new RegExp(`^${n} de octubre:`) });

/** Espera a que el mes esté pintado (hay casillas). */
const mesPintado = () => screen.findByRole("button", { name: /^1 de octubre:/ });

const comensales = (n: number) => within(casilla(n)).getByTestId("comensales-casilla");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  secuencia = 0;
  for (const k of Object.keys(tablas)) delete tablas[k];
  tablas.reservas = { data: [] };
  tablas.vista_asignacion_dia = { data: [] };
  vi.mocked(useEspaciosReserva).mockReturnValue({ data: ESPACIOS, isLoading: false, isError: false } as never);
  vi.mocked(useMesas).mockReturnValue({ data: [], isLoading: false } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. Los comensales, en grande ────────────────────────────────────────────

describe("CalendarioOcupacion · la cifra grande son los comensales", () => {
  beforeEach(() => {
    tablas.reservas = {
      data: [reserva(dia(20), "13:00:00", 4), reserva(dia(20), "13:30:00", 6), reserva(dia(20), "21:00:00", 10)],
    };
  });

  it("cada casilla con reservas enseña los COMENSALES del día como cifra protagonista", async () => {
    montar();
    await mesPintado();
    const grande = comensales(20);
    expect(grande).toHaveTextContent("20"); // 4 + 6 + 10
    // Es el elemento más grande de la casilla: letra gorda y con tamaño propio (cqw).
    expect(grande.className).toMatch(/font-bold/);
    expect(grande.className).toMatch(/font-size:clamp/);
  });

  it("el nº de reservas pasa a secundario: pequeño y aparte", async () => {
    montar();
    await mesPintado();
    const pequeno = within(casilla(20)).getByTestId("reservas-casilla");
    expect(pequeno).toHaveTextContent("3 res.");
    expect(pequeno.className).toMatch(/\btext-sm\b/);
    // Y no compite con la cifra grande: son elementos distintos.
    expect(pequeno).not.toBe(comensales(20));
  });

  it("la cifra grande no usa cifras de ancho fijo (en un número grande suelto abren el hueco)", async () => {
    montar();
    await mesPintado();
    expect(comensales(20).className).not.toMatch(/tabular-nums/);
  });

  it("la cifra y el % son decoración para el lector de pantalla: lo dice el aria-label, entero", async () => {
    montar();
    await mesPintado();
    expect(comensales(20)).toHaveAttribute("aria-hidden", "true");
    expect(casilla(20)).toHaveAttribute("aria-label", expect.stringMatching(/^20 de octubre: 20 comensales en 3 reservas/));
  });

  it("los días sin reservas no pintan cifra ni barras", async () => {
    montar();
    await mesPintado();
    const vacia = casilla(26);
    expect(within(vacia).queryByTestId("comensales-casilla")).not.toBeInTheDocument();
    expect(within(vacia).queryByTestId("barras-casilla")).not.toBeInTheDocument();
    expect(within(vacia).queryByTestId("porcentaje-casilla")).not.toBeInTheDocument();
    expect(vacia).toHaveAttribute("aria-label", "26 de octubre: sin reservas");
    expect(vacia).toHaveAttribute("data-nivel", "vacio");
  });
});

// ─── 2. El color: % de ocupación ─────────────────────────────────────────────

describe("CalendarioOcupacion · el color es el % de ocupación", () => {
  // Casa Tomás: 170 por turno. Cargas del 20 % al 100 % (y un día vacío).
  beforeEach(() => {
    tablas.reservas = {
      data: [
        ...carga(dia(20), 34), //   20 %
        ...carga(dia(21), 85), //   50 %
        ...carga(dia(22), 128), //  75 %
        ...carga(dia(23), 153), //  90 %
        ...carga(dia(24), 170), // 100 %
      ],
    };
  });

  it.each<[number, string, string]>([
    [20, "bajo", "20%"],
    [21, "medio", "50%"],
    [22, "alto", "75%"],
    [23, "casi_lleno", "90%"],
    [24, "completo", "Completo"],
  ])("el día %i cae en el nivel «%s» y escribe «%s»", async (n, nivel, texto) => {
    montar();
    await mesPintado();
    expect(casilla(n)).toHaveAttribute("data-nivel", nivel);
    expect(within(casilla(n)).getByTestId("porcentaje-casilla")).toHaveTextContent(texto);
  });

  it("cada nivel lleva SU fondo: las cinco casillas tienen clases distintas", async () => {
    montar();
    await mesPintado();
    const clases = [20, 21, 22, 23, 24].map((n) => casilla(n).className);
    // Se compara la parte de color (bg-… y text-…), que es lo que cambia entre niveles.
    const color = (c: string) => c.split(/\s+/).filter((t) => /^(bg-\[|text-(white|slate))/.test(t)).join(" ");
    expect(new Set(clases.map(color)).size).toBe(5);
    // Y salen de la tabla de estilos de la lógica pura (un único sitio).
    expect(casilla(24).className).toContain(estiloNivel("completo").celda);
    expect(casilla(20).className).toContain(estiloNivel("bajo").celda);
  });

  it("no solo color: cada casilla con reservas lleva barras y su % escrito, y el nivel está en el aria-label", async () => {
    montar();
    await mesPintado();
    for (const n of [20, 21, 22, 23, 24]) {
      expect(within(casilla(n)).getByTestId("barras-casilla")).toBeInTheDocument();
      expect(within(casilla(n)).getByTestId("porcentaje-casilla")).toBeInTheDocument();
    }
    expect(casilla(22)).toHaveAttribute("aria-label", expect.stringContaining("ocupación 75% (concurrido) en la cena"));
    expect(casilla(23)).toHaveAttribute("aria-label", expect.stringContaining("ocupación 90% (casi lleno)"));
  });

  it("un servicio completo se dice con palabras: «Completo», no «100%»", async () => {
    montar();
    await mesPintado();
    const texto = within(casilla(24)).getByTestId("porcentaje-casilla");
    expect(texto).toHaveTextContent("Completo");
    expect(texto).not.toHaveTextContent("100%");
    expect(casilla(24)).toHaveAttribute("aria-label", expect.stringContaining("completo"));
  });

  it("el rojo y el ámbar no se usan para la ocupación: el ámbar es solo el punto de «sin sala»", async () => {
    montar();
    await mesPintado();
    for (const n of [20, 21, 22, 23, 24]) {
      expect(casilla(n).className).not.toMatch(/amber|red-|destructive|orange|green/);
    }
  });

  it("el color lo decide el servicio MÁS LLENO del día, no una media (comida 20 %, cena 90 %)", async () => {
    tablas.reservas = { data: [...carga(dia(20), 34, "13:00:00"), ...carga(dia(20), 153, "21:00:00")] };
    montar();
    await mesPintado();
    expect(casilla(20)).toHaveAttribute("data-nivel", "casi_lleno");
    expect(within(casilla(20)).getByTestId("porcentaje-casilla")).toHaveTextContent("90%");
  });

  it("las dos barras (comida y cena) enseñan cada turno con su largo", async () => {
    tablas.reservas = { data: [...carga(dia(20), 34, "13:00:00"), ...carga(dia(20), 153, "21:00:00")] };
    montar();
    await mesPintado();
    const barras = within(casilla(20)).getByTestId("barras-casilla");
    const rellenos = Array.from(barras.querySelectorAll<HTMLElement>("span[style]"));
    expect(rellenos.map((r) => r.style.width)).toEqual(["20%", "90%"]);
  });

  it("el aforo es el de Casa Tomás: 170 por turno, sin las salas de Touza (80) ni la sala inactiva (40)", async () => {
    // 85/170 = 50 %. Si se sumaran los espacios de Touza serían 85/250 = 34 %; con la
    // inactiva, 85/290 = 29 %.
    tablas.reservas = { data: carga(dia(20), 85) };
    montar();
    await mesPintado();
    expect(casilla(20)).toHaveAttribute("data-nivel", "medio");
    expect(within(casilla(20)).getByTestId("porcentaje-casilla")).toHaveTextContent("50%");
  });

  it("una sala desactivada no suma aforo: con ella Casa Tomás tendría 210 y 105 comensales serían 50 %", async () => {
    tablas.reservas = { data: carga(dia(20), 105) };
    montar();
    await mesPintado();
    // 105/170 = 61 % (con la sala inactiva serían 105/210 = 50 %).
    expect(within(casilla(20)).getByTestId("porcentaje-casilla")).toHaveTextContent("61%");
  });

  it("IGNORA las reservas antiguas de Touza: no suman comensales, reservas ni %", async () => {
    tablas.reservas = {
      data: [
        ...carga(dia(20), 85),
        ...carga(dia(20), 40, "21:00:00", { marca: "touza", espacio_id: "e-t-interior" }),
        ...carga(dia(20), 30, "13:00:00", { marca: "touza", espacio_id: "e-t-interior" }),
      ],
    };
    montar();
    await mesPintado();
    expect(comensales(20)).toHaveTextContent("85");
    expect(within(casilla(20)).getByTestId("reservas-casilla")).toHaveTextContent("9 res."); // 85 en 9 reservas (8x10 + 5)
    expect(within(casilla(20)).getByTestId("porcentaje-casilla")).toHaveTextContent("50%");
    expect(casilla(20)).toHaveAttribute("data-nivel", "medio");
  });

  it("un día que solo tiene reservas de Touza se ve como un día vacío", async () => {
    tablas.reservas = { data: carga(dia(20), 40, "21:00:00", { marca: "touza", espacio_id: "e-t-interior" }) };
    montar();
    await mesPintado();
    expect(casilla(20)).toHaveAttribute("data-nivel", "vacio");
    expect(within(casilla(20)).queryByTestId("comensales-casilla")).not.toBeInTheDocument();
  });

  it("una reserva de Touza sin sala no pone el punto de «sin sala»", async () => {
    tablas.reservas = { data: [reserva(dia(15), "21:00:00", 4, { marca: "touza", espacio_id: null })] };
    montar();
    await mesPintado();
    expect(within(casilla(15)).queryByTestId("punto-sin-sala")).not.toBeInTheDocument();
  });

  it("el tooltip desglosa cada turno contra el aforo, sin nombres de negocio ni aforo de Touza", async () => {
    tablas.reservas = {
      data: [
        ...carga(dia(20), 85, "21:00:00"),
        ...carga(dia(20), 40, "13:00:00"),
        ...carga(dia(20), 40, "21:00:00", { marca: "touza", espacio_id: "e-t-interior" }),
      ],
    };
    montar();
    await mesPintado();
    fireEvent.focus(casilla(20));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Comida: 23% (40 de 170)");
    expect(tooltip).toHaveTextContent("Cena: 50% (85 de 170)");
    expect(tooltip).toHaveTextContent("125 comensales en 13 reservas");
    expect(tooltip.textContent ?? "").not.toMatch(/touza|casa tom|\b80\b/i);
  });

  it("en ninguna parte de la cuadrícula se enseña Touza ni su aforo", async () => {
    tablas.reservas = { data: carga(dia(20), 40, "21:00:00", { marca: "touza", espacio_id: "e-t-interior" }) };
    const { container } = montar();
    await mesPintado();
    // El panel del día (con sus salas) no es parte de la cuadrícula: se mira solo la rejilla y la leyenda.
    const rejilla = within(container).getByTestId("tarjeta-mes");
    expect(rejilla.textContent ?? "").not.toMatch(/touza/i);
    const leyenda = screen.getByRole("list", { name: "Escala de ocupación" }).closest("div.rounded-lg") as HTMLElement;
    expect(leyenda.textContent ?? "").not.toMatch(/touza|\b80\b/i);
  });
});

// ─── 3. Qué estados cuentan ──────────────────────────────────────────────────

describe("CalendarioOcupacion · para el aforo cuentan solo las reservas vivas", () => {
  it("canceladas, «Llegó» y «No vino» no suman en un día futuro: solo pendiente, verificada y confirmada", async () => {
    tablas.reservas = {
      data: [
        reserva(dia(21), "21:00:00", 10, { estado: "pendiente" }),
        reserva(dia(21), "21:00:00", 10, { estado: "verificada" }),
        reserva(dia(21), "21:00:00", 10, { estado: "confirmada" }),
        reserva(dia(21), "21:00:00", 99, { estado: "cancelada" }),
        reserva(dia(21), "21:00:00", 99, { estado: "completada" }),
        reserva(dia(21), "21:00:00", 99, { estado: "no_show" }),
      ],
    };
    montar();
    await mesPintado();
    expect(comensales(21)).toHaveTextContent("30");
    expect(within(casilla(21)).getByTestId("reservas-casilla")).toHaveTextContent("3 res.");
  });

  it("hoy cuenta lo mismo que el panel del día (vivas): quien ya llegó sale de la cifra, como en el panel", async () => {
    tablas.reservas = {
      data: [reserva(dia(14), "21:00:00", 20), reserva(dia(14), "13:00:00", 8, { estado: "completada" })],
    };
    montar();
    await mesPintado();
    expect(comensales(14)).toHaveTextContent("20");
  });

  it("un día futuro con solo canceladas se ve vacío", async () => {
    tablas.reservas = { data: [reserva(dia(21), "21:00:00", 10, { estado: "cancelada" })] };
    montar();
    await mesPintado();
    expect(casilla(21)).toHaveAttribute("data-nivel", "vacio");
  });
});

// ─── 4. Días pasados ─────────────────────────────────────────────────────────

describe("CalendarioOcupacion · días pasados", () => {
  beforeEach(() => {
    // Ayer: lo de siempre en producción, casi todo «No vino» y alguna llegada.
    tablas.reservas = {
      data: [
        reserva(dia(10), "13:00:00", 8, { estado: "completada" }),
        reserva(dia(10), "13:30:00", 6, { estado: "no_show" }),
        reserva(dia(10), "21:00:00", 4, { estado: "confirmada" }),
        reserva(dia(10), "21:00:00", 50, { estado: "cancelada" }),
      ],
    };
  });

  it("se enseñan atenuados con lo que se reservó (sin canceladas) y sin escala ni porcentaje", async () => {
    montar();
    await mesPintado();
    const c = casilla(10);
    expect(c).toHaveAttribute("data-nivel", "pasado");
    expect(comensales(10)).toHaveTextContent("18");
    expect(c.className).toContain(estiloNivel("pasado").celda);
    expect(within(c).queryByTestId("barras-casilla")).not.toBeInTheDocument();
    expect(within(c).queryByTestId("porcentaje-casilla")).not.toBeInTheDocument();
    expect(c).toHaveAttribute("aria-label", expect.stringContaining("día pasado, 18 comensales en 3 reservas"));
  });

  it("no llevan punto de «sin sala» aunque falte la sala: ya no hay nada que repartir", async () => {
    tablas.reservas = { data: [reserva(dia(10), "21:00:00", 4, { espacio_id: null })] };
    montar();
    await mesPintado();
    expect(within(casilla(10)).queryByTestId("punto-sin-sala")).not.toBeInTheDocument();
  });

  it("un día pasado sin reservas también va atenuado, no en blanco", async () => {
    montar();
    await mesPintado();
    expect(casilla(5).className).toContain(estiloNivel("pasado").celda);
  });

  it("hoy NO es un día pasado: tiene escala y su número va marcado", async () => {
    tablas.reservas = { data: carga(dia(14), 85) };
    montar();
    await mesPintado();
    expect(casilla(14)).toHaveAttribute("data-nivel", "medio");
    // El número de hoy va en un círculo (clase `rounded-full`) con su propio color.
    const numero = within(casilla(14)).getByText("14");
    expect(numero.className).toMatch(/rounded-full/);
    expect(numero.className).toContain("bg-primary");
    expect(within(casilla(15)).getByText("15").className).not.toMatch(/bg-primary/);
  });
});

// ─── 5. «Sin sala»: punto discreto dentro de la ventana ──────────────────────

describe("CalendarioOcupacion · «sin sala» como punto, solo dentro de la ventana de asignación", () => {
  it("ya no pinta el punto en los días con reservas sin sala (11/11/2026)", async () => {
    tablas.reservas = {
      data: [
        reserva(dia(14), "21:00:00", 4, { espacio_id: null }), // esta noche
        reserva(dia(15), "13:00:00", 4, { espacio_id: null }), // mañana
        reserva(dia(15), "21:00:00", 4), // con sala
      ],
    };
    montar();
    await mesPintado();
    // Sin el punto amarillo (11/11/2026, petición del dueño): sigue dicho en el aria-label y en el tooltip.
    expect(within(casilla(14)).queryByTestId("punto-sin-sala")).not.toBeInTheDocument();
    expect(within(casilla(15)).queryByTestId("punto-sin-sala")).not.toBeInTheDocument();
  });

  it("NO sale más allá de la ventana, que es donde casi todo está sin sala y no hay nada que decir", async () => {
    tablas.reservas = {
      data: [
        ...carga(dia(16), 20, "13:00:00", { espacio_id: null }), // 16/10 13:00: pasadas las 48 h
        ...carga(dia(25), 100, "21:00:00", { espacio_id: null }),
        ...carga(dia(28), 100, "21:00:00", { espacio_id: null }),
      ],
    };
    montar();
    await mesPintado();
    for (const n of [16, 25, 28]) {
      expect(within(casilla(n)).queryByTestId("punto-sin-sala")).not.toBeInTheDocument();
    }
  });

  it("no es un color: un día con todo sin sala sigue pintado por su ocupación, y no en ámbar", async () => {
    tablas.reservas = { data: carga(dia(15), 128, "21:00:00", { espacio_id: null }) };
    montar();
    await mesPintado();
    expect(casilla(15)).toHaveAttribute("data-nivel", "alto");
    expect(casilla(15).className).not.toMatch(/amber/);
  });

  it("el aria-label y el tooltip lo dicen con palabras", async () => {
    tablas.reservas = {
      data: [reserva(dia(15), "21:00:00", 4, { espacio_id: null }), reserva(dia(15), "21:30:00", 4, { espacio_id: null })],
    };
    montar();
    await mesPintado();
    expect(casilla(15)).toHaveAttribute("aria-label", expect.stringContaining("2 reservas sin sala en las próximas 48 h"));
    fireEvent.focus(casilla(15));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("2 reservas sin sala en las próximas 48 h");
  });

  it("respeta la ventana configurada en `configuracion_reservas` (24 h: el 15 por la noche ya queda fuera)", async () => {
    tablas.configuracion_reservas = { data: [{ id: "cfg", asignacion_ventana_horas: 24 }] };
    tablas.reservas = { data: [reserva(dia(15), "21:00:00", 4, { espacio_id: null })] };
    montar();
    await mesPintado();
    await waitFor(() => expect(casilla(15)).toBeInTheDocument());
    expect(casilla(15).getAttribute("aria-label")).not.toMatch(/sin sala/);
  });
});

// ─── 6. Aforo no disponible ──────────────────────────────────────────────────

describe("CalendarioOcupacion · si no se conoce el aforo", () => {
  it("enseña los comensales pero ni barras ni porcentaje inventados", async () => {
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: [], isLoading: false, isError: false } as never);
    tablas.reservas = { data: carga(dia(20), 85) };
    montar();
    await mesPintado();
    expect(comensales(20)).toHaveTextContent("85");
    expect(casilla(20)).toHaveAttribute("data-nivel", "sin_aforo");
    expect(within(casilla(20)).queryByTestId("barras-casilla")).not.toBeInTheDocument();
    expect(within(casilla(20)).queryByTestId("porcentaje-casilla")).not.toBeInTheDocument();
  });

  it("si fallan los espacios, la leyenda lo avisa", async () => {
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: undefined, isLoading: false, isError: true } as never);
    montar();
    expect(await screen.findByText(/No se ha podido leer el aforo de las salas/)).toBeInTheDocument();
  });

  it("mientras llegan los espacios espera (no pinta el mes en gris para que luego salte a color)", async () => {
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: undefined, isLoading: true, isError: false } as never);
    montar();
    expect(await screen.findByLabelText("Cargando el calendario")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^1 de octubre:/ })).not.toBeInTheDocument();
  });
});

// ─── 7. La leyenda ───────────────────────────────────────────────────────────

describe("CalendarioOcupacion · leyenda", () => {
  it("trae los cinco niveles con su rango EN NÚMEROS (el color nunca va solo)", async () => {
    montar();
    await mesPintado();
    const leyenda = within(screen.getByRole("list", { name: "Escala de ocupación" }));
    for (const nivel of NIVELES_ESCALA) {
      expect(leyenda.getByText(estiloNivel(nivel).etiqueta)).toBeInTheDocument();
      expect(leyenda.getByText(rangoNivel(nivel))).toBeInTheDocument();
    }
    expect(leyenda.getByText("Sin reservas")).toBeInTheDocument();
  });

  it("los rangos salen de los umbrales: si se ajustan, la leyenda cambia con ellos", async () => {
    montar();
    await mesPintado();
    const u = UMBRALES_OCUPACION;
    expect(screen.getByText(`menos del ${u.medio}%`)).toBeInTheDocument();
    expect(screen.getByText(`${u.casiLleno}–${u.completo - 1}%`)).toBeInTheDocument();
    expect(screen.getByText(`${u.completo}%`)).toBeInTheDocument();
  });

  it("cada muestra tiene el MISMO color que su casilla (mismo estilo de la lógica pura)", async () => {
    montar();
    await mesPintado();
    for (const nivel of NIVELES_ESCALA) {
      const muestra = document.querySelector(`[data-nivel-muestra="${nivel}"]`) as HTMLElement;
      expect(muestra.className).toContain(estiloNivel(nivel).muestra);
    }
  });

  it("dice contra qué aforo se mide: el de Casa Tomás por turno (170), sin hablar de dos negocios", async () => {
    montar();
    await mesPintado();
    expect(screen.getByText(/sobre el aforo de 170 comensales por turno/)).toBeInTheDocument();
    expect(screen.queryByText(/se miden cada una/i)).not.toBeInTheDocument();
  });

  it("explica el día pasado y cómo leer las cifras (sin el punto de «sin sala» desde el 11/11/2026)", async () => {
    montar();
    await mesPintado();
    expect(screen.queryByText("Reservas sin sala en las próximas 48 h")).not.toBeInTheDocument();
    expect(screen.getByText(/Día pasado: lo que se reservó, sin porcentaje/)).toBeInTheDocument();
    expect(screen.getByText(/Cifra grande: comensales del día/)).toBeInTheDocument();
    expect(screen.getByText(/Cuentan las reservas pendientes, verificadas y confirmadas/)).toBeInTheDocument();
    expect(screen.queryByTestId("muestra-sin-sala")).not.toBeInTheDocument();
  });

  it("ya no habla de «reparto por sala» como si fuera el color del día", async () => {
    montar();
    await mesPintado();
    expect(screen.queryByText("Todas las reservas tienen sala")).not.toBeInTheDocument();
    expect(screen.queryByText("Quedan reservas por repartir por sala")).not.toBeInTheDocument();
  });
});

// ─── 8. Un mes de más de mil reservas ────────────────────────────────────────

describe("CalendarioOcupacion · meses con más de 1000 reservas", () => {
  const filasDelMes = () => {
    // 1.200 reservas de 1 comensal repartidas entre los días 1 y 25 más un último
    // día (el 31) que solo se cuenta si se pide la SEGUNDA página.
    const filas: Fila[] = [];
    for (let i = 0; i < 1100; i++) filas.push(reserva(dia(1 + (i % 25)), "21:00:00", 1));
    for (let i = 0; i < 100; i++) filas.push(reserva(dia(31), "21:00:00", 1));
    return filas;
  };

  it("pide el mes por páginas y no se queda sin contar el final (tope de 1000 filas de PostgREST)", async () => {
    tablas.reservas = { data: filasDelMes(), maxFilas: 1000 };
    montar();
    await mesPintado();
    // El 31 está al final del mes: con una sola petición (1000 filas) no habría salido.
    await waitFor(() => expect(comensales(31)).toHaveTextContent("100"));
    const peticiones = vi.mocked(supabase.from).mock.calls.filter(([t]) => String(t) === "reservas").length;
    expect(peticiones).toBeGreaterThanOrEqual(2);
  });

  it("no se fía del tamaño de la página: si el servidor devuelve menos (tope más bajo), sigue hasta el recuento", async () => {
    tablas.reservas = { data: filasDelMes(), maxFilas: 300 };
    montar();
    await mesPintado();
    await waitFor(() => expect(comensales(31)).toHaveTextContent("100"));
  });

  it("un mes normal se lee en una sola petición", async () => {
    tablas.reservas = { data: carga(dia(20), 34) };
    montar();
    await mesPintado();
    const peticiones = vi.mocked(supabase.from).mock.calls.filter(([t]) => String(t) === "reservas").length;
    expect(peticiones).toBe(1);
  });
});

// ─── 9. Cargando, error y cambio de mes ──────────────────────────────────────

describe("CalendarioOcupacion · estados de la consulta del mes", () => {
  it("mientras viaja enseña el spinner y ninguna cifra", async () => {
    tablas.reservas = { pendiente: true };
    montar();
    expect(await screen.findByLabelText("Cargando el calendario")).toBeInTheDocument();
    expect(screen.queryByTestId("comensales-casilla")).not.toBeInTheDocument();
  });

  it("si la consulta falla lo dice y ofrece reintentar, en vez de pintar un mes vacío que sería mentira", async () => {
    tablas.reservas = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    montar();
    expect(await screen.findByText(/No se han podido leer las reservas de este mes/)).toBeInTheDocument();
    expect(screen.getByText(/statement timeout/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
    // Ni una casilla con «sin reservas» que haría creer que el mes está vacío.
    expect(screen.queryByRole("button", { name: /sin reservas/ })).not.toBeInTheDocument();
    // La navegación del mes sigue disponible.
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeInTheDocument();
  });

  it("al reintentar vuelve a pedir el mes y lo pinta", async () => {
    tablas.reservas = { data: null, error: { message: "fallo de red" } };
    montar();
    const boton = await screen.findByRole("button", { name: /Reintentar/ });
    tablas.reservas = { data: carga(dia(20), 85) };
    fireEvent.click(boton);
    await mesPintado();
    expect(comensales(20)).toHaveTextContent("85");
    expect(screen.queryByText(/No se han podido leer/)).not.toBeInTheDocument();
  });

  it("al pasar al mes siguiente se pintan sus días y ninguno es «hoy» ni «pasado»", async () => {
    tablas.reservas = { data: [reserva("2026-11-05", "21:00:00", 85)] };
    montar();
    await mesPintado();
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    const cinco = await screen.findByRole("button", { name: /^5 de noviembre:/ });
    expect(cinco).toHaveAttribute("data-nivel", "medio");
    expect(screen.getByRole("heading", { name: /noviembre 2026/i })).toBeInTheDocument();
  });

  it("el mes anterior es todo histórico: atenuado, con lo que se reservó", async () => {
    tablas.reservas = { data: [reserva("2026-09-20", "21:00:00", 12, { estado: "no_show" })] };
    montar();
    await mesPintado();
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    const veinte = await screen.findByRole("button", { name: /^20 de septiembre:/ });
    expect(veinte).toHaveAttribute("data-nivel", "pasado");
    expect(within(veinte).getByTestId("comensales-casilla")).toHaveTextContent("12");
  });
});

// ─── 10. Estructura (el desborde en móvil) ───────────────────────────────────

describe("CalendarioOcupacion · estructura", () => {
  it("el mes va a TODO el ancho: ya no hay panel del día a la derecha (dueño, 2026-10-15)", async () => {
    montar();
    await mesPintado();
    const mes = screen.getByTestId("tarjeta-mes");
    expect(mes.parentElement?.children).toHaveLength(1);
    expect(mes.parentElement).toHaveClass("grid-cols-1");
    expect(mes.parentElement?.className).not.toMatch(/lg:grid-cols-\[/);
    expect(screen.queryByTestId("panel-dia")).toBeNull();
    expect(screen.queryByTestId("cierre-dia")).toBeNull();
  });

  it("la casilla seleccionada marca `aria-pressed` y se mueve al pulsar otra", async () => {
    montar();
    await mesPintado();
    expect(casilla(14)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(casilla(20));
    // El pop-up (modal) deja el resto oculto al lector de pantalla mientras está abierto.
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Listo" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(casilla(20)).toHaveAttribute("aria-pressed", "true");
    expect(casilla(14)).toHaveAttribute("aria-pressed", "false");
  });

  it("al pulsar un día se abre el pop-up de cierre de ese día («Martes, 20 de octubre»)", async () => {
    montar();
    await mesPintado();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(casilla(20));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "Martes, 20 de octubre" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Cerrar comida" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Cerrar cena" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: /Cerrar las dos/ })).toBeInTheDocument();
  });

  it("con solo «Ver» el pop-up enseña el día sin botones de abrir ni cerrar (06/11/2026)", async () => {
    permisos.editar = false;
    try {
      montar();
      await mesPintado();
      fireEvent.click(casilla(20));
      const dialogo = await screen.findByRole("dialog");
      expect(within(dialogo).getByRole("heading", { name: "Martes, 20 de octubre" })).toBeInTheDocument();
      expect(within(dialogo).getByTestId("estado-comida")).toBeInTheDocument();
      expect(within(dialogo).queryByRole("button", { name: /Cerrar (comida|cena|las dos)/ })).toBeNull();
    } finally {
      permisos.editar = true;
    }
  });
});

// ─── 10b. Altura fija (calendario a la altura de la pantalla) ────────────────

describe("CalendarioOcupacion · altura fija, sin scroll", () => {
  const original = {
    innerHeight: window.innerHeight,
    ro: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: original.innerHeight });
  });

  /** jsdom no calcula layout: se le dan medidas a mano (bloque en y=88, rejilla de 700×456). */
  function conLayout(altoVentana: number) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, "innerHeight", { configurable: true, value: altoVentana });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.dataset.testid === "calendario-ocupacion" ? 88 : 0;
      return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 700 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 456 });
  }

  it("sin medidas de layout (jsdom) conserva el layout de siempre: ni altura fija ni densidad", async () => {
    const { container } = montar();
    await mesPintado();
    expect(screen.getByTestId("calendario-ocupacion")).not.toHaveAttribute("data-altura-fija");
    expect(casilla(14)).not.toHaveAttribute("data-densidad");
    expect(screen.queryByTestId("leyenda-compacta")).toBeNull();
    expect(container.querySelector('[class*="grid-rows-[minmax"]')).toBeNull();
  });

  it("el bloque mide lo que queda de ventana: alto visual − posición del bloque", async () => {
    conLayout(800);
    montar();
    await mesPintado();
    await waitFor(() => expect(screen.getByTestId("calendario-ocupacion")).toHaveAttribute("data-altura-fija", "712"));
    expect(screen.getByTestId("calendario-ocupacion").style.getPropertyValue("--alto-bloque")).toBe("712px");
  });

  it("la rejilla reparte el alto entre las semanas del mes (octubre 2026: 5) con minmax(0,1fr)", async () => {
    conLayout(800);
    montar();
    await mesPintado();
    await waitFor(() => expect(screen.getByTestId("rejilla-mes")).toHaveStyle({ gridTemplateRows: "repeat(5, minmax(0, 1fr))" }));
  });

  it("cada casilla se adapta a su fila: 88 px de alto → densidad media (sin «N res.»), todo sigue en el aria-label", async () => {
    tablas.reservas = { data: carga(dia(20), 34) };
    conLayout(800);
    montar();
    await mesPintado();
    await waitFor(() => expect(casilla(20)).toHaveAttribute("data-densidad", "media"));
    expect(within(casilla(20)).getByTestId("comensales-casilla")).toHaveTextContent("34");
    expect(within(casilla(20)).queryByTestId("reservas-casilla")).toBeNull();
    expect(within(casilla(20)).getByTestId("porcentaje-casilla")).toHaveTextContent("20%");
    expect(casilla(20)).toHaveAttribute("aria-label", expect.stringMatching(/34 comensales en 4 reservas/));
  });

  it("con una fila de ~65 px la casilla pasa a una sola línea (cifra y barra; sin % escrito ni «N res.»)", async () => {
    tablas.reservas = { data: carga(dia(20), 34) };
    conLayout(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(340);
    montar();
    await mesPintado();
    await waitFor(() => expect(casilla(20)).toHaveAttribute("data-densidad", "compacta"));
    expect(within(casilla(20)).getByTestId("comensales-casilla")).toHaveTextContent("34");
    expect(within(casilla(20)).getByTestId("barras-casilla")).toBeInTheDocument();
    expect(within(casilla(20)).queryByTestId("porcentaje-casilla")).toBeNull();
    expect(within(casilla(20)).queryByTestId("reservas-casilla")).toBeNull();
  });

  it("con poca altura la leyenda pasa a su variante compacta; con mucha, completa", async () => {
    conLayout(800);
    const { unmount } = montar();
    await mesPintado();
    await waitFor(() => expect(screen.getByTestId("leyenda-compacta")).toBeInTheDocument());
    unmount();
    conLayout(1200);
    montar();
    await mesPintado();
    await waitFor(() => expect(screen.getByTestId("calendario-ocupacion")).toHaveAttribute("data-altura-fija"));
    expect(screen.queryByTestId("leyenda-compacta")).toBeNull();
  });

  it("una ventana demasiado baja no encoge más del suelo (520 px): la página hace scroll antes que casillas ilegibles", async () => {
    conLayout(500);
    montar();
    await mesPintado();
    await waitFor(() => expect(screen.getByTestId("calendario-ocupacion")).toHaveAttribute("data-altura-fija", "520"));
  });
});

// ─── 11. Lo que cambia en OTRO dispositivo ───────────────────────────────────

describe("CalendarioOcupacion · cambios de otros dispositivos", () => {
  it("monta la suscripción compartida a `reservas` (`useReservasEnVivo`): refresca la cuadrícula", async () => {
    montar();
    await mesPintado();
    expect(vi.mocked(useReservasEnVivo)).toHaveBeenCalled();
  });

  it("la cuadrícula del mes se relee cada minuto, solo con la pestaña a la vista (respaldo sin realtime)", async () => {
    const { qc } = montar();
    await mesPintado();
    const consulta = qc.getQueryCache().find({ queryKey: ["reservas_mes", "2026-10"] });
    expect(consulta?.observers[0]?.options).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  });
});

// ─── 7. El Reservado (sala privada): fuera de aforo, pero a la vista ─────────

describe("CalendarioOcupacion · el Reservado (sala privada) está fuera de aforo", () => {
  // En producción el Reservado lleva `caracteristicas.privada = true` (decisión del dueño, 2026-10-03):
  // el aforo es 150 (sin sus 20 plazas) y sus reservas no entran en ninguna cifra, pero se marcan.
  beforeEach(() => {
    vi.mocked(useEspaciosReserva).mockReturnValue({
      data: ESPACIOS.map((e) =>
        e.id === "e-reservado" ? { ...e, caracteristicas: { marca: "casa_tomas", privada: true } } : e,
      ),
      isLoading: false,
      isError: false,
    } as never);
    tablas.reservas = {
      data: [
        ...carga(dia(20), 30), // cena, en el comedor
        reserva(dia(20), "14:00:00", 8, { espacio_id: "e-reservado" }), // comida, Reservado
        reserva(dia(21), "21:00:00", 8, { espacio_id: "e-reservado" }), // día con SOLO el Reservado
      ],
    };
  });

  it("la leyenda dice que el aforo es 150 (no 170) y ya no habla del Reservado (solo se ve en Hoy)", async () => {
    montar();
    await mesPintado();
    expect(screen.getByText(/sobre el aforo de 150 comensales por turno/)).toBeInTheDocument();
    expect(screen.queryByTestId("muestra-sala-privada")).toBeNull();
    expect(screen.queryByText(/Reservado/)).toBeNull();
  });

  it("sus comensales no suman en la cifra grande ni en el %, y la casilla no lo marca", async () => {
    montar();
    await mesPintado();
    expect(comensales(20)).toHaveTextContent("30"); // sin los 8 del Reservado
    expect(within(casilla(20)).getByTestId("reservas-casilla")).toHaveTextContent("3 res.");
    expect(within(casilla(20)).getByTestId("porcentaje-casilla")).toHaveTextContent("20%"); // 30/150, no 38/170
    expect(within(casilla(20)).queryByTestId("indicador-sala-privada")).toBeNull();
    expect(casilla(20).getAttribute("aria-label")).not.toMatch(/Reservado/);
  });

  it("un día con solo el Reservado se ve como un día vacío", async () => {
    montar();
    await mesPintado();
    const solo = casilla(21);
    expect(within(solo).queryByTestId("comensales-casilla")).not.toBeInTheDocument();
    expect(within(solo).queryByTestId("indicador-sala-privada")).toBeNull();
    expect(solo).toHaveAttribute("data-nivel", "vacio");
    expect(solo.getAttribute("aria-label")).not.toMatch(/Reservado/);
  });
});
