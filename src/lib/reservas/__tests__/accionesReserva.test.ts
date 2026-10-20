/**
 * Acciones de una reserva (`accionesReserva.ts`): qué botones tiene en cada vista,
 * cuáles se pueden pulsar y con qué texto.
 *
 * Es el ÚNICO sitio donde esa decisión debería vivir, así que se fija entera:
 * 6 estados × 2 vistas × `canEdit` true/false, las doce acciones. La matriz de
 * abajo es una tabla escrita a mano (no calculada con la misma lógica que la
 * función) y es la misma que documenta la cabecera del módulo.
 *
 * QUÉ CODIFICA
 * ----------------------------------------------------------------------------
 * · El comportamiento ACTUAL de cada vista: la Lista (gestión: aceptar, verificar,
 *   confirmar, cancelar) y Hoy (servicio: ha llegado, no vino, deshacer, mover).
 *   Siguen siendo DIFERENTES a propósito; aquí solo se centraliza su fuente de
 *   verdad.
 * · Los cambios acordados: (a) sin cancelar «Llegó» / «No vino»; (b) «editar»
 *   siempre, en los seis estados; (c) Hoy respeta el permiso en TODO —también la
 *   lista negra, desde el paso 1—; (d) un solo vocabulario, «Ha llegado» /
 *   «No vino»; (e) desde el paso 3, la Lista también respeta el permiso en
 *   «Verificar», la estrella y la lista negra (decisión del dueño, 2026-10-01, con
 *   la RLS de `reservas` endurecida). Ya no queda nada que escriba sin mirarlo.
 *
 * Los textos son los de hoy salvo donde lo dice un cambio acordado (en el paso 3,
 * «Llegó» deja de decirse «ya servida»): migrar la Lista no cambia lo que lee el
 * personal.
 */
import { describe, it, expect } from "vitest";
import {
  ACCIONES_RESERVA,
  TITULO_ACEPTAR,
  TITULO_SIN_PERMISO_CANCELAR,
  TITULO_SIN_PERMISO_EDITAR,
  accionesDisponibles,
  type AccionReserva,
  type EstadoAccion,
  type VistaReservas,
} from "../accionesReserva";
import { ORDEN_ESTADOS, esEstadoVivo, ocupaEspacio } from "../estadosReserva";
import { haLlegado } from "../servicioSala";
// Texto del fichero, tal cual (`?raw` de Vite): no hace falta `fs` ni rutas.
import fuenteDeAcciones from "../accionesReserva.ts?raw";

/** Columnas de las tablas de abajo: los seis estados en el orden del ciclo de vida. */
const ESTADOS = [...ORDEN_ESTADOS]; // pendiente, verificada, confirmada, completada, cancelada, no_show

const VISTAS: VistaReservas[] = ["lista", "hoy"];

// ✔ habilitada · ✖ visible pero deshabilitada · · no visible
type Fila = Record<AccionReserva, string>;

const CON_PERMISO: Record<VistaReservas, Fila> = {
  //                      pend   verif  confir Llegó  cancel NoVino
  lista: {
    aceptar:     "✔·····",
    confirmar:   "·✔✖✖✖✖",
    verificar:   "✔✖✖✖✖✖",
    seleccionar: "✔·····",
    cancelar:    "✔✔✔✖✖✖", // cambio (a): Llegó y No vino ya no se cancelan
    editar:      "✔✔✔✔✔✔", // cambio (b)
    importante:  "✔✔✔✔✔✔",
    listaNegra:  "✔✔✔✔✔✔",
    haLlegado:   "······",
    noVino:      "······",
    deshacer:    "······",
    mover:       "······",
  },
  hoy: {
    aceptar:     "······",
    confirmar:   "······",
    verificar:   "······",
    seleccionar: "······",
    cancelar:    "······",
    haLlegado:   "✔✔✔···",
    noVino:      "✔✔✔···",
    deshacer:    "···✔·✔",
    mover:       "✔✔✔✔✖✖", // cancelada y No vino no ocupan sitio: la entrada está, sin destinos
    editar:      "✔✔✔✔✔✔", // cambio (b)
    importante:  "✔✔✔✔✔✔",
    listaNegra:  "✔✔✔✔✔✔",
  },
};

const SIN_PERMISO: Record<VistaReservas, Fila> = {
  lista: {
    aceptar:     "✖·····",
    confirmar:   "·✖✖✖✖✖",
    verificar:   "✖✖✖✖✖✖", // cambio (e): antes abría el modal en solo lectura
    seleccionar: "······", // sin permiso desaparece la casilla de aceptar en bloque
    cancelar:    "✖✖✖✖✖✖",
    editar:      "✖✖✖✖✖✖",
    importante:  "✖✖✖✖✖✖", // cambio (e)
    listaNegra:  "✖✖✖✖✖✖", // cambio (e)
    haLlegado:   "······",
    noVino:      "······",
    deshacer:    "······",
    mover:       "······",
  },
  hoy: {
    aceptar:     "······",
    confirmar:   "······",
    verificar:   "······",
    seleccionar: "······",
    cancelar:    "······",
    haLlegado:   "✖✖✖···", // cambio (c)
    noVino:      "✖✖✖···", // cambio (c)
    deshacer:    "···✖·✖", // cambio (c)
    mover:       "✖✖✖✖✖✖", // cambio (c)
    editar:      "✖✖✖✖✖✖", // cambio (b)
    importante:  "✖✖✖✖✖✖", // cambio (c)
    listaNegra:  "✖✖✖✖✖✖", // cambio (c), ampliado en el paso 1: también la lista negra de Hoy
  },
};

const simbolo = (a: EstadoAccion) => (!a.visible ? "·" : a.habilitada ? "✔" : "✖");

const acciones = (
  estado: string,
  vista: VistaReservas,
  canEdit: boolean,
  extra: { nombre?: string | null; importante?: boolean | null } = {},
) => accionesDisponibles({ estado, nombre: "Ana", ...extra }, { vista, canEdit });

const titulo = (
  estado: string,
  vista: VistaReservas,
  canEdit: boolean,
  accion: AccionReserva,
  extra: { nombre?: string | null; importante?: boolean | null } = {},
) => acciones(estado, vista, canEdit, extra)[accion].titulo;

describe("accionesDisponibles — la matriz entera", () => {
  it("las tablas de este test están completas (doce acciones, seis estados)", () => {
    for (const tabla of [CON_PERMISO, SIN_PERMISO]) {
      for (const vista of VISTAS) {
        expect(Object.keys(tabla[vista]).sort()).toEqual([...ACCIONES_RESERVA].sort());
        for (const accion of ACCIONES_RESERVA) expect([...tabla[vista][accion]], `${vista}.${accion}`).toHaveLength(ESTADOS.length);
      }
    }
  });

  describe.each(VISTAS)("vista %s", (vista) => {
    describe.each([true, false])("canEdit=%s", (canEdit) => {
      const esperada = (canEdit ? CON_PERMISO : SIN_PERMISO)[vista];

      it.each(ACCIONES_RESERVA)("%s", (accion) => {
        const obtenida = ESTADOS.map((estado) => simbolo(acciones(estado, vista, canEdit)[accion])).join("");
        expect(obtenida, `${ESTADOS.join(" · ")}`).toBe(esperada[accion]);
      });
    });
  });

  it("devuelve siempre las doce acciones, en cualquier combinación", () => {
    for (const vista of VISTAS) {
      for (const canEdit of [true, false]) {
        for (const estado of [...ESTADOS, "rechazada"]) {
          expect(Object.keys(acciones(estado, vista, canEdit)).sort(), `${vista}/${estado}/${canEdit}`).toEqual([...ACCIONES_RESERVA].sort());
        }
      }
    }
  });
});

describe("accionesDisponibles — invariantes de cada respuesta", () => {
  const casos = VISTAS.flatMap((vista) =>
    [true, false].flatMap((canEdit) => ESTADOS.map((estado) => [vista, estado, canEdit] as const)),
  );

  it.each(casos)("%s / %s / canEdit=%s", (vista, estado, canEdit) => {
    for (const accion of ACCIONES_RESERVA) {
      const a = acciones(estado, vista, canEdit)[accion];
      const donde = `${accion}: ${JSON.stringify(a)}`;
      // Lo que no se pinta no se puede pulsar y no lleva texto.
      if (!a.visible) {
        expect(a.habilitada, donde).toBe(false);
        expect(a.titulo, donde).toBe("");
      }
      // Lo que se pinta se explica solo, habilitado o no.
      if (a.visible) expect(a.titulo.trim().length, donde).toBeGreaterThan(0);
      // Nada habilitado sin estar visible.
      if (a.habilitada) expect(a.visible, donde).toBe(true);
    }
  });

  it("sin permiso, lo que queda deshabilitado POR EL PERMISO lo dice en el título", () => {
    // Desde el cambio (e) también «Verificar», la estrella y la lista negra de la Lista.
    for (const [vista, accion] of [
      ["lista", "aceptar"],
      ["lista", "editar"],
      ["lista", "cancelar"],
      ["lista", "verificar"],
      ["lista", "importante"],
      ["lista", "listaNegra"],
      ["hoy", "haLlegado"],
      ["hoy", "noVino"],
      ["hoy", "mover"],
      ["hoy", "importante"],
      ["hoy", "listaNegra"],
      ["hoy", "editar"],
    ] as const) {
      expect(titulo("pendiente", vista, false, accion), `${vista}.${accion}`).toMatch(/permiso/i);
    }
  });

  it("es pura: mismos argumentos, mismo resultado; devuelve objetos nuevos y no toca lo que recibe", () => {
    const reserva = Object.freeze({ estado: "pendiente", nombre: "Ana", importante: false });
    const opciones = Object.freeze({ vista: "lista" as const, canEdit: true });

    const a = accionesDisponibles(reserva, opciones);
    const b = accionesDisponibles(reserva, opciones);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.aceptar).not.toBe(b.aceptar);

    // Mutar una respuesta no contamina las siguientes (las acciones ocultas no comparten objeto).
    a.haLlegado.visible = true;
    a.cancelar.titulo = "otra cosa";
    expect(accionesDisponibles(reserva, opciones).haLlegado.visible).toBe(false);
    expect(accionesDisponibles(reserva, opciones).cancelar.titulo).not.toBe("otra cosa");
    expect(reserva).toEqual({ estado: "pendiente", nombre: "Ana", importante: false });
  });

  it("no importa React, Supabase ni TanStack por su cuenta: solo el mapa de estados", () => {
    const importaciones = [...fuenteDeAcciones.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);

    expect(importaciones).toEqual(["./estadosReserva"]);
    expect(fuenteDeAcciones).not.toMatch(/from\s+["'](react|@tanstack|@\/integrations|@supabase|sonner)/);
  });
});

describe("Lista y Hoy siguen siendo diferentes", () => {
  const visibles = (estado: string, vista: VistaReservas, canEdit: boolean) =>
    ACCIONES_RESERVA.filter((a) => acciones(estado, vista, canEdit)[a].visible);

  it("solo comparten editar, la estrella y la lista negra; cada vista tiene lo suyo", () => {
    for (const canEdit of [true, false]) {
      for (const estado of ESTADOS) {
        const enLista = visibles(estado, "lista", canEdit);
        const enHoy = visibles(estado, "hoy", canEdit);
        expect(enLista.filter((a) => enHoy.includes(a)).sort(), `${estado}/${canEdit}`).toEqual(["editar", "importante", "listaNegra"]);
      }
    }
  });

  it("la Lista es de gestión y Hoy es de servicio", () => {
    const gestion: AccionReserva[] = ["aceptar", "verificar", "confirmar", "cancelar", "seleccionar"];
    const servicio: AccionReserva[] = ["haLlegado", "noVino", "deshacer", "mover"];
    for (const estado of ESTADOS) {
      for (const a of servicio) expect(acciones(estado, "lista", true)[a].visible, `lista/${estado}/${a}`).toBe(false);
      for (const a of gestion) expect(acciones(estado, "hoy", true)[a].visible, `hoy/${estado}/${a}`).toBe(false);
    }
  });
});

describe("coherencia con las reglas que ya usan ControlLlegada y el kanban (estadosReserva.ts, servicioSala.ts)", () => {
  it.each(ESTADOS)("%s: «Ha llegado» / «No vino» solo si se espera su llegada (viva); «Deshacer» solo si ya llegó o no vino", (estado) => {
    const hoy = acciones(estado, "hoy", true);
    expect(hoy.haLlegado.visible).toBe(esEstadoVivo(estado));
    expect(hoy.noVino.visible).toBe(esEstadoVivo(estado));
    expect(hoy.deshacer.visible).toBe(haLlegado(estado) || estado === "no_show");
  });

  it.each(ESTADOS)("%s: se puede mover exactamente si ocupa sitio (`ocupaEspacio`)", (estado) => {
    expect(acciones(estado, "hoy", true).mover.habilitada).toBe(ocupaEspacio(estado));
  });
});

describe("cambios acordados", () => {
  describe("(a) una reserva «Llegó» o «No vino» ya no se puede cancelar", () => {
    it.each([
      ["completada", "No se puede cancelar una reserva que ya llegó"],
      ["no_show", "No se puede cancelar una reserva marcada como «No vino»"],
    ])("%s: la ranura sigue en la Lista, deshabilitada y con el motivo, con o sin permiso", (estado, motivo) => {
      for (const canEdit of [true, false]) {
        const cancelar = acciones(estado, "lista", canEdit).cancelar;
        expect(cancelar).toEqual({ visible: true, habilitada: false, titulo: motivo });
      }
    });

    it("las vivas siguen pudiéndose cancelar con permiso", () => {
      for (const estado of ["pendiente", "verificada", "confirmada"]) {
        expect(acciones(estado, "lista", true).cancelar.habilitada, estado).toBe(true);
      }
    });

    it("y Hoy nunca ofreció cancelar", () => {
      for (const estado of ESTADOS) expect(acciones(estado, "hoy", true).cancelar.visible).toBe(false);
    });
  });

  describe("(b) editar está en los seis estados de las dos vistas, y solo lo apaga el permiso", () => {
    it.each(VISTAS)("%s", (vista) => {
      for (const estado of ESTADOS) {
        expect(acciones(estado, vista, true).editar, estado).toMatchObject({ visible: true, habilitada: true });
        expect(acciones(estado, vista, false).editar, estado).toEqual({
          visible: true,
          habilitada: false,
          titulo: TITULO_SIN_PERMISO_EDITAR,
        });
      }
    });

    it("el texto sin permiso es el que ya usan la lista, el kanban, el plano y el panel de asignación", () => {
      expect(TITULO_SIN_PERMISO_EDITAR).toBe("No tienes permiso para editar reservas");
    });
  });

  describe("(c) Hoy respeta el permiso en todas sus acciones (la lista negra, desde el paso 1)", () => {
    it("con permiso están habilitadas; sin él, deshabilitadas y dicen por qué", () => {
      for (const estado of ESTADOS) {
        const con = acciones(estado, "hoy", true);
        const sin = acciones(estado, "hoy", false);
        for (const a of ["haLlegado", "noVino", "deshacer", "mover", "importante", "listaNegra", "editar"] as const) {
          if (!con[a].visible) continue;
          // mover en cancelada / No vino no se habilita ni con permiso: no hay a dónde.
          if (a !== "mover" || con[a].habilitada) expect(con[a].habilitada, `${estado}/${a}`).toBe(true);
          expect(sin[a].habilitada, `${estado}/${a}`).toBe(false);
          expect(sin[a].visible, `${estado}/${a}`).toBe(true);
        }
      }
    });

    it("«Mover» en una reserva que no ocupa sitio dice que no se puede, antes que lo del permiso", () => {
      for (const canEdit of [true, false]) {
        expect(acciones("no_show", "hoy", canEdit).mover.titulo).toBe("No se puede mover en este estado");
        expect(acciones("cancelada", "hoy", canEdit).mover.titulo).toBe("No se puede mover en este estado");
      }
    });
  });

  describe("(d) un solo vocabulario: «Ha llegado» / «No vino»", () => {
    it("los botones de servicio se llaman así", () => {
      expect(titulo("confirmada", "hoy", true, "haLlegado")).toBe("Ha llegado");
      expect(titulo("confirmada", "hoy", true, "noVino")).toBe("No vino");
      expect(titulo("no_show", "hoy", true, "deshacer")).toBe("Deshacer «No vino»");
      expect(titulo("completada", "hoy", true, "deshacer")).toBe("Deshacer llegada");
    });

    it("ningún texto de ninguna combinación dice «no se presentó»", () => {
      const todos = VISTAS.flatMap((vista) =>
        [true, false].flatMap((canEdit) =>
          [...ESTADOS, "rechazada"].flatMap((estado) =>
            ACCIONES_RESERVA.map((a) => acciones(estado, vista, canEdit, { importante: true })[a].titulo),
          ),
        ),
      );
      expect(todos.filter((t) => /no se present/i.test(t))).toEqual([]);
    });

    it("ni «servida»: el estado se llama «Llegó» (paso 3, al pasar la Lista a este módulo)", () => {
      const todos = VISTAS.flatMap((vista) =>
        [true, false].flatMap((canEdit) => ESTADOS.flatMap((estado) => ACCIONES_RESERVA.map((a) => acciones(estado, vista, canEdit)[a].titulo))),
      );
      expect(todos.filter((t) => /servida/i.test(t))).toEqual([]);
    });
  });
});

describe("Lista — textos (los de hoy: el paso que migre la Lista no cambia lo que lee el personal)", () => {
  it("aceptar", () => {
    // Cambio acordado (2026-10-01): «Aceptar» acepta la reserva tal como está; antes decía «tal y como la pidió el cliente».
    expect(titulo("pendiente", "lista", true, "aceptar")).toBe(
      "Aceptar la reserva tal como está (hora y sala actuales); se avisa al cliente si tiene email",
    );
    expect(TITULO_ACEPTAR).toBe(titulo("pendiente", "lista", true, "aceptar"));
    expect(titulo("pendiente", "lista", false, "aceptar")).toBe(TITULO_SIN_PERMISO_EDITAR);
  });

  it("confirmar: «Confirmar» si está verificada; si no hay nada que confirmar, lo dice con la frase del estado", () => {
    expect(titulo("verificada", "lista", true, "confirmar")).toBe("Confirmar la reserva verificada");
    expect(titulo("confirmada", "lista", true, "confirmar")).toBe("Nada que aceptar ni confirmar: la reserva está ya confirmada");
    expect(titulo("cancelada", "lista", true, "confirmar")).toBe("Nada que aceptar ni confirmar: la reserva está cancelada");
    expect(titulo("no_show", "lista", true, "confirmar")).toBe("Nada que aceptar ni confirmar: la reserva está marcada como «no vino»");
    // Vocabulario único (decisión (d), paso 3): «Llegó», ya no «ya servida».
    expect(titulo("completada", "lista", true, "confirmar")).toBe("Nada que aceptar ni confirmar: la reserva está marcada como «Llegó»");
    // Sin permiso manda el permiso, sea cual sea el estado.
    for (const estado of ["verificada", "confirmada", "completada", "cancelada", "no_show"]) {
      expect(titulo(estado, "lista", false, "confirmar"), estado).toBe(TITULO_SIN_PERMISO_EDITAR);
    }
  });

  it("verificar: solo las pendientes; el texto del resto explica por qué no", () => {
    expect(titulo("pendiente", "lista", true, "verificar")).toBe("Verificar: comparar lo pedido con lo ofrecido");
    for (const estado of ["verificada", "confirmada", "completada", "cancelada", "no_show"]) {
      expect(titulo(estado, "lista", true, "verificar"), estado).toBe("Verificar: solo para reservas pendientes");
    }
  });

  it("CAMBIO (e): sin permiso, «Verificar», la estrella y la lista negra lo dicen, en cualquier estado", () => {
    for (const estado of ESTADOS) {
      for (const accion of ["verificar", "importante", "listaNegra"] as const) {
        expect(acciones(estado, "lista", false)[accion], `${estado}/${accion}`).toEqual({
          visible: true,
          habilitada: false,
          titulo: TITULO_SIN_PERMISO_EDITAR,
        });
      }
    }
  });

  it("seleccionar (aceptar en bloque)", () => {
    expect(titulo("pendiente", "lista", true, "seleccionar")).toBe("Seleccionar para aceptar en bloque");
  });

  it("cancelar: con el nombre; el estado manda sobre el permiso", () => {
    expect(titulo("confirmada", "lista", true, "cancelar")).toBe("Cancelar la reserva de Ana — pedirá confirmación");
    expect(titulo("confirmada", "lista", false, "cancelar")).toBe(TITULO_SIN_PERMISO_CANCELAR);
    expect(TITULO_SIN_PERMISO_CANCELAR).toBe("No tienes permiso para cancelar reservas");
    expect(titulo("cancelada", "lista", true, "cancelar")).toBe("La reserva ya está cancelada");
    expect(titulo("cancelada", "lista", false, "cancelar")).toBe("La reserva ya está cancelada");
  });

  it("editar: empieza por «Gestionar» (así la llama «Dar mesa» cuando falta la sala) y lleva el nombre", () => {
    expect(titulo("pendiente", "lista", true, "editar")).toBe(
      "Gestionar: editar la reserva de Ana — datos, día, hora, comensales y sala",
    );
  });

  it("la estrella y la lista negra llevan el nombre", () => {
    expect(titulo("pendiente", "lista", true, "importante")).toBe("Marcar Ana como importante");
    expect(titulo("pendiente", "lista", true, "importante", { importante: true })).toBe("Desmarcar Ana como importante");
    expect(titulo("pendiente", "lista", true, "listaNegra")).toBe("Añadir a Ana a la lista negra");
  });

  it.each([null, undefined, ""])("una reserva sin nombre (%j) sale como «este cliente»", (nombre) => {
    for (const accion of ["cancelar", "editar", "importante", "listaNegra"] as const) {
      expect(titulo("confirmada", "lista", true, accion, { nombre }), accion).toContain("este cliente");
    }
  });
});

describe("Hoy — textos (los del kanban y ControlLlegada, con el vocabulario de (d))", () => {
  it("servicio", () => {
    expect(titulo("pendiente", "hoy", true, "haLlegado")).toBe("Ha llegado");
    expect(titulo("pendiente", "hoy", true, "noVino")).toBe("No vino");
    expect(titulo("completada", "hoy", true, "deshacer")).toBe("Deshacer llegada");
    expect(titulo("no_show", "hoy", true, "deshacer")).toBe("Deshacer «No vino»");
    expect(titulo("confirmada", "hoy", true, "mover")).toBe("Mover a…");
  });

  it("editar, estrella y lista negra", () => {
    expect(titulo("confirmada", "hoy", true, "editar")).toBe("Editar reserva");
    expect(titulo("confirmada", "hoy", true, "importante")).toBe("Marcar como importante");
    expect(titulo("confirmada", "hoy", true, "importante", { importante: true })).toBe("Quitar importante");
    expect(titulo("confirmada", "hoy", true, "listaNegra")).toBe("Añadir a blacklist");
  });

  it("sin permiso, TODAS las acciones visibles de Hoy llevan el texto del permiso (salvo mover en un estado que no se mueve)", () => {
    for (const [estado, accion] of [
      ["confirmada", "haLlegado"],
      ["confirmada", "noVino"],
      ["completada", "deshacer"],
      ["no_show", "deshacer"],
      ["confirmada", "mover"],
      ["confirmada", "editar"],
      ["confirmada", "importante"],
      ["confirmada", "listaNegra"],
    ] as const) {
      expect(titulo(estado, "hoy", false, accion), `${estado}/${accion}`).toBe(TITULO_SIN_PERMISO_EDITAR);
    }
  });
});

describe("un estado que no es de los seis (no existe en la BD: el comportamiento es solo defensivo)", () => {
  it("Lista: nada que confirmar ni cancelar, y el texto dice el estado tal cual; editar sigue", () => {
    expect(acciones("rechazada", "lista", true).confirmar).toEqual({
      visible: true,
      habilitada: false,
      titulo: "Nada que aceptar ni confirmar: la reserva está rechazada",
    });
    expect(acciones("rechazada", "lista", true).cancelar.habilitada).toBe(false);
    expect(acciones("rechazada", "lista", true).cancelar.titulo).toBe("No se puede cancelar: la reserva está rechazada");
    expect(acciones("rechazada", "lista", true).editar.habilitada).toBe(true);
  });

  it("Hoy: sin acciones de servicio y sin mover", () => {
    const hoy = acciones("rechazada", "hoy", true);
    for (const a of ["haLlegado", "noVino", "deshacer"] as const) expect(hoy[a].visible, a).toBe(false);
    expect(hoy.mover).toMatchObject({ visible: true, habilitada: false, titulo: "No se puede mover en este estado" });
    expect(hoy.editar.habilitada).toBe(true);
  });
});
