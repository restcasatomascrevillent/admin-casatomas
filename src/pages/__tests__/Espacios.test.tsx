/**
 * Super Admin › Espacios (src/pages/Espacios.tsx): solo las salas de Casa Tomás.
 *
 * Touza no admite reservas (decisión del dueño 2026-10-01). Sus tres salas siguen en la base de datos
 * (y activas: El Reservado, Terraza e Interior), así que `useEspaciosReserva` las devuelve; la página las
 * deja fuera con `salaAdmiteReservas`, que decide por la marca de la sala y nunca por el nombre (hay dos
 * «Terraza»). Esta página y su enlace `?editar=<id>` son lo único que abre el formulario de espacio, así que
 * también son la barrera para que una sala de Touza no se edite (ni se pase a Casa Tomás) desde aquí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  espacios: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({ data: h.espacios, isLoading: false }),
  useEliminarEspacio: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useMesas", () => ({ useMesas: () => ({ data: [], refetch: vi.fn() }) }));
// El formulario y el editor de plano se prueban aparte: aquí solo importa QUÉ sala les llega.
vi.mock("@/components/reservas/EspacioForm", () => ({ EspacioForm: () => null }));
vi.mock("@/components/espacios/EditorPlanoEspacio", () => ({
  EditorPlanoEspacio: ({ espacioId, espacioNombre }: { espacioId: string; espacioNombre: string }) => (
    <div data-testid="editor-plano">{`${espacioId}|${espacioNombre}`}</div>
  ),
}));

import Espacios from "@/pages/Espacios";

const sala = (id: string, nombre: string, capacidad: number, caracteristicas: unknown, activa = true) => ({
  id,
  nombre,
  descripcion: null,
  capacidad_maxima: capacidad,
  activa,
  caracteristicas,
});

/** Las salas de producción (2026-10-01) y una de Casa Tomás desactivada. */
const SALAS_BD = [
  sala("ct-comedor", "Comedor", 50, {}),
  sala("ct-salon", "Salón", 50, null),
  sala("ct-terraza", "Terraza", 50, { marca: "casa_tomas" }),
  sala("ct-reservado", "Reservado", 20, { marca: "casa_tomas", privada: true }),
  sala("ct-bodega", "Bodega", 40, { marca: "casa_tomas" }, false),
  sala("tz-reservado", "El Reservado", 20, { privada: true, marca: "touza" }),
  sala("tz-terraza", "Terraza", 30, { marca: "touza" }),
  sala("tz-interior", "Interior", 30, { marca: "touza" }),
];

function montar(ruta = "/super-admin/espacios") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Espacios />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.espacios = SALAS_BD;
});

describe("Espacios · solo las salas de Casa Tomás", () => {
  it("no pinta las salas de Touza (ni la otra «Terraza») y el aforo es el de Casa Tomás", () => {
    montar();

    for (const nombre of ["Comedor", "Salón", "Reservado", "Bodega"]) {
      expect(screen.getByText(nombre), nombre).toBeInTheDocument();
    }
    // Una sola «Terraza»: la de Casa Tomás. Las de Touza no salen.
    expect(screen.getAllByText("Terraza")).toHaveLength(1);
    expect(screen.queryByText("El Reservado")).not.toBeInTheDocument();
    expect(screen.queryByText("Interior")).not.toBeInTheDocument();
    // 50 + 50 + 50 de las activas de Casa Tomás SIN el Reservado (privado: fuera de aforo, decisión del dueño
    // del 2026-10-03). No 250 con las de Touza, ni 170 con el Reservado, ni 190 con la desactivada.
    expect(screen.getByText(/Aforo por turno/).textContent).toMatch(/Aforo por turno:\s*150\s*plazas/);
    expect(screen.getByText(/Aforo por turno/).textContent).toMatch(/sin las salas privadas/);
  });

  it("el enlace `?editar=` no abre el plano de una sala de Touza (ni aunque se llame igual que una de Casa Tomás)", () => {
    montar("/super-admin/espacios?editar=tz-terraza");

    expect(screen.queryByTestId("editor-plano")).not.toBeInTheDocument();
    // Se queda en la lista, como con un id que no existe.
    expect(screen.getByRole("button", { name: /nuevo espacio/i })).toBeInTheDocument();
  });

  it("el enlace `?editar=` sí abre el plano de una sala de Casa Tomás", () => {
    montar("/super-admin/espacios?editar=ct-terraza");

    expect(screen.getByTestId("editor-plano")).toHaveTextContent("ct-terraza|Terraza");
  });
});

describe("Espacios · lista plana con menú «⋯»", () => {
  it("cada sala es una fila con su menú «⋯» (nombre accesible y tamaño de dedo ≥ 44 px) y estado con punto", () => {
    montar();
    expect(screen.getByRole("list", { name: "Salas" })).toBeInTheDocument();
    for (const nombre of ["Comedor", "Salón", "Terraza", "Reservado", "Bodega"]) {
      const menu = screen.getByRole("button", { name: `Más acciones de ${nombre}` });
      expect(menu.className, nombre).toMatch(/pointer-coarse:h-11/);
      expect(menu.className, nombre).toMatch(/pointer-coarse:w-11/);
    }
    expect(screen.getAllByText("Activo")).toHaveLength(4);
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nuevo Espacio/ }).className).toMatch(/(^| )h-11( |$)/);
  });

  it("el menú ofrece Configurar plano y mesas, Editar espacio y Eliminar; «Configurar» abre el editor", async () => {
    montar();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Más acciones de Comedor" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Editar espacio" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Configurar plano y mesas" }));
    expect(await screen.findByTestId("editor-plano")).toHaveTextContent("ct-comedor|Comedor");
  });
});
