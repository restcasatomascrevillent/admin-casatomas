/**
 * Gestor Web › Carta con solo «Ver» (decisión del dueño, 06/11/2026): se consulta (lista, buscador,
 * filtros y tarjetas en lectura) y se descarga el «PDF Carta»; todo lo demás se OCULTA (no se
 * desactiva) y arriba sale la etiqueta común «Solo lectura». Con «Editar», o siendo super admin,
 * todo sigue como siempre.
 *
 * Se usan el `UserRoleProvider` y el `useCanAccessSection` REALES (solo se simulan Supabase, la
 * sesión y el «¿es super admin?»), con las listas reales de la carta: así se prueba la regla de
 * verdad y que las tarjetas no enseñan ni un botón que escriba.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Medidor } from "@/lib/carta-pdf/maquetacion";

const h = vi.hoisted(() => ({
  permisos: [] as Array<{ section_key: string; can_view: boolean; can_edit: boolean }>,
  superAdmin: false,
  mutaciones: [] as string[],
}));

const mutacion = (nombre: string) => ({
  mutate: vi.fn(() => h.mutaciones.push(nombre)),
  mutateAsync: vi.fn(async () => h.mutaciones.push(nombre)),
  isPending: false,
});

// Puntuaciones Parker con fuente (08/11/2026): la lista las lee con react-query; aquí, ninguna.
vi.mock("@/components/carta/parker/usePuntuacionesParker", () => ({
  usePuntuacionesParker: () => ({
    filas: [], isLoading: false, porVino: () => [],
    guardar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    confirmar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    borrar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => ({
      select: () => ({
        eq: () => {
          const resultado = tabla === "user_roles" ? { data: { role: "staff" }, error: null } : { data: h.permisos, error: null };
          return {
            single: async () => resultado,
            then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko),
          };
        },
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u-1", email: "sala@casatomas.test" }, loading: false }) }));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false }) }));

const PLATOS = [
  { id: "p1", nombre: "Croquetas", categoria: "ENTRANTES", precio_eur: 9, activado: true, expanded: false, imagen_url: null, orden: 1, alergenos_oficiales: [] },
  { id: "p2", nombre: "Pulpo", categoria: "ENTRANTES", precio_eur: 18, activado: false, expanded: false, imagen_url: null, orden: 2, alergenos_oficiales: [] },
];
const VINOS = [
  { id: "v1", nombre: "Albariño", categoria: "VINOS BLANCOS — RÍAS BAIXAS", precio_eur: 24, activado: true, restaurante: true, touza: false, expanded: false, imagen_url: null, orden: 1, alergenos_oficiales: [], ubicacion_pais: "España", ubicacion_region: "Cambados, Pontevedra" },
];
vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({
    platos: PLATOS, isLoading: false, categorias: ["ENTRANTES"], guardarOrden: mutacion("ordenarPlatos"),
    toggleExpanded: mutacion("expandir"), toggleActivado: mutacion("activar"), eliminarPlato: mutacion("eliminar"), actualizarPlato: mutacion("actualizar"),
  }),
}));
vi.mock("@/hooks/useVinos", () => ({
  useVinos: () => ({
    vinos: VINOS, isLoading: false, categorias: ["VINOS BLANCOS — RÍAS BAIXAS"], guardarOrden: mutacion("ordenarVinos"),
    eliminarVino: mutacion("eliminar"), toggleExpanded: mutacion("expandir"), toggleRestaurante: mutacion("restaurante"),
    toggleTouza: mutacion("touza"), actualizarVino: mutacion("actualizar"),
  }),
}));
vi.mock("@/hooks/useBebidas", () => ({
  useBebidas: () => ({
    bebidas: [{ id: "b1", nombre: "Agua", categoria: "AGUAS", precio_eur: 2, activado: true, restaurante: true, touza: true, imagen_url: null }],
    isLoading: false, categorias: ["AGUAS"], guardarOrden: mutacion("ordenarBebidas"),
    eliminarBebida: mutacion("eliminar"), actualizarBebida: mutacion("actualizar"), toggleActivado: mutacion("activar"),
    toggleRestaurante: mutacion("restaurante"), toggleTouza: mutacion("touza"),
  }),
}));
vi.mock("@/hooks/useCocteles", () => ({
  useCocteles: () => ({ cocteles: [], isLoading: false, categorias: [], guardarOrden: mutacion("ordenarCocteles") }),
}));
vi.mock("@/hooks/useEncuestaVinos", async (original) => ({
  ...(await original<typeof import("@/hooks/useEncuestaVinos")>()),
  useEncuestaVinos: () => ({
    activa: true, disponible: true, cargando: false, error: false,
    cambiarActiva: mutacion("votacion"), vaciar: mutacion("vaciar"),
    votos: { isLoading: false, isError: false, data: [] },
  }),
}));
// Los vídeos pendientes leen trabajos_video (con solo «Ver» la RLS no da nada): aquí, ninguno.
vi.mock("@/components/carta/potente/useVideosPendientesCarta", () => ({ useVideosPendientesCarta: () => new Set() }));
// Los formularios (alta, ajuste de precios) solo deben montarse con «Editar»: se marcan.
vi.mock("@/components/carta/PlatoForm", () => ({ PlatoForm: () => <div data-testid="form-plato" /> }));
vi.mock("@/components/carta/BebidaForm", () => ({ BebidaForm: () => <div data-testid="form-bebida" /> }));
vi.mock("@/components/carta/VinoForm", () => ({ VinoForm: () => <div data-testid="form-vino" /> }));
vi.mock("@/components/carta/CoctelForm", () => ({ CoctelForm: () => <div data-testid="form-coctel" /> }));
vi.mock("@/components/carta/AjustePreciosModal", () => ({ AjustePreciosModal: () => <div data-testid="form-precios" /> }));
// El PDF: el motor real pesa; se simula como en BotonCartaImprimir.test.tsx.
const medidor: Medidor = { ancho: (texto, _f, tamano) => texto.length * tamano * 0.5, limpiar: (t) => t };
vi.mock("@/lib/carta-pdf/navegador", () => ({ cargarMotorCarta: async () => ({ medidor, recursos: {} }), descargarPdf: vi.fn() }));
vi.mock("@/lib/carta-pdf/pdf", () => ({ crearPdfCarta: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }));

import { UserRoleProvider } from "@/hooks/useUserRole";
import TabCarta from "../tabs/TabCarta";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  h.permisos = [];
  h.superAdmin = false;
  h.mutaciones = [];
});

const SOLO_VER = [{ section_key: "gestor_carta", can_view: true, can_edit: false }];
const EDITAR = [{ section_key: "gestor_carta", can_view: true, can_edit: true }];

async function montar() {
  render(
    <UserRoleProvider>
      <TabCarta />
    </UserRoleProvider>,
  );
  // Las tarjetas ya están (el permiso se ha resuelto).
  await screen.findByRole("heading", { name: "Croquetas" });
  await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument());
}
function irA(seccion: RegExp) {
  const tab = screen.getByRole("tab", { name: seccion });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}
/** Botones que escriben o gastan IA en la barra y en las tarjetas. */
const ESCRITURA = [
  /^Añadir (plato|bebida|vino|cóctel)$/, /Ajustar precios/, /Varias botellas/, /^Ordenar$/, /^Editar\b/, /^Eliminar\b/, /^Foto$/,
  /foto a|la foto de/i, /Ajustar posición/, /^Resultados$/,
];
const botonesDeEscritura = () =>
  screen.queryAllByRole("button").filter((b) => {
    const nombre = b.getAttribute("aria-label") ?? b.getAttribute("title") ?? b.textContent ?? "";
    return ESCRITURA.some((r) => r.test(nombre)) || ESCRITURA.some((r) => r.test(b.textContent ?? ""));
  });

describe("Gestor Web › Carta · solo «Ver»", () => {
  it("etiqueta «Solo lectura», sin botones que escriban ni interruptores, y con el «PDF Carta»", async () => {
    h.permisos = SOLO_VER;
    await montar();

    expect(screen.getByTestId("etiqueta-solo-lectura")).toHaveTextContent("Solo lectura");
    expect(screen.getByRole("button", { name: "PDF Carta" })).toBeInTheDocument();
    expect(botonesDeEscritura()).toEqual([]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^form-/)).toEqual([]);

    // Las tarjetas se leen: precio, y la publicación en texto en vez del interruptor.
    const croquetas = screen.getByRole("heading", { name: "Croquetas" }).closest(".rounded-lg") as HTMLElement;
    expect(within(croquetas).getByTestId("estado-lectura")).toHaveTextContent("Activo (se publica en la web)");
    const pulpo = screen.getByRole("heading", { name: "Pulpo" }).closest(".rounded-lg") as HTMLElement;
    expect(within(pulpo).getByTestId("estado-lectura")).toHaveTextContent("Despublicado (no sale en la web)");
  });

  it("buscador y filtros siguen funcionando", async () => {
    h.permisos = SOLO_VER;
    await montar();
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: "pulpo" } });
    expect(screen.queryByRole("heading", { name: "Croquetas" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pulpo" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filtrar visibilidad" })).toBeInTheDocument();
  });

  it("Vinos: «PDF Carta» sí; «Añadir vino», «Varias botellas» y los interruptores de carta, no; la votación solo se lee", async () => {
    h.permisos = SOLO_VER;
    await montar();
    irA(/Vinos/);
    await screen.findByRole("heading", { name: "Albariño" });
    expect(screen.getByRole("button", { name: "PDF Carta" })).toBeInTheDocument();
    expect(botonesDeEscritura()).toEqual([]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByTestId("estado-lectura")).toHaveTextContent("Sale solo en la carta de la web de Casa Tomás.");
    expect(screen.getByTestId("estado-votacion")).toHaveTextContent("Abierta en la web");
    expect(screen.queryByRole("button", { name: "Resultados" })).not.toBeInTheDocument();
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
  });

  it("Bebidas: sin «PDF Carta» (no lo hay) queda solo la etiqueta; la tarjeta dice en qué carta sale", async () => {
    h.permisos = SOLO_VER;
    await montar();
    irA(/Bebidas/);
    await screen.findByRole("heading", { name: "Agua" });
    expect(screen.queryByRole("button", { name: "PDF Carta" })).not.toBeInTheDocument();
    expect(botonesDeEscritura()).toEqual([]);
    expect(screen.getByTestId("estado-lectura")).toHaveTextContent("Casa Tomás: sí · Touza: sí");
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
  });

  it("el «PDF Carta» se abre y se puede descargar con solo «Ver»", async () => {
    h.permisos = SOLO_VER;
    await montar();
    fireEvent.click(screen.getByRole("button", { name: "PDF Carta" }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByRole("button", { name: "Descargar PDF" })).toBeInTheDocument();
    expect(h.mutaciones).toEqual([]);
  });
});

describe.each([
  ["«Editar» en la carta", () => { h.permisos = EDITAR; }],
  ["super admin (sin filas de permisos)", () => { h.superAdmin = true; }],
])("Gestor Web › Carta · %s", (_caso, preparar) => {
  it("sin etiqueta y con todo: añadir, ajustar precios, PDF, interruptores y botones de cada tarjeta", async () => {
    preparar();
    await montar();
    expect(screen.queryByTestId("etiqueta-solo-lectura")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Añadir plato/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustar precios" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF Carta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Ordenar$/ })).toBeInTheDocument();
    expect(screen.getByTitle("Editar Croquetas")).toBeInTheDocument();
    expect(screen.getByTitle("Eliminar Croquetas")).toBeInTheDocument();
    expect(screen.getByTitle("Añadir una foto a Croquetas")).toBeInTheDocument();
    // El mismo filtro que en solo «Ver» sí encuentra los botones aquí (no es un filtro que nunca casa).
    expect(botonesDeEscritura().length).toBeGreaterThanOrEqual(8);
    expect(screen.getAllByRole("switch").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("estado-lectura")).not.toBeInTheDocument();
    expect(screen.getByTestId("form-plato")).toBeInTheDocument();
    expect(screen.getByTestId("form-precios")).toBeInTheDocument();

    irA(/Vinos/);
    await screen.findByRole("heading", { name: "Albariño" });
    expect(screen.getByRole("button", { name: /Añadir vino/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Varias botellas/ })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Vota tu vino favorito/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resultados" })).toBeInTheDocument();
  });
});
