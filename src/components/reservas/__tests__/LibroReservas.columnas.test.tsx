/**
 * «Nueva reserva» (LibroReservas), 10/11/2026, peticiones del dueño:
 *   · «quizá dos columnas para que se vea bien en estos dispositivos en horizontal»: en ancho (≥ 1024 px o
 *     tablet en horizontal con ≥ 900 px) la hoja del día a la izquierda y «Apuntar nueva» a la derecha; en
 *     estrecho, apilado.
 *   · «se abra en el día en el pop up»: con `fechaInicial`, el libro y el formulario arrancan en ese día.
 *   · «con el táctil se pueda pasar arrastrando»: SOLO en la lista de la hoja, nunca en el lienzo de escribir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forwardRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { pasarHoja, tituloHoja } from "@/lib/reservas/libroReservas";

const h = vi.hoisted(() => ({ formulario: vi.fn() }));

vi.mock("@/hooks/useReservasServicioDia", () => ({
  CLAVE_RESERVAS_SERVICIO_DIA: "reservas-servicio-dia",
  useReservasServicioDia: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useBorradoresManuscritos", () => ({
  useBorradoresPendientes: () => ({ data: [] }),
  useGuardarBorrador: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolverBorrador: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useGastoLecturaManuscrita", () => ({ useGastoLecturaManuscrita: () => ({ data: null }) }));
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: { datosPreseleccionados?: { fecha?: Date } }) => {
    h.formulario(props);
    return <div data-testid="formulario" />;
  },
}));
vi.mock("@/components/reservas/libro/LienzoManuscrito", () => ({
  LienzoManuscrito: forwardRef(function Lienzo(_p, _ref) {
    return <div data-testid="lienzo" style={{ touchAction: "none" }} />;
  }),
}));

import { LibroReservas } from "@/components/reservas/libro/LibroReservas";

const FECHA = "2026-11-20";
const fechaVisible = () => screen.getByText(/^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d/);

function montar(props: Parameters<typeof LibroReservas>[0] = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <LibroReservas {...props} />
    </QueryClientProvider>,
  );
}

function arrastrar(el: HTMLElement, desdeX: number, hastaX: number) {
  const base = { pointerId: 1, pointerType: "touch", clientY: 200 };
  fireEvent.pointerDown(el, { ...base, clientX: desdeX });
  fireEvent.pointerMove(el, { ...base, clientX: (desdeX + hastaX) / 2 });
  fireEvent.pointerUp(el, { ...base, clientX: hastaX });
}

/** `matchMedia` de mentira: `ancho` = lo que responde la consulta de dos columnas. */
function pantalla(ancho: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: ancho,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const original = window.matchMedia;
beforeEach(() => {
  h.formulario.mockClear();
  try {
    localStorage.setItem("reservas.modoAlta", "lapiz");
  } catch {
    /* sin almacenamiento */
  }
});
afterEach(() => {
  window.matchMedia = original;
});

describe("LibroReservas · dos columnas en horizontal, una en vertical", () => {
  it("en ancho: hoja del día a la izquierda (40 %) y «Apuntar nueva» a la derecha, cada una con su scroll", () => {
    pantalla(true);
    montar();
    const hoja = screen.getByTestId("lista-hoja-libro");
    const cuerpo = hoja.parentElement!;
    expect(cuerpo).toHaveAttribute("data-columnas", "2");
    expect(cuerpo).toHaveClass("flex-row");
    expect(hoja).toHaveClass("w-2/5", "overflow-y-auto");
    expect(screen.getByTestId("columna-apuntar")).toHaveClass("flex-1");
  });

  it("en ancho, el formulario va en una columna con su propio scroll", () => {
    pantalla(true);
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Formulario/ }));
    const caja = screen.getByTestId("formulario").parentElement!.parentElement!;
    expect(caja).toHaveClass("formulario-una-columna", "overflow-y-auto", "flex-1");
    // Sin relleno inferior: con él, por debajo del «Crear Reserva» fijo asomaban los campos.
    expect(caja).toHaveClass("pb-0");
    expect(caja).not.toHaveClass("pb-6");
  });

  it("en ancho, el renglón del lápiz ocupa el alto de la columna (mínimo 280 px) con los botones abajo", () => {
    pantalla(true);
    montar();
    expect(screen.getByTestId("zona-lapiz")).toHaveClass("flex", "flex-col", "flex-1");
    const caja = screen.getByTestId("caja-lienzo");
    expect(caja).toHaveClass("flex-1", "min-h-[280px]");
    expect(caja).not.toHaveClass("h-[clamp(11rem,32dvh,20rem)]");
    // Los botones, después del renglón.
    expect(caja.nextElementSibling!.textContent).toMatch(/Borrar.*Deshacer.*Guardar sin interpretar.*Interpretar/);
  });

  it("apilado, el renglón del lápiz conserva su alto de siempre", () => {
    pantalla(false);
    montar();
    expect(screen.getByTestId("caja-lienzo")).toHaveClass("h-[clamp(11rem,32dvh,20rem)]");
  });

  it("en estrecho (o sin matchMedia): apilado como antes", () => {
    pantalla(false);
    montar();
    const cuerpo = screen.getByTestId("lista-hoja-libro").parentElement!;
    expect(cuerpo).toHaveAttribute("data-columnas", "1");
    expect(cuerpo).toHaveClass("flex-col");
  });

  it("los avisos se apartan de «Crear Reserva» mientras el diálogo está abierto (marca para el CSS)", () => {
    montar();
    expect(document.querySelector("[data-dialogo-nueva-reserva]")).not.toBeNull();
  });
});

describe("LibroReservas · solo apuntar (desde «Añadir reserva a este día»)", () => {
  it("sin la hoja del día: la columna de apuntar a todo el ancho, aunque la pantalla sea ancha", () => {
    pantalla(true);
    montar({ fechaInicial: FECHA, soloApuntar: true });
    expect(screen.getByTestId("lista-hoja-libro")).toHaveClass("hidden");
    expect(screen.getByTestId("columna-apuntar")).toHaveClass("flex-1");
    expect(screen.getByTestId("lista-hoja-libro").parentElement).toHaveAttribute("data-columnas", "1");
    // El lienzo, a todo el alto; el día sigue a la vista y se puede cambiar.
    expect(screen.getByTestId("caja-lienzo")).toHaveClass("flex-1", "min-h-[280px]");
    expect(fechaVisible()).toHaveTextContent(tituloHoja(FECHA));
    fireEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(fechaVisible()).toHaveTextContent(tituloHoja(pasarHoja(FECHA, 1)));
  });

  it("el formulario centrado en una columna cómoda (máx. 48rem)", () => {
    montar({ fechaInicial: FECHA, soloApuntar: true });
    fireEvent.click(screen.getByRole("button", { name: /Formulario/ }));
    const centro = screen.getByTestId("formulario").parentElement!;
    expect(centro).toHaveClass("mx-auto", "max-w-3xl");
    expect(centro.parentElement).toHaveClass("formulario-una-columna", "flex-1");
  });

  it("avisa del día de la hoja (para el título del diálogo)", () => {
    const onCambioFecha = vi.fn();
    montar({ fechaInicial: FECHA, soloApuntar: true, onCambioFecha });
    expect(onCambioFecha).toHaveBeenLastCalledWith(FECHA);
    fireEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(onCambioFecha).toHaveBeenLastCalledWith(pasarHoja(FECHA, 1));
  });
});

describe("LibroReservas · abrir en un día y pasar hojas arrastrando", () => {
  it("con `fechaInicial` abre en esa hoja y el formulario trae ese día", () => {
    montar({ fechaInicial: FECHA });
    expect(fechaVisible()).toHaveTextContent(tituloHoja(FECHA));
    fireEvent.click(screen.getByRole("button", { name: /Formulario/ }));
    const props = h.formulario.mock.calls.at(-1)![0] as { datosPreseleccionados: { fecha: Date } };
    expect(props.datosPreseleccionados.fecha.getDate()).toBe(20);
  });

  it("arrastrar en la LISTA de la hoja pasa de día", () => {
    montar({ fechaInicial: FECHA });
    arrastrar(screen.getByTestId("lista-hoja-libro"), 400, 250);
    expect(fechaVisible()).toHaveTextContent(tituloHoja(pasarHoja(FECHA, 1)));
    expect(screen.getByTestId("lista-hoja-libro")).toHaveClass("touch-pan-y", "overflow-x-hidden");
  });

  it("arrastrar en el LIENZO de escribir NO pasa de día", () => {
    montar({ fechaInicial: FECHA });
    arrastrar(screen.getByTestId("lienzo"), 400, 100);
    expect(fechaVisible()).toHaveTextContent(tituloHoja(FECHA));
  });
});
