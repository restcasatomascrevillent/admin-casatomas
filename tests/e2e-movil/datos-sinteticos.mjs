// Datos 100 % sintéticos (nombres «SIM …», correos @sim.casatomas.test) para las pruebas e2e móviles.
// Pensados para provocar los casos difíciles del móvil: textos largos, cifras de 3 dígitos y listas largas.
import { USER_ID, EMAIL } from "./supabase-falso.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dia = (delta) => { const d = new Date(); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ahora = new Date().toISOString();
const ESPACIO_A = uuid(101), ESPACIO_B = uuid(102);

const NOMBRES = ["SIM María del Carmen Fernández de la Vega Álvarez", "SIM José Luis Rodríguez", "SIM Ana", "SIM Pedro Sánchez Gómez de las Heras y Mendoza", "SIM Lucía Ortega", "SIM Marta Díaz"];

function reservas() {
  const filas = [];
  let n = 1;
  // Hoy y mañana con muchas reservas (más de 100 comensales el mismo día): las cifras de 3 dígitos del calendario.
  for (const [delta, cuantas] of [[0, 24], [1, 30], [2, 6], [3, 4], [-1, 5], [5, 3], [9, 2]]) {
    for (let i = 0; i < cuantas; i++, n++) {
      const comida = i % 2 === 0;
      filas.push({
        id: uuid(1000 + n), hora: comida ? `${13 + (i % 3)}:${i % 2 ? "30" : "00"}:00` : `${20 + (i % 3)}:00:00`, hora_solicitada: null, canal: i % 3 ? "web" : "telefono",
        email: `sim${n}@sim.casatomas.test`, fecha: dia(delta), marca: "casa_tomas", estado: ["confirmada", "pendiente", "verificada"][i % 3], nombre: NOMBRES[i % NOMBRES.length],
        telefono: `6000000${String(n).padStart(2, "0")}`, salida_at: null, llegada_at: null, created_at: ahora, updated_at: ahora, espacio_id: i % 4 === 3 ? null : (i % 2 ? ESPACIO_A : ESPACIO_B),
        espacio_solicitado_id: null, importante: i % 7 === 0, en_blacklist: false, solicitud_id: null, notas_cliente: i % 5 === 0 ? "Alergia a los frutos secos; trae un carrito de bebé y pide mesa cerca de la ventana si es posible" : null,
        numero_comensales: 4 + (i % 5), email_verificado_at: null, condiciones_aceptadas_at: null, consentimiento_newsletter: false,
      });
    }
  }
  return filas;
}

export function tablas() {
  const permisos = ["dashboard", "reservas", "gestor_carta", "gestion_web", "marketing", "cheques", "facturas", "usuarios"].map((s, i) => ({ id: uuid(300 + i), user_id: USER_ID, section_key: s, can_view: true, can_edit: true }));
  return {
    super_admins: [{ id: uuid(1), user_id: USER_ID, email: EMAIL, created_at: ahora }],
    user_roles: [{ id: uuid(2), user_id: USER_ID, role: "admin", created_at: ahora }],
    user_permissions: permisos,
    admin_feature_toggles: [],
    espacios_reserva: [
      { id: ESPACIO_A, nombre: "SIM Salón principal con un nombre de sala bastante largo", descripcion: "Sala grande", activa: true, capacidad_maxima: 60, caracteristicas: {}, created_at: ahora, updated_at: ahora },
      { id: ESPACIO_B, nombre: "SIM Terraza", descripcion: "Terraza", activa: true, capacidad_maxima: 40, caracteristicas: {}, created_at: ahora, updated_at: ahora },
    ],
    mesas: Array.from({ length: 14 }, (_, i) => ({ id: uuid(500 + i), nombre: `Mesa ${i + 1}`, etiqueta: String(i + 1), capacidad: 4, espacio_id: i % 2 ? ESPACIO_A : ESPACIO_B, activa: true, forma: "rect", pos_x: 20 + (i % 5) * 120, pos_y: 20 + Math.floor(i / 5) * 100, ancho: 90, alto: 60, rotacion: 0, piezas: 1, piezas_max: 3, plazas_min: 2, plazas_max: 6, picos_base: 0, picos_max: 2, is_merged: false, original_mesas: [], grupo_piezas: null, crece_hacia: "derecha", created_at: ahora, updated_at: ahora })),
    reservas: reservas(),
    asignaciones_mesa: [],
    vista_asignacion_dia: [],
    configuracion_reservas: [{ id: uuid(600), auto_confirmar: false, email_obligatorio: true, telefono_obligatorio: true, dias_max_antelacion: 60, dias_cerrados_comida: [], dias_cerrados_cena: [], estancia_comida_minutos: 90, estancia_cena_minutos: 120, retraso_gracia_minutos: 15, asignacion_aviso_activo: true, asignacion_ventana_horas: 48, asignacion_mesas_excluidas: [], asignacion_espacios_excluidos: [], max_comensales_por_reserva: 12, min_comensales_por_reserva: 1, max_reservas_por_email_dia: 3, max_reservas_por_telefono_dia: 3, minutos_corte_antes_servicio: 60, limite_web_crear_dia: 100, limite_web_crear_ip_hora: 10, created_at: ahora, updated_at: ahora }],
    configuracion_turnos: [
      { id: uuid(610), activo: true, nombre_periodo: "Comida", hora_inicio: "13:00:00", hora_fin: "16:00:00", dias_semana: [0, 1, 2, 3, 4, 5, 6], espacio_id: null, intervalo_base_minutos: 15, base_umbral: "reservas", niveles_escalera: [], ocultar_nivel_anterior: false, umbral_apertura_secundario: 0, ocultar_primario_si_secundario: false, created_at: ahora, updated_at: ahora },
      { id: uuid(611), activo: true, nombre_periodo: "Cena", hora_inicio: "20:00:00", hora_fin: "23:30:00", dias_semana: [0, 1, 2, 3, 4, 5, 6], espacio_id: null, intervalo_base_minutos: 15, base_umbral: "reservas", niveles_escalera: [], ocultar_nivel_anterior: false, umbral_apertura_secundario: 0, ocultar_primario_si_secundario: false, created_at: ahora, updated_at: ahora },
    ],
    notificaciones_dashboard: [],
    solicitudes_pendientes: [],
    cierres_reserva: [],
    blacklist: [],
    sugerencias_blacklist: [],
    planos_espacio: [],
    Platos: Array.from({ length: 12 }, (_, i) => ({ id: uuid(700 + i), nombre: i === 0 ? "SIM Arroz meloso de langosta, gambas rojas y verduras de temporada de la huerta" : `SIM Plato ${i + 1}`, categoria: "ARROCES", orden: i, precio_eur: 18.5 + i, unidad: "Unidad", activado: true, expanded: false, featured: false, touza: false, restaurante: true, descripcion: "Descripción larga de prueba para comprobar cómo se corta el texto en las tarjetas de la carta del panel en pantallas estrechas.", imagen_url: null, sin_gluten_disponible: false, alergenos_oficiales: ["crustaceos"], alergenos_inferidos: [], created_at: ahora, updated_at: ahora })),
    Vinos: [], Bebidas: [], Cocteles: [], ComidaVENTA: [], BebidasVENTA: [], tapas: [], menus_diarios: [], novedades: [],
    facturas: [], productos_factura: [], proveedores: [], categorias_producto: [], ocr_trabajos: [], chat_facturas_conversaciones: [], chat_facturas_mensajes: [],
    configuracion_web: [], configBotWeb: [], chat_web_config: [], phone_system_config: [], newsletter_suscriptores: [], newsletter_envios: [], cheques_regalo: [], plantilla_cheques_regalo: [], plantilla_factura_cheques: [],
    areas_trabajo: [], ajustes_mesa_servicio: [], user_role_presets: [], trabajos_video: [], resenas: [], config_google_places: [], plantillas_email_reserva: [], email_eventos: [], pedidos_ecommerce: [], costes_fijos: [],
    servicios_contratados: serviciosContratados(),
    audit_log: [], audit_log_visible: [], trafico_web_diario: [], trafico_web_desglose: [], trafico_web_sync_estado: [], ia_funciones: [], ia_coste_estimado: [], peso_paginas: [], call_logs: [],
  };
}

// Super Admin › Servicios: los 5 proveedores con textos largos y consumo en los tres colores del semáforo.
const FUENTE = "https://vercel.com/docs/plans/hobby";
function serviciosContratados() {
  const s = (proveedor, nombre, extra) => ({ proveedor, nombre, plan: "Free", precio_mensual: 0, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null, panel_url: `https://${proveedor}.sim.casatomas.test/panel`, limites: {}, notas: null, actualizado_en: ahora, ...extra });
  return [
    s("vercel", "Vercel", { plan: "Hobby", cuenta: "Equipo «Casa tomas» (casa-tomas, team_18KKVg7ueSX0PL4Ycy1QakZj) · proyectos web-casatomas y admin-casatomas", limites: {
      peticiones_cdn: { orden: 1, etiqueta: "Visitas a las webs (peticiones al CDN)", limite: 1000000, unidad: "peticiones", periodo: "últimos 30 días", fuente: FUENTE },
      transferencia_rapida: { orden: 2, etiqueta: "Datos servidos a los visitantes (Fast Data Transfer)", limite: 100, unidad: "GB", periodo: "últimos 30 días", fuente: FUENTE },
      despliegues_24h: { orden: 7, etiqueta: "Publicaciones (despliegues)", limite: 100, unidad: "despliegues", periodo: "últimas 24 h", fuente: FUENTE },
    }, notas: "Plan gratuito. Si se pasa de un límite, Vercel pausa ese recurso hasta que pasen 30 días." }),
    s("supabase", "Supabase", { cuenta: "Organización «Casa Tomas» · proyectos casatomas-prod (haqmmdfdzzatdnrrcgez) y casatomas-staging (sfonaclosuafvlhutkon)", limites: {
      bd_tamano: { orden: 1, etiqueta: "Tamaño de la base de datos", limite: 500, unidad: "MB", periodo: "ahora" },
      almacenamiento: { orden: 2, etiqueta: "Fotos y archivos guardados (Storage)", limite: 1, unidad: "GB", periodo: "ahora" },
      egreso: { orden: 5, etiqueta: "Datos servidos (egress)", limite: 5, unidad: "GB", periodo: "mes en curso", nota: "Supabase no da este dato por API en el plan Free: míralo en su panel (Usage)." },
    } }),
    s("github", "GitHub", { cuenta: "Cuenta restcasatomascrevillent · repositorios web-casatomas y admin-casatomas", limites: { actions_computo: { orden: 1, etiqueta: "Pruebas automáticas (GitHub Actions)", limite: 12, unidad: "USD", periodo: "mes en curso" } } }),
    s("resend", "Resend", { plan: "Free (por confirmar)", limites: { correos_mes: { orden: 1, etiqueta: "Correos enviados este mes", limite: 3000, unidad: "correos", periodo: "mes en curso" }, correos_hoy: { orden: 2, etiqueta: "Correos enviados hoy", limite: 100, unidad: "correos", periodo: "hoy (UTC)" } } }),
    s("stripe", "Stripe", { plan: "Sin cuota (comisión por cobro)", precio_mensual: null, moneda: "EUR", ciclo: "por_uso", cuenta: "Cuenta en MODO PRUEBA (todavía no cobra de verdad)" }),
  ];
}
const lecturasServicios = () => [
  { proveedor: "vercel", tomado_en: ahora, metricas: {}, error: "falta_secreto", secreto: "SERVICIOS_VERCEL_TOKEN", detalles: { secreto: "SERVICIOS_VERCEL_TOKEN" } },
  { proveedor: "supabase", tomado_en: ahora, error: null, desde_cache: true, metricas: {
    bd_tamano: { etiqueta: "Tamaño de la base de datos", valor: 460 * 1024 ** 2, unidad: "bytes" },
    almacenamiento: { etiqueta: "Fotos y archivos guardados (Storage)", valor: 0.75 * 1024 ** 3, unidad: "bytes", nota: "501 archivos en este proyecto." },
    usuarios_activos_mes: { etiqueta: "Usuarios activos este mes", valor: 2, unidad: "usuarios", periodo: "mes en curso" },
  }, detalles: { secreto_opcional: "SERVICIOS_SUPABASE_TOKEN", avisos: ["Sin SERVICIOS_SUPABASE_TOKEN no salen las peticiones a la API ni las ejecuciones de funciones."] } },
  { proveedor: "github", tomado_en: ahora, metricas: {}, error: "falta_secreto", secreto: "SERVICIOS_GITHUB_TOKEN", detalles: { secreto: "SERVICIOS_GITHUB_TOKEN" } },
  { proveedor: "resend", tomado_en: ahora, metricas: { correos_mes: { valor: 2985, unidad: "correos" }, correos_hoy: { valor: 12, unidad: "correos" } }, error: "falta_secreto", secreto: "RESEND_API_KEY", detalles: { secreto: "RESEND_API_KEY" } },
  { proveedor: "stripe", tomado_en: ahora, metricas: { cobros_mes: { etiqueta: "Cobros este mes", valor: 123, unidad: "cobros" }, importe_cobrado_mes: { etiqueta: "Importe cobrado este mes", valor: 12345.67, unidad: "EUR" } }, error: null, detalles: { modo: "prueba", moneda: "EUR" } },
];

const hoyISO = dia(0);
export const rpcSinteticas = {
  servicios_uso_ultimas: () => lecturasServicios(),
  version_auditoria_panel: () => 2,
  registrar_acceso_panel: () => null,
  listar_tablas_auditoria_panel: () => [{ tabla: "reservas" }],
  servicios_cerrados_reserva: () => [],
  // La línea «Lectura de facturas este mes» (Facturas › Cargar) con importes de varias cifras.
  gasto_ia_real_resumen: () => [{ proceso: "ocr", usd_real: 8.9, ultimo_dia_real: hoyISO, usd_estimado_hoy: 0.3 }, { proceso: "chat", usd_real: 1.7, ultimo_dia_real: hoyISO, usd_estimado_hoy: 0.1 }, { reparto: "por_clave" }],
  gasto_ia_resumen: () => [{ funcion: "procesar-factura", coste_usd: 6.12, filas: 180, llamadas: 410, unidades: 66, filas_sin_tarifa: 0, documentos_ocr: 66, ultima: ahora }],
  tipo_cambio_usd_eur_actual: () => [{ eur_por_usd: 0.86, fecha: hoyISO, fuente: "bce" }],
  estadisticas_lectura: () => [{ documentos: 66, total_usd: 9.52, media_usd: 0.144, mediana_usd: 0.11, llamadas_media: 2.4, mas_cara_id: 12, mas_cara_proveedor: "SIM Distribuciones Alimentarias del Norte de España, S.L.U.", mas_cara_numero: "2026/00045-A", mas_cara_usd: 0.92, por_paginas: [], por_lineas: [] }],
  ia_coste_mes: () => [{ mes: hoyISO.slice(0, 7), coste_acumulado_usd: 9.46, dias_con_dato: 2, dias_mes: 30, dias_restantes: 28, estimado_ia_usd_mes: 273.8, fijos_eur_mes: null, fijos_sin_verificar: 8, peticiones: 480, proy_lineal_usd: 140, proy_media7_usd: 273.8 }],
  ia_coste_serie: () => [], ia_coste_por_funcion: () => [], ia_coste_por_modelo: () => [], ia_funciones_sin_registro: () => [], proveedores_listado: () => [], productos_resumen: () => [], productos_gasto_por_categoria: () => [],
};
export const funcionesSinteticas = {
  "servicios-uso": () => ({ lecturas: lecturasServicios(), generado_en: ahora }),
  "list-users": () => ({ users: [{ id: USER_ID, email: EMAIL, display_name: "SIM Usuario e2e", created_at: ahora, access_blocked: false }] }),
};
