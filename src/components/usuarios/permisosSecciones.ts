/**
 * Permisos por sección de la pantalla Usuarios: «Ver» y «Puede editar».
 *
 * Lógica compartida por el diálogo «Permisos» (ListaUsuarios), el alta
 * (InvitarUsuario) y los roles preconfigurados (ConfigurarRolesModal). Hasta el
 * 2026-10-01 las tres forzaban `can_edit: false` al cargar y en cada cambio: el
 * permiso de edición no se podía dar desde el panel y cualquier guardado borraba
 * el que se hubiera puesto por SQL.
 *
 * Reglas:
 *   - «Puede editar» solo se activa si la sección tiene «Ver», y quitar «Ver»
 *     quita también «Puede editar» (editar implica ver, como en el resto del panel).
 *   - Se muestra y se guarda el valor real; lo nuevo empieza sin edición.
 *   - Quién puede CONCEDER la edición no se decide aquí: solo un super admin
 *     (`puedeConcederEdicion` en los componentes; en la BD, la RLS de
 *     user_permissions solo deja escribir a super admins).
 */
import { SECTIONS, type AppRole } from "@/hooks/useUserRole";
import type { ManagedUser } from "@/hooks/useUsersManagement";

export interface PermisoSeccion {
  section_key: string;
  can_view: boolean;
  can_edit: boolean;
}

type Seccion = (typeof SECTIONS)[number];
type SeccionConfigurable = Seccion;

/**
 * Secciones que se configuran desde Usuarios. Desde el 06/11/2026 también
 * «usuarios» (antes iba por el rol admin): un solo interruptor, «Puede ver», que
 * deja consultar la lista en el admin panel; gestionarla es solo del super admin.
 */
export const SECCIONES_CONFIGURABLES: SeccionConfigurable[] = [...SECTIONS];

/**
 * Qué desbloquea «Puede editar» en cada sección, tal como está HOY el panel: Reservas,
 * Reservas · Configuración, Cheques, Tienda y Facturas (06/11/2026) miran el permiso de
 * edición (`useCanAccessSection(…, "edit")`); en el resto basta con «Ver». Si una sección
 * empieza a exigir edición, cambiar su texto aquí. Se muestra detrás de «Editar: » (en las
 * de un solo interruptor, detrás de su etiqueta, p. ej. «Puede subir: »).
 */
export const AYUDA_EDICION: Record<SeccionConfigurable["key"], string> = {
  dashboard: "sin efecto aquí; las reservas del día dependen de «Reservas».",
  reservas: "crear y modificar reservas, aceptarlas o cancelarlas, marcar llegadas, dar mesa y mover de sala, cerrar días y la lista negra. Con solo «Ver» se consulta todo, sin ningún botón para cambiarlo.",
  reservas_configuracion:
    "entrar y cambiar las reglas, los turnos, las mesas y las plantillas de correo de las reservas. «Ver» aquí no sirve por sí solo: sin «Editar» no se ve la pestaña. Hace falta también «Ver» en Reservas.",
  reservas_crear:
    "«Nueva reserva»: crear reservas (nacen verificadas o pendientes y el cliente las confirma por correo), sin modificarlas, cambiar su estado (ni «Ha llegado»), dar mesa, cancelar ni configurar. Necesita «Ver» en Reservas. Es el tipo de usuario «Reservas».",
  gestor_carta:
    "añadir, cambiar y borrar platos, vinos, bebidas y cócteles: ajustar y restaurar precios, ordenar, visibilidad, fotos (quitar el fondo y vídeos), «Añadir vino» y «Varias botellas» con IA, traducciones y la votación del vino favorito, y el «PDF Carta» (carta de platos y de vinos para imprimir). Con solo «Ver» se consulta la carta, sin el «PDF Carta».",
  gestion_web:
    "sin efecto: en Novedades, Menús diarios y Tapas basta con «Ver» para cambiarlo todo (decisión del dueño, 06/11/2026).",
  marketing:
    "en Instagram: crear y cambiar piezas, subir fotos, usar la IA, publicar, programar, pedir encargos y generar vídeos. En el newsletter: crear y enviar newsletters (también la prueba) y actualizar la lista de envío. Con solo «Ver» se consultan los suscriptores, el historial de envíos y las estadísticas.",
  instagram_agencia: "aceptar, entregar y comentar los encargos de Instagram como la agencia (Oficiosos). Con solo «Ver», los consulta.",
  instagram_render:
    "obligatorio para el usuario del equipo de vídeo: reclamar, generar y subir los vídeos de los reels. No le des Marketing.",
  cheques: "compra manual, configuración del cheque, plantilla de factura y la pestaña Stripe (cobros, comisiones e «Informe de cheques regalo»). Con solo «Ver» se consultan y se canjean cheques regalo, sin ver Stripe.",
  tienda: "poner o quitar vinos de la tienda y la pestaña Ajustes (visible, descuento y textos). Con solo «Ver» se consulta la lista de vinos.",
  facturas:
    "modificar, verificar y borrar documentos, clasificar productos, cambiar los ajustes de Facturas y usar la IA; también subir (pestaña Cargar). Con solo «Ver» se consultan Análisis y Compras.",
  facturas_subida:
    "pestaña Cargar: subir facturas y albaranes, decidir sobre los repetidos y corregir los datos leídos de lo que sube él mismo (no lo de otros). No necesita «Ver» en Facturas: sin él, solo ve Cargar.",
  facturas_albaranes:
    "pantalla «Subir albaranes» (pensada para el móvil): hacer o elegir fotos de albaranes y facturas para que se lean solas, y ver si llegaron. No ve lo leído, ni importes, ni el resto de Facturas. Es el tipo de usuario «Albaranes».",
  usuarios:
    "consultar en el admin panel la lista de usuarios y sus permisos. Crear, borrar, bloquear y cambiar permisos es solo del super admin.",
};

/**
 * Secciones con UN solo interruptor (06/11/2026): «Facturas · Subida» («Puede
 * subir»). Lo que habilita no se divide en ver/editar: se guarda en can_view y
 * can_edit queda siempre a false (la BD acepta cualquiera de los dos,
 * facturas_puede_subir()). En la tabla, el interruptor va en la columna «Ver» y
 * la de «Puede editar» queda vacía.
 */
export const SECCIONES_UN_INTERRUPTOR: Partial<Record<SeccionConfigurable["key"], { etiqueta: string }>> = {
  facturas_subida: { etiqueta: "Puede subir" },
  // Tipos de usuario «Reservas» y «Albaranes» (10/11/2026).
  reservas_crear: { etiqueta: "Puede crear" },
  facturas_albaranes: { etiqueta: "Puede subir fotos" },
  usuarios: { etiqueta: "Puede ver" },
};

/** Etiqueta del único interruptor de la sección («Puede subir»), o null si tiene «Ver» y «Puede editar». */
export function interruptorUnico(sectionKey: string): string | null {
  return SECCIONES_UN_INTERRUPTOR[sectionKey as SeccionConfigurable["key"]]?.etiqueta ?? null;
}

/**
 * Por qué el diálogo «Permisos» sale en solo lectura a quien no es super admin: la RLS de
 * user_permissions solo deja escribir a un super admin (cualquier otro guardado no hace nada).
 */
export const SOLO_SUPER_ADMIN_CAMBIA_PERMISOS = "Solo un super admin puede cambiar permisos.";

type PermisoGuardado = { section_key: string; can_view?: boolean | null; can_edit?: boolean | null };

/**
 * Estado editable de TODAS las secciones configurables a partir de lo guardado
 * (los permisos de un usuario o los de una plantilla). Conserva el can_edit real;
 * las secciones que no aparecen salen sin «Ver» ni «Puede editar».
 */
export function permisosParaEditar(origen: ReadonlyArray<PermisoGuardado>): PermisoSeccion[] {
  return SECCIONES_CONFIGURABLES.map((seccion) => {
    const guardado = origen.find((p) => p.section_key === seccion.key);
    const guardadoEditar = Boolean(guardado?.can_edit);
    // Un solo interruptor: lo que haya (can_view o can_edit) es «sí», y se guarda en can_view.
    const can_edit = interruptorUnico(seccion.key) ? false : guardadoEditar;
    return { section_key: seccion.key, can_view: Boolean(guardado?.can_view) || guardadoEditar, can_edit };
  });
}

/**
 * Secciones que no sirven sin «Ver» en otra (10/11/2026): «Reservas · Crear» necesita ver las
 * reservas (en la BD, reservas_puede_crear() exige los dos). Al activarla se activa también «Ver»
 * en Reservas, y al quitar «Ver» en Reservas se quita también ella.
 */
export const NECESITA_VER: Readonly<Record<string, string>> = { reservas_crear: "reservas" };

/** Cambia «Ver» de una sección; al quitarlo se quita también «Puede editar». */
export function cambiarVer(permisos: PermisoSeccion[], sectionKey: string, ver: boolean): PermisoSeccion[] {
  const base = NECESITA_VER[sectionKey];
  const dependientes = Object.keys(NECESITA_VER).filter((k) => NECESITA_VER[k] === sectionKey);
  return permisos.map((p) => {
    if (p.section_key === sectionKey) return { ...p, can_view: ver, can_edit: ver && p.can_edit };
    if (ver && base && p.section_key === base) return { ...p, can_view: true };
    if (!ver && dependientes.includes(p.section_key)) return { ...p, can_view: false, can_edit: false };
    return p;
  });
}

/** Cambia «Puede editar» de una sección; sin «Ver» no se puede activar. */
export function cambiarEditar(permisos: PermisoSeccion[], sectionKey: string, editar: boolean): PermisoSeccion[] {
  const unico = interruptorUnico(sectionKey) !== null;
  return permisos.map((p) => (p.section_key === sectionKey ? { ...p, can_edit: editar && p.can_view && !unico } : p));
}

/** Los mismos permisos sin edición en ninguna sección (para quien no puede concederla). */
export function sinEdicion(permisos: PermisoSeccion[]): PermisoSeccion[] {
  return permisos.map((p) => (p.can_edit ? { ...p, can_edit: false } : p));
}

/**
 * Secciones que NO cuentan para decidir el rol por los permisos: el Dashboard («Editar»
 * no hace nada), los dos perfiles especiales de Instagram, «Facturas · Subida»,
 * «Usuarios», «Reservas · Crear» y «Facturas · Solo fotos» (un solo interruptor cada una).
 */
const SECCIONES_FUERA_DEL_ROL = new Set([
  "dashboard", "instagram_agencia", "instagram_render", "facturas_subida", "usuarios",
  // Tipos de usuario «Reservas» y «Albaranes» (10/11/2026): un solo interruptor cada una.
  "reservas_crear", "facturas_albaranes",
]);

/**
 * Rol base que corresponde a unos permisos (06/11/2026, dueño: «cuando cambias los
 * permisos no se actualiza bien el rol»). Antes el rol solo cambiaba al elegir un rol
 * preconfigurado: al tocar los permisos a mano, alguien que era «Admin» seguía
 * saliendo como «Admin» con solo «Ver». Regla:
 *   - edita en TODAS las secciones que cuentan → admin;
 *   - edita en alguna → manager;
 *   - solo ve (o nada) → staff.
 */
export function rolSegunPermisos(origen: ReadonlyArray<PermisoGuardado>): AppRole {
  const permisos = permisosParaEditar(origen);
  const cuentan = permisos.filter((p) => !SECCIONES_FUERA_DEL_ROL.has(p.section_key));
  if (cuentan.length > 0 && cuentan.every((p) => p.can_edit)) return "admin";
  if (permisos.some((p) => p.can_edit)) return "manager";
  return "staff";
}

/**
 * Rol que se guarda con unos permisos: el del rol preconfigurado elegido o, si se han
 * tocado a mano, el de un preconfigurado con esos mismos permisos; si no hay ninguno,
 * el que sale de `rolSegunPermisos`.
 */
export function rolAlGuardar(
  permisos: ReadonlyArray<PermisoGuardado>,
  presets: ReadonlyArray<{ id: string; base_role: AppRole; permissions: ReadonlyArray<PermisoGuardado> }>,
  presetElegido: string | null,
): AppRole {
  const elegido = presetElegido ? presets.find((p) => p.id === presetElegido) : undefined;
  if (elegido) return elegido.base_role;
  const igual = presets.find((p) => mismosPermisos(permisos, p.permissions));
  return igual ? igual.base_role : rolSegunPermisos(permisos);
}

/** Nombre legible de un rol base. */
export const NOMBRE_ROL: Record<AppRole, string> = { admin: "Admin", manager: "Manager", staff: "Staff" };

/** ¿Coinciden «Ver» y «Puede editar» en todas las secciones configurables? */
export function mismosPermisos(a: ReadonlyArray<PermisoGuardado>, b: ReadonlyArray<PermisoGuardado>): boolean {
  const pb = permisosParaEditar(b);
  return permisosParaEditar(a).every(
    (p, i) => p.can_view === pb[i].can_view && p.can_edit === pb[i].can_edit,
  );
}

export type DatosPermisos = Pick<ManagedUser, "is_super_admin" | "role" | "permissions">;

/**
 * «Ver» y «Editar» de cada sección, más la fila de Usuarios (va por rol, no por permisos).
 * Las de un solo interruptor llevan `unInterruptor` («Puede subir») y su valor en `ver`
 * (y el mismo en `editar`, para quien solo mire esos dos).
 */
export function seccionesConPermisos(user: DatosPermisos): Array<{
  key: string;
  label: string;
  ayuda: string;
  ver: boolean;
  editar: boolean;
  unInterruptor?: string;
}> {
  const permisos = permisosParaEditar(user.permissions);
  return [
    ...SECCIONES_CONFIGURABLES.map((seccion) => {
      const permiso = permisos.find(p => p.section_key === seccion.key);
      const unico = interruptorUnico(seccion.key);
      if (unico) {
        const si = user.is_super_admin || Boolean(permiso?.can_view);
        return { key: seccion.key, label: seccion.label, ayuda: `${unico}: ${AYUDA_EDICION[seccion.key]}`, ver: si, editar: si, unInterruptor: unico };
      }
      return {
        key: seccion.key,
        label: seccion.label,
        ayuda: `Editar: ${AYUDA_EDICION[seccion.key]}`,
        ver: user.is_super_admin || Boolean(permiso?.can_view),
        editar: user.is_super_admin || Boolean(permiso?.can_edit),
      };
    }),
  ];
}
