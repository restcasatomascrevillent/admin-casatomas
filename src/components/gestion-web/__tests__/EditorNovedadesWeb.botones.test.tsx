// Editor de novedades con botones (historia 4073221d): lo que llega al guardar.
//
// - Regla 2.4 del plan: una novedad sin botones (ni al abrirla ni ahora) se
//   guarda EXACTAMENTE con las mismas claves que antes, sin `botones`, `menu`
//   ni `plato_id`. Es lo que permite que el panel nuevo llegue a producción
//   antes que la migración.
// - Reabrir una novedad restaura botones, orden, plato y menú.
// - La validación no deja guardar (criterio 5).
// - Aviso «El plato ya no está en la carta» en la lista.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Novedad } from "@/hooks/useNovedades";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";

const mocks = vi.hoisted(() => ({
  novedades: [] as unknown[],
  platos: [] as unknown[],
  crear: vi.fn(),
  actualizar: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })) },
  },
}));
vi.mock("@/hooks/useNovedades", () => ({
  useNovedades: () => ({
    novedades: mocks.novedades,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    crearNovedad: { mutateAsync: mocks.crear },
    actualizarNovedad: { mutateAsync: mocks.actualizar },
    eliminarNovedad: { mutateAsync: vi.fn() },
    toggleActivo: { mutateAsync: vi.fn() },
    reordenar: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock("@/hooks/usePlatosParaMenu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/usePlatosParaMenu")>();
  return { ...real, usePlatosParaMenu: () => ({ platos: mocks.platos, isLoading: false, error: null }) };
});

import { toast } from "sonner";
import { EditorNovedadesWeb } from "@/components/gestion-web/EditorNovedadesWeb";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const HOY = new Date().toLocaleDateString("sv-SE");

const novedad = (id: string, titulo: string, extra: Partial<Novedad> = {}): Novedad => ({
  id,
  titulo,
  descripcion: "Texto",
  imagen_url: null,
  imagen_posicion_y: 50,
  tipo: "anuncio",
  tipo_asociacion: "seccion",
  plato_id: null,
  vino_id: null,
  bebida_id: null,
  seccion: "gestion_web_novedades",
  fecha_inicio: HOY,
  fecha_fin: null,
  activo: true,
  destacado: false,
  orden: 0,
  titulo_en: "Text en",
  titulo_fr: "Texte fr",
  descripcion_en: null,
  descripcion_fr: null,
  badge_text: null,
  badge_text_en: null,
  badge_text_fr: null,
  icono: "star",
  bullets: null,
  bullets_en: null,
  bullets_fr: null,
  tags: null,
  tags_en: null,
  tags_fr: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  created_by: null,
  ...extra,
});

const pulpo: PlatoDeCarta = {
  id: "p-pulpo",
  nombre: "Pulpo a feira",
  nombre_en: "Octopus",
  nombre_fr: "Poulpe",
  descripcion: null,
  descripcion_en: null,
  descripcion_fr: null,
  categoria: "Entrantes",
  imagen_url: null,
  imagen_posicion_y: null,
  alergenos_oficiales: [],
  alergenos_inferidos: [],
  alergenos_notas: null,
  activado: true,
  restaurante: true,
  orden: null,
};

const MENU_GUARDADO = {
  version: 1,
  incluye_bebidas: false,
  secciones: {
    primero: [
      {
        id: "l-1",
        origen: "libre",
        platoId: null,
        nombre: "Caldo gallego",
        descripcion: null,
        imagenUrl: null,
        imagenPosicionY: null,
        alergenos: [],
        alergenosInferidos: [],
        alergenosNotas: null,
        traducciones: {
          en: { nombre: "Galician broth", descripcion: null },
          fr: { nombre: "Bouillon galicien", descripcion: null },
        },
      },
    ],
    segundo: [],
    postre: [],
    bebidas: [],
  },
};

const renderEditor = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditorNovedadesWeb />
    </QueryClientProvider>,
  );

const bloque = () => within(screen.getByTestId("bloque-botones-novedad"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platos = [pulpo];
  mocks.actualizar.mockResolvedValue({});
  mocks.crear.mockResolvedValue({});
  // El traductor de la novedad no responde: la prueba no depende de él.
  mocks.invoke.mockResolvedValue({ data: { ok: false, error: "sin red" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("EditorNovedadesWeb — botones", () => {
  it("una novedad de antes se guarda sin botones, menu ni plato_id (regla 2.4)", async () => {
    // Fila de una BBDD sin la migración: no trae las columnas nuevas.
    mocks.novedades = [novedad("n-1", "Cocido los jueves")];
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Cocido los jueves»" }));
    expect(bloque().getByText("Sin botones: la tarjeta se ve como hasta ahora.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: "Cocido todos los jueves" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1));
    const payload = mocks.actualizar.mock.calls[0][0];
    expect(payload).toMatchObject({ id: "n-1", titulo: "Cocido todos los jueves", tipo: "anuncio" });
    expect(payload).not.toHaveProperty("botones");
    expect(payload).not.toHaveProperty("menu");
    expect(payload).not.toHaveProperty("plato_id");
    // Solo se llamó al traductor de la novedad, nunca al del menú.
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][1].body.tipo).toBe("novedad");
  });

  it("al reabrir restaura botones, orden y menú; al guardar los conserva", async () => {
    mocks.novedades = [
      novedad("n-2", "Menú de Navidad", { botones: ["ver_menu", "llamar"], menu: MENU_GUARDADO }),
    ];
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Menú de Navidad»" }));
    const filas = within(bloque().getByRole("list", { name: "Botones de la tarjeta, en orden" })).getAllByRole("listitem");
    expect(filas.map((f) => f.textContent)).toEqual([expect.stringMatching(/Ver menú/), expect.stringMatching(/Llamar/)]);
    expect(screen.getByLabelText("Nombre del plato 1")).toHaveValue("Caldo gallego");

    // Cambiar el orden y guardar.
    fireEvent.click(bloque().getByRole("button", { name: "Subir «Llamar»" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1));
    const payload = mocks.actualizar.mock.calls[0][0];
    expect(payload.botones).toEqual(["llamar", "ver_menu"]);
    expect(payload.plato_id).toBeNull();
    // Ya estaba traducido: se guarda igual y no se llama al traductor.
    expect(payload.menu).toEqual(MENU_GUARDADO);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("una novedad nueva con «Llamar» manda los botones y deja menu y plato_id a null", async () => {
    mocks.novedades = [];
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: "Reserva tu mesa" } });
    fireEvent.click(within(bloque().getByRole("group", { name: "Añadir botón" })).getByRole("button", { name: /llamar/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(mocks.crear).toHaveBeenCalledTimes(1));
    expect(mocks.crear.mock.calls[0][0]).toMatchObject({ botones: ["llamar"], menu: null, plato_id: null });
  });

  it("no deja guardar «Ver menú» sin platos y explica por qué", async () => {
    mocks.novedades = [];
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: "Menú de Navidad" } });
    fireEvent.click(within(bloque().getByRole("group", { name: "Añadir botón" })).getByRole("button", { name: /ver menú/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    expect(toast.error).toHaveBeenCalledWith(
      "No se puede guardar: «Ver menú» necesita al menos un plato en primero, segundo o postre.",
      expect.anything(),
    );
    expect(mocks.crear).not.toHaveBeenCalled();
  });

  it("un menú escrito a mano se traduce con tipo «menu» al guardar", async () => {
    mocks.novedades = [];
    mocks.invoke.mockImplementation(async (_fn: string, { body }: { body: { tipo: string } }) =>
      body.tipo === "menu"
        ? {
            data: {
              ok: true,
              translations: {
                menu_en: { primero: "Broth", segundo: "", postre: "" },
                menu_fr: { primero: "Bouillon", segundo: "", postre: "" },
              },
            },
            error: null,
          }
        : { data: { ok: false }, error: null },
    );
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: "Menú de invierno" } });
    fireEvent.click(within(bloque().getByRole("group", { name: "Añadir botón" })).getByRole("button", { name: /ver menú/i }));
    fireEvent.click(within(screen.getByTestId("seccion-menu-primero")).getByRole("button", { name: /a mano/i }));
    fireEvent.change(screen.getByLabelText("Nombre del plato 1"), { target: { value: "Caldo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(mocks.crear).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).toHaveBeenCalledWith("traducir-contenido", {
      body: { tipo: "menu", datos: { primero: "Caldo", segundo: "", postre: "" } },
    });
    const { menu, botones } = mocks.crear.mock.calls[0][0];
    expect(botones).toEqual(["ver_menu"]);
    expect(menu.secciones.primero[0]).toMatchObject({
      nombre: "Caldo",
      traducciones: { en: { nombre: "Broth", descripcion: null }, fr: { nombre: "Bouillon", descripcion: null } },
    });
  });

  it("si el plato enlazado ya no está en la carta, lo avisa en la lista y no deja guardar", async () => {
    mocks.platos = [{ ...pulpo, activado: false }];
    mocks.novedades = [
      novedad("n-3", "Pulpo nuevo", { botones: ["ver_plato"], plato_id: "p-pulpo" }),
      novedad("n-4", "Plato borrado", { botones: ["llamar", "ver_plato"], plato_id: null }),
      novedad("n-5", "Sin botones"),
    ];
    renderEditor();

    const lista = within(screen.getByRole("list", { name: "Novedades" }));
    expect(lista.getAllByText("El plato ya no está en la carta")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Editar «Pulpo nuevo»" }));
    expect(bloque().getByText("El plato ya no está en la carta")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: "Pulpo de temporada" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(toast.error).toHaveBeenCalledWith(
      "No se puede guardar: El plato ya no está en la carta: enlaza otro o quita «Échale un vistazo».",
      expect.anything(),
    );
    expect(mocks.actualizar).not.toHaveBeenCalled();

    // Quitar el botón permite guardar y limpia plato_id.
    fireEvent.click(bloque().getByRole("button", { name: "Quitar «Échale un vistazo»" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1));
    expect(mocks.actualizar.mock.calls[0][0]).toMatchObject({ botones: [], menu: null, plato_id: null });
  });

  it("la novedad borrada de la carta (plato_id NULL) también avisa al abrirla", () => {
    mocks.novedades = [novedad("n-4", "Plato borrado", { botones: ["ver_plato"], plato_id: null })];
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Editar «Plato borrado»" }));
    expect(bloque().getByText("El plato ya no está en la carta")).toBeInTheDocument();
  });
});
