/**
 * `AccionesReserva` y sus piezas: los botones de una reserva en la Lista (tabla y
 * tarjeta de móvil), pintados a partir de `accionesDisponibles(…, { vista: "lista" })`.
 *
 * 10/11/2026 (petición del dueño: «hay que limpiarlo de botones para que quede claro lo que se tiene que
 * hacer, y los botones de acción y las cosas más grandes»): en vez de seis ranuras de icono con lo que no
 * aplica deshabilitado, UNA acción principal grande con texto (solo si hay algo que hacer: nunca un botón
 * deshabilitado de algo ya hecho) y «⋯ Más» con el resto, con texto y solo lo que se puede usar; las
 * destructivas al final y en rojo. Sin permiso de edición (06/11/2026) no sale nada.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  AccionesReserva,
  CasillaAceptarEnBloque,
  EstrellaImportante,
  RanurasDeAcciones,
  type AlPulsar,
  type ReservaDeLaLista,
} from "@/components/reservas/AccionesReserva";

const ESTADOS = ["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"] as const;
type Estado = (typeof ESTADOS)[number];

/** Con sala y fecha: «Dar mesa» solo depende del estado (y de que la pantalla lleve a un plano). */
const reserva = (estado: string, extra: Partial<ReservaDeLaLista> = {}): ReservaDeLaLista => ({
  id: `res-${estado}`,
  estado,
  nombre: "Ana",
  importante: false,
  fecha: "2026-10-05",
  hora: "21:30:00",
  espacio_id: "esp-comedor",
  ...extra,
});

/** Un manejador por botón, para saber cuál se ha pulsado. */
const manejadores = () =>
  ({
    aceptar: vi.fn(),
    confirmar: vi.fn(),
    verificar: vi.fn(),
    seleccionar: vi.fn(),
    editar: vi.fn(),
    cancelar: vi.fn(),
    listaNegra: vi.fn(),
  }) satisfies AlPulsar;

function montar(props: Partial<ComponentProps<typeof AccionesReserva>> & { reserva: ReservaDeLaLista }) {
  const al = manejadores();
  const onAsignarMesa = vi.fn();
  const { container } = render(
    <div data-testid="celda">
      <AccionesReserva variante="fila" canEdit al={al} onAsignarMesa={onAsignarMesa} nombreSala="Comedor" {...props} />
    </div>,
  );
  const celda = container.querySelector<HTMLElement>('[data-testid="celda"]')!;
  return { al, onAsignarMesa, celda };
}

/** La acción principal (en verde) de la celda, o null. */
const principal = (celda: HTMLElement) => celda.querySelector<HTMLButtonElement>("button[data-principal]");

/**
 * Los demás botones de la celda, en orden. Desde el 10/11/2026 («no pongas el Más, que se vean los botones») van
 * todos a la vista: el nombre se conserva para no reescribir cada prueba.
 */
function abrirMas(celda: HTMLElement) {
  return [...celda.querySelectorAll<HTMLButtonElement>("button:not([data-principal]):not([role=checkbox])")];
}
const textos = (items: HTMLElement[]) => items.map((i) => i.textContent?.trim());

// Con permiso, sala y fecha, y una pantalla que lleva al plano.
const CON_PERMISO: Record<Estado, { principal: string | null; mas: string[] }> = {
  // «Verificar» (antes «Aceptar», 10/11/2026) es la principal; «Más» ya no la repite.
  pendiente: { principal: "Verificar", mas: ["Dar mesa", "Editar", "Cancelar", "Lista negra"] },
  verificada: { principal: "Confirmar", mas: ["Dar mesa", "Editar", "Cancelar", "Lista negra"] },
  confirmada: { principal: null, mas: ["Dar mesa", "Editar", "Cancelar", "Lista negra"] },
  completada: { principal: null, mas: ["Dar mesa", "Editar", "Lista negra"] }, // «Llegó» no se cancela
  cancelada: { principal: null, mas: ["Editar", "Lista negra"] },
  no_show: { principal: null, mas: ["Dar mesa", "Editar", "Lista negra"] }, // «No vino» no se cancela
};

describe("AccionesReserva · la acción principal y los demás botones a la vista, por estado y permiso", () => {
  describe.each(["fila", "tarjeta"] as const)("variante %s", (variante) => {
    describe("canEdit=true", () => {
      it.each(ESTADOS)("%s", (estado) => {
        const { celda } = montar({ reserva: reserva(estado), canEdit: true, variante });
        const p = principal(celda);
        expect(p?.textContent?.trim() ?? null).toBe(CON_PERMISO[estado].principal);
        // Nunca un botón deshabilitado de algo ya hecho.
        for (const b of within(celda).queryAllByRole("button")) expect(b).not.toBeDisabled();
        expect(textos(abrirMas(celda))).toEqual(CON_PERMISO[estado].mas);
      });
    });

    describe("canEdit=false: nada", () => {
      it.each(ESTADOS)("%s", (estado) => {
        const { celda, al, onAsignarMesa } = montar({ reserva: reserva(estado), canEdit: false, variante });
        expect(celda.querySelectorAll("button")).toHaveLength(0);
        expect(celda.querySelector('[role="checkbox"]')).toBeNull();
        expect(celda.textContent).toBe("");
        expect(onAsignarMesa).not.toHaveBeenCalled();
        expect(Object.values(al).every((f) => f.mock.calls.length === 0)).toBe(true);
      });
    });
  });

  it("sin acción principal no queda hueco: solo los botones que se pueden usar (10/11/2026)", () => {
    const { celda } = montar({ reserva: reserva("confirmada") });
    expect(principal(celda)).toBeNull();
    expect(within(celda).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Dar mesa", "Editar", "Cancelar", "Lista negra"]);
  });
  it("grande y a la vista: 48 px de alto, texto a 16 px, separados con gap-3; la principal en verde; sin «Más»", () => {
    const { celda } = montar({ reserva: reserva("pendiente") });
    expect(within(celda).queryByRole("button", { name: /^Más/ })).toBeNull();
    for (const b of within(celda).getAllByRole("button").filter((x) => x.getAttribute("role") !== "checkbox")) {
      expect(b.className).toContain("h-12");
      expect(b.className).toContain("text-base");
    }
    expect(principal(celda)!.className).toContain("bg-emerald-600");
    expect(celda.querySelector('[data-testid="acciones-fila"]')!.className).toContain("gap-3");
    expect(celda.querySelector('[data-testid="acciones-fila"]')!.className).toContain("flex-wrap");
  });
  it("CAMBIO ACORDADO (2026-10-01): «Aceptar» acepta la reserva tal como está, no «como la pidió el cliente»", () => {
    const { celda } = montar({ reserva: reserva("pendiente") });
    expect(principal(celda)!.getAttribute("title")).toBe(
      "Verificar la reserva tal como está (hora y sala actuales); se avisa al cliente si tiene email",
    );
  });

  it("las destructivas van al final, separadas y en rojo contorneado; cada botón explica en su `title`", () => {
    const { celda } = montar({ reserva: reserva("confirmada") });
    const items = abrirMas(celda);
    expect(items.map((i) => /text-destructive/.test(i.className))).toEqual([false, false, true, true]);
    expect(celda.querySelector('[data-testid="acciones-destructivas"]')!.className).toContain("border-l-2");
    expect(items.map((i) => i.getAttribute("title"))).toEqual([
      "Abrir el plano en Comedor para darle mesa",
      "Gestionar: editar la reserva de Ana — datos, día, hora, comensales y sala",
      "Cancelar la reserva de Ana — pedirá confirmación",
      "Añadir a Ana a la lista negra",
    ]);
    const iconos = items.map((i) => i.querySelector("svg")?.getAttribute("class") ?? "");
    expect(iconos[0]).toMatch(/armchair/);
    expect(iconos[1]).toMatch(/square-pen/);
    expect(iconos[2]).toMatch(/circle-x|x-circle/);
    expect(iconos[3]).toMatch(/shield-ban/);
  });
});

describe("AccionesReserva · qué hace cada botón", () => {
  it("pendiente: la principal acepta y cada opción de «Más» llama a lo suyo", () => {
    const { al, onAsignarMesa, celda } = montar({ reserva: reserva("pendiente") });
    fireEvent.click(principal(celda)!);
    expect(al.aceptar).toHaveBeenCalledTimes(1);
    expect(al.confirmar).not.toHaveBeenCalled();

    for (const texto of ["Dar mesa", "Editar", "Cancelar", "Lista negra"]) {
      const item = abrirMas(celda).find((i) => i.textContent?.trim() === texto)!;
      fireEvent.click(item);
    }
    // Una sola «Verificar»: la de la fila (la de elegir hora va desde su diálogo).
    expect(al.verificar).not.toHaveBeenCalled();
    expect(al.editar).toHaveBeenCalledTimes(1);
    expect(al.cancelar).toHaveBeenCalledTimes(1);
    expect(al.listaNegra).toHaveBeenCalledTimes(1);
    // El destino del plano: SU sala, SU día, ella señalada y el turno de su hora (21:30 → cena).
    expect(onAsignarMesa).toHaveBeenCalledWith({
      espacioId: "esp-comedor",
      fecha: "2026-10-05",
      reservaId: "res-pendiente",
      turno: "cena",
    });
  });

  it("verificada: la principal es «Confirmar» y llama a confirmar (no a aceptar)", () => {
    const { al, celda } = montar({ reserva: reserva("verificada") });
    fireEvent.click(principal(celda)!);
    expect(al.confirmar).toHaveBeenCalledTimes(1);
    expect(al.aceptar).not.toHaveBeenCalled();
  });

  it("sin manejadores no hay principal ni opciones salvo «Dar mesa» (que lleva su propio salto)", () => {
    const { celda } = montar({ reserva: reserva("pendiente"), al: {} });
    expect(principal(celda)).toBeNull();
    expect(textos(abrirMas(celda))).toEqual(["Dar mesa"]);
  });

  it("CAMBIO ACORDADO: ningún texto dice «servida»", () => {
    const { celda } = montar({ reserva: reserva("completada") });
    abrirMas(celda);
    expect(celda.innerHTML).not.toMatch(/servida/i);
    expect(document.body.innerHTML).not.toMatch(/servida/i);
  });

  it("sin permiso ya no hay ningún «No tienes permiso…»: no hay botones (06/11/2026)", () => {
    for (const estado of ESTADOS) {
      const { celda } = montar({ reserva: reserva(estado), canEdit: false });
      expect(celda.innerHTML, estado).not.toMatch(/permiso/i);
      expect(within(celda).queryByRole("button"), estado).toBeNull();
      cleanup();
    }
  });
});

describe("AccionesReserva · mientras hay una petición en curso", () => {
  it("`ocupada` (esta reserva): la principal gira y no se pulsa; «Cancelar» gira y no se pulsa", () => {
    const { al, celda } = montar({ reserva: reserva("pendiente"), ocupada: true });
    const p = principal(celda)!;
    expect(p).toBeDisabled();
    expect(p.querySelector("svg")?.getAttribute("class")).toMatch(/animate-spin/);
    fireEvent.click(p);
    expect(al.aceptar).not.toHaveBeenCalled();
    const cancelar = abrirMas(celda).find((i) => /Cancelando/.test(i.textContent ?? ""))!;
    expect(cancelar).toBeDisabled();
    expect(cancelar.querySelector("svg")?.getAttribute("class")).toMatch(/animate-spin/);
    fireEvent.click(cancelar);
    expect(al.cancelar).not.toHaveBeenCalled();
  });

  it("`ocupada` en una fila sin nada que confirmar: no aparece ninguna principal", () => {
    const { celda } = montar({ reserva: reserva("cancelada"), ocupada: true });
    expect(principal(celda)).toBeNull();
  });

  it("`bloqueEnCurso` (aceptar en bloque): solo espera la principal", () => {
    const { celda } = montar({ reserva: reserva("verificada"), bloqueEnCurso: true });
    expect(principal(celda)).toBeDisabled();
    expect(principal(celda)!.querySelector("svg")?.getAttribute("class")).toMatch(/animate-spin/);
    expect(textos(abrirMas(celda))).toContain("Cancelar");
  });

  it("sin permiso no pinta nada aunque esté ocupada (no hay nada que pulsar)", () => {
    const { celda } = montar({ reserva: reserva("pendiente"), canEdit: false, bloqueEnCurso: true, ocupada: true });
    expect(celda.querySelector("svg")).toBeNull();
  });
});

describe("AccionesReserva · «Dar mesa»", () => {
  it("sin sala no sale (se asigna desde «Editar»)", () => {
    const { celda } = montar({ reserva: reserva("confirmada", { espacio_id: null }) });
    expect(textos(abrirMas(celda))).not.toContain("Dar mesa");
  });

  it("si la pantalla no lleva a ningún plano, no sale", () => {
    const { celda } = montar({ reserva: reserva("confirmada"), onAsignarMesa: undefined });
    expect(textos(abrirMas(celda))).not.toContain("Dar mesa");
  });

  it("sin nombre de sala, el texto no inventa ninguno", () => {
    const { celda } = montar({ reserva: reserva("confirmada"), nombreSala: null });
    const item = abrirMas(celda).find((i) => i.textContent?.trim() === "Dar mesa")!;
    expect(item.getAttribute("title")).toBe("Abrir el plano para darle mesa");
  });
});

describe("AccionesReserva · variantes", () => {
  it("`fila`: sin casilla (la casilla de «aceptar en bloque» va en su propia columna de la Lista)", () => {
    for (const estado of ESTADOS) {
      const { celda } = montar({ reserva: reserva(estado) });
      expect(within(celda).queryAllByRole("checkbox"), estado).toHaveLength(0);
      cleanup();
    }
  });
  it("`fila` sin permiso: nada", () => {
    const { celda } = montar({ reserva: reserva("pendiente"), canEdit: false });
    expect(celda.querySelector('[data-testid="acciones-fila"]')).toBeNull();
  });
  it("`fila`: debajo de los datos del cliente, con aire (mt-3)", () => {
    const { celda } = montar({ reserva: reserva("pendiente") });
    expect(celda.querySelector('[data-testid="acciones-fila"]')!.className).toContain("mt-3");
  });
  it("`tarjeta`: los mismos botones en una fila propia que pasa de línea", () => {
    const { celda } = montar({ reserva: reserva("pendiente"), variante: "tarjeta" });
    const fila = celda.firstElementChild as HTMLElement;
    expect(fila.className).toBe("flex flex-wrap items-center gap-3 pt-2");
    expect(within(celda).queryByRole("checkbox")).toBeNull();
    expect(principal(celda)).toHaveTextContent("Verificar");
    expect(within(celda).getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });
});

describe("AccionesReserva · textos de una reserva sin nombre (la BD lo permite)", () => {
  it.each([null, undefined, ""])("nombre %j: «este cliente»", (nombre) => {
    const { celda } = montar({ reserva: reserva("confirmada", { nombre }) });
    expect(abrirMas(celda).map((i) => i.getAttribute("title"))).toEqual([
      "Abrir el plano en Comedor para darle mesa",
      "Gestionar: editar la reserva de este cliente — datos, día, hora, comensales y sala",
      "Cancelar la reserva de este cliente — pedirá confirmación",
      "Añadir a este cliente a la lista negra",
    ]);
  });
});

describe("RanurasDeAcciones · el molde que comparten reservas y solicitudes", () => {
  it("pinta la principal y en «Más» solo lo que tiene manejador; «Gestionar» lleva el engranaje si no se le da icono", () => {
    const onGestionar = vi.fn();
    const { container } = render(
      <div>
        <RanurasDeAcciones
          principal={{ etiqueta: "Convertir", titulo: "Convertir la solicitud en una reserva", icono: null, onClick: vi.fn() }}
          darMesa={{ titulo: "Todavía no es una reserva" }}
          verificar={{ titulo: "Verificar: solo para reservas" }}
          gestionar={{ titulo: "Gestionar: propuesta al cliente, salas y notas", onClick: onGestionar }}
          cancelar={{ titulo: "Descartar la solicitud: se hace desde «Gestionar»" }}
          listaNegra={{ titulo: "Lista negra: solo para reservas" }}
        />
      </div>,
    );
    const celda = container.firstElementChild as HTMLElement;
    expect(principal(celda)).toHaveTextContent("Convertir");
    const items = abrirMas(celda);
    expect(textos(items)).toEqual(["Gestionar"]);
    expect(items[0].querySelector("svg")?.getAttribute("class")).toMatch(/settings-?2/);
    fireEvent.click(items[0]);
    expect(onGestionar).toHaveBeenCalledTimes(1);
  });

  it("sin principal ni otros botones: nada", () => {
    const { container } = render(
      <div>
        <RanurasDeAcciones
          principal={{ etiqueta: "Convertir", titulo: "Ya está cerrada", icono: null }}
          darMesa={{ titulo: "" }}
          verificar={{ titulo: "" }}
          gestionar={{ titulo: "" }}
          cancelar={{ titulo: "" }}
          listaNegra={{ titulo: "" }}
        />
      </div>,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect((container.firstElementChild as HTMLElement).childElementCount).toBe(0);
  });
});

describe("EstrellaImportante", () => {
  const estrella = (props: Partial<ComponentProps<typeof EstrellaImportante>> = {}) => {
    const onClick = vi.fn();
    const { container } = render(
      <EstrellaImportante reserva={reserva("confirmada")} canEdit variante="fila" onClick={onClick} {...props} />,
    );
    return { onClick, boton: container.querySelector("button")!, svg: container.querySelector("svg")! };
  };

  it("con permiso se pulsa en cualquier estado", () => {
    for (const estado of ESTADOS) {
      const { onClick, boton } = estrella({ reserva: reserva(estado) });
      expect(boton.hasAttribute("disabled"), estado).toBe(false);
      fireEvent.click(boton);
      expect(onClick, estado).toHaveBeenCalledTimes(1);
    }
  });

  it("sin permiso (solo «Ver», 06/11/2026): sin botón; si es importante, la estrella se ve como dato", () => {
    for (const estado of ESTADOS) {
      const normal = estrella({ reserva: reserva(estado), canEdit: false });
      expect(normal.boton, estado).toBeNull();
      expect(normal.svg, estado).toBeNull();

      const importante = estrella({ reserva: reserva(estado, { importante: true }), canEdit: false });
      expect(importante.boton, estado).toBeNull();
      expect(importante.svg.getAttribute("aria-label"), estado).toBe("Importante");
      expect(importante.svg.getAttribute("class"), estado).toMatch(/fill-amber-400/);
    }
  });

  it("su nombre dice qué hará, con el nombre del cliente", () => {
    expect(estrella().boton.getAttribute("aria-label")).toBe("Marcar Ana como importante");
    expect(estrella({ reserva: reserva("confirmada", { importante: true }) }).boton.getAttribute("aria-label")).toBe(
      "Desmarcar Ana como importante",
    );
    expect(estrella({ reserva: reserva("confirmada", { nombre: null }) }).boton.getAttribute("aria-label")).toBe(
      "Marcar este cliente como importante",
    );
  });

  it("rellena de ámbar si es importante; en la tabla crece y se colorea al pasar el ratón, en la tarjeta no", () => {
    expect(estrella({ reserva: reserva("confirmada", { importante: true }) }).svg.getAttribute("class")).toMatch(
      /fill-amber-400/,
    );
    const fila = estrella();
    expect(fila.boton.className).toMatch(/hover:scale-110/);
    expect(fila.svg.getAttribute("class")).toMatch(/hover:text-amber-400/);
    const tarjeta = estrella({ variante: "tarjeta" });
    expect(tarjeta.boton.className).not.toMatch(/hover:scale-110/);
    expect(tarjeta.svg.getAttribute("class")).not.toMatch(/hover:text-amber-400/);
  });

  it("sin manejador sale deshabilitada y lo dice en el envoltorio", () => {
    const { boton } = estrella({ onClick: undefined });
    expect(boton.hasAttribute("disabled")).toBe(true);
    expect(boton.parentElement?.getAttribute("title")).toBe("Marcar Ana como importante");
  });
});

describe("CasillaAceptarEnBloque", () => {
  it("solo en las pendientes y con permiso", () => {
    for (const canEdit of [true, false]) {
      for (const estado of ESTADOS) {
        const { container, unmount } = render(
          <CasillaAceptarEnBloque reserva={reserva(estado)} canEdit={canEdit} marcada={false} onCambiar={vi.fn()} />,
        );
        expect(container.querySelector('[role="checkbox"]') !== null, `${estado}/${canEdit}`).toBe(
          canEdit && estado === "pendiente",
        );
        unmount();
      }
    }
  });

  it("dice para qué es y avisa al cambiar", () => {
    const onCambiar = vi.fn();
    const { getByRole } = render(
      <CasillaAceptarEnBloque reserva={reserva("pendiente")} canEdit marcada={false} onCambiar={onCambiar} className="shrink-0" />,
    );
    const casilla = getByRole("checkbox", { name: "Seleccionar para aceptar en bloque" });
    expect(casilla.getAttribute("aria-checked")).toBe("false");
    expect(casilla.hasAttribute("disabled")).toBe(false);
    fireEvent.click(casilla);
    expect(onCambiar).toHaveBeenCalledTimes(1);
  });
});
