/**
 * Tests para src/components/reservas/DisponibilidadCuartos.tsx
 *
 * La cuenta está probada en lib/reservas/__tests__/rejillaCuartos.test.ts;
 * aquí solo se fija que la vista enseña TODAS las horas del turno, que cada
 * hora se puede elegir y que no aparece ninguna sala. Y, con `baldosas` (el
 * panel del día del Calendario, 2026-10-06), que no hay tabla ni scroll lateral,
 * que cada baldosa lo dice todo y que el tinte es la escala del mes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { UMBRALES_OCUPACION, estiloNivel, type NivelCalendario } from "@/lib/reservas/ocupacionCalendario";

// El día de cada test: espacios, reservas y periodos de turno. Por defecto, solo la comida (13-16) con una
// reserva de 4 a las 13:00 y 170 de aforo; los tests de las baldosas lo cambian.
const dia = vi.hoisted(() => {
  const inicial = () => ({
    espacios: [
      { id: "comedor", nombre: "Comedor", capacidad_maxima: 100 },
      { id: "salon", nombre: "Salón", capacidad_maxima: 70 },
    ] as Array<{ id: string; nombre: string; capacidad_maxima: number }>,
    reservas: [{ id: "r1", hora: "13:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: "salon" }] as Array<{
      id: string;
      hora: string;
      numero_comensales: number;
      estado: string;
      espacio_id: string | null;
    }>,
    periodos: [{ hora_inicio: "13:00:00", hora_fin: "16:00:00", activo: true, espacio_id: null, dias_semana: [] }] as Array<{
      hora_inicio: string;
      hora_fin: string;
      activo: boolean;
      espacio_id: null;
      dias_semana: number[];
    }>,
  });
  return { inicial, actual: inicial() };
});

vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    // Touza no admite reservas (decisión del dueño 2026-10-01): el hook devuelve el día de Casa Tomás en
    // `data` (antes, el bloque del negocio pedido en `negocio`).
    data: {
      espacios: dia.actual.espacios,
      reservas: dia.actual.reservas,
      horasBase: ["13:00"],
      cerrado: false,
    },
  }),
}));
vi.mock("@/hooks/useConfiguracionTurnos", () => ({
  useConfiguracionTurnos: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: dia.actual.periodos,
  }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: { estancia_comida_minutos: 105, estancia_cena_minutos: 120 } }),
}));

import { DisponibilidadCuartos } from "@/components/reservas/DisponibilidadCuartos";

beforeEach(() => {
  dia.actual = dia.inicial();
});

describe("DisponibilidadCuartos", () => {
  it("enseña los 12 cuartos de la comida, sin escalera y sin salas", () => {
    const { container } = render(<DisponibilidadCuartos fecha="2026-10-05" />);
    const tabla = screen.getByRole("table");
    const cabeceras = within(tabla).getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabeceras).toEqual([
      "Hora",
      "13:00", "13:15", "13:30", "13:45", "14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45",
    ]);
    expect(screen.getByText(/4\/170 · quedan 166/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Salón|Comedor/);
  });

  it("cada hora es un botón que la elige, y la elegida se marca", () => {
    const onSeleccionarHora = vi.fn();
    render(
      <DisponibilidadCuartos
        fecha="2026-10-05"
        hora="14:15"
        comensales={6}
        onSeleccionarHora={onSeleccionarHora}
      />,
    );
    expect(screen.getByRole("button", { name: /Elegir las 14:15/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Elegir las 13:45/ }));
    expect(onSeleccionarHora).toHaveBeenCalledWith("13:45");
    expect(screen.getByText("Caben 6 más")).toBeInTheDocument();
  });

  it("sin fecha pide elegir un día", () => {
    render(<DisponibilidadCuartos fecha={null} />);
    expect(screen.getByText(/elige un día/i)).toBeInTheDocument();
  });

  // Touza no admite reservas (decisión del dueño 2026-10-01): una sola rejilla, sin «· Casa Tomás» ni otro negocio.
  it("el título no nombra ningún negocio", () => {
    render(<DisponibilidadCuartos fecha="2026-10-05" />);
    expect(screen.getByRole("heading", { name: "Disponibilidad por cuartos de hora" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Casa Tomás|Touza/);
  });

  it("compacta, sigue llevando su título (el panel del día y la verificación no tienen otro)", () => {
    render(<DisponibilidadCuartos fecha="2026-10-05" compacto />);
    expect(screen.getByRole("heading", { name: "Disponibilidad por cuartos de hora" })).toBeInTheDocument();
  });

  it.each([
    ["compacta", true],
    ["completa", false],
  ])("%s y con `ocultarTitulo` no repite el título a la vista, pero la sección conserva su nombre", (_, compacto) => {
    render(<DisponibilidadCuartos fecha="2026-10-05" compacto={compacto} ocultarTitulo />);
    expect(screen.queryByRole("heading", { name: "Disponibilidad por cuartos de hora" })).not.toBeInTheDocument();
    expect(screen.queryByText("Disponibilidad por cuartos de hora")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Disponibilidad por cuartos de hora" })).toBeInTheDocument();
    // La rejilla sigue entera.
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

// ─── Baldosas (panel del día del Calendario, 2026-10-06) ─────────────────────
//
// El dueño: «se ve súper pequeño; esto de reservas es posible que se gestione desde una tablet». En el panel
// del día la tabla no cabía (cada turno con su barra de scroll lateral y letra de 12 px): ahí van baldosas.

const COMIDA = { hora_inicio: "13:00:00", hora_fin: "16:00:00", activo: true, espacio_id: null, dias_semana: [] };
const CENA = { hora_inicio: "20:00:00", hora_fin: "23:30:00", activo: true, espacio_id: null, dias_semana: [] };
const reserva = (id: string, hora: string, pax: number) => ({
  id,
  hora,
  numero_comensales: pax,
  estado: "confirmada",
  espacio_id: null,
});

/** Las baldosas de un turno, por su lista. */
const baldosasDe = (turno: "Comida" | "Cena") =>
  within(screen.getByRole("list", { name: new RegExp(`^${turno}:`) })).getAllByRole("listitem");
const baldosa = (hora: string) => screen.getByRole("listitem", { name: new RegExp(`^${hora}:`) });

describe("DisponibilidadCuartos · baldosas (panel del día del Calendario)", () => {
  beforeEach(() => {
    // Como la captura del dueño: 2 a las 13:00 y 4 a las 13:45 (estancia de la comida: 105 min).
    dia.actual.periodos = [COMIDA, CENA];
    dia.actual.reservas = [reserva("a", "13:00:00", 2), reserva("b", "13:45:00", 4), reserva("c", "21:00:00", 1)];
    dia.actual.espacios = [{ id: "comedor", nombre: "Comedor", capacidad_maxima: 150 }];
  });

  it("una baldosa por cuarto de cada turno, sin tabla ni contenedores con scroll lateral", () => {
    const { container } = render(<DisponibilidadCuartos fecha="2026-10-06" compacto baldosas />);
    expect(baldosasDe("Comida").map((b) => b.getAttribute("data-cuarto"))).toEqual([
      "13:00", "13:15", "13:30", "13:45", "14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45",
    ]);
    expect(baldosasDe("Cena")).toHaveLength(14); // 20:00 … 23:15
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      container.querySelectorAll('[class*="overflow-x-"], [class*="overflow-auto"], [class*="overflow-scroll"], .scroll-x-touch'),
    ).toHaveLength(0);
    // La cabecera de cada turno, como siempre («Cena 43/150 · quedan 107» en la captura del dueño).
    expect(screen.getByText("6/150 · quedan 144")).toBeInTheDocument();
    expect(screen.getByText("1/150 · quedan 149")).toBeInTheDocument();
  });

  it("la tabla de siempre no cambia donde se usa (sin `baldosas`)", () => {
    render(<DisponibilidadCuartos fecha="2026-10-06" compacto />);
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it.each([
    ["comida", ["Comida"], ["Cena"]],
    ["cena", ["Cena"], ["Comida"]],
  ] as const)("con `turno=\"%s\"` solo salen las baldosas de ese turno", (turno, salen, noSalen) => {
    render(<DisponibilidadCuartos fecha="2026-10-06" compacto baldosas turno={turno} />);
    for (const t of salen) expect(screen.getByRole("list", { name: new RegExp(`^${t}:`) })).toBeInTheDocument();
    for (const t of noSalen) expect(screen.queryByRole("list", { name: new RegExp(`^${t}:`) })).not.toBeInTheDocument();
  });

  it("cada baldosa lo dice todo en su aria-label: «13:45: 6 en sala, llegan 4»", () => {
    render(<DisponibilidadCuartos fecha="2026-10-06" compacto baldosas />);
    expect(baldosa("13:45")).toHaveAccessibleName("13:45: 6 en sala, llegan 4");
    expect(baldosa("13:15")).toHaveAccessibleName("13:15: 2 en sala, sin llegadas");
    expect(baldosa("21:00")).toHaveAccessibleName("21:00: 1 en sala, llega 1");
  });

  it("«+N llegan» solo sale si llega alguien; los que hay en sala, siempre y en grande", () => {
    render(<DisponibilidadCuartos fecha="2026-10-06" compacto baldosas />);
    expect(baldosa("13:45")).toHaveTextContent("+4 llegan");
    expect(baldosa("21:00")).toHaveTextContent("+1 llega");
    expect(baldosa("13:15").textContent ?? "").not.toMatch(/llega/);
    expect(within(baldosa("13:15")).getByText("2")).toHaveClass("text-xl");
    // Y la leyenda lo explica sin conocer la tabla.
    expect(screen.getByText(/los comensales/)).toHaveTextContent(/en sala.*«\+4 llegan», los que entran/);
  });

  // Con 100 de aforo, los comensales de una reserva a las 13:00 están en sala de 13:00 a 14:30 (105 min).
  const u = UMBRALES_OCUPACION;
  it.each<[number, NivelCalendario]>([
    [u.medio - 1, "bajo"],
    [u.medio, "medio"],
    [u.alto, "alto"],
    [u.casiLleno, "casi_lleno"],
    [u.completo, "completo"],
  ])("el tinte es la escala del mes (`UMBRALES_OCUPACION`): %i en sala de 100 → «%s»", (pax, nivel) => {
    dia.actual.espacios = [{ id: "comedor", nombre: "Comedor", capacidad_maxima: 100 }];
    dia.actual.reservas = [reserva("a", "13:00:00", pax)];
    render(<DisponibilidadCuartos fecha="2026-10-06" compacto baldosas turno="comida" />);
    expect(baldosa("13:00")).toHaveAttribute("data-nivel", nivel);
    expect(baldosa("13:00").className).toContain(estiloNivel(nivel).celda);
    // Un cuarto sin nadie sentado va en blanco, como un día sin reservas.
    expect(baldosa("15:45")).toHaveAttribute("data-nivel", "vacio");
    expect(baldosa("15:45").className).toContain(estiloNivel("vacio").celda);
    // Ni verde ni ámbar ni rojo: en el Calendario el ámbar es «sin sala» y el rojo no se usa.
    expect(baldosa("13:00").className).not.toMatch(/emerald|amber|red-|green-/);
  });

  it("una hora fuera de los turnos lleva asterisco y su porqué escrito, no solo en un `title`", () => {
    dia.actual.reservas = [reserva("a", "16:15:00", 4)];
    render(<DisponibilidadCuartos fecha="2026-10-06" compacto baldosas turno="comida" />);
    expect(baldosa("16:15")).toHaveTextContent("16:15*");
    expect(baldosa("16:15")).toHaveAccessibleName(/^16:15: 4 en sala, llegan 4\. Fuera del horario del turno/);
    expect(screen.getByText(/Fuera del horario del turno: sale porque ya hay una reserva a esa hora\./)).toBeInTheDocument();
  });

  it("ningún texto de las baldosas baja de 13 px (ni `text-xs` ni tamaños de 10-12 px)", () => {
    const { container } = render(<DisponibilidadCuartos fecha="2026-10-06" compacto baldosas />);
    const pequenos = Array.from(container.querySelectorAll("*")).filter((el) =>
      /(^|\s)text-(xs|\[1[0-2]px\])(\s|$)/.test(el.getAttribute("class") ?? ""),
    );
    expect(pequenos.map((el) => `${el.tagName} «${el.textContent?.slice(0, 30)}»`)).toEqual([]);
  });
});
