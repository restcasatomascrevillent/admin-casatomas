import type { AuditLogEntry } from "@/hooks/useAuditLog";

export const TABLAS_REVERSIBLES = [
  "Platos",
  "Vinos",
  "Bebidas",
  "Cocteles",
  "menus_diarios",
  "tapas",
  "novedades",
  "resenas",
  "configuracion_web",
  "configuracion_reservas",
  "configuracion_turnos",
  "dashboard_config",
  "configBotWeb",
  "chat_web_config",
  "plantilla_cheques_regalo",
  "plantilla_factura_cheques",
  "plantillas_email_reserva",
  "oficiososia_borradores",
  "user_permissions",
  "user_roles",
  "admin_feature_toggles",
  "user_role_presets",
];

const ENTIDADES: Record<string, string> = {
  Platos: "plato",
  Vinos: "vino",
  Bebidas: "bebida",
  Cocteles: "cóctel",
  tapas: "tapa",
  menus_diarios: "menú del día",
  novedades: "novedad",
  resenas: "reseña",
  reservas: "reserva",
  mesas: "mesa",
  cheques_regalo: "cheque regalo",
  facturas: "factura de proveedor",
  oficiososia_facturas: "factura emitida",
  oficiososia_borradores: "borrador de factura",
  proveedores: "proveedor",
  productos_catalogo: "producto",
  productos_factura: "línea de factura",
  user_permissions: "permiso",
  user_roles: "rol de usuario",
  "auth.users": "usuario",
  "storage.objects": "archivo",
  mensajes_chat: "mensaje a la IA de facturas",
  conversaciones: "conversación con la IA de facturas",
};
const CAMPOS: Record<string, string> = {
  nombre: "Nombre",
  precio_eur: "Precio",
  importe_eur: "Importe",
  categoria: "Categoría",
  descripcion: "Descripción",
  alergenos_oficiales: "Alérgenos",
  alergenos_inferidos: "Alérgenos inferidos",
  sin_gluten_disponible: "Se puede hacer sin gluten",
  activado: "Visible",
  enabled: "Activado",
  featured: "Destacado",
  restaurante: "Restaurante",
  touza: "Touza",
  orden: "Orden",
  imagen_url: "Imagen",
  ubicacion_pais: "País",
  ubicacion_region: "Región",
  denominacion_origen: "Denominación de origen",
  fecha: "Fecha",
  hora: "Hora",
  numero_comensales: "Comensales",
  estado: "Estado",
  notas_cliente: "Notas",
  section_key: "Sección",
  can_view: "Puede ver",
  can_edit: "Puede editar",
  can_delete: "Puede eliminar",
  can_create: "Puede crear",
  role: "Rol",
  user_id: "Usuario",
  usado: "Canjeado",
  caduca_el: "Caducidad",
  codigo: "Código",
  email: "Correo",
  titulo: "Título",
  contenido: "Mensaje",
  content: "Mensaje",
  rol: "Autor del mensaje",
  session_id: "Conversación",
  banned_until: "Bloqueado hasta",
  cantidad: "Cantidad",
  ingredientes: "Ingredientes",
  traducciones: "Traducciones",
};
const OMITIDOS = new Set([
  "id",
  "created_at",
  "updated_at",
  "actualizado_en",
  "modified_at",
  "request_id",
  "expanded",
  "embedding",
]);
export function etiquetaCampo(campo: string): string {
  return (
    CAMPOS[campo] ??
    campo.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
export function valorLegible(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "")
    return "Sin indicar";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (
    typeof valor === "number" &&
    /(_eur|precio|importe|total|coste)/.test(campo)
  )
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
    }).format(valor);
  if (Array.isArray(valor))
    return valor.length
      ? valor.map((v) => valorLegible(campo, v)).join(", ")
      : "Ninguno";
  if (typeof valor === "object")
    return Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => `${etiquetaCampo(k)}: ${valorLegible(k, v)}`)
      .join(" · ");
  const texto = String(valor);
  if (
    /^(\d{4}-\d{2}-\d{2})(T|$)/.test(texto) &&
    /(fecha|_at$|_en$|caduca|banned_until)/.test(campo)
  ) {
    const fecha = new Date(texto.length === 10 ? `${texto}T12:00:00` : texto);
    if (!Number.isNaN(fecha.getTime()))
      return fecha.toLocaleString(
        "es-ES",
        texto.length === 10
          ? { dateStyle: "medium" }
          : { dateStyle: "medium", timeStyle: "short" },
      );
  }
  return texto;
}
export function camposLegibles(fila: unknown) {
  if (!fila || typeof fila !== "object" || Array.isArray(fila)) return [];
  return Object.entries(fila)
    .filter(
      ([k, v]) =>
        !OMITIDOS.has(k) &&
        !/(password|secret|token|api_?key|base64|authorization)/i.test(k) &&
        v !== "[oculto]",
    )
    .map(([campo, valor]) => ({
      campo,
      etiqueta: etiquetaCampo(campo),
      valor: valorLegible(campo, valor),
    }));
}
export function tipoEvento(entrada: AuditLogEntry): string {
  if (entrada.tipo_evento) return entrada.tipo_evento;
  const d = entrada.detalles ?? {};
  if (entrada.accion === "ejecutar" && d.tipo_evento)
    return String(d.tipo_evento);
  if (entrada.tabla === "conversaciones")
    return entrada.accion === "eliminar" ? "eliminar_chat_ia" : "crear_chat_ia";
  if (entrada.tabla === "mensajes_chat")
    return d.operacion_sql === "DELETE" || entrada.accion === "eliminar"
      ? "eliminar_chat_ia"
      : "mensaje_ia";
  if (entrada.tabla === "user_permissions") return "cambiar_permisos";
  if (entrada.tabla === "user_roles" || entrada.tabla === "super_admins")
    return "cambiar_roles";
  if (d.credenciales_actualizadas) return "cambiar_credenciales";
  const antes = d.antes as Record<string, unknown> | undefined;
  const despues = d.despues as Record<string, unknown> | undefined;
  if (entrada.accion === "actualizar" && antes && despues) {
    if (
      entrada.tabla === "cheques_regalo" &&
      (antes.usado !== despues.usado ||
        antes.canjeado_en !== despues.canjeado_en)
    )
      return "canjear_cheque";
    if (antes.precio_eur !== despues.precio_eur) return "cambiar_precio";
    if (antes.activado !== despues.activado) return "cambiar_visibilidad";
  }
  return entrada.accion;
}
export function resumenEntrada(entrada: AuditLogEntry): string {
  const d = entrada.detalles ?? {};
  if (d.tipo_evento === "reversion")
    return "Ha revertido un cambio de auditoría";
  if (d.tipo_evento === "consulta_ia" || d.tipo_evento === "regeneracion_ia")
    return `${d.tipo_evento === "regeneracion_ia" ? "Ha pedido otra respuesta a" : "Ha consultado"} la IA de facturas: «${String(d.pregunta ?? "").slice(0, 180)}»`;
  if (entrada.tabla === "mensajes_chat") {
    const fila = (d.despues ?? d.antes ?? {}) as Record<string, unknown>;
    return `${entrada.accion === "eliminar" ? "Ha eliminado un mensaje" : (fila.rol ?? fila.role) === "assistant" ? "La IA de facturas ha respondido" : "Ha preguntado a la IA de facturas"}: «${String(fila.contenido ?? fila.content ?? "").slice(0, 180)}»`;
  }
  if (d.credenciales_actualizadas)
    return "Ha cambiado las credenciales de un usuario";
  if (entrada.tabla === "user_permissions")
    return `Ha ${d.operacion_permiso === "retirar" ? "retirado" : d.operacion_permiso === "conceder" ? "concedido" : "modificado"} permisos de acceso`;
  if (entrada.tabla === "user_roles" || entrada.tabla === "super_admins")
    return "Ha cambiado un rol o una asignación de superadmin";
  if (entrada.accion === "ejecutar") {
    const operaciones: Record<string, string> = {
      "chat-facturas": "Ha utilizado la IA de facturas",
      "procesar-factura": "Ha procesado una factura",
      "rebuild-webs": "Ha publicado cambios en la web",
      "traducir-contenido": "Ha traducido contenido",
      "extraer-vino-foto": "Ha extraído un vino de una foto",
      "newsletter-sync-resend": "Ha sincronizado la newsletter",
    };
    return (
      operaciones[String(d.operacion)] ??
      `Ha ejecutado ${String(d.operacion ?? "una acción del servidor")}`
    );
  }
  const accesos: Record<string, string> = {
    login: "Ha iniciado sesión",
    logout: "Ha cerrado sesión",
    acceso: "Ha accedido con una sesión abierta",
    acceso_denegado: "Ha intentado acceder sin permiso",
    login_fallido: "Ha intentado iniciar sesión sin éxito",
    intento_login: "Ha iniciado un intento de acceso",
  };
  if (accesos[entrada.accion]) return accesos[entrada.accion];
  const fila = (d.despues ?? d.antes ?? {}) as Record<string, unknown>;
  const nombre =
    fila.nombre ??
    fila.titulo ??
    fila.codigo ??
    fila.numero_factura ??
    fila.email ??
    (entrada.tabla === "storage.objects" ? fila.name : undefined);
  const entidad = ENTIDADES[entrada.tabla ?? ""] ?? "registro";
  const verbo =
    entrada.accion === "crear"
      ? "creado"
      : entrada.accion === "eliminar"
        ? "eliminado"
        : "modificado";
  const femenina =
    /^(bebida|tapa|novedad|reseña|reserva|mesa|factura|línea|conversación)/.test(
      entidad,
    );
  const articulo =
    entrada.accion === "crear"
      ? femenina
        ? "una nueva"
        : "un nuevo"
      : femenina
        ? "la"
        : "el";
  return `Ha ${verbo} ${articulo} ${entidad}${nombre ? ` «${String(nombre)}»` : ""}`;
}
export function puedeRevertir(entrada: AuditLogEntry): boolean {
  return (
    TABLAS_REVERSIBLES.includes(entrada.tabla ?? "") &&
    ["crear", "actualizar", "eliminar"].includes(entrada.accion) &&
    Boolean(entrada.detalles?.antes || entrada.detalles?.despues) &&
    !JSON.stringify(entrada.detalles).includes("[oculto]")
  );
}
export const ACCIONES_ESPECIFICAS = [
  ["crear_chat_ia", "Crear conversación con la IA"],
  ["eliminar_chat_ia", "Eliminar conversación con la IA"],
  ["consulta_ia", "Pregunta a la IA de facturas"],
  ["regeneracion_ia", "Regenerar respuesta de la IA"],
  ["mensaje_ia", "Mensajes históricos de la IA"],
  ["cambiar_precio", "Cambiar precio"],
  ["cambiar_visibilidad", "Mostrar / ocultar contenido"],
  ["canjear_cheque", "Canjear cheque regalo"],
  ["cambiar_permisos", "Cambiar permisos"],
  ["cambiar_roles", "Cambiar roles"],
  ["cambiar_credenciales", "Cambiar credenciales"],
  ["reversion", "Revertir un cambio"],
] as const;
