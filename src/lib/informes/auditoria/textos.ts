// ============================================================================
//  Informe mensual de auditoría — TEXTOS para leerlo sin saber de informática
// ----------------------------------------------------------------------------
//  18/11/2026, petición del dueño: «las acciones del servidor en unas slides
//  finales dividiendo qué son cada una y explicándolo con lenguaje entendible
//  natural». Aquí está el diccionario de:
//    · PROCESOS: lo que hace el servidor solo (el `actor_label` de la auditoría
//      es «API · service_role · <proceso>» o «Base de datos · postgres»);
//    · BOTONES: lo que una persona le pide al servidor desde el panel (la
//      auditoría lo guarda como «ejecutar» en «acciones_servidor», con el
//      nombre de la función en `registro_id`);
//    · COSAS y CAMPOS: cómo se dice cada tabla y cada columna en una frase.
//  Las explicaciones salen de la cabecera de cada función
//  (supabase/functions/<nombre>/index.ts, aquí y en web-casatomas). Si se añade
//  una función nueva y no está aquí, el informe dice «Proceso «nombre»» con una
//  explicación genérica: basta con añadirla a PROCESOS o a BOTONES.
// ============================================================================
import { TABLA_LABEL } from "@/hooks/useAuditLog";
import { fmtEntero, unirLista } from "@/components/trafico-web/informe/formatoInforme";

// ─── Lo que hace el servidor solo ───────────────────────────────────────────

export interface TextoProceso {
  nombre: string;
  explicacion: string;
}

export const PROCESOS: Record<string, TextoProceso> = {
  "ocr-trabajo": {
    nombre: "Lectura de facturas largas",
    explicacion: "Cuando alguien sube una factura o un albarán de varias páginas, el servidor lo lee con IA en segundo plano y crea la factura, sus líneas y, si es nuevo, el proveedor.",
  },
  "procesar-factura": {
    nombre: "Lectura de facturas",
    explicacion: "Lee con IA la foto o el PDF de una factura que se acaba de subir y saca el proveedor, las líneas y los importes.",
  },
  "emails-reserva": {
    nombre: "Correos de las reservas",
    explicacion: "Envía los correos de las reservas (confirmaciones, contraofertas, recordatorios), apunta en cada reserva qué se mandó y deja sugerencias para la lista de bloqueo.",
  },
  "clasificar-productos": {
    nombre: "Clasificación de productos",
    explicacion: "Cada línea nueva de factura se une a su producto del catálogo y a su familia (carne, vino, limpieza…). Si el precio ha subido, deja un aviso.",
  },
  "sync-trafico-web": {
    nombre: "Visitas de la web",
    explicacion: "Cada día trae de Vercel cuántas visitas tuvo la web, para la pantalla Tráfico web y su informe mensual.",
  },
  "facturas-originales-drive": {
    nombre: "Originales de facturas a Google Drive",
    explicacion: "Guarda en Google Drive el PDF o la foto original de cada factura y apunta en la factura el enlace para abrirla.",
  },
  "embeddings-nombres": {
    nombre: "Preparar nombres para buscar",
    explicacion: "Prepara los nombres de los productos de las facturas para que el buscador y el asistente encuentren cosas parecidas aunque estén escritas distinto.",
  },
  "limpiar-fotos-novedades": {
    nombre: "Limpieza de fotos de novedades",
    explicacion: "Borra las fotos que ya no usa ninguna novedad, para no ocupar espacio.",
  },
  "sincronizar-costes-openai": {
    nombre: "Gasto real de la IA (OpenAI)",
    explicacion: "Trae lo que factura OpenAI, el servicio de IA, para la pantalla Servicios › Costes.",
  },
  "resend-webhook": {
    nombre: "Estado de los correos enviados",
    explicacion: "El servicio de correo (Resend) avisa de si cada correo llegó, rebotó o se abrió, y queda apuntado.",
  },
  "instagram-programador": {
    nombre: "Publicaciones programadas de Instagram",
    explicacion: "Cada 5 minutos mira si toca publicar algo programado en Instagram y lo publica.",
  },
  "instagram-metricas": {
    nombre: "Métricas de Instagram",
    explicacion: "Trae de Instagram el alcance, los seguidores y los datos de cada publicación.",
  },
  "cheques-regalo-web": {
    nombre: "Venta de cheques regalo en la web",
    explicacion: "Cuando alguien compra un cheque regalo en la web, crea el cheque y la página de pago.",
  },
  "stripe-webhook-cheques-regalo": {
    nombre: "Pagos de cheques regalo (Stripe)",
    explicacion: "Stripe avisa de que un cheque se ha pagado y el cheque queda como cobrado.",
  },
  "reservas-web": {
    nombre: "Reservas desde la web",
    explicacion: "Recibe las reservas que hacen los clientes en la web y comprueba si hay sitio.",
  },
  "chat-web": {
    nombre: "Chat de la web",
    explicacion: "El asistente que contesta a los clientes en la web pública.",
  },
  "importar-zip2025-sql": {
    nombre: "Importación de las facturas de 2025",
    explicacion: "Carga del histórico de facturas de 2025 (proveedores, facturas y líneas) que el equipo técnico hizo una sola vez.",
  },
  "sync-google-reviews": {
    nombre: "Reseñas de Google",
    explicacion: "Trae las últimas reseñas de Google de los restaurantes.",
  },
  "procesar-logs-web": {
    nombre: "Análisis de los registros de la web",
    explicacion: "Revisa en segundo plano los errores y la actividad de la web para la pantalla Logs.",
  },
};

/** Cargas puntuales (scripts que el equipo técnico lanza una vez): fotos, migraciones, importaciones. */
const RE_CARGA_PUNTUAL = /^(tmp-|importar-|carga-|alta-|fotos-|migracion-|subir-|claude-)/;

export const BASE_DE_DATOS: TextoProceso = {
  nombre: "La base de datos, por su cuenta",
  explicacion: "Reacciones automáticas a otro cambio (al cambiar una reserva, se recolocan sus mesas) y tareas de mantenimiento del equipo técnico.",
};

/** Todas las cargas puntuales juntas, en una sola tarjeta. */
export const CARGAS_PUNTUALES: TextoProceso = {
  nombre: "Cargas puntuales del equipo técnico",
  explicacion: "Procesos que el equipo técnico lanzó una vez para cargar o mover datos o fotos. No se repiten solos.",
};

export const esCargaPuntual = (clave: string): boolean => !PROCESOS[clave] && !BOTONES[clave] && RE_CARGA_PUNTUAL.test(clave);

/** «API · service_role · ocr-trabajo» → «ocr-trabajo»; «Base de datos · postgres» → «base_de_datos». */
export function claveProceso(label: string | null): string {
  if (!label) return "sistema";
  if (/^Base de datos/i.test(label)) return "base_de_datos";
  const m = label.match(/^API\s*·\s*[a-z_]+\s*·\s*(.+)$/i);
  return m ? m[1].trim() : label;
}

/** Nombre y explicación de un proceso automático, aunque no esté en el diccionario. */
export function textoProceso(clave: string): TextoProceso {
  if (clave === "base_de_datos") return BASE_DE_DATOS;
  if (PROCESOS[clave]) return PROCESOS[clave];
  if (BOTONES[clave]) return { nombre: BOTONES[clave], explicacion: "Lo hace el servidor sin que nadie pulse nada en ese momento." };
  if (RE_CARGA_PUNTUAL.test(clave)) {
    return {
      nombre: `Carga puntual «${clave}»`,
      explicacion: "Un proceso que el equipo técnico lanzó una vez para cargar o mover datos o fotos. No se repite solo.",
    };
  }
  return { nombre: `Proceso «${clave}»`, explicacion: "Un proceso del servidor que trabaja sin que nadie pulse nada." };
}

// ─── Lo que una persona le pide al servidor (botones) ───────────────────────

export const BOTONES: Record<string, string> = {
  "importar-factura-historica": "Importar facturas antiguas del histórico",
  "rebuild-webs": "Publicar los cambios en las webs",
  "traducir-contenido": "Traducir la carta o una novedad a otros idiomas",
  "chat-facturas": "Preguntar al asistente de Facturas",
  "newsletter-sync-resend": "Sincronizar los suscriptores de la newsletter",
  "procesar-factura": "Leer una factura con IA",
  "ocr-trabajo": "Leer una factura larga con IA",
  "instagram-drive": "Buscar fotos para Instagram en Google Drive",
  "registrar-metrica": "Apuntar su inicio de sesión, automático al entrar",
  "extraer-vino-foto": "Leer la etiqueta de un vino desde una foto",
  "instagram-estado": "Mirar el estado de la cuenta de Instagram",
  "instagram-metricas": "Actualizar las métricas de Instagram",
  "instagram-ia": "Pedir textos a la IA para Instagram",
  "instagram-publicar": "Publicar en Instagram",
  "procesar-logs-web": "Analizar los registros de la web",
  "format-novedad": "Mejorar con IA el texto de una novedad",
  "resenas-contestador": "Preparar con IA respuestas a reseñas de Google",
  "notify-reservation-change": "Avisar de un cambio en una reserva",
  "admin-set-user-access": "Bloquear o devolver el acceso a un usuario",
  "admin-delete-user": "Borrar un usuario",
  "admin-create-user": "Crear un usuario",
  "admin-update-user-password": "Cambiar la contraseña de un usuario",
  "admin-set-super-admin": "Dar o quitar el permiso de super admin",
  "emails-reserva": "Enviar correos de una reserva",
  "interpretar-reserva-manuscrita": "Pasar a limpio una reserva escrita a mano",
  "rrss-ia": "Pedir ideas o textos a la IA de redes sociales",
  "facturas-original": "Abrir el original de una factura",
  "subir-original-drive": "Subir el original de una factura a Drive",
  "ia-modelos-openai": "Cambiar los modelos de IA",
  "avisos-telegram": "Configurar o probar los avisos por Telegram",
  "analizar-peticion": "Analizar con IA una petición del panel",
  "recortar-fondo-vino": "Quitar el fondo a la foto de un vino",
  "buscar-puntuacion-parker": "Buscar la puntuación Parker de un vino",
  "auditoria-revertir": "Deshacer un cambio desde Auditoría",
  "cambiar-mi-contrasena": "Cambiar su propia contraseña",
  "list-users": "Ver la lista de usuarios",
  "control-excel": "Consultar o editar el Excel de control",
  "enviar-newsletter": "Enviar la newsletter",
  "newsletter-ia": "Redactar la newsletter con IA",
  "newsletter-baja": "Dar de baja a un suscriptor",
  "transcribir-dictado": "Dictar por voz",
  "servicios-uso": "Consultar el consumo de los servicios",
  "stripe-estado-cuenta": "Consultar el estado de Stripe",
  "sync-google-reviews": "Traer las reseñas de Google",
  "cheques-regalo-admin": "Gestionar cheques regalo",
  "leer-metricas": "Ver los inicios de sesión del personal",
  "procesar-dibujo-perimetro": "Dibujar el contorno de una sala",
  "vapi-analytics": "Ver las estadísticas del teléfono con IA",
  "notificar-video": "Avisar de que un vídeo está listo",
  "sincronizar-costes-openai": "Actualizar el gasto real de la IA",
  "clasificar-productos": "Clasificar productos de las facturas",
  "embeddings-nombres": "Preparar nombres de productos para buscar",
  "resumen-logs-web": "Ver el resumen de los registros de la web",
  "sync-trafico-web": "Actualizar las visitas de la web",
};

export const textoBoton = (op: string | null | undefined): string => (op && BOTONES[op]) || (op ? `Acción del servidor «${op}»` : "Acción del servidor");

// ─── Cómo se dice cada cosa ─────────────────────────────────────────────────

/** [una, varias]: «una reserva» / «reservas». */
const COSAS: Record<string, [string, string]> = {
  reservas: ["una reserva", "reservas"],
  solicitudes_pendientes: ["una solicitud de reserva", "solicitudes de reserva"],
  asignaciones_mesa: ["una asignación de mesa", "asignaciones de mesa"],
  ajustes_mesa_servicio: ["un ajuste de mesas del servicio", "ajustes de mesas del servicio"],
  servicios_bloqueados: ["un servicio cerrado", "servicios cerrados"],
  salas_cerradas_servicio: ["una sala cerrada", "salas cerradas"],
  mesas: ["una mesa", "mesas"],
  espacios_reserva: ["una sala", "salas"],
  planos_espacio: ["un plano", "planos"],
  blacklist: ["a alguien en la lista de bloqueo", "entradas de la lista de bloqueo"],
  sugerencias_blacklist: ["una sugerencia de bloqueo", "sugerencias de bloqueo"],
  Platos: ["un plato", "platos"],
  Vinos: ["un vino", "vinos"],
  Bebidas: ["una bebida", "bebidas"],
  Cocteles: ["un cóctel", "cócteles"],
  tapas: ["una tapa", "tapas"],
  menus_diarios: ["un menú del día", "menús del día"],
  novedades: ["una novedad", "novedades"],
  facturas: ["una factura", "facturas"],
  productos_factura: ["una línea de factura", "líneas de factura"],
  productos_catalogo: ["un producto del catálogo", "productos del catálogo"],
  productos_alias: ["un nombre de producto", "nombres de producto"],
  proveedores: ["un proveedor", "proveedores"],
  proveedores_alias: ["un nombre de proveedor", "nombres de proveedor"],
  avisos_subida_precio: ["un aviso de subida de precio", "avisos de subida de precio"],
  cheques_regalo: ["un cheque regalo", "cheques regalo"],
  "storage.objects": ["un archivo", "archivos"],
  conversaciones: ["una conversación con la IA", "conversaciones con la IA"],
  mensajes_chat: ["un mensaje a la IA", "mensajes a la IA"],
  user_permissions: ["un permiso", "permisos"],
  user_roles: ["un rol", "roles"],
  peticiones: ["una petición", "peticiones"],
  newsletter_suscriptores: ["un suscriptor", "suscriptores"],
  envios_email_reserva: ["un correo de reserva", "correos de reserva"],
  email_eventos: ["un aviso de correo", "avisos de correo"],
  trafico_web_diario: ["un día de visitas", "días de visitas"],
  instagram_piezas: ["una publicación de Instagram", "publicaciones de Instagram"],
  carta_fotos_originales: ["una foto original de la carta", "fotos originales de la carta"],
  novedades_fotos_por_borrar: ["una foto pendiente de borrar", "fotos pendientes de borrar"],
  openai_claves: ["una clave de OpenAI", "claves de OpenAI"],
  openai_proyectos: ["un proyecto de OpenAI", "proyectos de OpenAI"],
  resenas: ["una reseña", "reseñas"],
};

/** Tablas que no tienen nombre en la pantalla Auditoría (TABLA_LABEL). */
const NOMBRES_EXTRA: Record<string, string> = {
  avisos_subida_precio: "Avisos de subida de precio",
  productos_alias: "Nombres de productos",
  servicios_bloqueados: "Servicios cerrados",
  salas_cerradas_servicio: "Salas cerradas",
  ajustes_mesa_servicio: "Ajustes de mesas del servicio",
  conversaciones: "Chat con la IA",
  mensajes_chat: "Mensajes a la IA",
  peticiones: "Peticiones del panel",
  instagram_piezas: "Instagram",
  carta_fotos_originales: "Fotos originales de la carta",
  novedades_fotos_por_borrar: "Fotos de novedades por borrar",
  openai_claves: "Claves de OpenAI",
  openai_proyectos: "Proyectos de OpenAI",
  trafico_web_diario: "Visitas de la web",
  web_logs_config: "Configuración de los registros de la web",
  vinos_puntuacion_parker: "Puntuaciones Parker de los vinos",
  marketing_fechas: "Fechas de marketing",
  ia_modelo_funcion: "Modelos de IA por función",
  ia_precios: "Precios de la IA",
  rrss_archivos: "Archivos de redes sociales",
  rrss_proyectos: "Proyectos de redes sociales",
  rrss_resultados: "Resultados de redes sociales",
  instagram_sugerencias_ia: "Ideas de la IA para Instagram",
  instagram_campanas: "Campañas de Instagram",
  instagram_guias_marca: "Guía de marca de Instagram",
  instagram_fotos: "Fotos de Instagram",
  facturas_sustituciones: "Facturas sustituidas",
};

/** Nombre de la sección/tabla como se ve en el panel («Facturas de proveedores»). */
export const dondeTabla = (tabla: string | null): string =>
  tabla ? (TABLA_LABEL[tabla] ?? NOMBRES_EXTRA[tabla] ?? tabla.charAt(0).toUpperCase() + tabla.slice(1).replace(/_/g, " ")) : "—";

/** «una reserva» (o «algo en «Configuración de la web»» si no está en el diccionario). */
const una = (tabla: string | null): string => (tabla && COSAS[tabla] ? COSAS[tabla][0] : `algo en «${dondeTabla(tabla)}»`);

/** «183 líneas de factura», «1 factura» (o «12 en «Turnos»»). */
export function cuantas(n: number, tabla: string | null): string {
  if (tabla && COSAS[tabla]) {
    const [uno, varios] = COSAS[tabla];
    return n === 1 ? uno.replace(/^(una|un) /, "1 ").replace(/^a alguien en /, "1 entrada en ") : `${fmtEntero(n)} ${varios}`;
  }
  return `${fmtEntero(n)} en «${dondeTabla(tabla)}»`;
}

const CAMPOS: Record<string, string> = {
  precio_eur: "precio",
  precio_copa_eur: "precio por copa",
  activado: "si se ve en la web",
  imagen_url: "foto",
  imagen_posicion_y: "encuadre de la foto",
  descripcion: "descripción",
  nombre: "nombre",
  titulo: "título",
  estado: "estado",
  hora: "hora",
  fecha: "fecha",
  turno: "turno",
  numero_comensales: "comensales",
  mesa_id: "mesa",
  espacio_id: "sala",
  notas: "notas",
  notas_cliente: "notas del cliente",
  telefono: "teléfono",
  email: "correo",
  drive_url: "enlace al original",
  verificada: "revisada",
  verificacion_origen: "quién la revisó",
  alertas_validacion: "avisos",
  orden: "orden",
  categoria: "categoría",
  anada: "añada",
  copeo: "si se sirve por copas",
  featured: "destacado",
  llegada_at: "hora de llegada",
  salida_at: "hora de salida",
  mesa_fijada: "mesa fijada",
  importante: "importante",
  can_view: "puede ver",
  can_edit: "puede editar",
  role: "rol",
  contenido: "texto",
  total: "total",
  proveedor_id: "proveedor",
  categoria_id: "familia",
  producto_id: "producto",
  motivo: "motivo",
};

/** «precio_eur, imagen_url» → «precio y foto» (3 como mucho). */
export function textoCampos(campos: string[] | null | undefined): string {
  if (!campos?.length) return "";
  const nombres = [...new Set(campos.map((c) => CAMPOS[c] ?? (/^alergenos/.test(c) ? "alérgenos" : /_(en|fr)$/.test(c) ? "traducciones" : c.replace(/_(eur|id|at)$/, "").replace(/_/g, " "))))];
  const tres = nombres.slice(0, 3);
  return nombres.length > 3 ? `${tres.join(", ")} y ${nombres.length - 3} más` : unirLista(tres);
}

const VERBO: Record<string, string> = { crear: "Creó", actualizar: "Cambió", eliminar: "Borró" };

/** Frase de una acción de una persona: «Cambió un vino «Ribera» (precio)», «Pidió: Publicar los cambios en las webs». */
/**
 * El nombre de lo que tocó, para leerlo: corto, y en los archivos solo el nombre del fichero (sin carpetas);
 * si el fichero es un código sin sentido («3f2a…-…​.webp»), nada.
 */
function nombreLegible(tabla: string | null, nombre: string | null | undefined): string {
  let t = nombre?.trim() ?? "";
  if (!t) return "";
  if (tabla === "storage.objects") {
    t = t.split("/").pop() ?? t;
    if (/^[0-9a-f-]{10,}(\.\w+)?$/i.test(t)) return "";
  }
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/** Frase de una acción de una persona: «Cambió un vino «Ribera» (precio)», «Pidió: Publicar los cambios en las webs». */
export function fraseAccion(a: { accion: string; tabla: string | null; nombre?: string | null; campos?: string[] | null; op?: string | null; resultado?: string | null }): string {
  if (a.tabla === "acciones_servidor" || a.accion === "ejecutar") {
    return `Pidió: ${textoBoton(a.op)}${a.resultado === "fallida" ? " — no salió bien" : ""}`;
  }
  const verbo = VERBO[a.accion] ?? a.accion;
  const nombre = nombreLegible(a.tabla, a.nombre);
  const campos = a.accion === "actualizar" ? textoCampos(a.campos) : "";
  return `${verbo} ${una(a.tabla)}${nombre ? ` «${nombre}»` : ""}${campos ? ` (${campos})` : ""}`;
}

/** «Borró una reserva «Mesa López»» (para la lista de lo delicado). */
export const fraseBorrado = (tabla: string | null, nombre?: string | null): string => fraseAccion({ accion: "eliminar", tabla, nombre });

/** «Creó 183 líneas de factura y 58 facturas. Cambió 279 reservas.» a partir de las cuentas por tabla y acción. */
export function fraseCuentas(filas: { tabla: string | null; accion: string; n: number }[], maxPorVerbo = 3): string {
  const frases: string[] = [];
  for (const accion of ["crear", "actualizar", "eliminar", "ejecutar"]) {
    const del = filas.filter((f) => f.accion === accion && f.n > 0).sort((a, b) => b.n - a.n);
    if (!del.length) continue;
    if (accion === "ejecutar") {
      frases.push(`Lanzó ${fmtEntero(del.reduce((s, f) => s + f.n, 0))} tareas`);
      continue;
    }
    const partes = del.slice(0, maxPorVerbo).map((f) => cuantas(f.n, f.tabla));
    const resto = del.slice(maxPorVerbo).reduce((s, f) => s + f.n, 0);
    if (resto > 0) partes.push(`${fmtEntero(resto)} ${resto === 1 ? "cosa" : "cosas"} más`);
    frases.push(`${VERBO[accion]} ${unirLista(partes)}`);
  }
  return frases.length ? `${frases.join(". ")}.` : "";
}
