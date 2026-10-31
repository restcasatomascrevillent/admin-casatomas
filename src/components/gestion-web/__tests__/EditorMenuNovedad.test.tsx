// Menú de una novedad («Ver menú», historia 4073221d, criterios 3 y 7):
// comida con el editor del menú del día, «Comida + bebidas» o «Solo comida» y
// bebidas escritas a mano. Las traducciones guardadas se conservan mientras el
// español de la línea no cambie.
//
// Historia 4093221d (P3): tipo Menú o Cata con los avisos de E10, «Con
// maridaje» con la bebida de cada plato, la cata en orden y la v1 intacta.

import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorMenuNovedad } from "@/components/gestion-web/EditorMenuNovedad";
import { indexarPlatos, type PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { itemLibre } from "@/lib/menu-dia";
import type { BebidaDeCarta, VinoDeCarta } from "@/hooks/useBebidasParaMenu";
import {
  AVISO_GUARDAR_COMO_CATA,
  AVISO_GUARDAR_COMO_MENU,
  AVISO_MARIDAJE_APAGADO,
  menuNovedadVacio,
  parseMenuNovedad,
  serializarMenuNovedad,
  type ItemMenuNovedad,
  type MenuNovedad,
} from "@/lib/menu-novedad";

// La carta de vinos y bebidas, sin Supabase (el hook tiene sus propias pruebas).
const carta = vi.hoisted(() => ({
  valor: {
    vinos: [] as unknown[],
    bebidas: [] as unknown[],
    truncado: false,
    isLoading: false,
    error: null as Error | null,
  },
}));
vi.mock("@/hooks/useBebidasParaMenu", () => ({ useBebidasParaMenu: () => carta.valor }));

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

beforeEach(() => {
  carta.valor = { vinos: [FONDILLON], bebidas: [WHISKY], truncado: false, isLoading: false, error: null };
});

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const PULPO: PlatoDeCarta = {
  id: "p-pulpo",
  nombre: "Pulpo a feira",
  nombre_en: "Galician-style octopus",
  nombre_fr: "Poulpe à la galicienne",
  descripcion: null,
  descripcion_en: null,
  descripcion_fr: null,
  categoria: "Entrantes",
  imagen_url: null,
  imagen_posicion_y: null,
  alergenos_oficiales: ["moluscos"],
  alergenos_inferidos: [],
  alergenos_notas: null,
  activado: true,
  restaurante: true,
  orden: null,
};

let ultimo: MenuNovedad;

function Harness({ inicial = menuNovedadVacio() }: { inicial?: MenuNovedad }) {
  const [menu, setMenu] = useState(inicial);
  ultimo = menu;
  return (
    <EditorMenuNovedad
      menu={menu}
      onChange={setMenu}
      platos={[PULPO]}
      platosPorId={indexarPlatos([PULPO])}
      cargandoPlatos={false}
    />
  );
}

const traducido = (nombre: string): ItemMenuNovedad => ({
  ...itemLibre(nombre),
  traducciones: { en: { nombre: `${nombre} (en)`, descripcion: null }, fr: { nombre: `${nombre} (fr)`, descripcion: null } },
});

describe("EditorMenuNovedad", () => {
  it("tiene primero, segundo y postre y empieza en «Solo comida», sin Bebidas", () => {
    render(<Harness />);
    for (const seccion of ["primero", "segundo", "postre"]) {
      expect(screen.getByTestId(`seccion-menu-${seccion}`)).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: /solo comida/i })).toBeChecked();
    expect(screen.queryByTestId("seccion-menu-bebidas")).toBeNull();
  });

  it("«Comida + bebidas» añade la sección Bebidas, escrita a mano", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: /comida \+ bebidas/i }));
    expect(ultimo.incluye_bebidas).toBe(true);

    const bebidas = screen.getByTestId("seccion-menu-bebidas");
    expect(within(bebidas).getByText(/Sin bebidas todavía/)).toBeInTheDocument();

    fireEvent.click(within(bebidas).getByRole("button", { name: "Añadir bebida" }));
    const campo = within(bebidas).getByLabelText("Bebida 1");
    await waitFor(() => expect(campo).toHaveFocus());
    fireEvent.change(campo, { target: { value: "Vino de la casa" } });
    expect(ultimo.secciones.bebidas[0]).toMatchObject({ nombre: "Vino de la casa", origen: "libre", platoId: null });
  });

  it("volver a «Solo comida» oculta las bebidas sin perderlas (no se guardan)", () => {
    render(<Harness inicial={{ ...menuNovedadVacio(), incluye_bebidas: true, secciones: { ...menuNovedadVacio().secciones, bebidas: [itemLibre("Agua")] } }} />);
    fireEvent.click(screen.getByRole("radio", { name: /solo comida/i }));
    expect(ultimo.incluye_bebidas).toBe(false);
    expect(screen.queryByTestId("seccion-menu-bebidas")).toBeNull();
    expect(ultimo.secciones.bebidas).toHaveLength(1);
  });

  it("ordena y quita bebidas", () => {
    const inicial: MenuNovedad = {
      ...menuNovedadVacio(),
      incluye_bebidas: true,
      secciones: { ...menuNovedadVacio().secciones, bebidas: [itemLibre("Agua"), itemLibre("Vino")] },
    };
    render(<Harness inicial={inicial} />);
    fireEvent.click(screen.getByRole("button", { name: "Subir bebida 2" }));
    expect(ultimo.secciones.bebidas.map((b) => b.nombre)).toEqual(["Vino", "Agua"]);
    fireEvent.click(screen.getByRole("button", { name: "Quitar bebida 1" }));
    expect(ultimo.secciones.bebidas.map((b) => b.nombre)).toEqual(["Agua"]);
  });

  it("un plato de la carta se copia con sus datos", async () => {
    render(<Harness />);
    fireEvent.click(within(screen.getByTestId("seccion-menu-segundo")).getByRole("button", { name: /de la carta/i }));
    fireEvent.click(await screen.findByRole("option", { name: /pulpo a feira/i }));
    expect(ultimo.secciones.segundo[0]).toMatchObject({
      origen: "carta",
      platoId: "p-pulpo",
      nombre: "Pulpo a feira",
      alergenos: ["moluscos"],
    });
  });

  it("si cambia el nombre de una línea a mano, pierde su traducción; si no, la conserva", () => {
    const inicial: MenuNovedad = {
      ...menuNovedadVacio(),
      incluye_bebidas: true,
      secciones: {
        ...menuNovedadVacio().secciones,
        primero: [traducido("Caldo"), traducido("Empanada")],
        bebidas: [traducido("Agua")],
      },
    };
    render(<Harness inicial={inicial} />);

    fireEvent.change(screen.getByLabelText("Nombre del plato 1"), { target: { value: "Caldo gallego" } });
    expect(ultimo.secciones.primero[0].traducciones).toBeUndefined();
    expect(ultimo.secciones.primero[1].traducciones?.en?.nombre).toBe("Empanada (en)");

    fireEvent.change(screen.getByLabelText("Bebida 1"), { target: { value: "Agua mineral" } });
    expect(ultimo.secciones.bebidas[0].traducciones).toBeUndefined();
  });
});

type MenuJson = { version: number; secciones: Record<string, Array<Record<string, unknown>>> };
const json = (menu: MenuNovedad) => serializarMenuNovedad(menu) as unknown as MenuJson;
const vacio = menuNovedadVacio();
const radioTipo = (nombre: RegExp) => screen.getByRole("radio", { name: nombre });

describe("EditorMenuNovedad · Menú o Cata (E10)", () => {
  it("empieza en Menú; pasar a Cata sin contenido no avisa", () => {
    render(<Harness />);
    expect(radioTipo(/^Menú/)).toBeChecked();
    fireEvent.click(radioTipo(/^Cata/));
    expect(ultimo.tipo).toBe("cata");
    expect(screen.getByTestId("avisos-tipo-menu")).toBeEmptyDOMElement();
  });

  it("con platos, la Cata avisa y oculta platos, bebidas y maridaje; al volver a Menú reaparecen y avisa de la cata", () => {
    const gamba = itemLibre("Gamba roja");
    render(<Harness inicial={{ ...vacio, secciones: { ...vacio.secciones, primero: [gamba] } }} />);

    fireEvent.click(radioTipo(/^Cata/));
    expect(screen.getByTestId("avisos-tipo-menu")).toHaveTextContent(AVISO_GUARDAR_COMO_CATA);
    expect(screen.queryByTestId("seccion-menu-primero")).toBeNull();
    expect(screen.queryByRole("radio", { name: /comida \+ bebidas/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: /con maridaje/i })).toBeNull();
    expect(screen.getByTestId("editor-cata")).toBeInTheDocument();

    const añadir = screen.getByRole("group", { name: "Añadir bebida a la cata" });
    fireEvent.click(within(añadir).getByRole("button", { name: "Otra bebida" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Ginebra de Mahón" } });

    fireEvent.click(radioTipo(/^Menú/));
    expect(screen.getByTestId("avisos-tipo-menu")).toHaveTextContent(AVISO_GUARDAR_COMO_MENU);
    expect(screen.getByTestId("seccion-menu-primero")).toBeInTheDocument();
    // Lo del otro tipo sigue en memoria, pero el Menú se guarda sin la cata (v1).
    expect(ultimo.secciones.primero).toEqual([gamba]);
    expect(ultimo.cata.map((l) => l.nombre)).toEqual(["Ginebra de Mahón"]);
    expect(json(ultimo)).toMatchObject({ version: 1 });
    expect(json(ultimo).secciones).not.toHaveProperty("cata");
  });
});

describe("EditorMenuNovedad · Con maridaje", () => {
  it("apagado por defecto; encendido, cada plato elige, cambia o quita su bebida, y se combina con «Comida + bebidas»", async () => {
    const gamba = itemLibre("Gamba roja");
    const arroz = itemLibre("Arroz a banda");
    const turron = itemLibre("Turrón de Jijona");
    render(<Harness inicial={{ ...vacio, secciones: { ...vacio.secciones, primero: [gamba], segundo: [arroz], postre: [turron] } }} />);

    const interruptor = screen.getByRole("switch", { name: /con maridaje/i });
    expect(interruptor).not.toBeChecked();
    expect(screen.queryByTestId("bebida-de-cada-plato")).toBeNull();

    fireEvent.click(interruptor);
    expect(ultimo.maridaje).toBe(true);
    const bloque = screen.getByTestId("bebida-de-cada-plato");
    expect(within(bloque).getByText("0 de 3 con bebida")).toBeInTheDocument();

    // A mano, «Vino, cava o champagne»: sulfitos marcados y el foco en el nombre.
    const grupoGamba = within(bloque).getByRole("group", { name: "Bebida para «Gamba roja»" });
    fireEvent.click(within(grupoGamba).getByRole("button", { name: "Vino, cava o champagne" }));
    expect(ultimo.maridajes[gamba.id]).toMatchObject({ origen: "libre", refId: null, sulfitos: true });
    const nombre = within(bloque).getByLabelText("Nombre");
    await waitFor(() => expect(nombre).toHaveFocus());
    fireEvent.change(nombre, { target: { value: "Cava brut nature" } });
    expect(ultimo.maridajes[gamba.id].nombre).toBe("Cava brut nature");

    // De la carta: el vino con sus sulfitos.
    const grupoTurron = () => within(bloque).getByRole("group", { name: "Bebida para «Turrón de Jijona»" });
    fireEvent.click(within(grupoTurron()).getByRole("button", { name: /de la carta/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Fondillón/ }));
    expect(ultimo.maridajes[turron.id]).toMatchObject({ origen: "vino", refId: "vino-fondillon", sulfitos: true });
    expect(within(bloque).getByText("2 de 3 con bebida")).toBeInTheDocument();

    // Cambiar por otra bebida a mano y quitarla.
    fireEvent.click(within(bloque).getByRole("button", { name: "Cambiar «Fondillón»" }));
    fireEvent.click(within(grupoTurron()).getByRole("button", { name: "Otra bebida" }));
    expect(ultimo.maridajes[turron.id]).toMatchObject({ origen: "libre", sulfitos: false, nombre: "" });
    fireEvent.click(within(bloque).getByRole("button", { name: "Quitar «bebida sin nombre»" }));
    expect(ultimo.maridajes[turron.id]).toBeUndefined();
    expect(ultimo.maridajes[arroz.id]).toBeUndefined();
    await waitFor(() => expect(within(grupoTurron()).getByRole("button", { name: /de la carta/i })).toHaveFocus());

    // Con «Comida + bebidas»: v2 con la sección Bebidas y el maridaje solo en la gamba (E3).
    fireEvent.click(screen.getByRole("radio", { name: /comida \+ bebidas/i }));
    fireEvent.click(screen.getByRole("button", { name: "Añadir bebida" }));
    fireEvent.change(screen.getByLabelText("Bebida 1"), { target: { value: "Agua mineral" } });
    const guardado = json(ultimo);
    expect(guardado).toMatchObject({ version: 2, tipo: "menu", incluye_bebidas: true, maridaje: true });
    expect(guardado.secciones.primero[0].maridaje).toMatchObject({ nombre: "Cava brut nature", sulfitos: true });
    expect(guardado.secciones.segundo[0]).not.toHaveProperty("maridaje");
    expect(guardado.secciones.postre[0]).not.toHaveProperty("maridaje");
    expect(guardado.secciones.bebidas.map((b) => b.nombre)).toEqual(["Agua mineral"]);

    // Apagado: avisa, conserva las bebidas en memoria y se guarda la v1.
    fireEvent.click(interruptor);
    expect(screen.queryByTestId("bebida-de-cada-plato")).toBeNull();
    expect(screen.getByTestId("aviso-maridaje")).toHaveTextContent(AVISO_MARIDAJE_APAGADO);
    expect(ultimo.maridajes[gamba.id]).toBeDefined();
    expect(json(ultimo)).toMatchObject({ version: 1, incluye_bebidas: true });
  });

  it("cambiar la descripción de una bebida traducida conserva los nombres traducidos", () => {
    const gamba = itemLibre("Gamba roja");
    const inicial: MenuNovedad = {
      ...vacio,
      maridaje: true,
      secciones: { ...vacio.secciones, primero: [gamba] },
      maridajes: {
        [gamba.id]: {
          id: "m1",
          origen: "libre",
          refId: null,
          nombre: "Cava brut nature",
          descripcion: "Bien frío",
          sulfitos: true,
          traducciones: { en: { nombre: "Brut nature cava", descripcion: "Well chilled" } },
        },
      },
    };
    render(<Harness inicial={inicial} />);
    fireEvent.change(screen.getByLabelText("Descripción corta (opcional)"), { target: { value: "Muy frío" } });
    expect(ultimo.maridajes[gamba.id].traducciones).toEqual({ en: { nombre: "Brut nature cava", descripcion: null } });
  });

  it("sin platos con nombre, pide añadirlos primero; y avisa si la carta de vinos viene recortada", () => {
    carta.valor = { ...carta.valor, truncado: true };
    render(<Harness inicial={{ ...vacio, maridaje: true }} />);
    const bloque = screen.getByTestId("bebida-de-cada-plato");
    expect(within(bloque).getByText(/Añade platos arriba/)).toBeInTheDocument();
    expect(within(bloque).getByTestId("aviso-carta-truncada")).toHaveTextContent(/más vinos de los que caben/);
  });
});

describe("EditorMenuNovedad · Cata", () => {
  it("añade de la carta y a mano, en orden; sube y baja con el foco en la línea; quita; se guarda sin comida", async () => {
    render(<Harness inicial={{ ...vacio, tipo: "cata" }} />);
    expect(radioTipo(/^Cata/)).toBeChecked();
    const cata = screen.getByTestId("editor-cata");
    expect(within(cata).getByText(/Sin bebidas todavía/)).toBeInTheDocument();
    expect(within(cata).queryByTestId("aviso-carta-truncada")).toBeNull();

    const añadir = () => within(cata).getByRole("group", { name: "Añadir bebida a la cata" });
    fireEvent.click(within(añadir()).getByRole("button", { name: /de la carta/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Whisky/ }));
    fireEvent.click(within(añadir()).getByRole("button", { name: /de la carta/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Fondillón/ }));
    fireEvent.click(within(añadir()).getByRole("button", { name: "Otra bebida" }));
    const campo = within(screen.getByRole("group", { name: /Bebida 3 de la cata/ })).getByLabelText("Nombre");
    await waitFor(() => expect(campo).toHaveFocus());
    fireEvent.change(campo, { target: { value: "Ginebra de Mahón" } });
    const orden = () => ultimo.cata.map((l) => l.nombre);
    expect(orden()).toEqual(["Whisky de malta 12 años", "Fondillón", "Ginebra de Mahón"]);
    expect(within(cata).getByText("3 bebidas")).toBeInTheDocument();

    // Subir y bajar son botones de verdad (Enter y Espacio) y el foco sigue a la línea.
    const subir = () => screen.getByRole("button", { name: "Subir «Ginebra de Mahón»" });
    subir().focus();
    fireEvent.click(subir());
    expect(orden()).toEqual(["Whisky de malta 12 años", "Ginebra de Mahón", "Fondillón"]);
    await waitFor(() => expect(subir()).toHaveFocus());
    fireEvent.click(subir());
    expect(orden()).toEqual(["Ginebra de Mahón", "Whisky de malta 12 años", "Fondillón"]);
    // Arriba del todo «Subir» se desactiva y el foco pasa a «Bajar».
    expect(subir()).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Bajar «Ginebra de Mahón»" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Bajar «Whisky de malta 12 años»" }));
    expect(orden()).toEqual(["Ginebra de Mahón", "Fondillón", "Whisky de malta 12 años"]);

    fireEvent.click(screen.getByRole("button", { name: "Quitar «Fondillón»" }));
    expect(orden()).toEqual(["Ginebra de Mahón", "Whisky de malta 12 años"]);

    expect(json(ultimo)).toMatchObject({
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
          { nombre: "Ginebra de Mahón", origen: "libre", refId: null, sulfitos: false },
          { nombre: "Whisky de malta 12 años", origen: "bebida", refId: "bebida-whisky-12", sulfitos: false },
        ],
      },
    });
  });

  it("cambia una línea por otra en su sitio, y Cancelar la deja como estaba", async () => {
    const inicial: MenuNovedad = {
      ...vacio,
      tipo: "cata",
      cata: [
        { id: "c1", origen: "libre", refId: null, nombre: "Ginebra de Mahón", descripcion: null, sulfitos: false },
        { id: "c2", origen: "libre", refId: null, nombre: "Orujo", descripcion: null, sulfitos: false },
      ],
    };
    render(<Harness inicial={inicial} />);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar «Ginebra de Mahón»" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(ultimo.cata.map((l) => l.id)).toEqual(["c1", "c2"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar «Ginebra de Mahón»" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Cambiar «Ginebra de Mahón»" }));
    const grupo = screen.getByRole("group", { name: /Bebida 1 de la cata, en lugar de «Ginebra de Mahón»/ });
    fireEvent.click(within(grupo).getByRole("button", { name: /de la carta/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Fondillón/ }));
    expect(ultimo.cata.map((l) => l.nombre)).toEqual(["Fondillón", "Orujo"]);
    expect(ultimo.cata[0]).toMatchObject({ origen: "vino", sulfitos: true });
  });
});

describe("EditorMenuNovedad · una v1 de antes", () => {
  const V1 = {
    version: 1,
    incluye_bebidas: true,
    secciones: {
      primero: [
        {
          id: "p1",
          origen: "libre",
          platoId: null,
          nombre: "Gamba roja de Santa Pola",
          descripcion: "A la plancha",
          imagenUrl: null,
          imagenPosicionY: null,
          alergenos: [],
          alergenosInferidos: [],
          alergenosNotas: null,
          traducciones: { en: { nombre: "Santa Pola red prawn", descripcion: "Grilled" } },
        },
      ],
      segundo: [],
      postre: [],
      bebidas: [
        {
          id: "b1",
          origen: "libre",
          platoId: null,
          nombre: "Agua mineral",
          descripcion: null,
          imagenUrl: null,
          imagenPosicionY: null,
          alergenos: [],
          alergenosInferidos: [],
          alergenosNotas: null,
        },
      ],
    },
  };

  it("se abre como Menú sin maridaje y, aunque se toquen tipo e interruptor, se guarda igual", () => {
    const menu = parseMenuNovedad(V1);
    expect(menu).not.toBeNull();
    render(<Harness inicial={menu!} />);
    expect(radioTipo(/^Menú/)).toBeChecked();
    expect(screen.getByRole("switch", { name: /con maridaje/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /comida \+ bebidas/i })).toBeChecked();
    expect(serializarMenuNovedad(ultimo)).toEqual(V1);

    fireEvent.click(screen.getByRole("switch", { name: /con maridaje/i }));
    fireEvent.click(screen.getByRole("switch", { name: /con maridaje/i }));
    fireEvent.click(radioTipo(/^Cata/));
    fireEvent.click(radioTipo(/^Menú/));
    expect(screen.getByTestId("avisos-tipo-menu")).toBeEmptyDOMElement();
    expect(serializarMenuNovedad(ultimo)).toEqual(V1);
  });
});
