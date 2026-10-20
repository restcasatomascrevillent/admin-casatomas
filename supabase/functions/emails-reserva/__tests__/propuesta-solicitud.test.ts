/**
 * Tests para supabase/functions/emails-reserva/propuesta-solicitud.ts
 * (propuesta al cliente desde una solicitud del bot) + la separación de
 * acciones de token entre contraoferta y solicitud.
 */
import { describe, it, expect } from "vitest";
import {
  validarSolicitudParaEnvio,
  huellaPropuestaSolicitud,
  huellaSolicitudCoincide,
  marcaDeSolicitudParaCorreo,
  datosCorreoPropuestaSolicitud,
  epochSegundos,
  horaOriginalDeNotas,
  paginaTrasAceptar,
  claveIdempotenciaPropuestaSolicitud,
  type SolicitudParaPropuesta,
} from "../propuesta-solicitud.ts";
import { firmarToken, verificarToken } from "../tokens.ts";
import { renderPlantilla, type FilaPlantilla } from "../plantillas.ts";

const HOY = "2026-09-23";

const base = (over: Partial<SolicitudParaPropuesta> = {}): SolicitudParaPropuesta => ({
  id: "sol-1",
  nombre: "Ana",
  telefono: "+34612345678",
  email: "ana@example.com",
  fecha_solicitada: "2026-10-06",
  hora_solicitada: "14:30",
  numero_comensales: 12,
  notas_internas: null,
  estado: "pendiente",
  espacio_propuesto_id: "esp-1",
  propuesta_estado: "borrador",
  propuesta_enviada_at: null,
  ...over,
});

describe("validarSolicitudParaEnvio", () => {
  it("acepta una solicitud completa con email", () => {
    expect(validarSolicitudParaEnvio(base(), HOY)).toBeNull();
  });
  it("detecta la migración sin aplicar (no viene propuesta_estado)", () => {
    const s = base();
    delete (s as Partial<SolicitudParaPropuesta>).propuesta_estado;
    expect(validarSolicitudParaEnvio(s, HOY)).toBe("migracion_pendiente");
  });
  it("sin email -> sin_email; email roto -> email_invalido", () => {
    expect(validarSolicitudParaEnvio(base({ email: null }), HOY)).toBe("sin_email");
    expect(validarSolicitudParaEnvio(base({ email: "  " }), HOY)).toBe("sin_email");
    expect(validarSolicitudParaEnvio(base({ email: "ana@" }), HOY)).toBe("email_invalido");
  });
  it("incompleta, pasada, cerrada o ya aceptada", () => {
    expect(validarSolicitudParaEnvio(base({ hora_solicitada: null }), HOY)).toBe("propuesta_incompleta");
    expect(validarSolicitudParaEnvio(base({ numero_comensales: 0 }), HOY)).toBe("propuesta_incompleta");
    expect(validarSolicitudParaEnvio(base({ fecha_solicitada: "2026-09-22" }), HOY)).toBe("fecha_pasada");
    expect(validarSolicitudParaEnvio(base({ fecha_solicitada: HOY }), HOY)).toBeNull();
    expect(validarSolicitudParaEnvio(base({ estado: "resuelta" }), HOY)).toBe("solicitud_cerrada");
    expect(validarSolicitudParaEnvio(base({ propuesta_estado: "aceptada" }), HOY)).toBe("ya_aceptada");
  });
  it("se puede reenviar una ya enviada o rechazada", () => {
    expect(validarSolicitudParaEnvio(base({ propuesta_estado: "enviada" }), HOY)).toBeNull();
    expect(validarSolicitudParaEnvio(base({ propuesta_estado: "rechazada", estado: "contactado" }), HOY)).toBeNull();
  });
});

describe("huellaPropuestaSolicitud", () => {
  const enviada = "2026-09-23T10:00:00.123Z";
  it("es igual con el formato de Postgres y el de JS del mismo instante", () => {
    expect(huellaPropuestaSolicitud(base({ propuesta_enviada_at: enviada }))).toBe(
      huellaPropuestaSolicitud(base({ propuesta_enviada_at: "2026-09-23 10:00:00.123+00" })),
    );
  });
  it("normaliza la hora (14:30 == 14:30:00)", () => {
    expect(huellaPropuestaSolicitud(base({ hora_solicitada: "14:30:00" }))).toBe(huellaPropuestaSolicitud(base()));
  });
  it("es v2|fecha|HH:MM|pax|enviada (sin sala)", () => {
    expect(huellaPropuestaSolicitud(base({ propuesta_enviada_at: "2026-09-23T10:00:00Z" }))).toBe(
      "v2|2026-10-06|14:30|12|1790157600",
    );
  });
  it("cambia si cambia día, hora, pax o el envío", () => {
    const h = huellaPropuestaSolicitud(base({ propuesta_enviada_at: enviada }));
    for (const over of [
      { fecha_solicitada: "2026-10-07" },
      { hora_solicitada: "15:00" },
      { numero_comensales: 11 },
      { propuesta_enviada_at: "2026-09-23T10:00:05.000Z" },
    ]) {
      expect(huellaPropuestaSolicitud(base({ propuesta_enviada_at: enviada, ...over }))).not.toBe(h);
    }
  });
  it("NO cambia si cambia o se quita la sala propuesta (es interna)", () => {
    const h = huellaPropuestaSolicitud(base({ propuesta_enviada_at: enviada }));
    expect(huellaPropuestaSolicitud(base({ propuesta_enviada_at: enviada, espacio_propuesto_id: "esp-2" }))).toBe(h);
    expect(huellaPropuestaSolicitud(base({ propuesta_enviada_at: enviada, espacio_propuesto_id: null }))).toBe(h);
  });
});

describe("marcaDeSolicitudParaCorreo con la columna marca (20260930100000)", () => {
  it("la marca guardada manda sobre la sala y las notas", () => {
    expect(marcaDeSolicitudParaCorreo({ marca: "touza", espacio_propuesto_id: null, notas_cliente: null }, null)).toBe("touza");
    expect(marcaDeSolicitudParaCorreo({ marca: "casa_tomas", espacio_propuesto_id: "r", notas_cliente: null }, "touza")).toBe(
      "casa_tomas",
    );
    expect(
      marcaDeSolicitudParaCorreo({ marca: "casa_tomas", espacio_propuesto_id: null, notas_cliente: "Solicitud de El Reservado" }, null),
    ).toBe("casa_tomas");
  });
  it("sin columna (migración sin aplicar) o valor raro: regla antigua", () => {
    expect(marcaDeSolicitudParaCorreo({ espacio_propuesto_id: "r", notas_cliente: null }, "touza")).toBe("touza");
    expect(marcaDeSolicitudParaCorreo({ marca: "otra", espacio_propuesto_id: null, notas_cliente: "Solicitud de El Reservado" }, null)).toBe(
      "touza",
    );
  });
});

describe("huellaSolicitudCoincide", () => {
  const enviada = "2026-09-23T10:00:00Z";
  const s = base({ propuesta_enviada_at: enviada });

  it("v2: coincide con la huella firmada y no si cambió algo", () => {
    const fp = huellaPropuestaSolicitud(s);
    expect(huellaSolicitudCoincide(fp, s)).toBe(true);
    expect(huellaSolicitudCoincide(fp, { ...s, espacio_propuesto_id: "esp-9" })).toBe(true);
    expect(huellaSolicitudCoincide(fp, { ...s, hora_solicitada: "15:00" })).toBe(false);
  });

  it("legado de 5 partes (fecha|hora|pax|sala|enviada): ignora la sala", () => {
    const legado = "2026-10-06|14:30|12|esp-1|1790157600";
    expect(huellaSolicitudCoincide(legado, s)).toBe(true);
    expect(huellaSolicitudCoincide(legado, { ...s, espacio_propuesto_id: "esp-2" })).toBe(true);
    expect(huellaSolicitudCoincide(legado, { ...s, espacio_propuesto_id: null })).toBe(true);
  });

  it("legado: se rechaza si cambió día, hora, pax o el envío", () => {
    const legado = "2026-10-06|14:30|12|esp-1|1790157600";
    expect(huellaSolicitudCoincide(legado, { ...s, fecha_solicitada: "2026-10-07" })).toBe(false);
    expect(huellaSolicitudCoincide(legado, { ...s, hora_solicitada: "15:00" })).toBe(false);
    expect(huellaSolicitudCoincide(legado, { ...s, numero_comensales: 11 })).toBe(false);
    expect(huellaSolicitudCoincide(legado, { ...s, propuesta_enviada_at: "2026-09-23T10:00:05Z" })).toBe(false);
  });

  it("legado mal formado o vacío => no coincide", () => {
    expect(huellaSolicitudCoincide("2026-10-06|14:30|12|1790157600", s)).toBe(false);
    expect(huellaSolicitudCoincide("", s)).toBe(false);
  });
});

describe("epochSegundos", () => {
  it("parsea ISO y formato Postgres; null si vacío o basura", () => {
    expect(epochSegundos("1970-01-01T00:00:10.999Z")).toBe(10);
    expect(epochSegundos("1970-01-01 00:00:10+00")).toBe(10);
    expect(epochSegundos(null)).toBeNull();
    expect(epochSegundos("no")).toBeNull();
  });
});

describe("datos del correo", () => {
  it("usa la hora original de las notas para la comparación y no compara la sala", () => {
    const s = base({ notas_internas: "[Petición original del cliente: 2026-10-06 21:00, 14 pax]\nllamar tarde" });
    const d = datosCorreoPropuestaSolicitud(s, "Salón", { aceptar: "https://a", rechazar: "https://r" });
    expect(d.hora).toBe("14:30");
    expect(d.horaSolicitada).toBe("21:00");
    expect(d.espacio).toBe("Salón");
    expect(d.espacioSolicitado).toBe("Salón");
    expect(d.comensales).toBe(12);
    expect(d.botonPrincipalUrl).toBe("https://a");
  });
  it("sin línea original no hay contraoferta de hora", () => {
    expect(horaOriginalDeNotas(null)).toBeNull();
    const d = datosCorreoPropuestaSolicitud(base(), null, { aceptar: "a", rechazar: "r" });
    expect(d.horaSolicitada).toBe("14:30");
  });
  // La sala ya NO sale en el correo (decisión del dueño 2026-09-28, punto 7
  // del contrato en plantillas.ts): `datosCorreoPropuestaSolicitud` la sigue
  // rellenando —el panel y la huella del token la usan— pero el render la
  // ignora. Lo que se comprueba aquí es justo eso: los botones sí, la sala no.
  it("renderiza con la plantilla 'propuesta' e incluye los dos botones, pero NO la sala", () => {
    const plantilla: FilaPlantilla = {
      tipo: "propuesta",
      version: 1,
      asunto: "Confirma tu reserva",
      saludo: "Hola, {{nombre}}",
      cuerpo: "Revisa los datos",
      texto_boton_principal: "Sí",
      texto_boton_secundario: "No",
      pie: null,
      color_acento: "#B8936A",
      color_oscuro: "#1C1F22",
      logo_url: null,
      bloques: null,
    };
    const { html } = renderPlantilla(
      plantilla,
      datosCorreoPropuestaSolicitud(base({ nombre: "<b>Ana</b>" }), "Salón", {
        aceptar: "https://x/propuesta/aceptar?token=a",
        rechazar: "https://x/propuesta/rechazar?token=r",
      }),
    );
    expect(html).toContain("https://x/propuesta/aceptar?token=a");
    expect(html).toContain("https://x/propuesta/rechazar?token=r");
    expect(html).not.toContain("Salón");
    expect(html).not.toContain("Espacio");
    expect(html).not.toContain("<b>Ana</b>");
  });
});

describe("paginaTrasAceptar", () => {
  it("mapea el resultado de fn_aceptar_propuesta_solicitud", () => {
    expect(paginaTrasAceptar({ ok: true, estado: "confirmada" })).toBe("confirmada");
    expect(paginaTrasAceptar({ ok: true, estado: "pendiente" })).toBe("recibida");
    expect(paginaTrasAceptar({ ok: false, error: "sin_aforo" })).toBe("sin_aforo");
    expect(paginaTrasAceptar({ ok: false, error: "fecha_pasada" })).toBe("fecha_pasada");
    expect(paginaTrasAceptar({ ok: false, error: "propuesta_no_vigente" })).toBe("no_vigente");
    expect(paginaTrasAceptar({ ok: false, error: "datos_invalidos" })).toBe("error");
    expect(paginaTrasAceptar(null)).toBe("error");
  });
});

describe("tokens de solicitud", () => {
  it("un token de solicitud no vale en las rutas de la contraoferta ni al revés", async () => {
    const t = await firmarToken("s3cr3t", "sol-1", "aceptar_solicitud", "fp");
    expect(await verificarToken("s3cr3t", t, "aceptar_solicitud")).not.toBeNull();
    expect(await verificarToken("s3cr3t", t, "aceptar")).toBeNull();
    expect(await verificarToken("s3cr3t", t, "rechazar_solicitud")).toBeNull();
    const r = await firmarToken("s3cr3t", "res-1", "aceptar", "fp");
    expect(await verificarToken("s3cr3t", r, "aceptar_solicitud")).toBeNull();
  });
  it("la clave de idempotencia cambia con cada envío", () => {
    expect(claveIdempotenciaPropuestaSolicitud("s", 1)).not.toBe(claveIdempotenciaPropuestaSolicitud("s", 2));
  });
});
