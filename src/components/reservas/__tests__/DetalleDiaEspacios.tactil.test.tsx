/**
 * El panel del día del Calendario, legible y táctil (2026-10-06).
 *
 * El dueño, con el panel a ~315 px de ancho: «se ve súper pequeño; piensa que
 * esto de reservas es posible que se gestione desde una tablet». Había letra de
 * 10-12 px, el título «Martes, 6 De Octubre» y la rejilla por cuartos en dos
 * tablas, cada una con su barra de scroll horizontal dentro del scroll vertical
 * del panel.
 *
 * Aquí se monta el panel ENTERO con la rejilla por cuartos DE VERDAD (en
 * `DetalleDiaEspacios.test.tsx` va sustituida por un doble): se mockean solo
 * los hooks de datos. jsdom no calcula layout, así que se protegen las clases
 * que lo deciden: ningún contenedor con scroll lateral, un solo scroll (el
 * vertical del cuerpo), ningún texto por debajo de 13 px y el selector de turno
 * a 44 px con el dedo. Las medidas en el navegador, en las capturas del encargo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Martes 6 de octubre de 2026, como la captura del dueño. Tres reservas de Casa Tomás (aforo 150) y una en el
// Reservado (sala privada, fuera de aforo: sale con su etiqueta en el reparto y no cuenta en las cifras):
//   Ana   13:00 · 2 · Comedor   · con mesa
//   Bruno 13:45 · 4 · Comedor   · sin mesa
//   Diego 21:00 · 3 · sin sala
//   Elena 14:00 · 8 · Reservado · sin mesa
const fila = (
  reserva_id: string,
  hora: string,
  numero_comensales: number,
  espacio: { id: string; nombre: string } | null,
  grado: string,
) => ({
  reserva_id,
  fecha: "2026-10-06",
  hora,
  turno: hora < "17:00:00" ? "comida" : "cena",
  nombre: reserva_id,
  numero_comensales,
  estado: "confirmada",
  marca: "casa_tomas",
  espacio_id: espacio?.id ?? null,
  espacio_nombre: espacio?.nombre ?? null,
  mesas_asignadas: grado === "con_mesa" ? 1 : 0,
  plazas_asignadas: grado === "con_mesa" ? 4 : 0,
  mesas_nombres: grado === "con_mesa" ? ["Mesa 1"] : [],
  grado,
});
const COMEDOR = { id: "e-comedor", nombre: "Comedor" };
const FILAS = [
  fila("ana", "13:00:00", 2, COMEDOR, "con_mesa"),
  fila("bruno", "13:45:00", 4, COMEDOR, "sin_mesa"),
  fila("diego", "21:00:00", 3, null, "sin_sala"),
];
const FILA_RESERVADO = fila("elena", "14:00:00", 8, { id: "e-reservado", nombre: "Reservado" }, "sin_mesa");
const ESPACIOS = [
  ...["Comedor", "Salón", "Terraza"].map((nombre) => ({
    id: `e-${nombre.toLowerCase().replace("ó", "o")}`,
    nombre,
    capacidad_maxima: 50,
    activa: true,
    caracteristicas: { marca: "casa_tomas" },
  })),
  { id: "e-reservado", nombre: "Reservado", capacidad_maxima: 14, activa: true, caracteristicas: { marca: "casa_tomas", privada: true } },
];

vi.mock("@/hooks/useResumenAsignacionDia", () => ({
  useResumenAsignacionDia: () => ({
    filas: [...FILAS, FILA_RESERVADO],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: ESPACIOS, isLoading: false }) }));
vi.mock("@/hooks/useMesas", () => ({
  useMesas: () => ({ data: [{ id: "m1", espacio_id: "e-comedor", nombre: "Mesa 1", capacidad: 4, activa: true }] }),
}));
// Los datos de la rejilla por cuartos (la rejilla es la de verdad).
vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    data: {
      // Como el hook de verdad: la sala privada viene marcada y la rejilla deja fuera sus reservas.
      espacios: ESPACIOS.map(({ id, nombre, capacidad_maxima, caracteristicas }) => ({
        id,
        nombre,
        capacidad_maxima,
        privada: "privada" in caracteristicas,
      })),
      reservas: [...FILAS, FILA_RESERVADO].map((f) => ({
        id: f.reserva_id,
        hora: f.hora,
        numero_comensales: f.numero_comensales,
        estado: "confirmada",
        espacio_id: f.espacio_id,
      })),
      horasBase: [],
      cerrado: false,
    },
  }),
}));
vi.mock("@/hooks/useConfiguracionTurnos", () => ({
  useConfiguracionTurnos: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: [
      { hora_inicio: "13:00:00", hora_fin: "16:00:00", activo: true, espacio_id: null, dias_semana: [] },
      { hora_inicio: "20:00:00", hora_fin: "23:30:00", activo: true, espacio_id: null, dias_semana: [] },
    ],
  }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: { estancia_comida_minutos: 105, estancia_cena_minutos: 120 } }),
}));

import { DetalleDiaEspacios } from "@/components/reservas/DetalleDiaEspacios";

const MARTES = new Date(2026, 9, 6);

function montar(fecha: Date = MARTES) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const arbol = (f: Date) => (
    <MemoryRouter initialEntries={["/reservas?tab=calendario"]}>
      <QueryClientProvider client={qc}>
        <DetalleDiaEspacios fecha={f} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const vista = render(arbol(fecha));
  return { ...vista, cambiarDia: (f: Date) => vista.rerender(arbol(f)) };
}

const panel = () => screen.getByTestId("panel-dia");
/** El cuerpo desplazable del panel: el único elemento con scroll. */
const cuerpo = () => {
  const desplazables = Array.from(panel().querySelectorAll<HTMLElement>('[class*="overflow-y-auto"]'));
  expect(desplazables).toHaveLength(1);
  return desplazables[0];
};
const lista = (turno: "Comida" | "Cena") => screen.queryByRole("list", { name: new RegExp(`^${turno}:`) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DetalleDiaEspacios · legible y táctil (tablet)", () => {
  it("el título es «Martes, 6 de octubre»: solo la primera letra en mayúscula, sin `capitalize`", () => {
    montar();
    const titulo = screen.getByRole("heading", { level: 4 });
    expect(titulo).toHaveTextContent(/^Martes, 6 de octubre$/);
    expect(titulo).not.toHaveClass("capitalize");
  });

  it("el selector de turno: letra de 14 px, 36 px con ratón y 44 px con el dedo (`pointer-coarse:h-11`)", () => {
    montar();
    const botones = within(screen.getByRole("group", { name: "Filtrar por turno" })).getAllByRole("radio");
    expect(botones.map((b) => b.textContent)).toEqual(["Todo el día", "Comida", "Cena"]);
    for (const b of botones) {
      expect(b).toHaveClass("text-sm", "h-9", "pointer-coarse:h-11");
      expect(b).not.toHaveClass("text-xs");
      expect(b).not.toHaveClass("h-7");
    }
  });

  it("la rejilla por cuartos va en baldosas («13:45: 6 en sala, llegan 4») y el selector la filtra", () => {
    montar();
    expect(lista("Comida")).toBeInTheDocument();
    expect(lista("Cena")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "13:45: 6 en sala, llegan 4" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));
    expect(lista("Comida")).not.toBeInTheDocument();
    expect(within(lista("Cena") as HTMLElement).getAllByRole("listitem")).toHaveLength(14);

    fireEvent.click(screen.getByRole("radio", { name: "Comida" }));
    expect(within(lista("Comida") as HTMLElement).getAllByRole("listitem")).toHaveLength(12);
    expect(lista("Cena")).not.toBeInTheDocument();

    // Pulsar el turno activo vuelve al día entero.
    fireEvent.click(screen.getByRole("radio", { name: "Comida" }));
    expect(lista("Comida")).toBeInTheDocument();
    expect(lista("Cena")).toBeInTheDocument();
  });

  it("sin scroll lateral en todo el panel: ni tablas ni contenedores con `overflow-x`; un solo scroll, el vertical", () => {
    montar();
    expect(within(panel()).queryByRole("table")).not.toBeInTheDocument();
    expect(
      panel().querySelectorAll('[class*="overflow-x-"], [class*="overflow-auto"], [class*="overflow-scroll"], .scroll-x-touch'),
    ).toHaveLength(0);
    // Y el único que hay es el cuerpo (`cuerpo()` lo comprueba), con las baldosas dentro.
    expect(cuerpo()).toContainElement(lista("Comida"));
  });

  it("ningún texto del panel baja de 13 px (ni `text-xs` ni tamaños fijos de 10-12 px)", () => {
    montar();
    // Con todo a la vista: ocupación, «Sin sala», la tarjeta del Comedor (con sus insignias), la del Reservado
    // (con su etiqueta «Fuera de aforo») y las baldosas.
    expect(screen.getByTestId("ocupacion-del-dia")).toBeInTheDocument();
    expect(screen.getByText("Sin sala")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir el plano de Comedor" })).toHaveTextContent(/1 con mesa.*1 pendiente de mesa/);
    expect(within(screen.getByRole("button", { name: "Abrir el plano de Reservado" })).getByTestId("etiqueta-fuera-de-aforo")).toBeInTheDocument();
    const pequenos = Array.from(panel().querySelectorAll("*")).filter((el) =>
      /(^|\s)text-(xs|\[1[0-2]px\])(\s|$)/.test(el.getAttribute("class") ?? ""),
    );
    expect(pequenos.map((el) => `${el.tagName} «${el.textContent?.slice(0, 30)}»`)).toEqual([]);
  });

  it("fijos arriba solo el título y el selector; el resumen del turno abre el cuerpo desplazable", () => {
    montar();
    const desplazable = cuerpo();
    expect(desplazable).not.toContainElement(screen.getByRole("heading", { level: 4 }));
    expect(desplazable).not.toContainElement(screen.getByRole("group", { name: "Filtrar por turno" }));
    expect(desplazable).toContainElement(screen.getByTestId("comensales-dia"));
    expect(desplazable).toContainElement(screen.getByTestId("ocupacion-del-dia"));
    expect(screen.getByTestId("comensales-dia")).toHaveTextContent("9");
  });

  it("al cambiar de día el cuerpo vuelve arriba (el resumen del día nuevo está en él)", () => {
    const { cambiarDia } = montar();
    cuerpo().scrollTop = 420;
    expect(cuerpo().scrollTop).toBe(420);
    cambiarDia(new Date(2026, 9, 7));
    expect(screen.getByRole("heading", { level: 4 })).toHaveTextContent("Miércoles, 7 de octubre");
    expect(cuerpo().scrollTop).toBe(0);
  });
});
