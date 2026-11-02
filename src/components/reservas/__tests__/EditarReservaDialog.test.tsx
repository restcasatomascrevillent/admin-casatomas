/**
 * EditarReservaDialog: el diálogo que abre CUALQUIER vista para editar una
 * reserva con solo su id (Lista, Hoy/Kanban, Asignación…). Carga la fila
 * completa (la vista que lo abre puede tener solo unas columnas), comprueba el
 * permiso de la sección «reservas» y monta `FormularioReserva` en modo edición.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { useState } from "react";

const mocks = vi.hoisted(() => ({
  canEdit: true,
  permisosCargando: false,
  reserva: null as Record<string, unknown> | null,
  errorReserva: null as unknown,
  mesas: [] as unknown[],
  errorMesas: null as unknown,
  consultas: [] as Array<{ tabla: string; columnas?: string; filtros: Array<[string, unknown]> }>,
  formulario: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const consulta: { tabla: string; columnas?: string; filtros: Array<[string, unknown]> } = { tabla, filtros: [] };
      mocks.consultas.push(consulta);
      const b: Record<string, unknown> = {};
      b.select = (columnas: string) => {
        consulta.columnas = columnas;
        return b;
      };
      b.eq = (columna: string, valor: unknown) => {
        consulta.filtros.push([columna, valor]);
        return b;
      };
      b.maybeSingle = () =>
        Promise.resolve(
          mocks.errorReserva ? { data: null, error: mocks.errorReserva } : { data: mocks.reserva, error: null },
        );
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(
          mocks.errorMesas ? { data: null, error: mocks.errorMesas } : { data: mocks.mesas, error: null },
        ).then(ok, ko);
      return b;
    },
  },
}));

vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: mocks.canEdit, loading: mocks.permisosCargando }),
}));

// El formulario se prueba aparte (FormularioReserva.edicion.test.tsx): aquí solo
// interesa qué props recibe, que su `onSuccess` cierra el diálogo y qué hace el
// diálogo cuando el formulario le dice si hay cambios sin guardar.
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: { onSuccess?: () => void; onCambiosSinGuardar?: (hay: boolean) => void }) => {
    mocks.formulario(props);
    return (
      <div>
        <button type="button" onClick={() => props.onSuccess?.()}>
          simular guardado
        </button>
        <button type="button" onClick={() => props.onCambiosSinGuardar?.(true)}>
          simular cambios sin guardar
        </button>
        <button type="button" onClick={() => props.onCambiosSinGuardar?.(false)}>
          simular sin cambios
        </button>
      </div>
    );
  },
}));

import { EditarReservaDialog } from "@/components/reservas/EditarReservaDialog";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";

const fila = (over: Record<string, unknown> = {}) => ({
  id: "res-1",
  nombre: "Ana López",
  telefono: "+34612345678",
  email: null,
  fecha: "2026-10-10",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  notas_cliente: null,
  espacio_id: null,
  marca: "casa_tomas",
  canal: "telefono",
  importante: false,
  en_blacklist: false,
  ...over,
});

function montar(props: Partial<Parameters<typeof EditarReservaDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <EditarReservaDialog reservaId="res-1" onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canEdit = true;
  mocks.permisosCargando = false;
  mocks.reserva = fila();
  mocks.errorReserva = null;
  mocks.mesas = [];
  mocks.errorMesas = null;
  mocks.consultas = [];
});

describe("EditarReservaDialog · carga y formulario", () => {
  it("pide la fila COMPLETA por id y monta el formulario en modo edición", async () => {
    montar();

    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
    const consulta = mocks.consultas.find((c) => c.tabla === "reservas")!;
    expect(consulta.columnas).toBe("*");
    expect(consulta.filtros).toContainEqual(["id", "res-1"]);
    const props = mocks.formulario.mock.calls.at(-1)![0] as { reservaAEditar: Record<string, unknown> };
    expect(props.reservaAEditar).toMatchObject({ id: "res-1", nombre: "Ana López", estado: "confirmada" });
  });

  it("la cabecera dice qué reserva es, su estado y su canal, y que el estado no se cambia aquí", async () => {
    montar();

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText("Editar reserva")).toBeInTheDocument();
    await waitFor(() => expect(dialogo.textContent).toContain("Ana López"));
    expect(dialogo.textContent).toContain("10 de octubre 2026");
    expect(dialogo.textContent).toContain("21:00");
    expect(dialogo.textContent).toMatch(/Estado: Confirmada/);
    expect(dialogo.textContent).toMatch(/Canal: Teléfono/);
  });

  it.each([
    ["pendiente", /Estado: Pendiente/],
    ["verificada", /Estado: Verificada/],
    ["confirmada", /Estado: Confirmada/],
    ["cancelada", /Estado: Cancelada/],
    ["completada", /Estado: Llegó/],
    ["no_show", /Estado: No vino/],
  ])("una reserva «%s» se abre igual: no hay estado que la deje sin editor", async (estado, texto) => {
    mocks.reserva = fila({ estado });
    montar();

    const dialogo = await screen.findByRole("dialog");
    await waitFor(() => expect(dialogo.textContent).toMatch(texto));
    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
  });

  it("una reserva de hace un año (fecha pasada) y de canal web se abre igual", async () => {
    mocks.reserva = fila({ fecha: "2025-01-15", canal: "web", estado: "no_show" });
    montar();

    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
    const dialogo = screen.getByRole("dialog");
    expect(dialogo.textContent).toContain("15 de enero 2025");
    expect(dialogo.textContent).toMatch(/Canal: Web/);
  });

  it("una reserva con datos nulos (sin nombre, sin hora legible) no rompe la cabecera", async () => {
    mocks.reserva = fila({ nombre: null, telefono: null, email: null, canal: null });
    montar();

    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
    expect(screen.getByRole("dialog").textContent).toContain("Sin nombre");
  });

  it("pasa al formulario los nombres de las mesas que ya tiene, ordenadas", async () => {
    mocks.mesas = [{ id: "a1", mesas: { nombre: "Mesa 10" } }, { id: "a2", mesas: { nombre: "Mesa 2" } }, { id: "a3", mesas: null }];
    montar();

    await waitFor(() => {
      const props = mocks.formulario.mock.calls.at(-1)?.[0] as { mesasAsignadas?: string[] } | undefined;
      expect(props?.mesasAsignadas).toEqual(["Mesa 2", "Mesa 10"]);
    });
    const consultaMesas = mocks.consultas.find((c) => c.tabla === "asignaciones_mesa")!;
    expect(consultaMesas.filtros).toContainEqual(["reserva_id", "res-1"]);
  });

  it("si falla la consulta de mesas, el formulario se abre igual (sin aviso de mesas)", async () => {
    mocks.errorMesas = { message: "permission denied for table asignaciones_mesa" };
    montar();

    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
    await waitFor(() => {
      const props = mocks.formulario.mock.calls.at(-1)![0] as { mesasAsignadas?: string[] };
      expect(props.mesasAsignadas ?? []).toEqual([]);
    });
  });

  it("la fila no se vuelve a pedir en segundo plano mientras el diálogo está abierto (el «original» no cambia bajo los pies del formulario)", async () => {
    montar();
    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
    const pedidas = () => mocks.consultas.filter((c) => c.tabla === "reservas").length;
    expect(pedidas()).toBe(1);

    // Volver a la ventana: React Query refrescaría cualquier consulta «vieja». Si la
    // fila se refrescara, `FormularioReserva` compararía lo escrito contra datos
    // nuevos y un cambio ajeno podría acabar pisado con el valor antiguo del formulario.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(pedidas()).toBe(1);
  });

  it("al guardar (onSuccess del formulario) se cierra", async () => {
    const { onClose } = montar();

    fireEvent.click(await screen.findByRole("button", { name: "simular guardado" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EditarReservaDialog · cerrar con cambios sin guardar", () => {
  const escape = () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
  const conCambios = async () => {
    const vista = montar();
    fireEvent.click(await screen.findByRole("button", { name: "simular cambios sin guardar" }));
    return vista;
  };

  it("sin cambios, Esc cierra a la primera, como siempre", async () => {
    const { onClose } = montar();
    await screen.findByRole("button", { name: "simular guardado" });

    escape();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("con cambios sin guardar, Esc NO cierra: pregunta antes de tirar lo escrito", async () => {
    const { onClose } = await conCambios();

    escape();

    const aviso = await screen.findByRole("alertdialog");
    expect(within(aviso).getByText("¿Descartar los cambios?")).toBeInTheDocument();
    expect(aviso.textContent).toMatch(/no has guardado/i);
    expect(onClose).not.toHaveBeenCalled();
    // El editor sigue ahí, con lo escrito.
    expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
  });

  it("la X de la esquina pide lo mismo", async () => {
    const { onClose } = await conCambios();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar ventana" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("un clic fuera del editor pide lo mismo", async () => {
    const { onClose } = await conCambios();
    // Radix empieza a escuchar los clics de fuera un instante después de abrirse.
    await new Promise((resolve) => setTimeout(resolve, 20));

    fireEvent.pointerDown(document.body);

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("«Seguir editando» cierra solo la pregunta y deja el editor abierto", async () => {
    const { onClose } = await conCambios();
    escape();

    fireEvent.click(await screen.findByRole("button", { name: "Seguir editando" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "simular guardado" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("«Descartar cambios» cierra el editor", async () => {
    const { onClose } = await conCambios();
    escape();

    fireEvent.click(await screen.findByRole("button", { name: "Descartar cambios" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("con la pregunta abierta, Esc cierra SOLO la pregunta (el editor de debajo no se entera)", async () => {
    const { onClose } = await conCambios();
    escape();
    const aviso = await screen.findByRole("alertdialog");

    fireEvent.keyDown(aviso, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("si el formulario vuelve a decir «sin cambios» (se dejó como estaba), Esc vuelve a cerrar sin preguntar", async () => {
    const { onClose } = await conCambios();
    fireEvent.click(screen.getByRole("button", { name: "simular sin cambios" }));

    escape();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("al guardar NO pregunta aunque hubiera cambios: lo guardado ya no se pierde", async () => {
    const { onClose } = await conCambios();

    fireEvent.click(screen.getByRole("button", { name: "simular guardado" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("EditarReservaDialog · cuando algo no va", () => {
  it("mientras carga no hay formulario y se dice que está cargando", async () => {
    montar();

    expect(screen.getByRole("status")).toHaveTextContent(/cargando la reserva/i);
    expect(mocks.formulario).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
  });

  it("si la carga falla, enseña el error con «Reintentar» y reintenta", async () => {
    mocks.errorReserva = { message: "Failed to fetch" };
    montar();

    expect(await screen.findByText(/No se han podido cargar la reserva/)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
    expect(mocks.formulario).not.toHaveBeenCalled();

    mocks.errorReserva = null;
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
  });

  it("si la reserva ya no existe, lo dice y deja cerrar", async () => {
    mocks.reserva = null;
    const { onClose } = montar();

    expect(await screen.findByText(/ya no existe/i)).toBeInTheDocument();
    expect(mocks.formulario).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("sin permiso de edición sobre «reservas»: lo explica, no pide la reserva ni enseña el formulario", async () => {
    mocks.canEdit = false;
    const { onClose } = montar();

    expect(await screen.findByText(/no tiene permiso para editar reservas/i)).toBeInTheDocument();
    expect(mocks.formulario).not.toHaveBeenCalled();
    expect(mocks.consultas.some((c) => c.tabla === "reservas")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("mientras se comprueban los permisos no se enseña ni el formulario ni el «sin permiso»", () => {
    mocks.permisosCargando = true;
    mocks.canEdit = false;
    montar();

    expect(screen.queryByText(/no tiene permiso/i)).not.toBeInTheDocument();
    expect(mocks.formulario).not.toHaveBeenCalled();
  });
});

describe("useEdicionReserva · lo que usan las vistas para abrir el editor", () => {
  function Vista() {
    const { editarReserva, dialogoEdicion } = useEdicionReserva();
    const [, refrescar] = useState(0);
    return (
      <div>
        <button type="button" onClick={() => editarReserva("res-1")}>
          editar res-1
        </button>
        <button type="button" onClick={() => refrescar((n) => n + 1)}>
          repintar
        </button>
        {dialogoEdicion}
      </div>
    );
  }

  const montarVista = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <Vista />
      </QueryClientProvider>,
    );
  };

  it("no pinta nada hasta que se pide editar, y entonces abre el diálogo de esa reserva", async () => {
    montarVista();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.consultas).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "editar res-1" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mocks.formulario).toHaveBeenCalled());
  });

  it("al guardar se cierra y la vista queda como estaba", async () => {
    montarVista();
    fireEvent.click(screen.getByRole("button", { name: "editar res-1" }));

    fireEvent.click(await screen.findByRole("button", { name: "simular guardado" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("se puede volver a abrir después de cerrarlo", async () => {
    montarVista();
    fireEvent.click(screen.getByRole("button", { name: "editar res-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "simular guardado" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "editar res-1" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
