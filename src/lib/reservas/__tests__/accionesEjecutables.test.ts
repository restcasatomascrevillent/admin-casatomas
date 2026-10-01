/**
 * La tabla de acciones que ejecuta el único ejecutor (`accionesEjecutables.ts`): cada
 * acción declara qué COLUMNAS escribe, si AVISA AL CLIENTE, qué le dice al PERSONAL y de
 * qué estados puede partir. Módulo puro: estos tests no necesitan Supabase ni React.
 *
 * Los textos y las columnas son los de hoy: el ejecutor no debe cambiar lo que escribe ni
 * lo que lee el personal salvo donde el paso 2 lo dice (el «Deshacer» del chip vuelve al
 * estado previo; las acciones ya no parten de un estado que no les corresponde).
 *
 * CONTRATO DEL SERVIDOR que hace que el payload de `notify-reservation-change` dé igual
 * (`supabase/functions/notify-reservation-change/index.ts`): solo lee `reserva_id ?? id`, y
 * `emails-reserva` RELEE el estado de la BD para elegir la plantilla. Lo que cuenta es el
 * ESTADO que se escribe ANTES de avisar y, por eso, cada acción que avisa escribe primero.
 *
 * LOS ESTADOS DE PARTIDA SE FIJAN A MANO (la tabla `PARTIDA` de abajo) y no se calculan con
 * la misma función de la que salen: una comparación «la guarda = `accionesDisponibles`» no
 * detectaría que un cambio en `accionesDisponibles` mueve a la vez el botón y la regla.
 */
import { describe, it, expect } from "vitest";
import {
  ACCIONES_EJECUTABLES,
  IDS_ACCIONES_EJECUTABLES,
  desdeEstadosDeLaEscritura,
  estadosDePartida,
  evaluarGuarda,
  type IdAccionEjecutable,
  type ReservaEjecutable,
} from "../accionesEjecutables";
import { ORDEN_ESTADOS } from "../estadosReserva";

const AHORA = new Date("2026-09-30T19:23:00.000Z");

const reserva = (extra: Partial<ReservaEjecutable> = {}): ReservaEjecutable => ({
  id: "r1",
  estado: "confirmada",
  nombre: "Ana",
  email: "ana@ejemplo.com",
  hora: "21:00:00",
  espacio_id: null,
  importante: false,
  ...extra,
});

const cambios = <K extends IdAccionEjecutable>(id: K, r: ReservaEjecutable, entrada?: unknown, estadoPrevio?: string) =>
  ACCIONES_EJECUTABLES[id].cambios(r, entrada as never, { ahora: AHORA, estadoPrevio });

describe("el catálogo", () => {
  it("son diez acciones, las que mueven una reserva desde la Lista, el modal, Hoy y el modo servicio", () => {
    expect([...IDS_ACCIONES_EJECUTABLES]).toEqual([
      "aceptar",
      "verificar",
      "confirmar",
      "cancelar",
      "rechazar",
      "haLlegado",
      "noVino",
      "deshacer",
      "mover",
      "importante",
    ]);
    expect(Object.keys(ACCIONES_EJECUTABLES).sort()).toEqual([...IDS_ACCIONES_EJECUTABLES].sort());
  });

  it("AVISAN al cliente exactamente cinco: aceptar, verificar, confirmar, cancelar y rechazar", () => {
    const avisan = IDS_ACCIONES_EJECUTABLES.filter((id) => ACCIONES_EJECUTABLES[id].avisaCliente);
    expect(avisan).toEqual(["aceptar", "verificar", "confirmar", "cancelar", "rechazar"]);
  });

  it("llegada, «No vino», deshacer, mover y la estrella NO avisan al cliente (decisiones internas, sin plantilla de correo)", () => {
    for (const id of ["haLlegado", "noVino", "deshacer", "mover", "importante"] as const) {
      expect(ACCIONES_EJECUTABLES[id].avisaCliente, id).toBe(false);
    }
  });
});

describe("las columnas que escribe cada acción", () => {
  it("«Ha llegado»: 'completada' + llegada_at con la hora de ahora (ISO)", () => {
    expect(cambios("haLlegado", reserva())).toEqual({ estado: "completada", llegada_at: "2026-09-30T19:23:00.000Z" });
  });

  it("«No vino»: 'no_show' y llegada_at null", () => {
    expect(cambios("noVino", reserva())).toEqual({ estado: "no_show", llegada_at: null });
  });

  it("deshacer: vuelve al estado que tenía ANTES y borra llegada_at", () => {
    expect(cambios("deshacer", reserva({ estado: "completada" }), undefined, "verificada")).toEqual({
      estado: "verificada",
      llegada_at: null,
    });
  });

  it("deshacer sin estado previo conocido: 'confirmada', como hasta ahora", () => {
    expect(cambios("deshacer", reserva({ estado: "no_show" }))).toEqual({ estado: "confirmada", llegada_at: null });
  });

  it("mover: solo `espacio_id`, también a null («Sin asignar»)", () => {
    const mover = ACCIONES_EJECUTABLES.mover.cambios;
    expect(mover(reserva(), { destinoId: "terraza", nombreDestino: "Terraza" }, { ahora: AHORA })).toEqual({ espacio_id: "terraza" });
    expect(mover(reserva(), { destinoId: null, nombreDestino: "Sin asignar" }, { ahora: AHORA })).toEqual({ espacio_id: null });
  });

  it("aceptar: solo el estado (y la sala solo si hay que rellenarla): ver la sección «Aceptar acepta la reserva TAL COMO ESTÁ» más abajo", () => {
    expect(cambios("aceptar", reserva({ estado: "pendiente", hora: "14:00:00" }))).toEqual({ estado: "verificada" });
  });

  it("verificar: la hora y la sala DECIDIDAS", () => {
    const verificar = ACCIONES_EJECUTABLES.verificar.cambios;
    expect(verificar(reserva({ estado: "pendiente" }), { hora: "21:00", espacio_id: "salon" }, { ahora: AHORA })).toEqual({
      hora: "21:00",
      espacio_id: "salon",
      estado: "verificada",
    });
    expect(verificar(reserva({ estado: "pendiente" }), { hora: "14:00", espacio_id: null }, { ahora: AHORA })).toEqual({
      hora: "14:00",
      espacio_id: null,
      estado: "verificada",
    });
  });

  it("confirmar: 'confirmada'; cancelar y rechazar: 'cancelada' (no existe un estado «rechazada»)", () => {
    expect(cambios("confirmar", reserva({ estado: "verificada" }))).toEqual({ estado: "confirmada" });
    expect(cambios("cancelar", reserva())).toEqual({ estado: "cancelada" });
    expect(cambios("rechazar", reserva({ estado: "pendiente" }))).toEqual({ estado: "cancelada" });
  });

  it("la estrella: alterna el valor de ahora (sin valor cuenta como desmarcada)", () => {
    expect(cambios("importante", reserva({ importante: false }))).toEqual({ importante: true });
    expect(cambios("importante", reserva({ importante: true }))).toEqual({ importante: false });
    expect(cambios("importante", reserva({ importante: null }))).toEqual({ importante: true });
    expect(cambios("importante", reserva({ importante: undefined }))).toEqual({ importante: true });
  });
});

describe("aceptar: «Aceptar» acepta la reserva TAL COMO ESTÁ AHORA (cambio acordado con el dueño, 2026-10-01)", () => {
  // Antes escribía `hora = hora_solicitada` y `espacio_id = espacio_solicitado_id`. En Casa Tomás el cliente ya
  // no elige sala (`espacio_solicitado_id` es null), así que Aceptar dejaba `espacio_id` en null y el trigger de
  // la BD BORRABA la sala y las mesas que el personal ya hubiera asignado; y revertía en silencio la hora que el
  // personal hubiera editado antes de aceptar. Ahora solo escribe el estado (y la sala, solo para rellenarla).
  const SALON = "e-salon";
  const RESERVADO = "e-reservado-touza";

  /**
   * ¿Se ejecutaría `trg_reservas_sincronizar_asignaciones` (y con él, borrar o mover las mesas)? Es el `WHEN` del
   * trigger (migración 20260926140000): cancelar, o cambiar `espacio_id`, `fecha` u `hora`. Copiado aquí para que
   * el test diga CLARAMENTE que Aceptar no toca las mesas.
   */
  const tocariaLasMesas = (actual: ReservaEjecutable, cambiosEscritos: object) => {
    const escrito = cambiosEscritos as Record<string, unknown>;
    return (
      escrito.estado === "cancelada" ||
      ("espacio_id" in escrito && (escrito.espacio_id ?? null) !== (actual.espacio_id ?? null)) ||
      ("hora" in escrito && escrito.hora !== actual.hora)
    );
  };

  const pendiente = (extra: Partial<ReservaEjecutable>) => reserva({ estado: "pendiente", hora: "14:00:00", espacio_id: null, ...extra });

  it("Casa Tomás, sin sala pedida ni asignada: escribe SOLO el estado", () => {
    expect(cambios("aceptar", pendiente({ hora_solicitada: "14:00:00", espacio_solicitado_id: null }))).toEqual({ estado: "verificada" });
  });

  it("Casa Tomás con la sala que ya asignó el personal (el caso P1): NO la toca, así que el trigger no borra ni sala ni mesas", () => {
    const actual = pendiente({ hora_solicitada: "14:00:00", espacio_id: SALON, espacio_solicitado_id: null });
    const escrito = cambios("aceptar", actual);

    expect(escrito).toEqual({ estado: "verificada" });
    expect(escrito).not.toHaveProperty("espacio_id");
    expect(tocariaLasMesas(actual, escrito)).toBe(false);
  });

  it("con la hora EDITADA por el personal (distinta de la pedida): NO se revierte, la hora ni se escribe", () => {
    const actual = pendiente({ hora: "14:30:00", hora_solicitada: "14:00:00", espacio_solicitado_id: null });
    const escrito = cambios("aceptar", actual);

    expect(escrito).toEqual({ estado: "verificada" });
    expect(escrito).not.toHaveProperty("hora");
    expect(tocariaLasMesas(actual, escrito)).toBe(false);
  });

  it("hora editada Y sala asignada a la vez: lo único que cambia es el estado", () => {
    const actual = pendiente({ hora: "21:15:00", hora_solicitada: "14:00:00", espacio_id: SALON, espacio_solicitado_id: null });

    expect(cambios("aceptar", actual)).toEqual({ estado: "verificada" });
  });

  it("Touza (El Reservado), con su espacio ya fijado (el normal): idéntico a antes en el resultado, solo el estado", () => {
    const actual = pendiente({ espacio_id: RESERVADO, espacio_solicitado_id: RESERVADO, hora_solicitada: "14:00:00" });
    const escrito = cambios("aceptar", actual);

    expect(escrito).toEqual({ estado: "verificada" });
    expect(tocariaLasMesas(actual, escrito)).toBe(false);
  });

  it("Touza sin espacio ahora y con el pedido: lo RELLENA con el pedido (el espacio ES lo reservado)", () => {
    expect(cambios("aceptar", pendiente({ espacio_id: null, espacio_solicitado_id: RESERVADO }))).toEqual({
      espacio_id: RESERVADO,
      estado: "verificada",
    });
  });

  it("con la sala actual distinta de la pedida: manda la ACTUAL, no se cambia por la pedida", () => {
    const actual = pendiente({ espacio_id: SALON, espacio_solicitado_id: RESERVADO });

    expect(cambios("aceptar", actual)).toEqual({ estado: "verificada" });
  });

  it("con la migración sin aplicar (la fila no trae lo pedido): también solo el estado", () => {
    expect(cambios("aceptar", pendiente({ espacio_id: SALON }))).toEqual({ estado: "verificada" });
    expect(cambios("aceptar", pendiente({ espacio_id: null }))).toEqual({ estado: "verificada" });
  });

  it("INVARIANTE: en todas las combinaciones, jamás escribe `hora` ni `espacio_id` en null, ni cambia la sala por otra distinta de la que hay", () => {
    const horas = ["14:00:00", "14:30:00", "21:00:00"];
    const pedidasHora = [null, undefined, "14:00:00", "20:00:00"];
    const actuales = [null, SALON, RESERVADO];
    const pedidasSala = [null, undefined, SALON, RESERVADO, "e-terraza"];
    for (const hora of horas) {
      for (const hora_solicitada of pedidasHora) {
        for (const espacio_id of actuales) {
          for (const espacio_solicitado_id of pedidasSala) {
            const actual = pendiente({ hora, hora_solicitada, espacio_id, espacio_solicitado_id });
            const escrito = cambios("aceptar", actual);
            const combinacion = JSON.stringify({ hora, hora_solicitada, espacio_id, espacio_solicitado_id });
            expect(escrito.estado, combinacion).toBe("verificada");
            expect(escrito, combinacion).not.toHaveProperty("hora");
            expect(escrito.espacio_id, combinacion).not.toBeNull();
            // La sala solo se escribe para RELLENAR la que falta, y con la pedida.
            if ("espacio_id" in escrito) {
              expect(espacio_id, combinacion).toBeNull();
              expect(escrito.espacio_id, combinacion).toBe(espacio_solicitado_id);
            }
            // Y el UPDATE nunca llega a mover ni borrar mesas salvo al rellenar una sala que no había.
            if (espacio_id) expect(tocariaLasMesas(actual, escrito), combinacion).toBe(false);
          }
        }
      }
    }
  });

  it("el aviso dice la hora ACTUAL (la que ve el personal), aunque el cliente pidiera otra", () => {
    const def = ACCIONES_EJECUTABLES.aceptar;
    const actual = pendiente({ hora: "14:30:00", hora_solicitada: "14:00:00" });
    const aviso = def.aviso(actual, undefined, def.cambios(actual, undefined, { ahora: AHORA }));

    expect(aviso?.titulo).toBe("Reserva verificada para las 14:30");
  });

  it("sigue AVISANDO al cliente: es el estado lo que dispara el correo (el servidor relee la BD)", () => {
    expect(ACCIONES_EJECUTABLES.aceptar.avisaCliente).toBe(true);
  });
});

describe("el estado de partida de cada acción: la regla, fijada a mano", () => {
  // ✔ = la acción parte de ese estado · = no. Columnas en el orden del ciclo de vida (`ORDEN_ESTADOS`).
  // La regla viene de `accionesDisponibles` (la función que habilita el botón), pero esta tabla NO se
  // calcula con ella: si cambia la regla, este test tiene que cambiar a propósito.
  //
  //                pend verif confir Llegó cancel NoVino
  const PARTIDA: Record<IdAccionEjecutable, string> = {
    aceptar: "✔·····",
    verificar: "✔·····",
    confirmar: "·✔····",
    cancelar: "✔✔✔···",
    // B1: solo una PENDIENTE. El modal «Verificar solicitud» solo se abre con una pendiente; si otra
    // persona la aceptó entre tanto (sale «propuesta»), rechazarla mandaría «rechazada»: dos correos
    // contradictorios al cliente.
    rechazar: "✔·····",
    haLlegado: "✔✔✔···",
    noVino: "✔✔✔···",
    deshacer: "···✔·✔",
    mover: "✔✔✔✔··",
    importante: "✔✔✔✔✔✔",
  };

  it("las seis columnas son los seis estados, en ese orden", () => {
    expect([...ORDEN_ESTADOS]).toEqual(["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"]);
  });

  it.each(IDS_ACCIONES_EJECUTABLES)("%s parte exactamente de los estados de la tabla", (id) => {
    const obtenido = ORDEN_ESTADOS.map((estado) => (evaluarGuarda(id, reserva({ estado })).ok ? "✔" : "·")).join("");
    expect(obtenido).toBe(PARTIDA[id]);
  });

  it.each([
    ["aceptar", ["pendiente"]],
    ["verificar", ["pendiente"]],
    ["confirmar", ["verificada"]],
    ["cancelar", ["pendiente", "verificada", "confirmada"]],
    ["rechazar", ["pendiente"]],
    ["haLlegado", ["pendiente", "verificada", "confirmada"]],
    ["noVino", ["pendiente", "verificada", "confirmada"]],
    ["deshacer", ["completada", "no_show"]],
    ["mover", ["pendiente", "verificada", "confirmada", "completada"]],
    ["importante", null],
  ] as const)("estadosDePartida(%s) = %j (lo que admite la regla)", (id, esperado) => {
    expect(estadosDePartida(id)).toEqual(esperado);
  });

  it("rechazar y verificar comparten el estado de partida: el modal solo se abre con una pendiente", () => {
    expect(estadosDePartida("rechazar")).toEqual(estadosDePartida("verificar"));
  });

  it("rechazar ya NO parte de una verificada ni de una confirmada (cancelar sí)", () => {
    for (const estado of ["verificada", "confirmada"]) {
      expect(evaluarGuarda("rechazar", reserva({ estado })).ok, estado).toBe(false);
      expect(evaluarGuarda("cancelar", reserva({ estado })).ok, estado).toBe(true);
    }
  });

  it("la estrella vale en cualquier estado: no hay condición", () => {
    expect(estadosDePartida("importante")).toBeNull();
    for (const estado of ORDEN_ESTADOS) expect(evaluarGuarda("importante", reserva({ estado })).ok).toBe(true);
    // Ni siquiera con un estado que no existe.
    expect(evaluarGuarda("importante", reserva({ estado: "rechazada" })).ok).toBe(true);
  });

  it("una reserva con un estado que no es de los seis no admite ninguna acción de estado (salvo la estrella)", () => {
    for (const id of IDS_ACCIONES_EJECUTABLES.filter((x) => x !== "importante")) {
      expect(evaluarGuarda(id, reserva({ estado: "rechazada" })).ok, id).toBe(false);
    }
  });
});

describe("desdeEstadosDeLaEscritura · lo que exige el UPDATE en la BD", () => {
  // M1: «Ha llegado» y «No vino» guardan el estado previo para el «Deshacer» del chip. Ese estado
  // previo es el que VIO el personal en la tarjeta, y la tarjeta puede estar desfasada (kanban y lista
  // no tienen realtime): si en la oficina la verificaron mientras tanto, guardar «Pendiente» y volver a
  // él con el chip dejaría la reserva en un estado que ya no le toca (y la lista volvería a ofrecer
  // «Aceptar», que reescribe hora y sala). Por eso la escritura va condicionada al estado que vio el
  // personal y, si la BD ya no está así pero SIGUE VIVA (la tarjeta decía «Verificada» y el cliente ya
  // había confirmado), se reintenta una vez desde el estado leído (`adoptaEstadoVivo`): exigir el estado
  // EXACTO sin más daba un falso error en plena hora de servicio. El chip sí exige el estado exacto.
  it.each(["haLlegado", "noVino"] as const)("%s exige el estado EXACTO que vio el personal, no cualquier estado vivo", (id) => {
    for (const estado of ["pendiente", "verificada", "confirmada"]) {
      expect(desdeEstadosDeLaEscritura(id, reserva({ estado }))).toEqual([estado]);
    }
  });

  it("deshacer (el chip) también: exige seguir «Llegó» o «No vino», según lo que vio el personal", () => {
    expect(desdeEstadosDeLaEscritura("deshacer", reserva({ estado: "completada" }))).toEqual(["completada"]);
    expect(desdeEstadosDeLaEscritura("deshacer", reserva({ estado: "no_show" }))).toEqual(["no_show"]);
  });

  it.each([
    ["aceptar", ["pendiente"]],
    ["verificar", ["pendiente"]],
    ["confirmar", ["verificada"]],
    ["cancelar", ["pendiente", "verificada", "confirmada"]],
    ["rechazar", ["pendiente"]],
    ["mover", ["pendiente", "verificada", "confirmada", "completada"]],
    ["importante", null],
  ] as const)("%s exige lo mismo que admite la regla: %j (no guarda ningún estado previo)", (id, esperado) => {
    // Da igual el estado que vea la tarjeta: la condición es el conjunto de la regla.
    expect(desdeEstadosDeLaEscritura(id, reserva({ estado: "pendiente" }))).toEqual(esperado);
    expect(desdeEstadosDeLaEscritura(id, reserva({ estado: "confirmada" }))).toEqual(esperado);
  });

  it("«Ha llegado» y «No vino» ADOPTAN el estado vivo de verdad (reintento desde el estado leído); el chip «Deshacer» NO: exige el estado exacto", () => {
    const adoptan = IDS_ACCIONES_EJECUTABLES.filter((id) => ACCIONES_EJECUTABLES[id].adoptaEstadoVivo);
    expect(adoptan).toEqual(["haLlegado", "noVino"]);
    expect(ACCIONES_EJECUTABLES.deshacer.desdeEstadoVisto).toBe(true);
    expect(ACCIONES_EJECUTABLES.deshacer.adoptaEstadoVivo).toBeFalsy();
    // Adoptar el estado de verdad solo tiene sentido en las que parten del estado visto.
    for (const id of adoptan) expect(ACCIONES_EJECUTABLES[id].desdeEstadoVisto, id).toBe(true);
  });

  it("las tres acciones de estado exacto son justo las que recuerdan o olvidan el estado previo", () => {
    const exactas = IDS_ACCIONES_EJECUTABLES.filter((id) => ACCIONES_EJECUTABLES[id].desdeEstadoVisto);
    expect(exactas).toEqual(["haLlegado", "noVino", "deshacer"]);
    for (const id of IDS_ACCIONES_EJECUTABLES) {
      const def = ACCIONES_EJECUTABLES[id];
      expect(!!def.desdeEstadoVisto, id).toBe(!!def.recuerdaEstadoPrevio || !!def.olvidaEstadoPrevio);
    }
  });
});

describe("evaluarGuarda · el motivo cuando NO se puede", () => {
  const motivo = (id: IdAccionEjecutable, estado: string) => {
    const r = evaluarGuarda(id, reserva({ estado }));
    return r.ok ? null : r.motivo;
  };

  it("cancelar una reserva que ya llegó o no vino: decisión del dueño, con los textos de siempre de la Lista", () => {
    expect(motivo("cancelar", "completada")).toBe("No se puede cancelar una reserva que ya llegó");
    expect(motivo("cancelar", "no_show")).toBe("No se puede cancelar una reserva marcada como «No vino»");
    expect(motivo("cancelar", "cancelada")).toBe("La reserva ya está cancelada");
    // Rechazar (el modal de una solicitud) solo parte de una pendiente: dice qué pide y en qué está.
    expect(motivo("rechazar", "completada")).toBe("Solo se puede rechazar una reserva pendiente: esta está «Llegó».");
    expect(motivo("rechazar", "verificada")).toBe("Solo se puede rechazar una reserva pendiente: esta está «Verificada».");
  });

  it("mover una cancelada o «No vino»: el mismo texto de siempre", () => {
    expect(motivo("mover", "cancelada")).toBe("Esta reserva no se puede mover.");
    expect(motivo("mover", "no_show")).toBe("Esta reserva no se puede mover.");
  });

  it("llegada y «No vino» fuera de los estados vivos: dicen en qué estado está", () => {
    expect(motivo("haLlegado", "cancelada")).toBe("No se puede registrar la llegada: la reserva está «Cancelada».");
    expect(motivo("haLlegado", "completada")).toBe("No se puede registrar la llegada: la reserva está «Llegó».");
    expect(motivo("noVino", "completada")).toBe("No se puede marcar «No vino»: la reserva está «Llegó».");
  });

  it("deshacer donde no hay nada que deshacer", () => {
    expect(motivo("deshacer", "confirmada")).toBe("No hay nada que deshacer: la reserva está «Confirmada».");
  });

  it("aceptar, verificar y confirmar dicen qué estado piden", () => {
    expect(motivo("aceptar", "verificada")).toBe("Solo se puede aceptar una reserva pendiente: esta está «Verificada».");
    expect(motivo("verificar", "completada")).toBe("Solo se puede verificar una reserva pendiente: esta está «Llegó».");
    expect(motivo("confirmar", "pendiente")).toBe("Solo se puede confirmar una reserva verificada: esta está «Pendiente».");
  });

  it("un estado desconocido se nombra tal cual", () => {
    expect(motivo("haLlegado", "rechazada")).toBe("No se puede registrar la llegada: la reserva está «rechazada».");
  });
});

describe("el verbo del aviso de error («No se pudo …»)", () => {
  const verbo = (id: IdAccionEjecutable, r = reserva()) => ACCIONES_EJECUTABLES[id].verbo(r);

  it("es el de siempre en cada acción", () => {
    expect(verbo("haLlegado")).toBe("registrar la llegada");
    expect(verbo("noVino")).toBe("marcar «No vino»");
    expect(verbo("mover")).toBe("mover la reserva");
    expect(verbo("aceptar")).toBe("guardar");
    expect(verbo("verificar")).toBe("guardar");
    expect(verbo("rechazar")).toBe("rechazar la solicitud");
    expect(verbo("importante")).toBe("actualizar la reserva");
  });

  it("deshacer habla de «No vino» o de la llegada, según de cuál se deshaga", () => {
    expect(verbo("deshacer", reserva({ estado: "no_show" }))).toBe("quitar el «No vino»");
    expect(verbo("deshacer", reserva({ estado: "completada" }))).toBe("deshacer la llegada");
  });

  it("confirmar y cancelar: «confirmar la reserva», «cancelar la reserva»", () => {
    expect(verbo("confirmar")).toBe("confirmar la reserva");
    expect(verbo("cancelar")).toBe("cancelar la reserva");
  });
});

describe("el aviso al personal, una vez guardado", () => {
  const aviso = <K extends IdAccionEjecutable>(id: K, r: ReservaEjecutable, entrada?: unknown) => {
    const def = ACCIONES_EJECUTABLES[id];
    const c = def.cambios(r, entrada as never, { ahora: AHORA, estadoPrevio: undefined });
    return def.aviso(r, entrada as never, c);
  };

  it("«Ha llegado»: con el nombre, 10 s y un «Deshacer» que restaura el estado de partida y borra llegada_at", () => {
    expect(aviso("haLlegado", reserva({ estado: "verificada" }))).toEqual({
      titulo: "Ana ha llegado",
      duracionMs: 10_000,
      deshacer: {
        cambios: { estado: "verificada", llegada_at: null },
        verbo: "deshacer la llegada",
        desde: ["completada"],
        olvidarEstadoPrevio: true,
      },
    });
  });

  it("sin nombre: «Cliente ha llegado»", () => {
    expect(aviso("haLlegado", reserva({ nombre: null }))?.titulo).toBe("Cliente ha llegado");
  });

  it("«No vino»: el «Deshacer» restaura el estado de partida SIN tocar llegada_at", () => {
    expect(aviso("noVino", reserva({ estado: "pendiente" }))).toEqual({
      titulo: "Ana: no vino",
      duracionMs: 10_000,
      deshacer: {
        cambios: { estado: "pendiente" },
        verbo: "deshacer el «No vino»",
        desde: ["no_show"],
        olvidarEstadoPrevio: true,
      },
    });
    expect(aviso("noVino", reserva({ nombre: null }))?.titulo).toBe("Reserva: no vino");
  });

  it("deshacer desde el chip: dice a qué estado ha vuelto, y no ofrece deshacer el deshacer", () => {
    const def = ACCIONES_EJECUTABLES.deshacer;
    expect(def.aviso(reserva({ estado: "completada" }), undefined, { estado: "confirmada", llegada_at: null })).toEqual({
      titulo: "Reserva devuelta a «Confirmada»",
    });
    expect(def.aviso(reserva({ estado: "completada" }), undefined, { estado: "pendiente", llegada_at: null })).toEqual({
      titulo: "Reserva devuelta a «Pendiente»",
    });
  });

  it("mover: «Ana → Terraza», 10 s y un «Deshacer» que vuelve a la sala de origen (null si venía sin asignar)", () => {
    expect(aviso("mover", reserva({ espacio_id: "salon" }), { destinoId: "terraza", nombreDestino: "Terraza" })).toEqual({
      titulo: "Ana → Terraza",
      duracionMs: 10_000,
      deshacer: {
        cambios: { espacio_id: "salon" },
        verbo: "deshacer el movimiento",
        desde: ["pendiente", "verificada", "confirmada", "completada"],
      },
    });
    expect(aviso("mover", reserva({ espacio_id: undefined }), { destinoId: "terraza", nombreDestino: "Terraza" })?.deshacer?.cambios).toEqual({
      espacio_id: null,
    });
    expect(aviso("mover", reserva({ nombre: null }), { destinoId: "t", nombreDestino: "Terraza" })?.titulo).toBe("Reserva → Terraza");
  });

  it("aceptar y verificar: título corto con la hora y, debajo, si al cliente le llega el correo", () => {
    // cambio acordado con el dueño: «Aceptar» no cambia la hora, así que el aviso dice la hora ACTUAL de la
    // reserva (la que ve el personal), no la que pidió el cliente.
    expect(aviso("aceptar", reserva({ estado: "pendiente", hora: "14:00:00", hora_solicitada: "13:30:00" }))).toEqual({
      titulo: "Reserva verificada para las 14:00",
      descripcion: "Se le manda el correo a ana@ejemplo.com",
    });
    expect(aviso("verificar", reserva({ estado: "pendiente", email: null }), { hora: "21:00", espacio_id: null })).toEqual({
      titulo: "Reserva verificada para las 21:00",
      descripcion: "No tiene correo: hay que avisarle por teléfono",
    });
  });

  it("el título de verificar no lleva el nombre del cliente (con uno largo se partía en dos líneas)", () => {
    const titulo = aviso("aceptar", reserva({ estado: "pendiente", nombre: "Miguel Benito Castellanos" }))?.titulo ?? "";
    expect(titulo).not.toContain("Miguel");
    expect(titulo.length).toBeLessThan(40);
  });

  it("rechazar: «Solicitud rechazada» y si al cliente le llega el correo", () => {
    expect(aviso("rechazar", reserva({ estado: "pendiente", email: null }))).toEqual({
      titulo: "Solicitud rechazada",
      descripcion: "No tiene correo: hay que avisarle por teléfono",
    });
  });

  it.each(["confirmar", "cancelar"] as const)("%s: «Estado actualizado correctamente», y solo avisa de la falta de email si falta", (id) => {
    expect(aviso(id, reserva({ email: "ana@ejemplo.com" }))).toEqual({ titulo: "Estado actualizado correctamente" });
    const sinEmail = { titulo: "Estado actualizado correctamente", descripcion: "Sin email: no se envía ningún correo al cliente." };
    expect(aviso(id, reserva({ email: null }))).toEqual(sinEmail);
    expect(aviso(id, reserva({ email: "   " }))).toEqual(sinEmail);
    expect(aviso(id, reserva({ email: undefined }))).toEqual(sinEmail);
  });

  it("la estrella: dice si queda marcada o desmarcada", () => {
    expect(aviso("importante", reserva({ importante: false }))).toEqual({ titulo: "Reserva marcada como importante" });
    expect(aviso("importante", reserva({ importante: true }))).toEqual({ titulo: "Reserva desmarcada" });
  });

  it("solo las acciones de llegada, «No vino» y mover ofrecen «Deshacer» en su aviso", () => {
    const conDeshacer = (["aceptar", "confirmar", "cancelar", "rechazar", "importante"] as const).filter(
      (id) => aviso(id, reserva({ estado: "pendiente" }))?.deshacer,
    );
    expect(conDeshacer).toEqual([]);
  });
});

describe("el estado previo: quién lo guarda y quién lo olvida", () => {
  it("llegada y «No vino» lo RECUERDAN (desde ahí se puede volver); deshacer lo OLVIDA", () => {
    expect(ACCIONES_EJECUTABLES.haLlegado.recuerdaEstadoPrevio).toBe(true);
    expect(ACCIONES_EJECUTABLES.noVino.recuerdaEstadoPrevio).toBe(true);
    expect(ACCIONES_EJECUTABLES.deshacer.olvidaEstadoPrevio).toBe(true);
    for (const id of ["aceptar", "verificar", "confirmar", "cancelar", "rechazar", "mover", "importante"] as const) {
      expect(ACCIONES_EJECUTABLES[id].recuerdaEstadoPrevio, id).toBeFalsy();
      expect(ACCIONES_EJECUTABLES[id].olvidaEstadoPrevio, id).toBeFalsy();
    }
  });
});

describe("los errores propios de cada acción", () => {
  it("aceptar, verificar y rechazar traducen «falta la migración de hora_solicitada» en vez de enseñar el error crudo", () => {
    for (const id of ["aceptar", "verificar", "rechazar"] as const) {
      const traducir = ACCIONES_EJECUTABLES[id].traducirError!;
      expect(traducir({ code: "PGRST204", message: "x" }), id).toMatch(/falta aplicar en la base de datos la migración pendiente/);
      expect(traducir({ code: "42703", message: "x" }), id).toMatch(/falta aplicar/);
      expect(traducir({ message: "column reservas.hora_solicitada does not exist" }), id).toMatch(/falta aplicar/);
      expect(traducir({ code: "42501", message: "denegado" }), id).toBeNull();
    }
  });

  it("las demás no traducen nada: el mensaje es «No se pudo {verbo}: {error}»", () => {
    for (const id of ["confirmar", "cancelar", "haLlegado", "noVino", "deshacer", "mover", "importante"] as const) {
      expect(ACCIONES_EJECUTABLES[id].traducirError, id).toBeUndefined();
    }
  });
});
