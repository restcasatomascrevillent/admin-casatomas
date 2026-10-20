/**
 * `AccionesReserva` y sus piezas: los botones de una reserva en la Lista (tabla y
 * tarjeta de móvil), pintados a partir de `accionesDisponibles(…, { vista: "lista" })`.
 *
 * Se fija el comportamiento que la Lista tenía ANTES de pasar a este componente
 * (paso 3 del refactor de acciones), con una tabla escrita a mano y no calculada
 * con la misma lógica: seis estados × con y sin permiso × las dos variantes. Lo
 * único que cambia respecto a entonces es lo acordado con el dueño: el título de
 * «Llegó» ya no dice «ya servida», «Aceptar» acepta la reserva tal como está, y
 * sin permiso «Verificar», la estrella y la lista negra salen deshabilitadas.
 *
 * Los ANCHOS no se pueden medir en jsdom (no calcula diseño): se fijan las clases
 * que los dan, que son las de siempre.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  AccionesReserva,
  CasillaAceptarEnBloque,
  EstrellaImportante,
  RanurasDeAcciones,
  TITULO_DAR_MESA_SIN_PLANO,
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
  /** Los botones de las ranuras, en orden de pantalla (sin la casilla). */
  const botones = [...celda.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "checkbox");
  return { al, onAsignarMesa, celda, botones };
}

/** ✔ habilitado · ✖ deshabilitado, en el orden de las ranuras. */
const simbolos = (botones: HTMLElement[]) => botones.map((b) => (b.hasAttribute("disabled") ? "✖" : "✔")).join("");

// ─── La tabla de lo que había ─────────────────────────────────────────────────
// Ranuras: principal · dar mesa · verificar · editar · cancelar · lista negra.
// «Dar mesa» lo decide `resolverSaltoAsignacion` y no mira el permiso (no escribe:
// abre el plano); aquí, con sala y fecha, solo la cancelada no salta.
const CON_PERMISO: Record<Estado, { principal: string; ranuras: string }> = {
  pendiente: { principal: "Aceptar", ranuras: "✔✔✔✔✔✔" },
  verificada: { principal: "Confirmar", ranuras: "✔✔✖✔✔✔" },
  confirmada: { principal: "Confirmar", ranuras: "✖✔✖✔✔✔" },
  completada: { principal: "Confirmar", ranuras: "✖✔✖✔✖✔" }, // «Llegó» ya no se cancela (cambio (a))
  cancelada: { principal: "Confirmar", ranuras: "✖✖✖✔✖✔" },
  no_show: { principal: "Confirmar", ranuras: "✖✔✖✔✖✔" }, // «No vino» ya no se cancela (cambio (a))
};

// Sin permiso, la principal dice «Aceptar» en TODAS las filas (como antes), deshabilitada.
// CAMBIO ACORDADO (2026-10-01): «Verificar» y la lista negra también se apagan sin
// permiso (antes: «Verificar» ✔ en la pendiente y la lista negra ✔ en todas).
const SIN_PERMISO: Record<Estado, { principal: string; ranuras: string }> = {
  pendiente: { principal: "Aceptar", ranuras: "✖✔✖✖✖✖" },
  verificada: { principal: "Aceptar", ranuras: "✖✔✖✖✖✖" },
  confirmada: { principal: "Aceptar", ranuras: "✖✔✖✖✖✖" },
  completada: { principal: "Aceptar", ranuras: "✖✔✖✖✖✖" },
  cancelada: { principal: "Aceptar", ranuras: "✖✖✖✖✖✖" },
  no_show: { principal: "Aceptar", ranuras: "✖✔✖✖✖✖" },
};

describe("AccionesReserva · las seis ranuras, por estado y permiso", () => {
  describe.each(["fila", "tarjeta"] as const)("variante %s", (variante) => {
    describe.each([true, false])("canEdit=%s", (canEdit) => {
      const tabla = canEdit ? CON_PERMISO : SIN_PERMISO;

      it.each(ESTADOS)("%s", (estado) => {
        const { botones } = montar({ reserva: reserva(estado), canEdit, variante });

        // Siempre seis, se pueda pulsar algo o no: los botones no bailan de sitio.
        expect(botones).toHaveLength(6);
        expect(botones[0].textContent?.trim()).toBe(tabla[estado].principal);
        expect(simbolos(botones), "principal · dar mesa · verificar · editar · cancelar · lista negra").toBe(
          tabla[estado].ranuras,
        );
      });
    });
  });

  it("el orden y los nombres accesibles: la principal por su texto y los iconos por su `aria-label`", () => {
    const { botones } = montar({ reserva: reserva("confirmada") });
    const nombres = botones.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());

    expect(botones[0].hasAttribute("aria-label")).toBe(false);
    expect(nombres[0]).toBe("Confirmar");
    expect(nombres[1]).toBe("Abrir el plano en Comedor para darle mesa");
    expect(nombres[2]).toBe("Verificar: solo para reservas pendientes");
    expect(nombres[3]).toBe("Gestionar: editar la reserva de Ana — datos, día, hora, comensales y sala");
    expect(nombres[4]).toBe("Cancelar la reserva de Ana — pedirá confirmación");
    expect(nombres[5]).toBe("Añadir a Ana a la lista negra");
    // Cada icono lleva su texto también en `title` (el globo al pasar el ratón).
    for (const b of botones.slice(1)) expect(b.getAttribute("title")).toBe(b.getAttribute("aria-label"));
    // Y su icono: sillón, portapapeles, lápiz, aspa y escudo.
    const iconos = botones.slice(1).map((b) => b.querySelector("svg")?.getAttribute("class") ?? "");
    expect(iconos[0]).toMatch(/armchair/);
    expect(iconos[1]).toMatch(/clipboard-check/);
    expect(iconos[2]).toMatch(/square-pen/);
    expect(iconos[3]).toMatch(/circle-x|x-circle/);
    expect(iconos[4]).toMatch(/shield-ban/);
  });

  it("CAMBIO ACORDADO (2026-10-01): «Aceptar» acepta la reserva tal como está, no «como la pidió el cliente»", () => {
    const { botones } = montar({ reserva: reserva("pendiente") });
    expect(botones[0].textContent?.trim()).toBe("Aceptar");
    expect(botones[0].getAttribute("title")).toBe(
      "Aceptar la reserva tal como está (hora y sala actuales); se avisa al cliente si tiene email",
    );
  });

  it("cancelar y lista negra son las destructivas; «Dar mesa» nunca (no es un error)", () => {
    const { botones } = montar({ reserva: reserva("confirmada") });
    const destructivas = botones.map((b) => /border-destructive/.test(b.className));
    expect(destructivas).toEqual([false, false, false, false, true, true]);
  });
});

describe("AccionesReserva · qué hace cada botón", () => {
  it("pendiente con permiso: cada botón llama a lo suyo, una vez", () => {
    const { al, onAsignarMesa, botones } = montar({ reserva: reserva("pendiente") });
    const [principal, darMesa, verificar, editar, cancelar, listaNegra] = botones;

    fireEvent.click(principal);
    fireEvent.click(verificar);
    fireEvent.click(editar);
    fireEvent.click(cancelar);
    fireEvent.click(listaNegra);
    fireEvent.click(darMesa);

    expect(al.aceptar).toHaveBeenCalledTimes(1);
    expect(al.confirmar).not.toHaveBeenCalled();
    expect(al.verificar).toHaveBeenCalledTimes(1);
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
    const { al, botones } = montar({ reserva: reserva("verificada") });
    fireEvent.click(botones[0]);
    expect(al.confirmar).toHaveBeenCalledTimes(1);
    expect(al.aceptar).not.toHaveBeenCalled();
  });

  it.each([true, false])("lo deshabilitado no llama a nada (canEdit=%s)", (canEdit) => {
    for (const estado of ESTADOS) {
      const { al, onAsignarMesa, botones } = montar({ reserva: reserva(estado), canEdit });
      for (const b of botones) if (b.hasAttribute("disabled")) fireEvent.click(b);
      const deshabilitados = simbolos(botones);
      // Lo que salió deshabilitado no se ha llamado.
      if (deshabilitados[0] === "✖") {
        expect(al.aceptar, estado).not.toHaveBeenCalled();
        expect(al.confirmar, estado).not.toHaveBeenCalled();
      }
      if (deshabilitados[1] === "✖") expect(onAsignarMesa, estado).not.toHaveBeenCalled();
      if (deshabilitados[2] === "✖") expect(al.verificar, estado).not.toHaveBeenCalled();
      if (deshabilitados[3] === "✖") expect(al.editar, estado).not.toHaveBeenCalled();
      if (deshabilitados[4] === "✖") expect(al.cancelar, estado).not.toHaveBeenCalled();
    }
  });

  it("un botón sin manejador sale deshabilitado aunque la regla lo permita", () => {
    const { botones } = montar({ reserva: reserva("pendiente"), al: {} });
    // Solo «Dar mesa» lleva su propio salto (`onAsignarMesa`).
    expect(simbolos(botones)).toBe("✖✔✖✖✖✖");
  });
});

describe("AccionesReserva · el motivo de lo deshabilitado se ve al pasar el ratón", () => {
  /** El `title` del envoltorio (`ConMotivo`) de un botón. */
  const motivo = (b: HTMLElement) => b.parentElement?.getAttribute("title") ?? null;

  it("deshabilitado: el envoltorio lleva el motivo; habilitado: el envoltorio no lleva nada", () => {
    const { botones } = montar({ reserva: reserva("completada") });
    const [principal, darMesa, verificar, editar, cancelar, listaNegra] = botones;

    expect(motivo(principal)).toBe("Nada que aceptar ni confirmar: la reserva está marcada como «Llegó»");
    expect(motivo(verificar)).toBe("Verificar: solo para reservas pendientes");
    expect(motivo(cancelar)).toBe("No se puede cancelar una reserva que ya llegó");
    for (const b of [darMesa, editar, listaNegra]) expect(motivo(b)).toBeNull();
  });

  it("CAMBIO ACORDADO: ningún texto dice «servida»; «Llegó» se llama «Llegó»", () => {
    const { celda } = montar({ reserva: reserva("completada") });
    expect(celda.innerHTML).not.toMatch(/servida/i);
    expect(within(celda).getByText("Confirmar").closest("button")!.getAttribute("title")).toMatch(/«Llegó»/);
  });

  it("sin permiso, lo que se apaga por el permiso lo dice", () => {
    const { botones } = montar({ reserva: reserva("confirmada"), canEdit: false });
    expect(motivo(botones[0])).toBe("No tienes permiso para editar reservas");
    expect(motivo(botones[3])).toBe("No tienes permiso para editar reservas");
    expect(motivo(botones[4])).toBe("No tienes permiso para cancelar reservas");
  });

  it("CAMBIO ACORDADO: sin permiso, «Verificar» y la lista negra se apagan y lo dicen (también en la pendiente)", () => {
    const { al, botones } = montar({ reserva: reserva("pendiente"), canEdit: false });
    for (const b of [botones[2], botones[5]]) {
      expect(b.hasAttribute("disabled")).toBe(true);
      expect(motivo(b)).toBe("No tienes permiso para editar reservas");
      fireEvent.click(b);
    }
    expect(al.verificar).not.toHaveBeenCalled();
    expect(al.listaNegra).not.toHaveBeenCalled();
  });

  it("el envoltorio no cambia el ancho: es un `inline-flex shrink-0` pegado al botón", () => {
    const { botones } = montar({ reserva: reserva("cancelada") });
    for (const b of botones) {
      expect(b.parentElement?.tagName).toBe("SPAN");
      expect(b.parentElement?.className).toBe("inline-flex shrink-0");
    }
  });
});

describe("AccionesReserva · mientras hay una petición en curso", () => {
  it("`ocupada` (esta reserva): la principal y cancelar giran y no se pulsan", () => {
    const { al, botones } = montar({ reserva: reserva("pendiente"), ocupada: true });
    expect(botones[0].hasAttribute("disabled")).toBe(true);
    expect(botones[0].querySelector("svg")?.getAttribute("class")).toMatch(/animate-spin/);
    expect(botones[4].hasAttribute("disabled")).toBe(true);
    expect(botones[4].querySelector("svg")?.getAttribute("class")).toMatch(/animate-spin/);
    fireEvent.click(botones[0]);
    fireEvent.click(botones[4]);
    expect(al.aceptar).not.toHaveBeenCalled();
    expect(al.cancelar).not.toHaveBeenCalled();
    // El resto sigue igual.
    expect(simbolos(botones).slice(1, 4)).toBe("✔✔✔");
  });

  it("`ocupada` en una fila sin nada que confirmar: cancelar gira igual (como antes); la principal no", () => {
    const { botones } = montar({ reserva: reserva("cancelada"), ocupada: true });
    expect(botones[0].querySelector("svg")?.getAttribute("class")).not.toMatch(/animate-spin/);
    expect(botones[4].querySelector("svg")?.getAttribute("class")).toMatch(/animate-spin/);
  });

  it("`bloqueEnCurso` (aceptar en bloque): solo espera la principal", () => {
    const { botones } = montar({ reserva: reserva("verificada"), bloqueEnCurso: true });
    expect(botones[0].hasAttribute("disabled")).toBe(true);
    expect(botones[0].querySelector("svg")?.getAttribute("class")).toMatch(/animate-spin/);
    expect(botones[4].hasAttribute("disabled")).toBe(false);
  });

  it("sin permiso no gira nada aunque esté ocupada (no había nada que pulsar)", () => {
    const { botones } = montar({ reserva: reserva("pendiente"), canEdit: false, bloqueEnCurso: true });
    expect(botones[0].querySelector("svg")?.getAttribute("class")).not.toMatch(/animate-spin/);
  });
});

describe("AccionesReserva · «Dar mesa»", () => {
  it("sin sala: deshabilitado y dice qué falta y dónde se arregla («Gestionar»)", () => {
    const { onAsignarMesa, botones } = montar({ reserva: reserva("confirmada", { espacio_id: null }) });
    expect(botones[1].hasAttribute("disabled")).toBe(true);
    expect(botones[1].getAttribute("aria-label")).toMatch(/sala/);
    expect(botones[1].getAttribute("aria-label")).toMatch(/«Gestionar»/);
    fireEvent.click(botones[1]);
    expect(onAsignarMesa).not.toHaveBeenCalled();
  });

  it("si la pantalla no lleva a ningún plano, sigue en su sitio, deshabilitado y lo dice", () => {
    const { botones } = montar({ reserva: reserva("confirmada"), onAsignarMesa: undefined });
    expect(botones).toHaveLength(6);
    expect(botones[1].hasAttribute("disabled")).toBe(true);
    expect(botones[1].getAttribute("aria-label")).toBe(TITULO_DAR_MESA_SIN_PLANO);
  });

  it("sin nombre de sala, el texto no inventa ninguno", () => {
    const { botones } = montar({ reserva: reserva("confirmada"), nombreSala: null });
    expect(botones[1].getAttribute("aria-label")).toBe("Abrir el plano para darle mesa");
  });
});

describe("AccionesReserva · variantes", () => {
  it("`fila` con permiso: la primera ranura es la de la casilla, con casilla solo en las pendientes", () => {
    for (const estado of ESTADOS) {
      const { celda } = montar({ reserva: reserva(estado) });
      const primera = celda.firstElementChild as HTMLElement;
      expect(primera.tagName, estado).toBe("SPAN");
      expect(primera.className, estado).toContain("w-4");
      expect(within(celda).queryAllByRole("checkbox"), estado).toHaveLength(estado === "pendiente" ? 1 : 0);
    }
  });

  it("`fila` sin permiso: ni ranura ni casilla (la cabecera tampoco la lleva)", () => {
    const { celda } = montar({ reserva: reserva("pendiente"), canEdit: false });
    expect(within(celda).queryByRole("checkbox")).toBeNull();
    expect(celda.querySelector("span.w-4")).toBeNull();
  });

  it("`fila`: la casilla marca y desmarca para aceptar en bloque", () => {
    const { al, celda } = montar({ reserva: reserva("pendiente"), seleccionada: true });
    const casilla = within(celda).getByRole("checkbox", { name: "Seleccionar para aceptar en bloque" });
    expect(casilla.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(casilla);
    expect(al.seleccionar).toHaveBeenCalledTimes(1);
  });

  it("`tarjeta`: los mismos seis botones en una fila propia y SIN casilla (va junto al nombre)", () => {
    const { celda, botones } = montar({ reserva: reserva("pendiente"), variante: "tarjeta" });
    const fila = celda.firstElementChild as HTMLElement;
    expect(fila.tagName).toBe("DIV");
    // Tablet (03/10/2026): la fila hace wrap y los botones llevan TEXTO visible (con dedo no hay `title`).
    expect(fila.className).toBe("flex flex-wrap items-center gap-2 pt-1");
    expect(botones).toHaveLength(6);
    expect(within(celda).queryByRole("checkbox")).toBeNull();
    for (const texto of ["Mesa", "Verificar", "Editar", "Cancelar", "Blacklist"]) {
      expect(within(celda).getAllByText(texto).length, texto).toBeGreaterThan(0);
    }
  });

  it("`fila`: solo iconos (la tabla no tiene sitio para el texto)", () => {
    const { celda } = montar({ reserva: reserva("pendiente") });
    expect(within(celda).queryByText("Blacklist")).toBeNull();
  });
});

describe("AccionesReserva · los anchos son los de siempre (la Lista no cambia de ancho)", () => {
  it("principal de ancho fijo y cinco iconos de 24/28 px", () => {
    const { botones } = montar({ reserva: reserva("pendiente") });
    expect(botones[0].className).toContain("w-[76px]");
    expect(botones[0].className).toContain("xl:w-[88px]");
    expect(botones[0].className).toContain("h-6");
    expect(botones[0].className).toContain("xl:h-7");
    for (const b of botones.slice(1)) {
      for (const clase of ["h-6", "w-6", "xl:h-7", "xl:w-7", "shrink-0"]) expect(b.className, clase).toContain(clase);
    }
  });
});

describe("AccionesReserva · textos de una reserva sin nombre (la BD lo permite)", () => {
  it.each([null, undefined, ""])("nombre %j: «este cliente»", (nombre) => {
    const { botones } = montar({ reserva: reserva("confirmada", { nombre }) });
    expect(botones[3].getAttribute("aria-label")).toBe(
      "Gestionar: editar la reserva de este cliente — datos, día, hora, comensales y sala",
    );
    expect(botones[4].getAttribute("aria-label")).toBe("Cancelar la reserva de este cliente — pedirá confirmación");
    expect(botones[5].getAttribute("aria-label")).toBe("Añadir a este cliente a la lista negra");
  });
});

describe("RanurasDeAcciones · el molde que comparten reservas y solicitudes", () => {
  it("pinta lo que le den, en las mismas seis ranuras; «Gestionar» lleva el engranaje si no se le da icono", () => {
    const onGestionar = vi.fn();
    const { container } = render(
      <div>
        <RanurasDeAcciones
          seleccion={null}
          principal={{ etiqueta: "Convertir", titulo: "Convertir la solicitud en una reserva", icono: null, onClick: vi.fn() }}
          darMesa={{ titulo: "Todavía no es una reserva" }}
          verificar={{ titulo: "Verificar: solo para reservas" }}
          gestionar={{ titulo: "Gestionar: propuesta al cliente, salas y notas", onClick: onGestionar }}
          cancelar={{ titulo: "Descartar la solicitud: se hace desde «Gestionar»" }}
          listaNegra={{ titulo: "Lista negra: solo para reservas" }}
        />
      </div>,
    );
    const botones = [...container.querySelectorAll("button")];
    expect(botones).toHaveLength(6);
    expect(simbolos(botones)).toBe("✔✖✖✔✖✖");
    expect(botones[3].querySelector("svg")?.getAttribute("class")).toMatch(/settings-?2/);
    // `seleccion={null}`: la ranura de la casilla está, vacía (misma X que una reserva con permiso).
    expect((container.firstElementChild!.firstElementChild as HTMLElement).className).toContain("w-4");
    fireEvent.click(botones[3]);
    expect(onGestionar).toHaveBeenCalledTimes(1);
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

  it("CAMBIO ACORDADO: sin permiso, deshabilitada con el motivo en el envoltorio y el mismo nombre (como en el kanban)", () => {
    for (const estado of ESTADOS) {
      const { onClick, boton } = estrella({ reserva: reserva(estado), canEdit: false });
      expect(boton.hasAttribute("disabled"), estado).toBe(true);
      expect(boton.parentElement?.getAttribute("title"), estado).toBe("No tienes permiso para editar reservas");
      expect(boton.getAttribute("aria-label"), estado).toBe("Marcar Ana como importante");
      fireEvent.click(boton);
      expect(onClick, estado).not.toHaveBeenCalled();
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
