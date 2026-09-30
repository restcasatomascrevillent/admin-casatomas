import { describe, it, expect } from "vitest";
import {
  avisoAlClienteTrasEdicion,
  calcularCambiosEdicion,
  cambiaAforo,
  camposCambiados,
  debeNotificarEdicion,
  efectoEnMesas,
  errorEmailEdicion,
  errorNombreEdicion,
  errorTelefonoEdicion,
  ErrorSinFilasEdicion,
  esReservaViva,
  interpretarRespuestaNotificacion,
  invalidaEnlaceConfirmacion,
  mensajeErrorEdicion,
  TEXTO_ENLACE_INVALIDADO,
  textoCamposCambiados,
  valoresFormularioDesdeReserva,
  type EnvioCorreoEdicion,
  type ReservaEditable,
  type ValoresEditados,
} from "@/lib/reservas/edicionReserva";

/** Reserva de partida: confirmada, con email y sin nada raro. */
const reserva = (over: Partial<ReservaEditable> = {}): ReservaEditable => ({
  id: "res-1",
  nombre: "Ana López",
  telefono: "+34612345678",
  email: "ana@ejemplo.com",
  fecha: "2026-10-10",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  notas_cliente: "Sin gluten",
  espacio_id: "salon",
  marca: "casa_tomas",
  canal: "telefono",
  importante: false,
  en_blacklist: false,
  ...over,
});

/** Lo que deja el formulario si el usuario no toca nada. */
const sinTocar = (r: ReservaEditable): ValoresEditados => {
  const v = valoresFormularioDesdeReserva(r);
  return { ...v };
};

describe("edicionReserva · esReservaViva (la que cuenta en el aforo)", () => {
  it("solo pendiente, verificada y confirmada", () => {
    expect(["pendiente", "verificada", "confirmada"].every(esReservaViva)).toBe(true);
    expect(["cancelada", "completada", "no_show", "", null, undefined].some((e) => esReservaViva(e as string))).toBe(
      false,
    );
  });
});

describe("edicionReserva · valoresFormularioDesdeReserva", () => {
  it("traduce la fila al formulario: hora sin segundos, fecha como Date local y nulos a vacío", () => {
    const v = valoresFormularioDesdeReserva(
      reserva({ nombre: null, telefono: null, email: null, notas_cliente: null, espacio_id: null, marca: null }),
    );
    expect(v.nombre).toBe("");
    expect(v.telefono).toBe("");
    expect(v.email).toBe("");
    expect(v.notas_cliente).toBe("");
    expect(v.espacio_id).toBeNull();
    expect(v.hora).toBe("21:00");
    expect(v.marca).toBe("casa_tomas");
    // Mediodía local: un `new Date("2026-10-10")` (UTC) caería en el día anterior en husos negativos.
    expect(v.fecha.getFullYear()).toBe(2026);
    expect(v.fecha.getMonth()).toBe(9);
    expect(v.fecha.getDate()).toBe(10);
  });

  it("acepta una hora que ya viene corta y una fecha con hora pegada", () => {
    const v = valoresFormularioDesdeReserva(reserva({ hora: "13:30", fecha: "2026-01-05T00:00:00+00:00" }));
    expect(v.hora).toBe("13:30");
    expect(v.fecha.getDate()).toBe(5);
  });
});

describe("edicionReserva · calcularCambiosEdicion (solo lo que cambia)", () => {
  it("sin tocar nada no hay cambios: ni siquiera se reescribe la hora con segundos", () => {
    const r = reserva();
    expect(calcularCambiosEdicion(r, sinTocar(r))).toEqual({});
  });

  it("cambiar solo el nombre no manda fecha, hora ni comensales (no dispara el trigger de aforo)", () => {
    const r = reserva();
    const cambios = calcularCambiosEdicion(r, { ...sinTocar(r), nombre: "  Ana María López " });
    expect(cambios).toEqual({ nombre: "Ana María López" });
    expect(cambios).not.toHaveProperty("fecha");
    expect(cambios).not.toHaveProperty("hora");
    expect(cambios).not.toHaveProperty("numero_comensales");
    expect(cambios).not.toHaveProperty("estado");
    expect(cambios).not.toHaveProperty("canal");
  });

  it("cada campo editable entra en el diff con el formato con el que se guarda", () => {
    const r = reserva();
    const cambios = calcularCambiosEdicion(r, {
      nombre: "Berta",
      telefono: "600 111 222",
      email: " berta@ejemplo.com ",
      fecha: new Date(2026, 10, 2, 12),
      hora: "20:30",
      numero_comensales: 6,
      notas_cliente: "  Cumpleaños ",
      espacio_id: null,
      importante: true,
    });
    expect(cambios).toEqual({
      nombre: "Berta",
      telefono: "+34600111222",
      email: "berta@ejemplo.com",
      fecha: "2026-11-02",
      hora: "20:30",
      numero_comensales: 6,
      notas_cliente: "Cumpleaños",
      espacio_id: null,
      importante: true,
    });
  });

  it("el teléfono reescrito en otro formato pero igual de verdad no cuenta como cambio", () => {
    const r = reserva({ telefono: "+34612345678" });
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), telefono: "612 34 56 78" })).toEqual({});
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), telefono: "0034 612-345-678" })).toEqual({});
  });

  it("vaciar el email lo guarda como null (nunca cadena vacía) y vaciar las notas también", () => {
    const r = reserva();
    const cambios = calcularCambiosEdicion(r, { ...sinTocar(r), email: "   ", notas_cliente: "" });
    expect(cambios).toEqual({ email: null, notas_cliente: null });
  });

  it("una reserva sin email, sin notas y sin sala queda sin cambios si no se toca", () => {
    const r = reserva({ email: null, notas_cliente: null, espacio_id: null });
    expect(calcularCambiosEdicion(r, sinTocar(r))).toEqual({});
  });

  it("poner un email a una reserva que no tenía lo guarda recortado", () => {
    const r = reserva({ email: null });
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), email: " juan@ejemplo.com" })).toEqual({
      email: "juan@ejemplo.com",
    });
  });

  it("una hora con segundos en la BD y la misma hora corta en el formulario es la misma hora", () => {
    const r = reserva({ hora: "21:00:00" });
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), hora: "21:00" })).toEqual({});
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), hora: "21:15" })).toEqual({ hora: "21:15" });
  });

  it("importante solo entra si se ha decidido y es distinto", () => {
    const r = reserva({ importante: false });
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), importante: undefined })).toEqual({});
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), importante: false })).toEqual({});
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), importante: true })).toEqual({ importante: true });
  });

  it("toda combinación de estado y canal produce el mismo diff: editar no depende de ninguno", () => {
    for (const estado of ["pendiente", "verificada", "confirmada", "cancelada", "completada", "no_show"]) {
      for (const canal of ["web", "telefono", "manual", null]) {
        const r = reserva({ estado, canal });
        const cambios = calcularCambiosEdicion(r, { ...sinTocar(r), nombre: "Otro" });
        expect(cambios).toEqual({ nombre: "Otro" });
      }
    }
  });

  it("una fecha pasada se puede cambiar igual que una futura", () => {
    const r = reserva({ fecha: "2020-01-15" });
    expect(calcularCambiosEdicion(r, { ...sinTocar(r), fecha: new Date(2020, 0, 16, 12) })).toEqual({
      fecha: "2020-01-16",
    });
  });

  describe("lista negra", () => {
    it("si cambia el teléfono y el nuevo está en la lista negra, marca la reserva", () => {
      const r = reserva({ en_blacklist: false });
      const cambios = calcularCambiosEdicion(r, { ...sinTocar(r), telefono: "699000111" }, { enListaNegra: true });
      expect(cambios).toEqual({ telefono: "+34699000111", en_blacklist: true });
    });

    it("si cambia el contacto y el nuevo ya no está en la lista negra, la desmarca", () => {
      const r = reserva({ en_blacklist: true });
      const cambios = calcularCambiosEdicion(r, { ...sinTocar(r), email: "otro@ejemplo.com" }, { enListaNegra: false });
      expect(cambios).toEqual({ email: "otro@ejemplo.com", en_blacklist: false });
    });

    it("si el contacto no cambia no se toca la marca, aunque se haya consultado", () => {
      const r = reserva({ en_blacklist: true });
      const cambios = calcularCambiosEdicion(r, { ...sinTocar(r), nombre: "Nuevo" }, { enListaNegra: false });
      expect(cambios).toEqual({ nombre: "Nuevo" });
    });

    it("si el resultado coincide con lo guardado no se reescribe", () => {
      const r = reserva({ en_blacklist: true });
      const cambios = calcularCambiosEdicion(r, { ...sinTocar(r), telefono: "611111111" }, { enListaNegra: true });
      expect(cambios).toEqual({ telefono: "+34611111111" });
    });

    it("sin consulta a la lista negra no se inventa nada", () => {
      const r = reserva({ en_blacklist: false });
      expect(calcularCambiosEdicion(r, { ...sinTocar(r), telefono: "699000111" })).toEqual({
        telefono: "+34699000111",
      });
    });
  });
});

describe("edicionReserva · qué campos cambian y qué implica", () => {
  it("camposCambiados ignora la marca de lista negra (no es un campo del formulario)", () => {
    expect(camposCambiados({ nombre: "X", en_blacklist: true })).toEqual(["nombre"]);
  });

  it("textoCamposCambiados lo dice en castellano, con «y» al final", () => {
    expect(textoCamposCambiados({})).toBe("");
    expect(textoCamposCambiados({ nombre: "X" })).toBe("nombre");
    expect(textoCamposCambiados({ hora: "20:00", numero_comensales: 3 })).toBe("hora y comensales");
    expect(textoCamposCambiados({ nombre: "X", telefono: "1", fecha: "2026-10-11" })).toBe(
      "nombre, teléfono y fecha",
    );
  });

  it("cambiaAforo: fecha, hora o comensales; nombre, notas, sala o importante no", () => {
    expect(cambiaAforo({ fecha: "2026-10-11" })).toBe(true);
    expect(cambiaAforo({ hora: "20:00" })).toBe(true);
    expect(cambiaAforo({ numero_comensales: 9 })).toBe(true);
    expect(cambiaAforo({ nombre: "X", notas_cliente: null, espacio_id: null, importante: true })).toBe(false);
    expect(cambiaAforo({})).toBe(false);
  });
});

describe("edicionReserva · validar solo lo que se toca", () => {
  it("un nombre o teléfono heredado y sin tocar no bloquea la edición de otra cosa", () => {
    // Datos antiguos que hoy no pasarían el formulario de alta.
    expect(errorNombreEdicion("J", "J")).toBeNull();
    expect(errorTelefonoEdicion("600123", "600123")).toBeNull();
    expect(errorTelefonoEdicion("", null)).toBeNull();
    expect(errorTelefonoEdicion("   ", "")).toBeNull();
  });

  it("en cuanto se toca, se valida como en el alta", () => {
    expect(errorNombreEdicion("J", "Juan")).toBe("El nombre es obligatorio");
    expect(errorNombreEdicion("  ", "Juan")).toBe("El nombre es obligatorio");
    expect(errorNombreEdicion("Juan Pérez", "Juan")).toBeNull();
    expect(errorTelefonoEdicion("", "+34612345678")).toBe("El teléfono es obligatorio");
    expect(errorTelefonoEdicion("12345", "+34612345678")).toBe("Teléfono no válido (mínimo 9 cifras)");
    expect(errorTelefonoEdicion("611 222 333", "+34612345678")).toBeNull();
  });

  it("el email heredado, aunque hoy no pasaría, no bloquea la edición de otra cosa", () => {
    // Una reserva del bot con un email que no cumple el formato que se exige en el alta.
    expect(errorEmailEdicion("josé@gmail.com ", "josé@gmail.com")).toBeNull();
    expect(errorEmailEdicion("ana@ejemplo", "ana@ejemplo")).toBeNull();
    expect(errorEmailEdicion("", null)).toBeNull();
    expect(errorEmailEdicion("   ", "")).toBeNull();
    // Escribirlo con otros espacios o vaciarlo sigue siendo «lo mismo» o «sin email».
    expect(errorEmailEdicion("  ana@ejemplo.com", "ana@ejemplo.com")).toBeNull();
  });

  it("en cuanto el email se toca, se valida como en el alta (opcional, pero con formato)", () => {
    expect(errorEmailEdicion("ana@ejemplo", "otro@ejemplo.com")).toBe("Email no válido");
    expect(errorEmailEdicion("ana example.com", null)).toBe("Email no válido");
    expect(errorEmailEdicion("nuevo@ejemplo.com", "viejo@ejemplo.com")).toBeNull();
    // Vaciarlo es quitarlo: válido.
    expect(errorEmailEdicion("", "viejo@ejemplo.com")).toBeNull();
    // Y corregir uno heredado por otro mal escrito no se cuela.
    expect(errorEmailEdicion("jose@gmail", "josé@gmail.com")).toBe("Email no válido");
  });
});

describe("edicionReserva · aviso al cliente (misma regla que el alta)", () => {
  const hoy = "2026-10-01";

  it("verificada a la que se añade un email: sí ('Confirma tu reserva')", () => {
    const r = reserva({ estado: "verificada", email: null });
    expect(debeNotificarEdicion(r, { email: "juan@ejemplo.com" }, { hoy, enListaNegra: false })).toBe(true);
  });

  it("verificada con el email corregido: también se pide (el sistema de correos no repite lo ya enviado)", () => {
    const r = reserva({ estado: "verificada", email: "mal@ejemplo.com" });
    expect(debeNotificarEdicion(r, { email: "bien@ejemplo.com" }, { hoy, enListaNegra: false })).toBe(true);
  });

  it("cualquier otro cambio de una verificada no avisa a nadie", () => {
    const r = reserva({ estado: "verificada" });
    expect(debeNotificarEdicion(r, { nombre: "X", hora: "20:00", numero_comensales: 2 }, { hoy, enListaNegra: false })).toBe(
      false,
    );
  });

  it("quitar el email no avisa (no hay a quién)", () => {
    const r = reserva({ estado: "verificada" });
    expect(debeNotificarEdicion(r, { email: null }, { hoy, enListaNegra: false })).toBe(false);
  });

  it("solo las verificadas: el resto de estados nunca disparan correo al editar", () => {
    for (const estado of ["pendiente", "confirmada", "cancelada", "completada", "no_show"]) {
      const r = reserva({ estado, email: null });
      expect(debeNotificarEdicion(r, { email: "juan@ejemplo.com" }, { hoy, enListaNegra: false })).toBe(false);
    }
  });

  it("nunca a un cliente en lista negra ni para un día que ya pasó", () => {
    const r = reserva({ estado: "verificada", email: null });
    expect(debeNotificarEdicion(r, { email: "juan@ejemplo.com" }, { hoy, enListaNegra: true })).toBe(false);
    const pasada = reserva({ estado: "verificada", email: null, fecha: "2026-09-01" });
    expect(debeNotificarEdicion(pasada, { email: "juan@ejemplo.com" }, { hoy, enListaNegra: false })).toBe(false);
    // Si la edición la mueve a un día futuro, sí vale.
    expect(
      debeNotificarEdicion(pasada, { email: "juan@ejemplo.com", fecha: "2026-10-05" }, { hoy, enListaNegra: false }),
    ).toBe(true);
  });
});

describe("edicionReserva · el enlace «Confirma tu reserva» depende de la hora", () => {
  const hoy = "2026-10-01";

  it("verificada con email a la que se cambia la hora: el enlace que ya recibió el cliente deja de valer", () => {
    // La huella del enlace es `v2|estado|HH:MM` (emails-reserva/tokens.ts): otra hora = «enlace no válido».
    const r = reserva({ estado: "verificada", hora: "21:00:00" });
    expect(invalidaEnlaceConfirmacion(r, { hora: "21:30" }, { hoy })).toBe(true);
  });

  it("cambiar el día, los comensales o cualquier otro dato NO lo invalida (la huella no los lleva)", () => {
    const r = reserva({ estado: "verificada" });
    expect(invalidaEnlaceConfirmacion(r, { fecha: "2026-10-12" }, { hoy })).toBe(false);
    expect(invalidaEnlaceConfirmacion(r, { numero_comensales: 9 }, { hoy })).toBe(false);
    expect(invalidaEnlaceConfirmacion(r, { nombre: "X", notas_cliente: null, espacio_id: "terraza" }, { hoy })).toBe(false);
    expect(invalidaEnlaceConfirmacion(r, {}, { hoy })).toBe(false);
  });

  it("solo la verificada lleva ese enlace: en los demás estados cambiar la hora no rompe nada", () => {
    for (const estado of ["pendiente", "confirmada", "cancelada", "completada", "no_show"]) {
      expect(invalidaEnlaceConfirmacion(reserva({ estado }), { hora: "21:30" }, { hoy })).toBe(false);
    }
  });

  it("sin email no se mandó ningún correo, así que no hay enlace que romper (ni con el email en blanco)", () => {
    expect(invalidaEnlaceConfirmacion(reserva({ estado: "verificada", email: null }), { hora: "21:30" }, { hoy })).toBe(false);
    expect(invalidaEnlaceConfirmacion(reserva({ estado: "verificada", email: "   " }), { hora: "21:30" }, { hoy })).toBe(false);
  });

  it("si el email se pone en ESA misma edición, el correo sale ya con la hora nueva: no hay enlace viejo", () => {
    const r = reserva({ estado: "verificada", email: null });
    expect(invalidaEnlaceConfirmacion(r, { hora: "21:30", email: "juan@ejemplo.com" }, { hoy })).toBe(false);
  });

  it("si se corrige el email a la vez que la hora, el correo ya enviado al antiguo sigue roto: avisa", () => {
    const r = reserva({ estado: "verificada", email: "mal@ejemplo.com" });
    expect(invalidaEnlaceConfirmacion(r, { hora: "21:30", email: "bien@ejemplo.com" }, { hoy })).toBe(true);
  });

  it("para un día que ya pasó el enlace ya no importa; si la edición la mueve a un día futuro, sí", () => {
    const pasada = reserva({ estado: "verificada", fecha: "2026-09-01" });
    expect(invalidaEnlaceConfirmacion(pasada, { hora: "21:30" }, { hoy })).toBe(false);
    expect(invalidaEnlaceConfirmacion(pasada, { hora: "21:30", fecha: "2026-10-05" }, { hoy })).toBe(true);
  });

  it("el texto dice qué pasa y qué hacer (confirmarla o llamar al cliente)", () => {
    expect(TEXTO_ENLACE_INVALIDADO).toMatch(/enlace de «Confirma tu reserva» que ya recibió el cliente deja de valer al cambiar la hora/);
    expect(TEXTO_ENLACE_INVALIDADO).toMatch(/confírmala tú o llámale/);
  });
});

describe("edicionReserva · interpretar la respuesta de notify-reservation-change", () => {
  /** Lo que devuelve la función proxy: el texto JSON de emails-reserva va en `resultado`. */
  const proxy = (resultado: unknown, extra: Record<string, unknown> = {}) => ({
    data: { success: true, status: 200, resultado: typeof resultado === "string" ? resultado : JSON.stringify(resultado), ...extra },
    error: null,
  });

  it("enviado: emails-reserva contesta {ok:true}", () => {
    expect(interpretarRespuestaNotificacion(proxy({ ok: true }))).toEqual({ resultado: "enviado" });
  });

  it("ya enviado o en curso: no se repite (un correo rebotado también ocupa ese hueco)", () => {
    expect(interpretarRespuestaNotificacion(proxy({ ok: false, motivo: "ya_enviado_o_en_curso" }))).toEqual({
      resultado: "ya_enviado",
    });
  });

  it("destinatario suprimido: el email rebotó o se quejó antes", () => {
    expect(interpretarRespuestaNotificacion(proxy({ ok: false, motivo: "destinatario_suprimido" }))).toEqual({
      resultado: "suprimido",
    });
  });

  it("cualquier otro motivo se conserva para decirlo tal cual", () => {
    expect(interpretarRespuestaNotificacion(proxy({ ok: false, motivo: "plantilla_no_configurada_propuesta" }))).toEqual({
      resultado: "no_enviado",
      motivo: "plantilla_no_configurada_propuesta",
    });
    expect(interpretarRespuestaNotificacion(proxy({ ok: false, motivo: "resend_no_configurado" }))).toEqual({
      resultado: "no_enviado",
      motivo: "resend_no_configurado",
    });
  });

  it("si el proxy contesta bien pero el resultado no se puede leer, solo se sabe que se ha pedido (sin prometer más)", () => {
    expect(interpretarRespuestaNotificacion(proxy("esto no es json"))).toEqual({ resultado: "pedido" });
    expect(interpretarRespuestaNotificacion(proxy(""))).toEqual({ resultado: "pedido" });
    expect(interpretarRespuestaNotificacion(proxy({ ok: false }))).toEqual({ resultado: "pedido" });
    expect(interpretarRespuestaNotificacion({ data: { success: true }, error: null })).toEqual({ resultado: "pedido" });
    expect(interpretarRespuestaNotificacion({ data: null, error: null })).toEqual({ resultado: "pedido" });
    // Sin respuesta alguna (p. ej. un mock sin valor de retorno): nunca lanza, y tampoco afirma nada.
    expect(interpretarRespuestaNotificacion(undefined)).toEqual({ resultado: "pedido" });
    expect(interpretarRespuestaNotificacion(null)).toEqual({ resultado: "pedido" });
  });

  it("acepta también un resultado que ya llegue como objeto", () => {
    expect(
      interpretarRespuestaNotificacion({ data: { success: true, resultado: { ok: true } }, error: null }),
    ).toEqual({ resultado: "enviado" });
  });

  it("fallo: ni se ha podido pedir (error de red o HTTP, o el proxy dice success:false)", () => {
    expect(interpretarRespuestaNotificacion({ data: null, error: new Error("Failed to fetch") })).toEqual({ resultado: "fallo" });
    expect(
      interpretarRespuestaNotificacion({ data: { success: false, status: 401, error: "unauthorized" }, error: null }),
    ).toEqual({ resultado: "fallo" });
  });
});

describe("edicionReserva · qué se le dice al personal sobre el cliente tras guardar", () => {
  const hoy = "2026-10-01";
  /** La reserva a la que se añade un email: el caso en que se pide «Confirma tu reserva». */
  const conEmailNuevo = () => reserva({ estado: "verificada", email: null });
  const envio = (e: EnvioCorreoEdicion) => avisoAlClienteTrasEdicion(conEmailNuevo(), { email: "juan@ejemplo.com" }, { hoy, envio: e });

  it("solo dice «se le ha enviado» cuando emails-reserva confirma que salió", () => {
    const texto = envio({ resultado: "enviado" });
    expect(texto).toMatch(/Se le ha enviado el correo «Confirma tu reserva»/);
  });

  it("si ya se le había enviado (o rebotó), NO dice que se le manda: dice que no se repite y qué hacer", () => {
    const texto = envio({ resultado: "ya_enviado" })!;
    expect(texto).not.toMatch(/Se le (ha enviado|manda)/);
    expect(texto).toMatch(/ya se le había enviado/);
    expect(texto).toMatch(/NO se repite|no se repite/);
    expect(texto).toMatch(/confírmala tú o llámale/);
  });

  it("email suprimido: no se ha enviado y hay que llamarle", () => {
    const texto = envio({ resultado: "suprimido" })!;
    expect(texto).not.toMatch(/Se le (ha enviado|manda)/);
    expect(texto).toMatch(/bloqueado/);
    expect(texto).toMatch(/Llámale/);
  });

  it("otro motivo: lo cita y dice que hay que llamarle", () => {
    const texto = envio({ resultado: "no_enviado", motivo: "plantilla_no_configurada_propuesta" })!;
    expect(texto).toMatch(/plantilla_no_configurada_propuesta/);
    expect(texto).toMatch(/Llámale/);
    expect(texto).not.toMatch(/Se le (ha enviado|manda)/);
  });

  it("respuesta ilegible: «se ha pedido el envío», sin afirmar que ha salido", () => {
    const texto = envio({ resultado: "pedido" })!;
    expect(texto).toMatch(/Se ha pedido el envío/);
    expect(texto).not.toMatch(/Se le (ha enviado|manda)/);
  });

  it("no se ha podido ni pedir: lo dice y manda avisarle por teléfono", () => {
    const texto = envio({ resultado: "fallo" })!;
    expect(texto).toMatch(/No se ha podido pedir el envío/);
    expect(texto).toMatch(/teléfono/);
  });

  it("cambiar día, hora o comensales de una reserva viva con email: el cliente NO recibe aviso y se dice", () => {
    const r = reserva({ estado: "confirmada" });
    for (const cambios of [{ fecha: "2026-10-12" }, { hora: "20:00" }, { numero_comensales: 2 }]) {
      expect(avisoAlClienteTrasEdicion(r, cambios, { hoy, envio: null })).toBe(
        "El cliente no recibe ningún aviso de este cambio.",
      );
    }
  });

  it("igual sin email: avisa de que hay que llamarle", () => {
    const r = reserva({ estado: "verificada", email: null });
    expect(avisoAlClienteTrasEdicion(r, { hora: "20:00" }, { hoy, envio: null })).toMatch(/No tiene email/);
  });

  it("si en la misma edición se le pone el email, cuenta el email nuevo", () => {
    const r = reserva({ estado: "confirmada", email: null });
    expect(avisoAlClienteTrasEdicion(r, { hora: "20:00", email: "juan@ejemplo.com" }, { hoy, envio: null })).toBe(
      "El cliente no recibe ningún aviso de este cambio.",
    );
  });

  it("no dice nada si el cambio no afecta al cliente, o la reserva ya no está viva, o ya pasó", () => {
    expect(avisoAlClienteTrasEdicion(reserva(), { nombre: "X" }, { hoy, envio: null })).toBeNull();
    expect(avisoAlClienteTrasEdicion(reserva(), {}, { hoy, envio: null })).toBeNull();
    for (const estado of ["cancelada", "completada", "no_show"]) {
      expect(avisoAlClienteTrasEdicion(reserva({ estado }), { hora: "20:00" }, { hoy, envio: null })).toBeNull();
    }
    expect(
      avisoAlClienteTrasEdicion(reserva({ fecha: "2026-09-01" }), { hora: "20:00" }, { hoy, envio: null }),
    ).toBeNull();
  });
});

describe("edicionReserva · efecto en las mesas (lo hace el trigger, aquí solo se avisa)", () => {
  it("cambiar de sala quita las mesas", () => {
    expect(efectoEnMesas(reserva(), { espacio_id: "terraza" })).toBe("quita");
    expect(efectoEnMesas(reserva(), { espacio_id: null })).toBe("quita");
  });

  it("cambiar de día o de turno las mueve si están libres", () => {
    expect(efectoEnMesas(reserva(), { fecha: "2026-10-11" })).toBe("mueve");
    // 21:00 (cena) -> 13:00 (comida)
    expect(efectoEnMesas(reserva({ hora: "21:00:00" }), { hora: "13:00" })).toBe("mueve");
  });

  it("cambiar la hora dentro del mismo turno, los comensales o el nombre no tocan las mesas", () => {
    expect(efectoEnMesas(reserva({ hora: "21:00:00" }), { hora: "21:30" })).toBeNull();
    expect(efectoEnMesas(reserva({ hora: "13:00:00" }), { hora: "14:15" })).toBeNull();
    expect(efectoEnMesas(reserva(), { numero_comensales: 8, nombre: "X" })).toBeNull();
    expect(efectoEnMesas(reserva(), {})).toBeNull();
  });

  it("si la sala cambia y además cambia el día, manda quitar las mesas (cancela la otra regla)", () => {
    expect(efectoEnMesas(reserva(), { espacio_id: "terraza", fecha: "2026-10-11" })).toBe("quita");
  });
});

describe("edicionReserva · errores legibles", () => {
  it("el trigger de aforo (23514 «Aforo superado») se explica", () => {
    expect(mensajeErrorEdicion({ code: "23514", message: "Aforo superado para el turno. Capacidad total: 60" })).toMatch(
      /No hay aforo suficiente en ese turno/,
    );
  });

  it("otro 23514 (un CHECK de la tabla) no se disfraza de aforo", () => {
    const m = mensajeErrorEdicion({ code: "23514", message: 'violates check constraint "reservas_numero_comensales_check"' });
    expect(m).not.toMatch(/aforo/i);
    expect(m).toMatch(/reservas_numero_comensales_check/);
  });

  it("permisos: 42501 y la escritura sin filas (RLS la filtra en silencio)", () => {
    expect(mensajeErrorEdicion({ code: "42501", message: "permission denied" })).toBe(
      "No tienes permiso para editar reservas.",
    );
    expect(mensajeErrorEdicion(new ErrorSinFilasEdicion())).toMatch(/no tienes permiso para editar esta reserva, o ya no existe/i);
  });

  it("un error cualquiera conserva su texto; sin texto, dice que es desconocido", () => {
    expect(mensajeErrorEdicion(new Error("boom"))).toBe("Error al guardar los cambios: boom");
    expect(mensajeErrorEdicion({})).toBe("Error al guardar los cambios: error desconocido");
    expect(mensajeErrorEdicion(null)).toBe("Error al guardar los cambios: error desconocido");
  });
});
