// El menú del día de Gestor web → «Menús» (tabla `menus_diarios`, tres filas
// por día: es/en/fr). Petición del dueño, 01/11/2026: «En el menú del día
// faltaría opción de entrante, y en el tema de postre o café: en nuestro menú
// entran las 2 cosas, que se pueda configurar. Además hay que hacer mucho
// scroll, soluciónalo.»
//
// Se prueba lo que se GUARDA (el entrante en las tres filas, traducido aparte;
// `postreCafe`), que un menú de antes se quede como se ve hoy en la web, y lo
// que quita scroll (lista corta, vista previa en un botón).

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  filas: [] as { id: string; fecha: string; menu: unknown }[],
  upsert: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: mocks.filas, error: null }) }) }),
      upsert: async (filas: unknown, opciones: unknown) => {
        mocks.upsert(tabla, filas, opciones);
        return { error: null };
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
  },
}));
vi.mock("@/hooks/usePlatosParaMenu", () => ({
  usePlatosParaMenu: () => ({ platos: [], isLoading: false, error: null }),
  indexarPlatos: () => new Map(),
}));
vi.mock("@/components/gestion-web/InterruptorMenuTapas", () => ({ InterruptorMenuTapas: () => null }));
vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { EditorMenuTapasWeb } from "@/components/gestion-web/EditorMenuTapasWeb";
import { serializarMenuDia, itemLibre } from "@/lib/menu-dia";

/** Fecha local `aaaa-mm-dd` a `dias` de hoy (negativo = pasado). */
const dia = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("sv-SE");
};

const conProveedor = (hijos: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {hijos}
  </QueryClientProvider>
);

const pintar = () => render(conProveedor(<EditorMenuTapasWeb seccionActiva="menus_diarios" />));

type Fila = { fecha: string; idiom: string; menu: Record<string, unknown> };
const filasGuardadas = (): Fila[] => mocks.upsert.mock.calls.at(-1)![1] as Fila[];
const seccionesDe = (fila: Fila) => fila.menu.secciones as Record<string, { nombre: string }[]>;

beforeEach(() => {
  mocks.filas = [];
  mocks.upsert.mockReset();
  mocks.invoke.mockReset();
});

describe("Menú del día — entrante y «¿Qué entra?» del postre", () => {
  it("un menú nuevo guarda el entrante en las tres filas, traducido en su propia llamada, y «Postre y café»", async () => {
    // Responde según lo que se le mande: el entrante va en el hueco de «primero».
    mocks.invoke.mockImplementation(async (_nombre: string, { body }: { body: { datos: { primero: string } } }) => {
      const esEntrante = body.datos.primero === "Gilda";
      return {
        data: {
          ok: true,
          translations: esEntrante
            ? { menu_en: { primero: "Gilda skewer" }, menu_fr: { primero: "Brochette Gilda" } }
            : {
                menu_en: { primero: "Soup", segundo: "", postre: "" },
                menu_fr: { primero: "Soupe", segundo: "", postre: "" },
              },
        },
        error: null,
      };
    });
    pintar();
    await screen.findByText("Todavía no hay nada guardado");

    // Sin ningún menú con la opción elegida, uno nuevo arranca en «Postre y café».
    expect(screen.getByLabelText("¿Qué entra?")).toHaveValue("postre_y_cafe");
    expect(within(screen.getByTestId("seccion-menu-postre")).getByRole("button", { name: /Postre y café/ })).toBeInTheDocument();

    const entrante = screen.getByTestId("seccion-menu-entrante");
    fireEvent.click(within(entrante).getByRole("button", { name: /Entrante/ }));
    fireEvent.click(within(entrante).getByRole("button", { name: /a mano/i }));
    fireEvent.change(within(entrante).getByPlaceholderText("Nombre del plato"), { target: { value: "Gilda" } });

    const primero = screen.getByTestId("seccion-menu-primero");
    fireEvent.click(within(primero).getByRole("button", { name: /a mano/i }));
    fireEvent.change(within(primero).getByPlaceholderText("Nombre del plato"), { target: { value: "Sopa" } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar y publicar" }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());

    // Dos llamadas al traductor: lo de siempre y el entrante aparte.
    const enviados = mocks.invoke.mock.calls.map(([, { body }]) => body.datos);
    expect(enviados).toEqual(
      expect.arrayContaining([
        { primero: "Sopa", segundo: "", postre: "" },
        { primero: "Gilda", segundo: "", postre: "" },
      ]),
    );

    const [es, en, fr] = filasGuardadas();
    expect([es.idiom, en.idiom, fr.idiom]).toEqual(["es", "en", "fr"]);
    for (const fila of [es, en, fr]) expect(fila.menu.postreCafe).toBe("postre_y_cafe");
    expect(seccionesDe(es).entrante.map((i) => i.nombre)).toEqual(["Gilda"]);
    expect(seccionesDe(en).entrante.map((i) => i.nombre)).toEqual(["Gilda skewer"]);
    expect(seccionesDe(fr).entrante.map((i) => i.nombre)).toEqual(["Brochette Gilda"]);
    expect(seccionesDe(en).primero.map((i) => i.nombre)).toEqual(["Soup"]);
    // Espejo heredado del entrante también.
    expect(en.menu.entrante).toBe("Gilda skewer");
  });

  it("un menú guardado antes de la opción se abre en «Solo postre» y se guarda igual que se ve hoy", async () => {
    mocks.filas = [
      { id: "1", fecha: dia(0), menu: { primero: "Sopa", segundo: "Merluza", postre: "Flan" } },
    ];
    mocks.invoke.mockResolvedValue({ data: { ok: false }, error: null });
    pintar();

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));

    // Plegadas con su resumen: el menú entero se ve sin desplazarse.
    const postre = screen.getByTestId("seccion-menu-postre");
    const cabecera = within(postre).getByRole("button", { name: /Postre/ });
    expect(cabecera).toHaveAttribute("aria-expanded", "false");
    expect(cabecera).toHaveTextContent("Flan");
    fireEvent.click(cabecera);
    expect(screen.getByLabelText("¿Qué entra?")).toHaveValue("postre");

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    expect(filasGuardadas()[0].menu.postreCafe).toBe("postre");
  });

  it("un menú nuevo repite la opción del último que la tiene elegida", async () => {
    mocks.filas = [
      { id: "2", fecha: dia(-1), menu: serializarMenuDia({ primero: [itemLibre("Sopa")], segundo: [], postre: [] }, "postre_o_cafe") },
    ];
    pintar();
    await screen.findByRole("button", { name: "Editar" });
    expect(screen.getByLabelText("¿Qué entra?")).toHaveValue("postre_o_cafe");

    fireEvent.change(screen.getByLabelText("¿Qué entra?"), { target: { value: "postre_y_cafe" } });
    expect(within(screen.getByTestId("seccion-menu-postre")).getByRole("button", { name: /Postre y café/ })).toBeInTheDocument();
  });
});

describe("Menú del día — menos scroll", () => {
  it("la lista enseña de hoy en adelante y los dos últimos días; el resto, a un toque", async () => {
    mocks.filas = [dia(2), dia(0), dia(-1), dia(-2), dia(-3), dia(-4)].map((fecha, i) => ({
      id: String(i),
      fecha,
      menu: { primero: `Plato ${i}`, segundo: "", postre: "" },
    }));
    pintar();

    const lista = await screen.findByTestId("lista-guardados");
    expect(within(lista).getAllByRole("listitem")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Ver los 2 anteriores" }));
    expect(within(lista).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Ocultar los anteriores" })).toBeInTheDocument();
  });

  it("la vista previa se abre con un botón y pinta los rótulos de la web", async () => {
    pintar();
    await screen.findByText("Todavía no hay nada guardado");

    const entrante = screen.getByTestId("seccion-menu-entrante");
    fireEvent.click(within(entrante).getByRole("button", { name: /Entrante/ }));
    fireEvent.click(within(entrante).getByRole("button", { name: /a mano/i }));
    fireEvent.change(within(entrante).getByPlaceholderText("Nombre del plato"), { target: { value: "Gilda" } });
    const postre = screen.getByTestId("seccion-menu-postre");
    fireEvent.click(within(postre).getByRole("button", { name: /a mano/i }));
    fireEvent.change(within(postre).getByPlaceholderText("Nombre del plato"), { target: { value: "Flan" } });

    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }));
    const dialogo = await screen.findByRole("dialog", { name: "Así se leerá en la web" });
    // Con entrante, la web dice «Entrantes» y «Primeros»; el postre, «Postre y café».
    expect(within(dialogo).getByTestId("previa-entrante")).toHaveTextContent("Entrantes");
    expect(within(dialogo).getByTestId("previa-primero")).toHaveTextContent("Primeros");
    expect(within(dialogo).getByTestId("previa-postre")).toHaveTextContent("Postre y café");
    expect(within(dialogo).getByText("Gilda")).toBeInTheDocument();
  });
});
