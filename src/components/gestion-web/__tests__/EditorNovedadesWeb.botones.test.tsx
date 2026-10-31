// Editor de novedades con botones (historia 4073221d): lo que llega al guardar.
//
// - Regla 2.4 del plan: una novedad sin botones (ni al abrirla ni ahora) se
//   guarda EXACTAMENTE con las mismas claves que antes, sin `botones`, `menu`
//   ni `plato_id`. Es lo que permite que el panel nuevo llegue a producción
//   antes que la migración.
// - Reabrir una novedad restaura botones, orden, plato y menú.
// - La validación no deja guardar (criterio 5).
// - Aviso «El plato ya no está en la carta» en la lista.
//
// Historia 4093221d (P4): maridaje y cata. Se guardan y se reabren en v2 (los
// fixtures canónicos), con la validación maridaje_vacio y cata_vacia, las
// bebidas pasan por el traductor y un menú sin maridaje sigue en v1.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Novedad } from "@/hooks/useNovedades";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import type { BebidaDeCarta, VinoDeCarta } from "@/hooks/useBebidasParaMenu";

const mocks = vi.hoisted(() => ({
  novedades: [] as unknown[],
  platos: [] as unknown[],
  crear: vi.fn(),
  actualizar: vi.fn(),
  invoke: vi.fn(),
  // La carta de vinos y bebidas de useBebidasParaMenu (el hook tiene sus pruebas).
  carta: { vinos: [] as unknown[], bebidas: [] as unknown[], truncado: false, isLoading: false, error: null },
}));
vi.mock("@/hooks/useBebidasParaMenu", () => ({ useBebidasParaMenu: () => mocks.carta }));

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

const fixture = (nombre: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), "src/lib/__tests__/fixtures", `${nombre}.json`), "utf8"));
const MENU_MARIDAJE = fixture("menu-novedad-v2-maridaje");
const MENU_CATA = fixture("menu-novedad-v2-cata");

const FONDILLON: VinoDeCarta = {
  id: "vino-fondillon",
  nombre: "Fondillón",
  nombre_en: "Fondillon",
  nombre_fr: null,
  categoria: "GENEROSOS",
  alergenos_oficiales: ["sulfitos"],
  activado: true,
  restaurante: true,
};
const WHISKY: BebidaDeCarta = {
  id: "bebida-whisky-12",
  nombre: "Whisky de malta 12 años",
  nombre_en: "12-year-old malt whisky",
  nombre_fr: null,
  categoria: "Licores",
  activado: true,
  restaurante: true,
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
  mocks.carta = { vinos: [FONDILLON], bebidas: [WHISKY], truncado: false, isLoading: false, error: null };
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

// El traductor del menú, línea a línea: lo que no está en el diccionario se
// devuelve igual. El de la novedad (tipo «novedad») no responde.
const DICCIONARIO: Record<string, { en: string; fr: string }> = {
  Caldo: { en: "Broth", fr: "Bouillon" },
  "Cava brut nature": { en: "Brut nature cava", fr: "Cava brut nature" },
  "Ginebra de Mahón": { en: "Mahon gin", fr: "Gin de Mahon" },
};
const traductorDeMenu = () =>
  mocks.invoke.mockImplementation(async (_fn: string, { body }: { body: { tipo: string; datos: Record<string, string> } }) => {
    if (body.tipo !== "menu") return { data: { ok: false, error: "sin red" }, error: null };
    const a = (idioma: "en" | "fr") =>
      Object.fromEntries(
        Object.entries(body.datos).map(([seccion, texto]) => [
          seccion,
          texto ? texto.split("\n").map((linea) => DICCIONARIO[linea]?.[idioma] ?? linea).join("\n") : "",
        ]),
      );
    return { data: { ok: true, translations: { menu_en: a("en"), menu_fr: a("fr") } }, error: null };
  });

const nuevaConVerMenu = (titulo: string) => {
  renderEditor();
  fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: titulo } });
  fireEvent.click(within(bloque().getByRole("group", { name: "Añadir botón" })).getByRole("button", { name: /ver menú/i }));
};
const platoAMano = (nombre: string) => {
  fireEvent.click(within(screen.getByTestId("seccion-menu-primero")).getByRole("button", { name: /a mano/i }));
  fireEvent.change(screen.getByLabelText("Nombre del plato 1"), { target: { value: nombre } });
};
const tipo = (nombre: RegExp) => bloque().getByRole("radio", { name: nombre });
const interruptorMaridaje = () => tipo(/^Maridaje/);
const maridajes = () => within(screen.getByTestId("bebida-de-cada-plato"));
const cata = () => within(screen.getByTestId("editor-cata"));
// En la vista previa solo lleva botones la tarjeta que se edita.
const botonesEnVistaPrevia = () =>
  screen.queryAllByRole("list", { name: "Botones de la tarjeta" }).map((lista) => lista.textContent);
const cambiarTitulo = (titulo: string) => fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: titulo } });

describe("EditorNovedadesWeb — maridaje y cata (historia 4093221d)", () => {
  it("guarda un menú con maridaje en v2 y la bebida a mano pasa por el traductor", async () => {
    mocks.novedades = [];
    traductorDeMenu();
    nuevaConVerMenu("Menú maridado");
    platoAMano("Caldo");
    fireEvent.click(interruptorMaridaje());
    fireEvent.click(
      within(maridajes().getByRole("group", { name: "Bebida para «Caldo»" })).getByRole("button", {
        name: "Vino, cava o champagne",
      }),
    );
    fireEvent.change(maridajes().getByLabelText("Nombre"), { target: { value: "Cava brut nature" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(mocks.crear).toHaveBeenCalledTimes(1));
    // E8: una llamada para la comida y otra para las bebidas de los platos.
    expect(mocks.invoke).toHaveBeenCalledWith("traducir-contenido", {
      body: { tipo: "menu", datos: { primero: "Caldo", segundo: "", postre: "" } },
    });
    expect(mocks.invoke).toHaveBeenCalledWith("traducir-contenido", {
      body: { tipo: "menu", datos: { primero: "Cava brut nature", segundo: "", postre: "" } },
    });
    const { menu, botones } = mocks.crear.mock.calls[0][0];
    expect(botones).toEqual(["ver_menu"]);
    expect(menu).toMatchObject({ version: 2, tipo: "menu", incluye_bebidas: false, maridaje: true });
    expect(menu.secciones).not.toHaveProperty("cata");
    expect(menu.secciones.primero[0]).toMatchObject({
      nombre: "Caldo",
      traducciones: { en: { nombre: "Broth", descripcion: null }, fr: { nombre: "Bouillon", descripcion: null } },
      maridaje: {
        origen: "libre",
        refId: null,
        nombre: "Cava brut nature",
        descripcion: null,
        sulfitos: true,
        traducciones: {
          en: { nombre: "Brut nature cava", descripcion: null },
          fr: { nombre: "Cava brut nature", descripcion: null },
        },
      },
    });
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringMatching(/^Menú:/), expect.anything());
  });

  it("reabre la v2 con maridaje tal cual y, sin traductor, la guarda igual que el fixture", async () => {
    mocks.novedades = [novedad("n-6", "Menú maridado", { botones: ["ver_menu"], menu: MENU_MARIDAJE })];
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Menú maridado»" }));
    expect(tipo(/^Maridaje/)).toBeChecked();
    // Con Maridaje no se ofrece «¿Qué incluye el menú?».
    expect(bloque().queryByRole("radio", { name: /comida \+ bebidas/i })).toBeNull();
    expect(maridajes().getByText("2 de 3 con bebida")).toBeInTheDocument();
    expect(maridajes().getByRole("button", { name: "Cambiar «Cava brut nature»" })).toBeInTheDocument();
    expect(maridajes().getByRole("button", { name: "Cambiar «Fondillón»" })).toBeInTheDocument();
    expect(botonesEnVistaPrevia()).toEqual(["Ver menú"]);

    cambiarTitulo("Menú maridado de otoño");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1));
    const payload = mocks.actualizar.mock.calls[0][0];
    expect(payload.botones).toEqual(["ver_menu"]);
    expect(payload.menu).toEqual(MENU_MARIDAJE);
    // Lo escrito a mano sin traducir se guarda en castellano y se avisa.
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/^Menú: /), expect.anything());
  });

  it("crea una cata con bebidas de la carta y a mano, en orden y sin comida; la vista previa enseña «Ver menú»", async () => {
    mocks.novedades = [];
    traductorDeMenu();
    nuevaConVerMenu("Cata de destilados");
    fireEvent.click(tipo(/^Cata/));
    // Una cata vacía no tendría botón en la web.
    expect(botonesEnVistaPrevia()).toEqual([]);
    expect(screen.getByText("No saldrá en la web: «Ver menú»")).toBeInTheDocument();

    const añadir = () => cata().getByRole("group", { name: "Añadir bebida a la cata" });
    fireEvent.click(within(añadir()).getByRole("button", { name: /de la carta/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Whisky/ }));
    fireEvent.click(within(añadir()).getByRole("button", { name: "Otra bebida" }));
    fireEvent.change(within(cata().getByRole("group", { name: /Bebida 2 de la cata/ })).getByLabelText("Nombre"), {
      target: { value: "Ginebra de Mahón" },
    });
    expect(botonesEnVistaPrevia()).toEqual(["Ver menú"]);
    expect(screen.queryByText("No saldrá en la web: «Ver menú»")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(mocks.crear).toHaveBeenCalledTimes(1));
    // El nombre de la carta no se traduce: solo va la línea a mano.
    expect(mocks.invoke).toHaveBeenCalledWith("traducir-contenido", {
      body: { tipo: "menu", datos: { primero: "Ginebra de Mahón", segundo: "", postre: "" } },
    });
    expect(mocks.crear.mock.calls[0][0].menu).toEqual({
      version: 2,
      tipo: "cata",
      incluye_bebidas: false,
      maridaje: false,
      secciones: {
        primero: [],
        segundo: [],
        postre: [],
        bebidas: [],
        cata: [
          {
            id: expect.any(String),
            origen: "bebida",
            refId: "bebida-whisky-12",
            nombre: "Whisky de malta 12 años",
            descripcion: null,
            sulfitos: false,
            traducciones: { en: { nombre: "12-year-old malt whisky", descripcion: null } },
          },
          {
            id: expect.any(String),
            origen: "libre",
            refId: null,
            nombre: "Ginebra de Mahón",
            descripcion: null,
            sulfitos: false,
            traducciones: { en: { nombre: "Mahon gin", descripcion: null }, fr: { nombre: "Gin de Mahon", descripcion: null } },
          },
        ],
      },
    });
  });

  it("reabre una cata en su orden y, sin traductor, la guarda igual que el fixture", async () => {
    mocks.novedades = [novedad("n-7", "Cata de destilados", { botones: ["ver_menu", "llamar"], menu: MENU_CATA })];
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Cata de destilados»" }));
    expect(tipo(/^Cata/)).toBeChecked();
    const cambiar = cata().getAllByRole("button", { name: /^Cambiar «/ });
    expect(cambiar).toHaveLength(3);
    expect(cambiar[0]).toHaveAccessibleName("Cambiar «Whisky de malta 12 años»");
    expect(cambiar[1]).toHaveAccessibleName("Cambiar «Fondillón»");
    expect(cambiar[2]).toHaveAccessibleName("Cambiar «Ginebra de Mahón»");
    expect(botonesEnVistaPrevia()).toEqual([expect.stringMatching(/^Ver menú/)]);

    cambiarTitulo("Cata de destilados de otoño");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1));
    const payload = mocks.actualizar.mock.calls[0][0];
    expect(payload.botones).toEqual(["ver_menu", "llamar"]);
    expect(payload.menu).toEqual(MENU_CATA);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/^Cata: /), expect.anything());
  });

  it("no deja guardar un Maridaje sin ninguna bebida (maridaje_vacio) y lo explica", () => {
    mocks.novedades = [];
    nuevaConVerMenu("Menú maridado");
    platoAMano("Caldo");
    fireEvent.click(interruptorMaridaje());
    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    const mensaje = "Un maridaje necesita la bebida de al menos un plato, o elige «Menú».";
    expect(toast.error).toHaveBeenCalledWith(`No se puede guardar: ${mensaje}`, expect.anything());
    expect(bloque().getByTestId("errores-botones")).toHaveTextContent(mensaje);
    expect(mocks.crear).not.toHaveBeenCalled();
  });

  it("con un error en los botones abre la subpestaña «Botones y menú» y la marca", () => {
    mocks.novedades = [];
    nuevaConVerMenu("Menú maridado");
    platoAMano("Caldo");
    fireEvent.click(interruptorMaridaje());
    const pestana = (nombre: RegExp) => screen.getByRole("tab", { name: nombre });
    fireEvent.mouseDown(pestana(/^Texto/));
    expect(pestana(/^Texto/)).toHaveAttribute("data-state", "active");
    expect(pestana(/^Botones y menú/)).toHaveAccessibleName(/con errores/);

    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    expect(pestana(/^Botones y menú/)).toHaveAttribute("data-state", "active");
    expect(mocks.crear).not.toHaveBeenCalled();
  });

  it("sin título vuelve a la subpestaña «Texto»", () => {
    mocks.novedades = [];
    renderEditor();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Publicación/ }));
    expect(screen.getByRole("tab", { name: /^Publicación/ })).toHaveAttribute("data-state", "active");
    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    expect(screen.getByRole("tab", { name: /^Texto/ })).toHaveAttribute("data-state", "active");
    expect(toast.error).toHaveBeenCalledWith("El título es obligatorio.");
  });

  it("no deja guardar una cata sin bebidas (cata_vacia) y lo explica", () => {
    mocks.novedades = [];
    nuevaConVerMenu("Cata de vinos");
    fireEvent.click(tipo(/^Cata/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    expect(toast.error).toHaveBeenCalledWith("No se puede guardar: Una cata necesita al menos una bebida.", expect.anything());
    expect(bloque().getByTestId("errores-botones")).toHaveTextContent("Una cata necesita al menos una bebida.");
    expect(mocks.crear).not.toHaveBeenCalled();
  });

  it("un menú v1 sigue guardándose en v1 aunque se toquen el tipo y el maridaje", async () => {
    mocks.novedades = [novedad("n-8", "Menú de Navidad", { botones: ["ver_menu"], menu: MENU_GUARDADO })];
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Menú de Navidad»" }));
    expect(tipo(/^Menú/)).toBeChecked();
    expect(interruptorMaridaje()).not.toBeChecked();
    fireEvent.click(interruptorMaridaje());
    fireEvent.click(tipo(/^Menú/));
    fireEvent.click(tipo(/^Cata/));
    fireEvent.click(tipo(/^Menú/));
    cambiarTitulo("Menú de Navidad 2026");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1));
    const { menu } = mocks.actualizar.mock.calls[0][0];
    expect(menu).toEqual(MENU_GUARDADO);
    expect(menu).not.toHaveProperty("tipo");
    expect(menu).not.toHaveProperty("maridaje");
    // Ya estaba traducido: el traductor del menú no se llama.
    expect(mocks.invoke.mock.calls.filter(([, { body }]) => body.tipo === "menu")).toHaveLength(0);
  });
});
