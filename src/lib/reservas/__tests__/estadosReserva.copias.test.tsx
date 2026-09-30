/**
 * El mapa único (`estadosReserva.ts`) frente a las copias que hoy siguen vivas.
 *
 * Mientras cada pantalla tenga su propia copia de los estados, este fichero
 * comprueba que el mapa es un SUPERCONJUNTO de ellas: dice lo mismo que lo que
 * pintan de verdad (se renderiza el timeline y se importan las opciones del
 * filtro y las variantes del `Badge`), no lo que este test recuerda de ellas. Así
 * el paso de migración de cada consumidor es un cambio de fuente de datos y no de
 * aspecto; y si una copia se toca sin tocar el mapa, salta aquí.
 *
 * Las otras dos copias —`getStatusBadge` de la lista y `ESTADOS_RESERVA` del
 * kanban— son locales a su componente y no se pueden importar; sus diferencias
 * con el mapa están en la cabecera de `estadosReserva.ts`.
 *
 * Cuando una copia desaparezca (paso 1), el bloque que la comprueba se borra con
 * ella.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, within } from "@testing-library/react";
import { TimelineEstadosReserva } from "@/components/reservas/TimelineEstadosReserva";
import { badgeVariants } from "@/components/ui/badge";
import { OPCIONES_FILTRO_ESTADO } from "../vistaUnificada";
import { ESTADOS_RESERVA, ORDEN_ESTADOS, esEstadoReserva, type EstadoReserva } from "../estadosReserva";

/** Las clases `lucide-…` de un icono: identifican QUÉ icono es, sin depender de su tamaño. */
const clasesLucide = (el: Element | null | undefined) =>
  (el?.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((c) => c.startsWith("lucide-"))
    .sort();

const normalizar = (texto: string | null | undefined) => (texto ?? "").replace(/\s+/g, " ").trim();

function iconoRenderizado(estado: EstadoReserva) {
  const { Icono } = ESTADOS_RESERVA[estado];
  const { container, unmount } = render(<Icono />);
  const clases = clasesLucide(container.querySelector("svg"));
  unmount();
  return clases;
}

describe("contra TimelineEstadosReserva (copia viva: nombre, frase, burbuja e icono)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const montar = () => {
    const { container } = render(<TimelineEstadosReserva />);
    return [...container.querySelectorAll<HTMLElement>("li[data-estado]")];
  };

  it("pinta los mismos estados, en el mismo orden que ORDEN_ESTADOS", () => {
    expect(montar().map((li) => li.getAttribute("data-estado"))).toEqual([...ORDEN_ESTADOS]);
  });

  it("cada nodo lleva el nombre del mapa", () => {
    for (const li of montar()) {
      const estado = li.getAttribute("data-estado") as EstadoReserva;
      expect(within(li).getByText(ESTADOS_RESERVA[estado].etiqueta), estado).toBeInTheDocument();
    }
  });

  it("cada nodo lleva la frase del mapa, precedida de su «cuando» en las dos salidas", () => {
    for (const li of montar()) {
      const estado = li.getAttribute("data-estado") as EstadoReserva;
      const { cuando, descripcion } = ESTADOS_RESERVA[estado];
      expect(normalizar(li.querySelector("p")?.textContent), estado).toBe(normalizar([cuando, descripcion].filter(Boolean).join(" ")));
    }
  });

  it("la burbuja lleva las clases de color del mapa", () => {
    for (const li of montar()) {
      const estado = li.getAttribute("data-estado") as EstadoReserva;
      const burbuja = li.querySelector('span[aria-hidden="true"]')!;
      for (const clase of ESTADOS_RESERVA[estado].burbuja.split(/\s+/)) {
        expect(burbuja.classList.contains(clase), `${estado}: ${clase}`).toBe(true);
      }
    }
  });

  it("la burbuja lleva el mismo icono que el mapa", () => {
    for (const li of montar()) {
      const estado = li.getAttribute("data-estado") as EstadoReserva;
      const icono = clasesLucide(li.querySelector('span[aria-hidden="true"] svg'));
      expect(icono.length, `${estado}: sin icono`).toBeGreaterThan(0);
      expect(icono, estado).toEqual(iconoRenderizado(estado));
    }
  });
});

describe("contra las variantes del Badge (la lista pinta cancelada y No vino con `variant`, no con clases)", () => {
  it("cancelada = variant=destructive", () => {
    const variante = badgeVariants({ variant: "destructive" }).split(/\s+/);
    for (const clase of ESTADOS_RESERVA.cancelada.insignia.split(/\s+/)) expect(variante, clase).toContain(clase);
  });

  it("No vino = variant=secondary", () => {
    const variante = badgeVariants({ variant: "secondary" }).split(/\s+/);
    for (const clase of ESTADOS_RESERVA.no_show.insignia.split(/\s+/)) expect(variante, clase).toContain(clase);
  });
});

describe("contra OPCIONES_FILTRO_ESTADO (copia viva: el filtro «Estado» de la lista)", () => {
  const opcionesDeReserva = OPCIONES_FILTRO_ESTADO.filter((o) => esEstadoReserva(o.value));

  it("tiene una opción por cada uno de los seis estados", () => {
    expect(opcionesDeReserva.map((o) => o.value).sort()).toEqual([...ORDEN_ESTADOS].sort());
  });

  it("el texto de cada opción es `etiquetaFiltro` del mapa", () => {
    for (const { value, label } of opcionesDeReserva) {
      expect(label, value).toBe(ESTADOS_RESERVA[value as EstadoReserva].etiquetaFiltro);
    }
  });

  it("las cuatro coinciden con `etiqueta` y las dos que no son «Llegó / completada» y «No se presentó»", () => {
    const distintas = opcionesDeReserva
      .filter(({ value, label }) => label !== ESTADOS_RESERVA[value as EstadoReserva].etiqueta)
      .map(({ value, label }) => [value, label]);

    expect(distintas).toEqual([
      ["completada", "Llegó / completada"],
      ["no_show", "No se presentó"],
    ]);
  });

  it("el filtro usa otro orden que el ciclo de vida: No vino va antes que Cancelada", () => {
    expect(opcionesDeReserva.map((o) => o.value)).toEqual([
      "pendiente",
      "verificada",
      "confirmada",
      "completada",
      "no_show",
      "cancelada",
    ]);
    expect([...ORDEN_ESTADOS].slice(-2)).toEqual(["cancelada", "no_show"]);
  });
});
