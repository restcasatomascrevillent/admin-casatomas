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
  solicitudes_pendientes: "solicitud de reserva",
  espacios_reserva: "espacio de reservas",
  planos_espacio: "plano del comedor",
  asignaciones_mesa: "asignación de mesa",
  blacklist: "bloqueo de cliente",
  sugerencias_blacklist: "sugerencia de bloqueo",
  proveedores_alias: "nombre alternativo de proveedor",
  categorias_producto: "categoría de productos",
  facturas_cheques: "factura de cheques regalo",
  newsletter_suscriptores: "suscripción a la newsletter",
  newsletter_envios: "envío de newsletter",
  envios_email_reserva: "correo de reserva",
  email_eventos: "estado de entrega de un correo",
  BebidasVENTA: "bebida de venta",
  ComidaVENTA: "producto de comida de venta",
  pedidos_ecommerce: "pedido",
  lineas_pedido: "línea de pedido",
  movimientos_stock: "movimiento de existencias",
  costes_fijos: "coste fijo",
  servicios_contratados: "servicio contratado",
  servicios_config: "tipo de cambio de Servicios",
  ia_funciones: "función de IA",
  ia_coste_estimado: "estimación de coste de IA",
  profiles: "perfil de usuario",
  sell_users: "usuario de venta",
  user_role_presets: "plantilla de permisos",
  ocr_trabajos: "procesamiento de factura",
  ocr_trabajo_paginas: "lectura de página de factura",
  productos_alias: "nombre alternativo de producto",
  web_rebuild_state: "estado de publicación de la web",
  trafico_web_diario: "estadística diaria de visitas web",
  ajustes_mesa_servicio: "ajuste de mesa para un servicio",
  openai_claves: "registro de credencial de IA",
};
const CONFIGURACIONES: Record<string, string> = {
  configuracion_web: "la web",
  configuracion_reservas: "las reservas",
  configuracion_turnos: "los turnos de reserva",
  dashboard_config: "el panel",
  configBotWeb: "el asistente de la web",
  chat_web_config: "el chat de la web",
  gdpr_config: "la privacidad",
  phone_system_config: "la telefonía",
  config_google_places: "las reseñas de Google",
  configuracion_facturas: "las facturas de proveedores",
  oficiososia_facturacion_config: "la emisión de facturas",
  plantilla_cheques_regalo: "la plantilla de cheques regalo",
  plantilla_factura_cheques: "la plantilla de facturas de cheques",
  plantillas_email_reserva: "la plantilla de correos de reserva",
  configuracion_tienda: "la tienda de vinos",
};
const CAMPOS: Record<string, string> = {
  nombre: "Nombre",
  precio_eur: "Precio",
  importe_eur: "Importe",
  gastos_gestion_eur: "Gastos de gestión",
  stripe_fee_eur: "Comisión de Stripe",
  gastos_gestion_activos: "Cobrar gastos de gestión",
  gastos_gestion_porcentaje: "Gastos de gestión (%)",
  gastos_gestion_fijo_eur: "Gastos de gestión (parte fija)",
  categoria: "Categoría",
  descripcion: "Descripción",
  alergenos_oficiales: "Alérgenos",
  alergenos_inferidos: "Alérgenos inferidos",
  sin_gluten_disponible: "Se puede hacer para celíacos",
  apto_celiacos: "Apto para celíacos",
  apto_sin_lactosa: "Apto sin lactosa",
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
  unidad: "Unidad de precio",
  name: "Nombre del archivo",
  bucket_id: "Almacén de archivos",
  contiene_sulfitos: "Contiene sulfitos",
  expanded: "Foto ampliada en la carta",
  canjeado_en: "Fecha de canje",
  motivo: "Motivo",
  numero_factura: "Número de factura",
  subject: "Asunto",
  destinatario: "Destinatario",
  status: "Estado",
  feature_key: "Sección del panel",
  acceso_bloqueado: "Acceso bloqueado",
  access_blocked: "Acceso bloqueado",
  nombre_original: "Archivo original",
  num_paginas: "Número de páginas",
  pagina_doc: "Página del documento",
  filas_extraidas: "Líneas leídas",
  filas_contadas: "Líneas detectadas",
  intentos: "Intentos de lectura",
  texto_normalizado: "Nombre alternativo del producto",
  sitio: "Web",
  visitas: "Visitas",
  visitantes: "Visitantes",
  turno: "Servicio",
  plazas: "Plazas",
  piezas: "Piezas de la mesa",
  picos: "Plazas adicionales",
  unida_a: "Unión con otra mesa",
};
const OMITIDOS = new Set([
  "id",
  "created_at",
  "updated_at",
  "actualizado_en",
  "modified_at",
  "request_id",
  "updated_by",
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
  if (campo === "role" || campo === "rol") {
    const roles: Record<string, string> = { admin: "Administrador", manager: "Manager", staff: "Personal", user: "Usuario", assistant: "IA de facturas" };
    return roles[texto] ?? texto;
  }
  if (campo === "estado" || campo === "status") {
    const estados: Record<string, string> = {
      no_show: "No se presentó",
      confirmada: "Confirmada",
      pendiente: "Pendiente",
      cancelada: "Cancelada",
      completada: "Completada",
      pagado: "Pagado",
      enviado: "Enviado",
      entregado: "Entregado",
      failed: "Fallido",
      processing: "En proceso",
      completed: "Completado",
      pending: "Pendiente",
      sent: "Enviado",
      delivered: "Entregado",
      bounced: "No entregado",
      paid: "Pagado",
      cancelled: "Cancelado",
      pagina1: "Leyendo la primera página",
      paginas: "Leyendo las páginas",
      consolidando: "Uniendo los datos de las páginas",
      procesando: "En proceso de lectura",
      completado: "Completado",
      duplicado: "Documento duplicado",
      fallido: "Fallido",
      fallida: "Fallida",
    };
    return estados[texto] ?? texto.replace(/_/g, " ");
  }
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
function filaObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}
function textoCorto(valor: unknown, limite = 100): string {
  const texto = typeof valor === "string" || typeof valor === "number"
    ? String(valor).replace(/\s+/g, " ").trim()
    : "";
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}
function nombreArchivo(fila: Record<string, unknown>): string {
  return textoCorto(String(fila.name ?? "").split("/").pop());
}
function claseArchivo(fila: Record<string, unknown>): string {
  if (fila.bucket_id === "facturas-originales") return "archivo original de factura";
  const metadata = filaObjeto(fila.metadata);
  return String(metadata.mimetype ?? "").startsWith("image/") ? "imagen" : "archivo";
}
/** Información útil del archivo; rutas, propietarios y versiones quedan en el JSON técnico. */
export function camposArchivoLegibles(entrada: AuditLogEntry) {
  const d = entrada.detalles ?? {};
  const fila = filaObjeto(d.despues ?? d.antes);
  const metadata = filaObjeto(fila.metadata);
  const bytes = Number(metadata.size ?? metadata.contentLength);
  const campos = [{ campo: "archivo", etiqueta: "Archivo", valor: nombreArchivo(fila) || "Sin nombre registrado" }];
  if (fila.bucket_id === "facturas-originales")
    campos.push({ campo: "uso", etiqueta: "Uso", valor: "Original de factura para su lectura y procesamiento" });
  if (typeof metadata.mimetype === "string") {
    const tipos: Record<string, string> = { "image/jpeg": "Imagen JPEG", "image/png": "Imagen PNG", "image/webp": "Imagen WebP", "application/pdf": "Documento PDF" };
    campos.push({ campo: "tipo", etiqueta: "Tipo", valor: tipos[metadata.mimetype] ?? metadata.mimetype });
  }
  if (Number.isFinite(bytes) && bytes >= 0)
    campos.push({ campo: "tamano", etiqueta: "Tamaño", valor: bytes < 1024 ? `${bytes} bytes` : `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} ${bytes < 1048576 ? "KB" : "MB"}` });
  return campos;
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
      entrada.tabla === "auth.users" &&
      antes.banned_until !== despues.banned_until
    )
      return despues.banned_until &&
        new Date(String(despues.banned_until)).getTime() >
          new Date(entrada.created_at).getTime()
        ? "bloquear_acceso"
        : "desbloquear_acceso";
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
  const evento = tipoEvento(entrada);
  const fila = filaObjeto(d.despues ?? d.antes);
  const antes = filaObjeto(d.antes);
  const despues = filaObjeto(d.despues);
  if (evento === "reversion")
    return "Ha revertido un cambio de auditoría";
  if (evento === "consulta_ia" || evento === "regeneracion_ia") {
    const pregunta = textoCorto(d.pregunta, 180);
    return `${evento === "regeneracion_ia" ? "Ha pedido otra respuesta a" : "Ha consultado"} la IA de facturas${pregunta ? `: «${pregunta}»` : ""}`;
  }
  if (entrada.tabla === "mensajes_chat") {
    const mensaje = textoCorto(fila.contenido ?? fila.content, 180);
    return `${entrada.accion === "eliminar" ? "Ha eliminado un mensaje de la IA de facturas" : (fila.rol ?? fila.role) === "assistant" ? "La IA de facturas ha respondido" : "Ha preguntado a la IA de facturas"}${mensaje ? `: «${mensaje}»` : ""}`;
  }
  if (entrada.tabla === "conversaciones")
    return `Ha ${entrada.accion === "eliminar" ? "eliminado" : "creado"} una conversación con la IA de facturas${fila.titulo ? `: «${textoCorto(fila.titulo)}»` : ""}`;
  if (evento === "bloquear_acceso" || evento === "desbloquear_acceso") {
    return `Ha ${evento === "bloquear_acceso" ? "bloqueado" : "desbloqueado"} el acceso de ${fila.email ? `«${String(fila.email)}»` : "un usuario"}`;
  }
  if (d.credenciales_actualizadas)
    return `Ha cambiado la contraseña de ${fila.email ? `«${textoCorto(fila.email)}»` : "un usuario"}`;
  if (entrada.tabla === "user_permissions")
    return `Ha ${d.operacion_permiso === "retirar" ? "retirado" : d.operacion_permiso === "conceder" ? "concedido" : "modificado"} permisos${fila.section_key ? ` en ${etiquetaCampo(String(fila.section_key))}` : " de acceso"}`;
  if (entrada.tabla === "super_admins")
    return `Ha ${d.operacion_asignacion === "retirar" || d.operacion_sql === "DELETE" ? "retirado" : d.operacion_asignacion === "asignar" || d.operacion_sql === "INSERT" ? "concedido" : "modificado"} el acceso de superadmin${fila.email ? ` a «${textoCorto(fila.email)}»` : " a un usuario"}`;
  if (entrada.tabla === "user_roles")
    return `Ha ${d.operacion_asignacion === "retirar" ? "retirado" : d.operacion_asignacion === "asignar" ? "asignado" : "modificado"} un rol de usuario${fila.role ? `: ${valorLegible("role", fila.role)}` : ""}`;
  if (entrada.tabla === "storage.objects") {
    const archivo = nombreArchivo(fila);
    const clase = claseArchivo(fila);
    if (entrada.accion === "crear") return `Ha subido un ${clase === "imagen" ? "archivo de imagen" : clase}${archivo ? `: ${archivo}` : ""}`;
    if (entrada.accion === "eliminar") return `Ha eliminado ${clase === "imagen" ? "una imagen" : `un ${clase}`}${archivo ? `: ${archivo}` : ""}`;
    if (antes.name && despues.name && antes.name !== despues.name) {
      const anterior = nombreArchivo(antes);
      return anterior !== archivo
        ? `Ha renombrado el archivo «${anterior}» a «${archivo}»`
        : `Ha movido el archivo «${archivo}»`;
    }
    return `Ha actualizado ${clase === "imagen" ? "una imagen" : `un ${clase}`}${archivo ? `: ${archivo}` : ""}`;
  }
  if (entrada.tabla === "ocr_trabajos" || entrada.tabla === "ocr_trabajo_paginas") {
    const pagina = entrada.tabla === "ocr_trabajo_paginas";
    const numero = fila.pagina_doc ?? fila.numero;
    const identificador = pagina
      ? `la página${typeof numero === "number" && Number.isInteger(numero) && numero > 0 ? ` ${numero}` : ""} de una factura`
      : `una factura${fila.nombre_original ? ` «${nombreArchivo({ name: fila.nombre_original })}»` : ""}`;
    if (entrada.accion === "eliminar") return `Ha eliminado el procesamiento de ${identificador}`;
    if (entrada.accion === "crear") return `Ha preparado la lectura de ${identificador}`;
    return `Lectura de ${identificador}${fila.estado ? `: ${valorLegible("estado", fila.estado)}` : ": Datos de procesamiento actualizados"}`;
  }
  if (entrada.tabla === "web_rebuild_state") {
    const sitio = textoCorto(fila.sitio);
    return `${entrada.accion === "eliminar" ? "Ha eliminado el estado de publicación de la web" : despues.pendiente === true ? "Ha dejado cambios pendientes de publicar en la web" : antes.pendiente === true && despues.pendiente === false ? "Ha enviado los cambios de la web para su publicación" : "Ha actualizado el estado de publicación de la web"}${sitio ? `: ${sitio}` : ""}`;
  }
  if (entrada.tabla === "trafico_web_diario")
    return `Ha ${entrada.accion === "eliminar" ? "eliminado" : "actualizado"} las estadísticas de visitas web${fila.fecha ? ` del ${valorLegible("fecha", fila.fecha)}` : ""}`;
  if (entrada.tabla === "ajustes_mesa_servicio")
    return `Ha ${entrada.accion === "eliminar" ? "eliminado" : "guardado"} un ajuste de mesa para un servicio${fila.fecha ? ` del ${valorLegible("fecha", fila.fecha)}` : ""}${fila.turno ? ` (${textoCorto(fila.turno)})` : ""}${typeof fila.plazas === "number" && entrada.accion !== "eliminar" ? `: ${fila.plazas} plazas` : ""}`;
  if (entrada.accion === "ejecutar") {
    const operaciones: Record<string, string> = {
      "chat-facturas": "utilizar la IA de facturas",
      "procesar-factura": "procesar una factura",
      "ocr-trabajo": "procesar las páginas de una factura",
      "rebuild-webs": "publicar cambios en la web",
      "traducir-contenido": "traducir contenido",
      "traducir-carta": "traducir la carta",
      "traducir-carta-auto": "traducir la carta automáticamente",
      "traducir-novedad": "traducir una novedad",
      "traducir-novedad-auto": "traducir una novedad automáticamente",
      "extraer-vino-foto": "leer los datos de un vino desde una foto",
      "format-novedad": "dar formato a una novedad",
      "newsletter-sync-resend": "sincronizar la newsletter",
      "enviar-newsletter": "enviar una newsletter",
      "newsletter-baja": "dar de baja una suscripción a la newsletter",
      "emails-reserva": "gestionar los correos de reservas",
      "resend-webhook": "actualizar el estado de entrega de un correo",
      "reservas-web": "gestionar una reserva de la web",
      "chat-web": "utilizar el asistente de la web",
      "clasificar-productos": "clasificar productos de facturas",
      "buscar-precios-mercado": "consultar precios de mercado",
      "sync-google-reviews": "sincronizar reseñas de Google",
      "sincronizar-costes-openai": "sincronizar costes de IA",
      "enviar-imagen-webhook": "enviar una imagen para su procesamiento",
      "procesar-dibujo-perimetro": "procesar el plano de un espacio",
      "admin-create-user": "crear un usuario",
      "admin-delete-user": "eliminar un usuario",
      "admin-set-super-admin": "cambiar el acceso de superadmin",
      "admin-update-user-password": "cambiar la contraseña de un usuario",
      "cambiar-mi-contrasena": "cambiar su propia contraseña",
      "admin-set-user-access": "cambiar el acceso de un usuario",
      "auditoria-revertir": "revertir un cambio de auditoría",
      "list-users": "consultar la lista de usuarios",
      "notify-config-bot-change": "notificar un cambio del asistente web",
      "notify-reservation-change": "notificar un cambio de reserva",
      "panel-auth": "validar el acceso al panel",
      "leer-metricas": "consultar las métricas del panel",
      "registrar-metrica": "registrar una métrica del panel",
      "sync-trafico-web": "sincronizar las estadísticas de visitas web",
      "vapi-analytics": "consultar las estadísticas de telefonía",
    };
    const operacion = String(d.operacion ?? d.origen ?? "").split("/")[0];
    const descripcion = operaciones[operacion];
    const resultado = entrada.resultado ?? d.resultado;
    if (resultado === "fallida") return `No se ha podido ${descripcion ?? "completar una acción del servidor"}`;
    if (resultado === "parcial") return `Ha solicitado ${descripcion ?? "una acción del servidor"}; resultado parcial`;
    return descripcion ? `Ha solicitado ${descripcion}` : "Ha realizado una acción del servidor";
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
  const nombre =
    fila.nombre ??
    fila.titulo ??
    fila.codigo ??
    fila.numero_factura ??
    fila.email ?? fila.asunto ?? (entrada.tabla === "productos_alias" ? fila.texto_normalizado : undefined);
  const entidad = ENTIDADES[entrada.tabla ?? ""] ?? etiquetaCampo(entrada.tabla ?? "registro").toLocaleLowerCase("es");
  const modificados = Object.keys({ ...antes, ...despues }).filter(c => !OMITIDOS.has(c) && !/(password|secret|token|api_?key|authorization)/i.test(c) && JSON.stringify(antes[c]) !== JSON.stringify(despues[c]));
  const camposModificados = modificados.slice(0, 3).map(etiquetaCampo).join(", ");
  const detalleModificacion = camposModificados ? `: ${camposModificados}${modificados.length > 3 ? ` y ${modificados.length - 3} campos más` : ""}` : "";
  const configuracion = CONFIGURACIONES[entrada.tabla ?? ""];
  if (configuracion)
    return `Ha ${entrada.accion === "eliminar" ? "eliminado" : entrada.accion === "crear" ? "guardado" : "modificado"} la configuración de ${configuracion}${entrada.accion === "actualizar" ? detalleModificacion : ""}`;
  if (entrada.tabla === "admin_feature_toggles")
    return `Ha ${entrada.accion === "eliminar" ? "eliminado la configuración de" : despues.enabled === true ? "activado" : despues.enabled === false ? "desactivado" : "modificado"} una sección del panel${fila.label || fila.section_key ? `: ${textoCorto(fila.label ?? etiquetaCampo(String(fila.section_key)))}` : ""}`;
  const verbo =
    entrada.accion === "crear"
      ? "creado"
      : entrada.accion === "eliminar"
        ? "eliminado"
        : "modificado";
  const femenina =
    /^(bebida|tapa|novedad|reseña|reserva|mesa|factura|línea|conversación|solicitud|asignación|sugerencia|categoría|suscripción|función|estimación|plantilla)/.test(
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
  const objetivo = `${femenina ? "la" : "el"} ${entidad}${nombre ? ` «${textoCorto(nombre)}»` : ""}`;
  const referencia = femenina ? `de ${objetivo}` : `del ${objetivo.slice(3)}`;
  if (entrada.accion === "actualizar") {
    if (evento === "cambiar_precio")
      return `Ha cambiado el precio ${referencia}: ${valorLegible("precio_eur", antes.precio_eur)} → ${valorLegible("precio_eur", despues.precio_eur)}`;
    if (evento === "cambiar_visibilidad" && typeof despues.activado === "boolean")
      return `Ha ${despues.activado ? "mostrado" : "ocultado"} ${objetivo} en la web`;
    if (evento === "canjear_cheque")
      return despues.usado === false ? `Ha anulado el canje ${referencia}` : `Ha canjeado ${objetivo}`;
    if (antes.estado !== despues.estado && ("estado" in antes || "estado" in despues))
      return `Ha cambiado el estado ${referencia}: ${valorLegible("estado", antes.estado)} → ${valorLegible("estado", despues.estado)}`;
    if (modificados.length > 0)
      return `Ha modificado ${objetivo}${detalleModificacion}`;
  }
  return `Ha ${verbo} ${articulo} ${entidad}${nombre ? ` «${textoCorto(nombre)}»` : ""}`;
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
