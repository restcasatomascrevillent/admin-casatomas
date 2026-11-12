/**
 * La Lista vista como el libro (10/11/2026, petición del dueño: «hacer o simular como el libro, que tenga
 * hojas que vas pasando»): una hoja por día que se pasa con las flechas, deslizando el dedo o con «Hoy», y
 * tocar una reserva abre su editor (el mismo que la tabla).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { claveDia, pasarHoja, tituloHoja } from "@/lib/reservas/libroReservas";

const h = vi.hoisted(() => ({
  pedidas: [] as string[],
  porDia: {} as Record<string, unknown[]>,
  editada: vi.fn(),
  buscadas: [] as string[],
  encontradas: [] as unknown[],
  porEstado: {} as Record<string, unknown[]>,
  aceptar: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/hooks/useBusquedaReservas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useBusquedaReservas")>();
  return {
    ...real,
    useBuscarReservas: (texto: string) => {
      h.buscadas.push(texto);
      return { data: h.encontradas, isLoading: false, isError: false, refetch: vi.fn(), escribiendo: false, limite: 100, termino: texto };
    },
    useReservasPorEstado: (estado: string | null) => ({
      data: estado ? h.porEstado[estado] ?? [] : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
  };
});

vi.mock("@/hooks/useReservasServicioDia", () => ({
  CLAVE_RESERVAS_SERVICIO_DIA: "reservas-servicio-dia",
  useReservasServicioDia: (fecha: string) => {
    h.pedidas.push(fecha);
    return { data: h.porDia[fecha] ?? [], isLoading: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({ useAccionesServicioReserva: () => ({ aceptar: h.aceptar, estaEnCurso: () => false }) }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({ data: [{ id: "s1", nombre: "Salón" }] }),
}));
vi.mock("@/components/reservas/EditarReservaDialog", () => ({
  EditarReservaDialog: ({ reservaId }: { reservaId: string }) => {
    h.editada(reservaId);
    return <div data-testid="editor-reserva">{reservaId}</div>;
  },
}));

import { ListaComoLibro } from "@/components/reservas/libro/ListaComoLibro";
import { ReservasDeLaHoja } from "@/components/reservas/libro/ReservasDeLaHoja";

const hoy = claveDia(new Date());
/** Arrastra con el dedo (o lo que se diga) de `desdeX` a `hastaX`, bajando `dy` px. */
function arrastrar(el: HTMLElement, desdeX: number, hastaX: number, dy = 0, pointerType = "touch") {
  const base = { pointerId: 1, pointerType, clientY: 200 };
  fireEvent.pointerDown(el, { ...base, clientX: desdeX });
  fireEvent.pointerMove(el, { ...base, clientX: (desdeX + hastaX) / 2, clientY: 200 + dy / 2 });
  fireEvent.pointerUp(el, { ...base, clientX: hastaX, clientY: 200 + dy });
}
const titulo = () => screen.getByRole("button", { name: "Elegir día" });
const hojas = () => screen.getAllByRole("article");

beforeEach(() => {
  h.pedidas = [];
  h.porDia = {};
  h.editada.mockClear();
  h.buscadas = [];
  h.encontradas = [];
  h.porEstado = {};
});

describe("ListaComoLibro · pasar hojas", () => {
  it("abre en la hoja de hoy (una sola hoja en tablet)", () => {
    render(<ListaComoLibro />);
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
    expect(hojas()).toHaveLength(1);
    expect(hojas()[0]).toHaveAccessibleName(`Hoja del ${tituloHoja(hoy)}`);
    expect(screen.getByRole("button", { name: "Hoy" })).toBeDisabled();
  });

  it("las flechas pasan a la hoja siguiente y a la anterior, y «Hoy» vuelve", () => {
    render(<ListaComoLibro />);
    fireEvent.click(screen.getByRole("button", { name: "Hoja siguiente" }));
    expect(titulo()).toHaveTextContent(tituloHoja(pasarHoja(hoy, 1)));
    expect(screen.getByTestId("libro-lista").querySelector("[data-sentido]")).toHaveAttribute("data-sentido", "siguiente");
    expect(h.pedidas).toContain(pasarHoja(hoy, 1));

    fireEvent.click(screen.getByRole("button", { name: "Hoja anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Hoja anterior" }));
    expect(titulo()).toHaveTextContent(tituloHoja(pasarHoja(hoy, -1)));
    expect(screen.getByTestId("libro-lista").querySelector("[data-sentido]")).toHaveAttribute("data-sentido", "anterior");

    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
  });

  it("arrastrar el dedo a la izquierda pasa a la hoja siguiente; a la derecha, a la anterior (eventos de puntero)", () => {
    render(<ListaComoLibro />);
    const libro = screen.getByTestId("libro-lista");
    arrastrar(libro, 400, 250, 10);
    expect(titulo()).toHaveTextContent(tituloHoja(pasarHoja(hoy, 1)));
    arrastrar(libro, 100, 300);
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
  });

  it("mientras se arrastra, la hoja sigue al dedo un poco y vuelve al soltar", () => {
    render(<ListaComoLibro />);
    const libro = screen.getByTestId("libro-lista");
    const hoja = screen.getByTestId("hoja-que-sigue-al-dedo");
    fireEvent.pointerDown(libro, { pointerId: 1, pointerType: "touch", clientX: 400, clientY: 200 });
    fireEvent.pointerMove(libro, { pointerId: 1, pointerType: "touch", clientX: 300, clientY: 200 });
    expect(hoja.style.transform).toBe("translateX(-40px)");
    fireEvent.pointerUp(libro, { pointerId: 1, pointerType: "touch", clientX: 300, clientY: 200 });
    expect(hoja.style.transform).toBe("");
  });

  it("un gesto corto, vertical (bajar por la hoja), cancelado o con ratón no pasa hoja", () => {
    render(<ListaComoLibro />);
    const libro = screen.getByTestId("libro-lista");
    arrastrar(libro, 300, 270);
    arrastrar(libro, 300, 220, 300);
    fireEvent.pointerDown(libro, { pointerId: 7, pointerType: "touch", clientX: 300, clientY: 100 });
    fireEvent.pointerCancel(libro, { pointerId: 7, pointerType: "touch" });
    fireEvent.pointerUp(libro, { pointerId: 7, pointerType: "touch", clientX: 100, clientY: 100 });
    arrastrar(libro, 400, 200, 0, "mouse");
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
  });

  it("la hoja y su contenedor con scroll dejan el gesto lateral a la página (touch-pan-y, sin scroll horizontal)", () => {
    render(<ListaComoLibro />);
    expect(screen.getByTestId("libro-lista")).toHaveClass("touch-pan-y");
    expect(screen.getByTestId("hoja-scroll")).toHaveClass("touch-pan-y", "overflow-x-hidden");
  });
});

describe("ListaComoLibro · añadir y arrastrar sin abrir (10/11/2026)", () => {
  it("«Añadir reserva a este día» (en la barra, 11/11/2026) pasa la fecha de la HOJA que se ve", () => {
    const onAnadirReserva = vi.fn();
    render(<ListaComoLibro onAnadirReserva={onAnadirReserva} />);
    fireEvent.click(screen.getByRole("button", { name: "Hoja siguiente" }));
    const boton = screen.getByRole("button", { name: "Añadir reserva a este día" });
    expect(boton).toHaveClass("bg-sky-100", "text-sky-900", "h-11");
    fireEvent.click(boton);
    expect(onAnadirReserva).toHaveBeenCalledWith(pasarHoja(hoy, 1));
  });

  it("sin permiso de crear (sin `onAnadirReserva`) no sale el botón", () => {
    render(<ListaComoLibro />);
    expect(screen.queryByRole("button", { name: "Añadir reserva a este día" })).toBeNull();
  });

  it("arrastrar empezando sobre una reserva pasa la hoja y NO abre la reserva; un toque sí la abre", () => {
    h.porDia[hoy] = [{ id: "r1", nombre: "Esther", hora: "14:15:00", numero_comensales: 2, estado: "confirmada", espacio_id: "s1" }];
    render(<ListaComoLibro />);
    const renglon = screen.getByRole("button", { name: /Abrir la reserva de Esther/ });
    arrastrar(renglon, 400, 250);
    // El navegador puede mandar un clic al soltar: no debe abrir nada.
    fireEvent.click(renglon);
    expect(h.editada).not.toHaveBeenCalled();
    expect(titulo()).toHaveTextContent(tituloHoja(pasarHoja(hoy, 1)));

    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: /Abrir la reserva de Esther/ }), { pointerId: 2, pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: /Abrir la reserva de Esther/ }));
    expect(h.editada).toHaveBeenCalledWith("r1");
  });

  it("al llegar una reserva recién creada, el libro va a su día y la resalta", () => {
    const dia = pasarHoja(hoy, 3);
    h.porDia[dia] = [{ id: "nueva", nombre: "Recién Creada", hora: "21:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: null }];
    const { rerender } = render(<ListaComoLibro resaltar={null} />);
    rerender(<ListaComoLibro resaltar={{ id: "nueva", fecha: dia }} />);
    expect(titulo()).toHaveTextContent(tituloHoja(dia));
    expect(screen.getByText("Recién Creada").closest("li")).toHaveClass("bg-amber-100");
  });
});

describe("ListaComoLibro · las reservas de la hoja", () => {
  it("enseña Comida y Cena y, al tocar una reserva, abre su editor", () => {
    h.porDia[hoy] = [
      { id: "r1", nombre: "Esther", hora: "14:15:00", numero_comensales: 2, estado: "confirmada", espacio_id: "s1" },
      { id: "r2", nombre: "Paco", hora: "21:00:00", numero_comensales: 4, estado: "pendiente", espacio_id: null },
    ];
    render(<ListaComoLibro />);
    const hoja = hojas()[0];
    expect(within(hoja).getByRole("region", { name: "Comida" })).toHaveTextContent("Esther");
    expect(within(hoja).getByRole("region", { name: "Cena" })).toHaveTextContent("Paco");
    expect(within(hoja).getByText("Salón")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-reserva")).not.toBeInTheDocument();

    fireEvent.click(within(hoja).getByRole("button", { name: /Abrir la reserva de Esther/ }));
    expect(screen.getByTestId("editor-reserva")).toHaveTextContent("r1");
    expect(h.editada).toHaveBeenCalledWith("r1");
  });

  it("hoja sin reservas: «Aún no hay reservas este día»", () => {
    render(<ListaComoLibro />);
    expect(within(hojas()[0]).getByText(/Aún no hay reservas este día/)).toBeInTheDocument();
  });
});

describe("ReservasDeLaHoja · la comida de martes a jueves en bloques", () => {
  const dia = (fecha: string) => {
    h.porDia[fecha] = [
      { id: "m1", nombre: "Menú Uno", hora: "14:00:00", numero_comensales: 2, estado: "confirmada", espacio_id: null, menu_del_dia: true },
      { id: "c1", nombre: "Carta Uno", hora: "13:30:00", numero_comensales: 4, estado: "confirmada", espacio_id: null, menu_del_dia: false },
      { id: "m2", nombre: "Menú Dos", hora: "13:15:00", numero_comensales: 3, estado: "pendiente", espacio_id: null, menu_del_dia: true },
      { id: "x1", nombre: "Antigua", hora: "14:30:00", numero_comensales: 5, estado: "confirmada", espacio_id: null, menu_del_dia: null },
      { id: "n1", nombre: "Cena Una", hora: "21:00:00", numero_comensales: 2, estado: "confirmada", espacio_id: null, menu_del_dia: null },
    ];
  };

  it("martes: «Menú del día», «Carta» y «Resto», cada uno por hora y con su total; la cena como siempre", () => {
    dia("2026-11-10");
    render(<ReservasDeLaHoja fecha="2026-11-10" />);
    const comida = screen.getByRole("region", { name: "Comida" });
    const bloques = within(comida).getAllByRole("region");
    expect(bloques.map((b) => b.getAttribute("aria-label"))).toEqual(["Menú del día", "Carta", "Resto"]);
    expect(within(bloques[0]).getByRole("heading")).toHaveTextContent("Menú del día · 2 reservas · 5 pax");
    expect(within(bloques[1]).getByRole("heading")).toHaveTextContent("Carta · 1 reserva · 4 pax");
    expect(within(bloques[2]).getByRole("heading")).toHaveTextContent("Resto · 1 reserva · 5 pax");
    // Por hora dentro del bloque: 13:15 antes que 14:00.
    expect(within(bloques[0]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Menú Dos"),
      expect.stringContaining("Menú Uno"),
    ]);
    const cena = screen.getByRole("region", { name: "Cena" });
    expect(within(cena).queryAllByRole("region")).toHaveLength(0);
    expect(cena).toHaveTextContent("Cena Una");
  });

  it("un viernes la comida va como siempre, sin bloques", () => {
    dia("2026-11-13");
    render(<ReservasDeLaHoja fecha="2026-11-13" />);
    expect(within(screen.getByRole("region", { name: "Comida" })).queryAllByRole("region")).toHaveLength(0);
  });
});

describe("ListaComoLibro · libro abierto en pantallas anchas", () => {
  it("aunque la pantalla sea ancha, una sola hoja (para que se lean los nombres)", () => {
    const antes = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    try {
      render(<ListaComoLibro />);
      expect(hojas().map((a) => a.getAttribute("aria-label"))).toEqual([`Hoja del ${tituloHoja(hoy)}`]);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: antes });
    }
  });
});

// 11/11/2026 (dueño: «que haya un buscador que busque en todo el histórico… quita el botón Por atender y pon
// Pendientes»): con texto o con «Pendientes» se ven los resultados en lugar de la hoja.
const reserva = (id: string, fecha: string, nombre: string, estado = "pendiente") => ({
  id,
  fecha,
  hora: "21:00:00",
  nombre,
  telefono: "612345678",
  email: null,
  numero_comensales: 4,
  estado,
  espacio_id: "s1",
  notas_cliente: null,
});

describe("ListaComoLibro · buscador y «Pendientes»", () => {
  it("al escribir 2 letras busca en todo el histórico, agrupa por día y abre la reserva al tocarla", () => {
    h.encontradas = [reserva("r1", "2026-12-01", "Lucía Pérez", "confirmada"), reserva("r2", "2025-03-14", "Lucía Gómez", "completada")];
    render(<ListaComoLibro />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en todas las reservas" }), { target: { value: "lu" } });
    expect(h.buscadas.at(-1)).toBe("lu");
    expect(screen.getByRole("heading", { name: "Resultados de «lu»" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: tituloHoja("2025-03-14") })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /^Hoja del/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Abrir la reserva de Lucía Gómez/ }));
    expect(h.editada).toHaveBeenCalledWith("r2");
  });

  it("«Ver el día» vuelve a la hoja de ese día y borra la búsqueda", () => {
    h.encontradas = [reserva("r2", "2025-03-14", "Lucía Gómez", "completada")];
    render(<ListaComoLibro />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lucía" } });
    fireEvent.click(screen.getByRole("button", { name: /Ver el día/ }));
    expect(titulo()).toHaveTextContent(tituloHoja("2025-03-14"));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("buscando no sale «Añadir reserva a este día» (no hay hoja a la vista)", () => {
    render(<ListaComoLibro onAnadirReserva={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zz" } });
    expect(screen.queryByRole("button", { name: "Añadir reserva a este día" })).toBeNull();
  });

  it("sin resultados lo dice", () => {
    render(<ListaComoLibro />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zz" } });
    expect(screen.getByText("No hay ninguna reserva con ese nombre, teléfono o email.")).toBeInTheDocument();
  });

  it("«Pendientes» cuenta las pendientes, las enseña al pulsarlo y vuelve a la hoja al quitarlo", () => {
    h.porEstado.pendiente = [reserva("p1", hoy, "Ana"), reserva("p2", pasarHoja(hoy, 2), "Berta")];
    render(<ListaComoLibro />);
    const boton = screen.getByRole("button", { name: /Pendientes/ });
    expect(boton).toHaveTextContent("2");
    expect(boton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(boton);
    expect(boton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: /Pendientes de verificar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir la reserva de Berta/ })).toBeInTheDocument();
    // «Verificar» en cada fila (12/11/2026): verifica sin abrir la ficha.
    fireEvent.click(screen.getByRole("button", { name: "Verificar la reserva de Berta" }));
    expect(h.aceptar).toHaveBeenCalledWith(expect.objectContaining({ id: "p2", estado: "pendiente" }));
    fireEvent.click(boton);
    expect(hojas()[0]).toHaveAccessibleName(`Hoja del ${tituloHoja(hoy)}`);
  });

  it("con un estado de un aviso («cancelada») abre esas reservas", () => {
    h.porEstado.cancelada = [reserva("c1", hoy, "Carlos", "cancelada")];
    render(<ListaComoLibro estadoInicial="cancelada" />);
    expect(screen.getByRole("heading", { name: /Canceladas/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir la reserva de Carlos/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Verificar/ })).toBeNull();
  });
});
