import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "@/hooks/useAuditLog";
import {
  camposLegibles,
  camposArchivoLegibles,
  puedeRevertir,
  resumenEntrada,
  tipoEvento,
  valorLegible,
} from "../auditoria";
const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: "event",
  created_at: "2026-10-12T15:00:00Z",
  actor_user_id: "admin",
  actor_email: "admin@test.local",
  accion: "actualizar",
  tabla: "Platos",
  registro_id: "dish",
  detalles: null,
  user_agent: null,
  ...overrides,
});
describe("auditoría legible", () => {
  it("identifica y explica una modificación de precio", () => {
    const e = entry({
      detalles: {
        antes: { nombre: "Croquetas", precio_eur: 9.5 },
        despues: { nombre: "Croquetas", precio_eur: 10.5 },
      },
    });
    expect(resumenEntrada(e)).toMatch(/^Ha cambiado el precio del plato «Croquetas»: .*9,50.* → .*10,50/);
    expect(tipoEvento(e)).toBe("cambiar_precio");
    expect(valorLegible("precio_eur", 9.5)).toMatch(/9,50/);
    expect(valorLegible("activado", false)).toBe("No");
  });
  it("oculta identificadores y secretos del resumen", () => {
    expect(
      camposLegibles({
        id: "id",
        nombre: "Plato",
        password: "secret",
        api_key: "secret",
        updated_at: "now",
      }),
    ).toEqual([{ campo: "nombre", etiqueta: "Nombre", valor: "Plato" }]);
  });
  it("lee los mensajes históricos con los nombres reales de la tabla", () => {
    expect(
      resumenEntrada(
        entry({
          tabla: "mensajes_chat",
          accion: "crear",
          detalles: { despues: { role: "user", content: "¿Cuánto gastamos?" } },
        }),
      ),
    ).toContain("Ha preguntado a la IA de facturas: «¿Cuánto gastamos?»");
  });
  it("distingue regeneraciones y no ofrece restaurar cobros ni secretos", () => {
    expect(
      tipoEvento(
        entry({
          accion: "ejecutar",
          detalles: { tipo_evento: "regeneracion_ia", pregunta: "Gasto" },
        }),
      ),
    ).toBe("regeneracion_ia");
    expect(
      puedeRevertir(
        entry({
          detalles: { antes: { nombre: "A" }, despues: { nombre: "B" } },
        }),
      ),
    ).toBe(true);
    expect(
      puedeRevertir(
        entry({
          tabla: "cheques_regalo",
          detalles: { antes: { usado: false }, despues: { usado: true } },
        }),
      ),
    ).toBe(false);
    expect(
      puedeRevertir(
        entry({
          detalles: { antes: { secret: "[oculto]" }, despues: { nombre: "B" } },
        }),
      ),
    ).toBe(false);
  });
});

describe("acciones comprensibles sin leer el JSON", () => {
  const archivo = {
    id: "archivo-id",
    name: "pendientes/usuario-id/factura-id/05.jpg",
    bucket_id: "facturas-originales",
    owner_id: "usuario-id",
    version: "version-id",
    metadata: { size: 21578, mimetype: "image/jpeg", eTag: "huella", cacheControl: "max-age=3600" },
  };
  it("explica el INSERT de originales de factura y aparta metadatos del detalle legible", () => {
    const e = entry({ tabla: "storage.objects", accion: "crear", detalles: { despues: archivo, operacion_sql: "INSERT", request_id: null } });
    expect(resumenEntrada(e)).toBe("Ha subido un archivo original de factura: 05.jpg");
    expect(camposArchivoLegibles(e)).toEqual([
      { campo: "archivo", etiqueta: "Archivo", valor: "05.jpg" },
      { campo: "uso", etiqueta: "Uso", valor: "Original de factura para su lectura y procesamiento" },
      { campo: "tipo", etiqueta: "Tipo", valor: "Imagen JPEG" },
      { campo: "tamano", etiqueta: "Tamaño", valor: "21,1 KB" },
    ]);
    expect(e.detalles?.despues).toEqual(archivo);
    expect(puedeRevertir(e)).toBe(false);
  });
  it.each([
    ["eliminar", "Ha eliminado un archivo original de factura: 05.jpg"],
    ["actualizar", "Ha actualizado un archivo original de factura: 05.jpg"],
  ] as const)("explica archivos al %s", (accion, resumen) => {
    expect(resumenEntrada(entry({ tabla: "storage.objects", accion, detalles: { antes: archivo } }))).toBe(resumen);
  });
  it("distingue renombrar de mover sin exponer las rutas internas", () => {
    expect(resumenEntrada(entry({ tabla: "storage.objects", detalles: { antes: archivo, despues: { ...archivo, name: "procesadas/usuario-id/06.jpg" } } }))).toBe("Ha renombrado el archivo «05.jpg» a «06.jpg»");
    expect(resumenEntrada(entry({ tabla: "storage.objects", detalles: { antes: archivo, despues: { ...archivo, name: "procesadas/usuario-id/05.jpg" } } }))).toBe("Ha movido el archivo «05.jpg»");
  });
  it("explica la visibilidad y los cambios de contenido de la carta", () => {
    expect(resumenEntrada(entry({ detalles: { antes: { nombre: "Croquetas", activado: true }, despues: { nombre: "Croquetas", activado: false } } }))).toBe("Ha ocultado el plato «Croquetas» en la web");
    expect(resumenEntrada(entry({ tabla: "Vinos", detalles: { antes: { nombre: "Albariño", descripcion: "Anterior" }, despues: { nombre: "Albariño", descripcion: "Nueva" } } }))).toBe("Ha modificado el vino «Albariño»: Descripción");
  });
  it("traduce no_show y diferencia el canje de su anulación", () => {
    expect(resumenEntrada(entry({ tabla: "reservas", detalles: { antes: { nombre: "Laura", estado: "confirmada" }, despues: { nombre: "Laura", estado: "no_show" } } }))).toBe("Ha cambiado el estado de la reserva «Laura»: Confirmada → No se presentó");
    expect(resumenEntrada(entry({ tabla: "cheques_regalo", detalles: { antes: { codigo: "REGALO", usado: false }, despues: { codigo: "REGALO", usado: true } } }))).toBe("Ha canjeado el cheque regalo «REGALO»");
    expect(resumenEntrada(entry({ tabla: "cheques_regalo", detalles: { antes: { codigo: "REGALO", usado: true }, despues: { codigo: "REGALO", usado: false } } }))).toBe("Ha anulado el canje del cheque regalo «REGALO»");
  });
  it("no afirma que una acción fallida se completó", () => {
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "admin-update-user-password", resultado: "fallida" } }))).toBe("No se ha podido cambiar la contraseña de un usuario");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "extraer-vino-foto/analizar", resultado: "completada" } }))).toBe("Ha solicitado leer los datos de un vino desde una foto");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "enviar-newsletter", resultado: "parcial" } }))).toBe("Ha solicitado enviar una newsletter; resultado parcial");
  });
  it("explica configuraciones, permisos y bajas de superadmin", () => {
    expect(resumenEntrada(entry({ tabla: "configuracion_reservas" }))).toBe("Ha modificado la configuración de las reservas");
    expect(resumenEntrada(entry({ tabla: "super_admins", detalles: { operacion_asignacion: "retirar", antes: { email: "staff@example.com" } } }))).toBe("Ha retirado el acceso de superadmin a «staff@example.com»");
    expect(resumenEntrada(entry({ tabla: "user_permissions", detalles: { operacion_permiso: "conceder", despues: { section_key: "facturas" } } }))).toBe("Ha concedido permisos en Facturas");
    expect(resumenEntrada(entry({ tabla: "admin_feature_toggles", detalles: { despues: { section_key: "gift_vouchers", label: "Cheques regalo", enabled: false } } }))).toBe("Ha desactivado una sección del panel: Cheques regalo");
    expect(resumenEntrada(entry({ tabla: "newsletter_suscriptores", accion: "crear", detalles: { despues: { email: "cliente@example.com" } } }))).toBe("Ha creado una nueva suscripción a la newsletter «cliente@example.com»");
  });
  it("conserva frases breves para preguntas largas o sin texto", () => {
    const resumen = resumenEntrada(entry({ accion: "ejecutar", detalles: { tipo_evento: "consulta_ia", pregunta: "gasto ".repeat(100) } }));
    expect(resumen).toContain("…»");
    expect(resumen.length).toBeLessThan(230);
    expect(resumenEntrada(entry({ accion: "ejecutar", tipo_evento: "consulta_ia" }))).toBe("Ha consultado la IA de facturas");
  });
  it.each([
    ["pagina1", "Leyendo la primera página"],
    ["paginas", "Leyendo las páginas"],
    ["consolidando", "Uniendo los datos de las páginas"],
    ["completado", "Completado"],
    ["duplicado", "Documento duplicado"],
    ["fallido", "Fallido"],
  ])("explica el estado OCR %s sin identificadores", (estado, visible) => {
    expect(resumenEntrada(entry({ tabla: "ocr_trabajos", detalles: { despues: { id: "trabajo-uuid", factura_id: "factura-uuid", nombre_original: "pendientes/usuario-uuid/Factura.pdf", estado } } }))).toBe(`Lectura de una factura «Factura.pdf»: ${visible}`);
  });
  it("explica la lectura de una página y los nombres alternativos de productos", () => {
    expect(resumenEntrada(entry({ tabla: "ocr_trabajo_paginas", detalles: { despues: { numero: 2, estado: "completada", trabajo_id: "uuid" } } }))).toBe("Lectura de la página 2 de una factura: Completada");
    expect(resumenEntrada(entry({ tabla: "productos_alias", accion: "crear", detalles: { despues: { texto_normalizado: "patata lavada", producto_id: "uuid" } } }))).toBe("Ha creado un nuevo nombre alternativo de producto «patata lavada»");
  });
  it("explica la solicitud de publicación sin confundirla con un despliegue ya completado", () => {
    expect(resumenEntrada(entry({ tabla: "web_rebuild_state", detalles: { antes: { pendiente: true }, despues: { pendiente: false, sitio: "Casa Tomás" } } }))).toBe("Ha enviado los cambios de la web para su publicación: Casa Tomás");
    expect(resumenEntrada(entry({ tabla: "web_rebuild_state", detalles: { despues: { pendiente: true } } }))).toBe("Ha dejado cambios pendientes de publicar en la web");
  });
  it("nombra ajustes de servicio, visitas y registros de credenciales sin afirmar crear una clave externa", () => {
    expect(resumenEntrada(entry({ tabla: "ajustes_mesa_servicio", detalles: { despues: { mesa_id: "uuid", turno: "Comida", plazas: 6 } } }))).toBe("Ha guardado un ajuste de mesa para un servicio (Comida): 6 plazas");
    expect(resumenEntrada(entry({ tabla: "trafico_web_diario", detalles: { despues: { visitas: 12 } } }))).toBe("Ha actualizado las estadísticas de visitas web");
    expect(resumenEntrada(entry({ tabla: "openai_claves", accion: "crear", detalles: { despues: { nombre: "Lectura de facturas", api_key_id: "[oculto]" } } }))).toBe("Ha creado un nuevo registro de credencial de IA «Lectura de facturas»");
  });
  it("prioriza el resultado proporcionado por la vista de auditoría", () => {
    expect(resumenEntrada(entry({ accion: "ejecutar", resultado: "fallida", detalles: { operacion: "admin-update-user-password", resultado: "completada" } }))).toBe("No se ha podido cambiar la contraseña de un usuario");
  });
});

it.each([true, false])(
  "explica el bloqueo y desbloqueo de un usuario (%s)",
  (blocked) => {
    const e = entry({
      tabla: "auth.users",
      detalles: {
        antes: {
          email: "persona@staff.local",
          banned_until: blocked ? null : "2126-10-13T08:00:00Z",
        },
        despues: {
          email: "persona@staff.local",
          banned_until: blocked ? "2126-10-13T08:00:00Z" : null,
        },
      },
    });
    expect(tipoEvento(e)).toBe(
      blocked ? "bloquear_acceso" : "desbloquear_acceso",
    );
    expect(resumenEntrada(e)).toBe(
      `Ha ${blocked ? "bloqueado" : "desbloqueado"} el acceso de «persona@staff.local»`,
    );
    expect(puedeRevertir(e)).toBe(false);
  },
);
