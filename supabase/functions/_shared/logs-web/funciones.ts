// ============================================================================
//  Logs web · catálogo de las funciones del servidor dichas en llano
// ----------------------------------------------------------------------------
//  Como TAREAS (sencillo.ts) para las tareas programadas: para cada Edge
//  Function, dónde vive (ámbito y zona), qué hace, a quién afecta si falla y
//  si se vuelve a intentar sola y cada cuánto (las tareas pg_cron de
//  supabase/migrations). Lo usan el panel (detalle de la incidencia) y el
//  ticket de Linear para decir «Fallo del admin · Panel › Facturas — La
//  clasificación automática de productos tardó demasiado y se cortó» en vez
//  de «clasificar-productos: productos_aplicar_clasificacion_ia: canceling…».
//
//  Ámbito (decisión del dueño, 18/11/2026):
//    · web   → lo que usan o notan los clientes: lo que llama la web pública
//              (web-casatomas/src: reservas-web, chat-web, cheques-regalo-web,
//              emails-reserva/enlace, newsletter-baja, registrar-actividad-web)
//              y lo que manda algo al cliente (correos de reserva, pago de
//              cheques regalo).
//    · admin → el panel y sus automatismos.
//  Una función que no está aquí cuenta como del panel (todas las de este repo
//  lo son salvo las de la web, que están todas en la lista).
//
//  Solo textos fijos: nada de los logs. Lo que no se sabe describir con
//  seguridad lleva un texto genérico honesto, sin inventar. Un test comprueba
//  que están todas las funciones que registran errores (las que envuelve
//  conAuditoriaDePeticion). Sin Deno ni imports remotos (panel y funciones).
// ============================================================================

export type Ambito = "web" | "admin";

export interface FuncionServidor {
  ambito: Ambito;
  /** «Panel › Facturas», «Web › Reservas». */
  zona: string;
  /** Sujeto en llano y en minúscula: «la clasificación automática de productos». */
  nombre: string;
  /** Para «es la función que …»: «pone producto y categoría a las líneas nuevas de las facturas». */
  hace: string;
  /** «A quién afecta», sin cifras: «a nadie de fuera; …». */
  afecta: string;
  /** Si se vuelve a lanzar sola, cómo y cada cuánto: «se reintenta sola cada 5 minutos». null = no se relanza sola. */
  reintento: string | null;
  /** Si no se relanza sola, qué hay que hacer para repetirla. */
  repetir?: string;
  /** Cuándo suele cargarse la base de datos con esta función (solo si se sabe). */
  carga?: string;
}

export interface FuncionConocida extends FuncionServidor {
  /** Nombre técnico (el de la carpeta de supabase/functions). */
  id: string;
}

const PANEL = "hay que volver a intentarlo desde el panel";
const CLIENTE = "el cliente tendría que volver a intentarlo";
const FACTURAS = "suele pasar cuando la base de datos tiene mucho trabajo a la vez (por ejemplo, al subir muchas facturas)";

const web = (zona: string, nombre: string, hace: string, afecta: string, reintento: string | null, repetir?: string): FuncionServidor =>
  ({ ambito: "web", zona, nombre, hace, afecta: `a los clientes: ${afecta}`, reintento, ...(repetir ? { repetir } : {}) });
const panel = (zona: string, nombre: string, hace: string, afecta: string, reintento: string | null = null, repetir: string | undefined = reintento ? undefined : PANEL, carga?: string): FuncionServidor =>
  ({ ambito: "admin", zona: `Panel › ${zona}`, nombre, hace, afecta: `a nadie de fuera; ${afecta}`, reintento, ...(repetir ? { repetir } : {}), ...(carga ? { carga } : {}) });

/** Las funciones del servidor (supabase/functions de este repo y las de la web pública). */
export const FUNCIONES: Readonly<Record<string, FuncionServidor>> = {
  // ─── Web: lo que usan o notan los clientes ────────────────────────────────
  "reservas-web": web("Web › Reservas", "la función de reservas de la web", "enseña las mesas libres y recibe las reservas que hacen los clientes en la web",
    "puede que alguno no pueda ver las mesas libres o enviar su reserva desde la web", null, CLIENTE),
  "chat-web": web("Web › Asistente", "el asistente (chat) de la web", "contesta a los clientes en el chat de la web",
    "el chat de la web puede no contestar", null, "el cliente tendría que volver a preguntar"),
  "cheques-regalo-web": web("Web › Cheques regalo", "la compra de cheques regalo en la web", "prepara el pago y la vista previa de los cheques regalo en la web",
    "puede que alguno no pueda comprar un cheque regalo", null, CLIENTE),
  "stripe-webhook-cheques-regalo": web("Web › Cheques regalo", "la confirmación de pago de los cheques regalo",
    "recibe el aviso de Stripe cuando un cliente paga un cheque regalo, genera el código y se lo manda por correo",
    "un cheque regalo ya pagado puede tardar en confirmarse o en llegarle al cliente", "Stripe vuelve a mandar el aviso solo durante varias horas"),
  "emails-reserva": web("Web › Reservas", "los correos de reserva", "manda a los clientes los correos de su reserva (confirmación, cambios, recordatorios) y atiende los enlaces de esos correos",
    "puede que alguno no reciba un correo de su reserva o que no le funcione un enlace del correo", "los correos que no salieron se reintentan solos cada 15 minutos"),
  "notify-reservation-change": web("Web › Reservas", "el aviso al cliente de un cambio en su reserva", "pide que se mande al cliente el correo cuando se cambia su reserva desde el panel",
    "puede que alguno no reciba el correo con el cambio de su reserva", null),
  "whatsapp-reservas": web("Web › Reservas", "los avisos de reserva por WhatsApp", "manda por WhatsApp los avisos de reserva a quien lo eligió al reservar y atiende sus botones",
    "puede que alguno no reciba el WhatsApp de su reserva (le llega el correo) o que no le funcione un botón", "Meta vuelve a mandar las pulsaciones durante un tiempo"),
  "newsletter-baja": web("Web › Newsletter", "la baja de la newsletter", "da de baja a quien pulsa «darse de baja» en un correo de la newsletter",
    "puede que alguien que quería darse de baja siga apuntado", null, CLIENTE),
  "registrar-actividad-web": {
    ambito: "web", zona: "Web › Estadísticas", nombre: "la recogida de estadísticas y errores de la web", hace: "guarda las visitas y los errores que manda la web",
    afecta: "a nadie de fuera: los clientes no lo notan; se pierden algunas estadísticas o avisos de errores", reintento: null, repetir: "no se repite: lo que no se guardó se pierde (son solo estadísticas)",
  },

  // ─── Panel › Facturas ─────────────────────────────────────────────────────
  "clasificar-productos": panel("Facturas", "la clasificación automática de productos", "pone producto y categoría a las líneas nuevas de las facturas",
    "los productos de las facturas nuevas se clasifican unos minutos más tarde", "se reintenta sola cada 5 minutos", undefined, FACTURAS),
  "embeddings-nombres": panel("Facturas", "la preparación de los productos nuevos para el buscador", "prepara los nombres nuevos de las facturas para que el chat de Facturas encuentre productos parecidos",
    "el chat de Facturas tarda unos minutos más en encontrar los productos nuevos", "se reintenta sola cada 10 minutos", undefined, FACTURAS),
  "procesar-factura": panel("Facturas", "la lectura automática de facturas", "lee con IA las facturas y albaranes que se suben",
    "alguna factura subida puede quedarse sin leer", null, "hay que volver a intentarlo desde Facturas"),
  "ocr-trabajo": panel("Facturas", "la lectura de facturas largas en segundo plano", "lee una a una las páginas de las facturas largas",
    "alguna factura larga tarda más en leerse", "se retoma sola cada minuto", undefined, FACTURAS),
  "chat-facturas": panel("Facturas", "el asistente de compras (chat de Facturas)", "contesta a las preguntas sobre compras y facturas en el chat del panel",
    "el chat de Facturas puede no contestar", null, "hay que volver a preguntar"),
  "importar-factura-historica": panel("Facturas", "la importación de facturas antiguas", "pasa al panel las facturas del histórico",
    "alguna factura del histórico puede no haberse importado"),
  "facturas-original": panel("Facturas", "la vista del original de una factura", "enseña el original de la factura guardado en Google Drive",
    "puede que no se vea el original de una factura", null, "basta con volver a abrirla"),
  "facturas-originales-drive": panel("Facturas", "la copia de los originales de facturas a Google Drive", "sube a Google Drive los originales de las facturas",
    "las copias en Drive se retrasan", "se reintenta sola cada 10 minutos"),
  "subir-original-drive": panel("Facturas", "la subida a Drive de facturas del histórico", "sube a Google Drive el PDF de una factura del histórico",
    "alguna factura del histórico puede quedarse sin su original en Drive"),
  "buscar-precios-mercado": panel("Facturas", "la consulta de precios de mercado", "busca precios de mercado con IA (ahora no la usa ninguna pantalla)",
    "no se nota nada: ahora no la usa ninguna pantalla"),
  "transcribir-dictado": panel("Facturas", "el dictado por voz del panel", "pasa a texto lo que se dicta por voz en el chat de Facturas",
    "el dictado no se pasa a texto y hay que escribirlo"),

  // ─── Panel › Carta y web ──────────────────────────────────────────────────
  "extraer-vino-foto": panel("Carta", "la lectura de etiquetas de vino con foto", "lee la etiqueta de una botella para rellenar la ficha del vino",
    "los datos del vino no se rellenan solos y hay que escribirlos"),
  "buscar-puntuacion-parker": panel("Carta", "la búsqueda de la puntuación Parker", "busca la puntuación Parker de un vino y su añada",
    "algún vino se queda de momento sin su puntuación Parker"),
  "traducir-contenido": panel("Carta", "la traducción automática de la carta y las novedades", "traduce al inglés y al francés los textos de la carta y las novedades",
    "algún texto puede quedarse sin traducir en la web en inglés o en francés"),
  "format-novedad": panel("Novedades", "la mejora de textos de novedades con IA", "reescribe con IA el texto de una novedad",
    "el texto de la novedad no se mejora y hay que retocarlo a mano"),
  "rebuild-webs": panel("Carta", "la publicación de los cambios de la carta en la web", "pide a Vercel que rehaga la web para que se vean los cambios de la carta",
    "los cambios de la carta tardan más en verse en la web"),
  "notificar-video": panel("Carta", "el aviso de vídeo o foto terminados", "avisa al móvil cuando un dispositivo termina un vídeo o una foto",
    "no llega el aviso al móvil de que un vídeo o una foto ha terminado", null, "no hace falta: el trabajo se ve igual en el panel"),
  "limpiar-fotos-novedades": panel("Novedades", "la limpieza de fotos viejas de novedades", "borra la foto que deja de usar una novedad al cambiarla o borrarla",
    "no se nota nada: solo se queda guardada una foto vieja", null, "no hace falta: solo ocupa un poco de espacio"),

  // ─── Panel › Reservas ─────────────────────────────────────────────────────
  "interpretar-reserva-manuscrita": panel("Reservas", "la lectura de reservas escritas a mano", "lee las reservas escritas con el lápiz en el libro de reservas",
    "la reserva escrita a mano no se pasa sola y hay que teclearla"),
  "procesar-dibujo-perimetro": panel("Reservas", "la lectura del plano dibujado de un espacio", "convierte en paredes rectas el perímetro dibujado a mano en el editor de planos",
    "el plano dibujado no se convierte y hay que repetirlo"),

  // ─── Panel › Marketing ────────────────────────────────────────────────────
  "instagram-programador": panel("Instagram", "la publicación programada en Instagram", "publica en Instagram las entradas programadas",
    "una publicación programada puede salir tarde", "se reintenta sola cada 5 minutos"),
  "instagram-publicar": panel("Instagram", "la publicación en Instagram", "publica en Instagram lo que se manda desde el panel",
    "la publicación no sale en Instagram hasta que se vuelva a intentar"),
  "instagram-metricas": panel("Instagram", "las cifras de Instagram", "trae las cifras de las publicaciones de Instagram",
    "las cifras de Instagram van con retraso", "se vuelve a lanzar sola una vez al día"),
  "instagram-ia": panel("Instagram", "la IA de textos de Instagram", "propone con IA los textos de las publicaciones de Instagram",
    "no salen las propuestas de texto y hay que escribirlas a mano"),
  "instagram-drive": panel("Instagram", "la biblioteca de fotos de Instagram en Google Drive", "enseña y guarda las fotos de Instagram en Google Drive",
    "puede que no carguen las fotos de la biblioteca"),
  "instagram-estado": panel("Instagram", "la comprobación de la conexión con Instagram", "mira si la cuenta de Instagram sigue conectada",
    "el panel puede no saber si Instagram está conectado"),
  "rrss-ia": panel("Redes sociales", "el editor con IA de fotos y vídeos para redes", "propone con IA cómo editar fotos y vídeos para las redes",
    "no salen las propuestas de la IA para editar"),
  "enviar-newsletter": panel("Newsletter", "el envío de la newsletter", "manda la newsletter a los suscriptores",
    "la newsletter puede no haber salido, o solo a una parte de los suscriptores", null, "hay que revisarla en Newsletter y volver a enviarla"),
  "newsletter-ia": panel("Newsletter", "la redacción de la newsletter con IA", "propone con IA el texto y el diseño de la newsletter",
    "no sale la propuesta de la IA y hay que redactarla a mano"),
  "newsletter-sync-resend": panel("Newsletter", "la sincronización de suscriptores con Resend", "copia los suscriptores a Resend y trae las bajas hechas allí",
    "la lista de Resend puede ir desfasada unas horas", "se vuelve a lanzar sola una vez al día"),
  "resend-webhook": panel("Correos", "el registro de entregas de correos", "apunta si los correos se entregaron, rebotaron o se abrieron",
    "el estado de entrega de algún correo puede no actualizarse", "Resend vuelve a mandar el aviso más tarde"),
  "resenas-contestador": panel("Reseñas", "las respuestas a reseñas de Google con IA", "propone (y, si está activado, publica) respuestas a las reseñas de Google",
    "alguna reseña puede tardar más en contestarse", "se vuelve a lanzar sola dos veces al día"),
  "sync-google-reviews": panel("Reseñas", "la descarga de reseñas de Google", "trae las últimas reseñas de la ficha de Google",
    "las reseñas nuevas tardan más en aparecer en el panel"),
  "avisos-telegram": panel("Avisos", "los avisos por Telegram", "manda por Telegram los avisos del panel",
    "algún aviso de Telegram puede llegar tarde", "se reintenta sola cada 5 minutos"),
  "informes-mensuales": panel("Super Admin", "la subida de los informes mensuales a Drive", "guarda en Google Drive los PDF de los informes del mes y el recibo mensual",
    "puede que algún informe del mes no esté en Drive", null, "basta con volver a lanzar la tarea de informes mensuales desde GitHub"),

  // ─── Panel › Super Admin y cuentas ────────────────────────────────────────
  "procesar-logs-web": panel("Logs", "el procesado de errores (este monitor)", "agrupa los errores en incidencias y prepara los tickets",
    "los avisos de errores pueden ir con retraso", "se reintenta sola cada 5 minutos"),
  "resumen-logs-web": panel("Logs", "el resumen con IA de las estadísticas", "resume con IA las estadísticas de la web",
    "no sale el resumen de la IA"),
  "sync-trafico-web": panel("Tráfico web", "la descarga de visitas de la web desde Vercel", "trae cada día las visitas de la web desde Vercel",
    "las cifras de Tráfico web van con retraso", "se vuelve a lanzar sola una vez al día"),
  "ia-modelos-openai": panel("Super Admin", "la lista de modelos de IA", "actualiza la lista de modelos de IA disponibles",
    "no se nota nada: la lista de modelos se queda como estaba", "se vuelve a lanzar sola una vez al día"),
  "sincronizar-costes-openai": panel("Super Admin", "el gasto real de OpenAI", "trae lo que factura OpenAI",
    "las cifras de gasto de IA van con retraso", "se reintenta sola cada 6 horas"),
  "servicios-uso": panel("Super Admin", "el consumo de los servicios contratados", "consulta cuánto se ha usado de cada servicio (Vercel, Supabase, OpenAI…)",
    "no se ven las cifras de consumo de algún servicio"),
  "control-excel": panel("Gestor de gasto", "el Excel de control en Google Drive", "lee y edita el Excel de control del cliente en Google Drive",
    "puede que no se vea o no se guarde algún dato del Excel de control"),
  "analizar-peticion": panel("Peticiones", "el análisis con IA de las peticiones", "analiza con IA las peticiones que se hacen desde el panel",
    "alguna petición se queda de momento sin analizar"),
  "auditoria-revertir": panel("Auditoría", "deshacer un cambio desde la auditoría", "deshace un cambio guardado en la auditoría",
    "el cambio no se ha deshecho"),
  "leer-metricas": panel("Super Admin", "las métricas de uso del panel", "enseña quién entra en el panel y cuándo",
    "no se ven las métricas de uso del panel"),
  "registrar-metrica": panel("Acceso", "el registro de inicios de sesión", "apunta cada inicio de sesión en el panel",
    "no se apunta algún inicio de sesión (no impide entrar)", null, "no hace falta: se apunta en el siguiente inicio de sesión"),
  "panel-auth": panel("Acceso", "la comprobación de acceso al panel", "comprueba que quien entra al panel tiene permiso",
    "alguien del equipo puede no poder entrar en el panel"),
  "vapi-analytics": panel("Llamadas", "las estadísticas del asistente telefónico", "trae las cifras de las llamadas del asistente telefónico",
    "no se ven las cifras de llamadas"),
  "stripe-estado-cuenta": panel("Cheques", "el estado de la cuenta de Stripe", "mira si la cuenta de Stripe puede cobrar",
    "el panel puede no saber si Stripe puede cobrar (los clientes pueden seguir pagando)"),
  "cheques-regalo-admin": panel("Cheques", "la gestión de cheques regalo desde el panel", "gestiona desde el panel los cheques regalo vendidos",
    "puede fallar alguna acción sobre los cheques desde el panel"),
  "list-users": panel("Usuarios", "la lista de usuarios", "enseña las cuentas del equipo", "no se ve la lista de usuarios"),
  "admin-create-user": panel("Usuarios", "el alta de usuarios", "crea cuentas del equipo", "no se ha creado la cuenta"),
  "admin-delete-user": panel("Usuarios", "la baja de usuarios", "borra cuentas del equipo", "no se ha borrado la cuenta"),
  "admin-set-super-admin": panel("Usuarios", "el cambio de permisos de super admin", "da o quita el acceso de super admin", "no se ha cambiado el permiso"),
  "admin-set-user-access": panel("Usuarios", "el bloqueo o desbloqueo de usuarios", "bloquea o desbloquea cuentas del equipo", "no se ha cambiado el acceso de la cuenta"),
  "admin-update-user-password": panel("Usuarios", "el cambio de contraseña de un usuario", "cambia la contraseña de una cuenta del equipo", "no se ha cambiado la contraseña"),
  "cambiar-mi-contrasena": panel("Mi cuenta", "el cambio de la propia contraseña", "cambia la contraseña de quien la pide", "no se ha cambiado la contraseña"),
};

/** Las funciones de la web (las que usan o notan los clientes): deciden el ámbito «web». */
export const FUNCIONES_WEB: readonly string[] = Object.entries(FUNCIONES).filter(([, f]) => f.ambito === "web").map(([id]) => id);

/** Ficha de una función por su nombre técnico, o null si no está en el catálogo. */
export function funcionSencilla(id: string | null | undefined): FuncionConocida | null {
  if (!id || !Object.prototype.hasOwnProperty.call(FUNCIONES, id)) return null;
  return { id, ...FUNCIONES[id] };
}

export interface DatosFuncion {
  tipo: string;
  fuente?: string | null;
  objetivo?: string | null;
  mensaje?: string | null;
}

const NOMBRE_FUNCION = /^([a-z0-9]+(?:-[a-z0-9]+)*)/;

/**
 * Nombre técnico de la función del servidor que falla (del objetivo o, si no
 * hay, del principio del mensaje «función/subruta: …»), o null. En los fallos
 * de integración, la función de «sync-trafico-web:<proyecto>». En el navegador,
 * la función a la que pidió datos (endpoint «reservas-web/crear»).
 * OJO: es texto de los logs; para enseñarlo, pasarlo por `funcionSencilla`.
 */
export function funcionDeError(d: DatosFuncion): string | null {
  const fuente = d.fuente ?? (d.tipo === "error_servidor" ? "servidor" : d.tipo === "error_integracion" ? "integracion" : "navegador");
  const objetivo = d.objetivo ?? "";
  if (fuente === "servidor") {
    const m = NOMBRE_FUNCION.exec(objetivo) ?? /^([a-z0-9]+(?:-[a-z0-9]+)*)(?=[:/])/.exec(d.mensaje ?? "");
    return m ? m[1] : null;
  }
  if (fuente === "integracion") {
    const m = /^([a-z0-9]+(?:-[a-z0-9]+)*):/.exec(objetivo);
    return m && m[1] !== "cron" ? m[1] : null;
  }
  if (fuente === "navegador" && d.tipo === "error_peticion") {
    const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(objetivo);
    return m ? m[1] : null;
  }
  return null;
}
