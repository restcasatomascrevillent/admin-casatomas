/**
 * Tests del timeline de estados de reserva (`TimelineEstadosReserva`, pestaña "Lista").
 *
 * QUÉ SE FIJA
 * ----------------------------------------------------------------------------
 * · Los SEIS estados del CHECK `reservas_estado_check`, en orden: cuatro pasos
 *   del camino y dos salidas. Si alguien añade o quita un estado en la base de
 *   datos y aquí no, este test lo dice.
 * · Los nombres son los de los badges de la lista y del kanban («Llegó», «No
 *   vino»), no los de la base de datos («completada», «no_show»).
 * · Sin desplegable (15/10/2026): siempre a la vista, sin botón de plegar.
 * · 04/10/2026: ya no se monta en la pestaña Hoy (el dueño lo quitó por ruido visual; lo
 *   vigila VistaHoy.test.tsx). Vive en la pestaña Lista, como filtro por estado.
 * · Nodos pulsables (`onElegirEstado` + `estadoActivo`): solo si quien monta el
 *   timeline los pide. Son botones de alternancia (`aria-pressed`); sin el
 *   callback el timeline sigue siendo una leyenda, sin botones.
 *
 * Y lo que pidió el dueño el 2026-10-06 («achatar más lo de "Cómo avanza una reserva": no pongas los
 * totales, los números no tienen sentido»):
 * · UNA fila fina: sin cabecera de dos líneas y sin la frase debajo de cada estado.
 * · SIN cifras: ni pastilla ni número junto a ningún estado; el botón se llama como el estado.
 * · La frase de cada estado no se pierde: va en el tooltip (`title`) y en `aria-description`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

import { TimelineEstadosReserva } from "@/components/reservas/TimelineEstadosReserva";
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";

// ─── Lo que se espera ────────────────────────────────────────────────────────

/** Valores de `reservas_estado_check`, en el orden del timeline. */
const ESTADOS = ["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"];
/** Nombre visible de cada uno: el de los badges de la lista y del kanban. */
const NOMBRES = ["Pendiente", "Verificada", "Confirmada", "Llegó", "Cancelada", "No vino"];
/** La frase de cada estado, con su «cuándo» delante en las dos salidas (la del mapa único). */
const FRASES = [
  "Solicitada por web o teléfono. Toca verificarla.",
  "Revisada: el cliente recibe «Confirma tu reserva».",
  "Confirma el cliente (o tú con «Confirmar»).",
  "Ya está en el local. Se marca con «Ha llegado».",
  "Antes de que llegue: la cancelas tú o el cliente.",
  "Si no se presenta: lo marcas tú o el sistema.",
];
const CLAVE_ABIERTO = "reservas:timeline-estados:abierto";

const nodos = () => screen.getAllByRole("listitem");
/** El botón de cada nodo, o `null` si el nodo no lo tiene. */
const botones = () => nodos().map((li) => within(li).queryByRole("button"));
const pulsados = () => botones().map((b) => b?.getAttribute("aria-pressed") ?? null);
/** El texto que se VE en un nodo (sin lo que solo oye el lector de pantalla). */
const textoVisible = (el: HTMLElement) => {
  const copia = el.cloneNode(true) as HTMLElement;
  copia.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return copia.textContent?.replace(/\s+/g, " ").trim();
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("TimelineEstadosReserva — los estados y su orden", () => {
  it("pinta los seis estados del CHECK en orden, con el nombre de los badges", () => {
    render(<TimelineEstadosReserva />);

    const items = nodos();
    expect(items).toHaveLength(6);
    expect(items.map((li) => li.getAttribute("data-estado"))).toEqual(ESTADOS);
    items.forEach((li, i) => {
      expect(within(li).getByText(NOMBRES[i])).toBeInTheDocument();
    });
  });

  it("el camino son cuatro pasos numerados y las dos salidas van aparte, tras una raya discontinua", () => {
    render(<TimelineEstadosReserva />);

    const items = nodos();
    items.slice(0, 4).forEach((li, i) => {
      expect(li).toHaveTextContent(`Paso ${i + 1} de 4`);
    });
    items.slice(4).forEach((li) => {
      expect(li).toHaveTextContent("Salida");
      expect(li).not.toHaveTextContent(/Paso \d de 4/);
    });
    // La primera salida lleva la raya que la separa del camino; ninguna otra.
    expect(items.map((li) => li.classList.contains("border-dashed"))).toEqual([false, false, false, false, true, false]);
  });

  it("no depende solo del color: cada nodo lleva su icono (oculto a lectores) y su nombre escrito", () => {
    render(<TimelineEstadosReserva />);

    for (const li of nodos()) {
      expect(li.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    }
  });

  it("es una región con nombre y la lista lleva el mismo nombre", () => {
    render(<TimelineEstadosReserva />);

    expect(screen.getByRole("region", { name: /Cómo avanza una reserva/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /Cómo avanza una reserva/ })).toBeInTheDocument();
  });
});

// 2026-10-06: «no pongas los totales» y «achatar más». Se comprueba con los nodos pulsables, que es como lo
// monta la Lista.
describe("TimelineEstadosReserva — una fila fina, sin cifras", () => {
  it("NO pinta ninguna cifra: cada estado enseña solo su nombre y su botón se llama exactamente así", () => {
    const { container } = render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    expect(container.querySelectorAll("[data-cifra]")).toHaveLength(0);
    nodos().forEach((li, i) => {
      expect(textoVisible(li), ESTADOS[i]).toBe(NOMBRES[i]);
      expect(within(li).getByRole("button")).toHaveAccessibleName(NOMBRES[i]);
    });
    // Ni rótulo de alcance («cifras de la lista», «cifras de hoy»).
    expect(container).not.toHaveTextContent(/cifras/);
  });

  it("es UNA fila: el rótulo y los estados, uno al lado del otro, sin frases debajo", () => {
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    const region = screen.getByRole("region", { name: /Cómo avanza una reserva/ });
    expect(region).toHaveClass("flex", "items-center");
    expect(region).not.toHaveClass("flex-col");
    // El rótulo y la lista de estados son hijos de la misma fila.
    expect(region.querySelector("h3")?.parentElement).toBe(region);
    expect(screen.getByRole("list").closest("section")).toBe(region);
    expect(screen.getByRole("list")).toHaveClass("flex", "items-center");
    // Nada de párrafos: ni la cabecera de dos líneas ni la frase de cada estado.
    expect(region.querySelectorAll("p")).toHaveLength(0);
    for (const frase of FRASES) expect(screen.queryByText(frase)).toBeNull();
  });

  it("la frase de cada estado va en `aria-description` (lector de pantalla) y en el tooltip, delante de lo que hace pulsarlo", () => {
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    botones().forEach((b, i) => {
      expect(b, ESTADOS[i]).toHaveAttribute("aria-description", FRASES[i]);
      expect(b?.getAttribute("title"), ESTADOS[i]).toBe(`${FRASES[i]}\nVer solo las reservas «${NOMBRES[i]}»`);
    });
  });

  it("las frases son las del mapa único (`ESTADOS_RESERVA`): su «cuándo» delante en las dos salidas", () => {
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    botones().forEach((b, i) => {
      const { cuando, descripcion } = ESTADOS_RESERVA[ESTADOS[i] as EstadoReserva];
      expect(b?.getAttribute("aria-description")).toBe([cuando, descripcion].filter(Boolean).join(" "));
    });
  });

  it("como leyenda (sin filtro) la frase va en el tooltip del nombre y en texto para el lector de pantalla", () => {
    render(<TimelineEstadosReserva />);

    nodos().forEach((li, i) => {
      expect(within(li).getByTitle(FRASES[i])).toHaveTextContent(NOMBRES[i]);
      expect(li.querySelector(".sr-only:last-child")?.textContent).toBe(`: ${FRASES[i]}`);
      expect(textoVisible(li)).toBe(NOMBRES[i]);
    });
  });

  it("la fila mide 36 px (44 con dedo)", () => {
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    // Desplegada: burbuja de 24 px + 6 px de hueco arriba y abajo = 36 (con dedo, el botón de 44 px sin hueco).
    const fila = screen.getByRole("list").parentElement!;
    expect(fila).toHaveClass("py-1.5", "pointer-coarse:py-0");
    expect(nodos()[0].querySelector('[aria-hidden="true"]')).toHaveClass("h-6");
    expect(botones()[0]).toHaveClass("pointer-coarse:min-h-11");
  });
});

describe("TimelineEstadosReserva — sin desplegable (15/10/2026)", () => {
  it("siempre a la vista: no hay botón de plegar, aunque quede guardado «plegado» de antes", () => {
    window.localStorage.setItem(CLAVE_ABIERTO, "0");
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Cómo avanza una reserva/ })).toBeNull();
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
    expect(screen.getByRole("list", { name: /Cómo avanza una reserva/ })).toBeInTheDocument();
    expect(botones()).toHaveLength(6);
  });

  it("el rótulo se ve desde `xl` y, por debajo, solo lo oye el lector de pantalla", () => {
    render(<TimelineEstadosReserva />);
    const rotulo = screen.getByRole("heading", { name: "Cómo avanza una reserva" });
    expect(rotulo).toHaveClass("sr-only", "xl:not-sr-only");
  });
});

describe("TimelineEstadosReserva — nodos pulsables (el filtro por estado de la Lista)", () => {
  it("sin `onElegirEstado` los nodos son una leyenda: ni un botón", () => {
    // Aunque llegue un estado activo, sin callback no hay nada que pulsar ni que marcar.
    render(<TimelineEstadosReserva estadoActivo="pendiente" />);

    expect(botones()).toEqual([null, null, null, null, null, null]);
    expect(document.querySelector("[aria-pressed]")).toBeNull();
    // El nodo en sí no lleva `title`: el tooltip va en el nombre.
    for (const li of nodos()) expect(li).not.toHaveAttribute("title");
  });

  it("con `onElegirEstado` cada estado es un botón de alternancia (`aria-pressed`), ninguno pulsado de entrada", () => {
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    // `type="button"`: nunca envía un formulario si algún día se monta dentro de uno.
    for (const b of botones()) {
      expect(b?.tagName).toBe("BUTTON");
      expect(b).toHaveAttribute("type", "button");
    }
    expect(pulsados()).toEqual(["false", "false", "false", "false", "false", "false"]);
  });

  it("`estadoActivo` marca como pulsado SOLO ese estado", () => {
    render(<TimelineEstadosReserva estadoActivo="completada" onElegirEstado={vi.fn()} />);

    expect(pulsados()).toEqual(["false", "false", "false", "true", "false", "false"]);
  });

  it("un valor del filtro que no es uno de los seis («all», «solicitudes»…) no deja ninguno pulsado", () => {
    for (const valor of ["all", "solicitudes", "solicitudes_cerradas", "por_atender", "", null, undefined]) {
      const { unmount } = render(<TimelineEstadosReserva estadoActivo={valor} onElegirEstado={vi.fn()} />);
      expect(pulsados(), String(valor)).toEqual(["false", "false", "false", "false", "false", "false"]);
      unmount();
    }
  });

  it("pulsar un estado avisa con su CLAVE de la base de datos (completada, no «Llegó»)", () => {
    const alElegir = vi.fn();
    render(<TimelineEstadosReserva onElegirEstado={alElegir} />);

    botones().forEach((b) => fireEvent.click(b!));

    expect(alElegir.mock.calls.map(([estado]) => estado)).toEqual(ESTADOS);
  });

  it("no decide nada por su cuenta: el estado pulsado lo manda quien lo monta (`estadoActivo`)", () => {
    const alElegir = vi.fn();
    const { rerender } = render(<TimelineEstadosReserva onElegirEstado={alElegir} />);

    fireEvent.click(botones()[0]!);
    // Sin que quien lo monta cambie `estadoActivo`, sigue sin haber nada pulsado.
    expect(pulsados()).toEqual(["false", "false", "false", "false", "false", "false"]);

    rerender(<TimelineEstadosReserva estadoActivo="pendiente" onElegirEstado={alElegir} />);
    expect(pulsados()).toEqual(["true", "false", "false", "false", "false", "false"]);
  });

  it("el botón se nombra solo con el estado y se enfoca con el teclado como cualquier botón", () => {
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    const llego = screen.getByRole("button", { name: "Llegó" });
    expect(screen.getByRole("button", { name: "No vino" })).toBeInTheDocument();
    llego.focus();
    expect(llego).toHaveFocus();
    expect(llego).not.toHaveAttribute("tabindex", "-1");
  });

  it("el tooltip dice, tras la frase, qué hace pulsarlo, según esté pulsado o no", () => {
    render(<TimelineEstadosReserva estadoActivo="no_show" onElegirEstado={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Pendiente" })).toHaveAttribute(
      "title",
      `${FRASES[0]}\nVer solo las reservas «Pendiente»`,
    );
    expect(screen.getByRole("button", { name: "No vino" })).toHaveAttribute(
      "title",
      `${FRASES[5]}\nQuitar el filtro «No vino»`,
    );
  });

  it("el paso del camino lo sigue leyendo el lector de pantalla, delante del botón", () => {
    render(<TimelineEstadosReserva onElegirEstado={vi.fn()} />);

    const items = nodos();
    expect(items[0]).toHaveTextContent("Paso 1 de 4");
    expect(items[4]).toHaveTextContent("Salida");
    // El paso queda FUERA del botón: el nombre del botón es el estado, no «Paso 1 de 4: Pendiente…».
    expect(within(items[0]).getByRole("button").textContent).not.toMatch(/Paso/);
  });
});
