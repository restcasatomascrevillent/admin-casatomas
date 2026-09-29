import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, addDays, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CalendarIcon, CheckCircle, ChevronDown, Info, MapPin, ShieldBan } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { verificarAforoTurno } from "@/hooks/useDisponibilidad";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useVerificarBlacklist, BlacklistEntry } from "@/hooks/useBlacklist";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useOcupacionSalasDia, CLAVE_OCUPACION_SALAS_DIA, datosDeNegocio } from "@/hooks/useOcupacionSalasDia";
import {
  espacioUnicoDeNegocio,
  etiquetaNegocio,
  MARCA_POR_DEFECTO,
  NEGOCIOS_PANEL,
  normalizarMarca,
} from "@/lib/reservas/negocios";
import {
  calcularOcupacionSalas,
  ETIQUETA_TURNO,
  evaluarUbicacion,
  horaCorta,
} from "@/lib/reservas/ocupacionSalas";
import { OcupacionSalas } from "./OcupacionSalas";
import { DisponibilidadCuartos, useRejillaCuartos } from "./DisponibilidadCuartos";
import { formatearTelefonoReserva, variantesTelefono } from "@/lib/reservas/telefono";
import {
  debeNotificarAltaPanel,
  errorEmail,
  errorTelefono,
  estadoInicialAltaPanel,
  RE_EMAIL,
} from "@/lib/reservas/altaPanel";
import { esErrorEsquemaPendiente } from "@/lib/reservas/propuestaCliente";
import { notificarCambioReserva } from "@/hooks/useVerificacionReservas";

// Teléfono Y email obligatorios (decisión del dueño, 2026-09-23): el cliente
// recibe un correo para confirmar la reserva. Reglas en src/lib/reservas/altaPanel.ts.
const formSchema = z.object({
  nombre: z.string({ required_error: "El nombre es obligatorio" }).trim().min(2, "El nombre es obligatorio"),
  telefono: z
    .string({ required_error: "El teléfono es obligatorio" })
    .superRefine((v, ctx) => {
      const mensaje = errorTelefono(v);
      if (mensaje) ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensaje });
    }),
  email: z
    .string({ required_error: "El email es obligatorio" })
    .superRefine((v, ctx) => {
      const mensaje = errorEmail(v);
      if (mensaje) ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensaje });
    }),
  fecha: z.date({ required_error: "Selecciona una fecha" }),
  hora: z.string().min(1, "Selecciona una hora"),
  numero_comensales: z
    .number({ invalid_type_error: "Indica el número de comensales" })
    .int("El número de comensales debe ser entero")
    .min(1, "Mínimo 1 comensal"),
  notas_cliente: z.string().optional(),
  /**
   * Negocio de la reserva, OBLIGATORIO y elegido a mano (reservas-sin-salas,
   * 2026-09-29). Antes lo decidía la sala; ahora la sala es interna y
   * opcional, así que no puede decidir de qué negocio es la reserva.
   */
  marca: z
    .string({ required_error: "Elige el negocio" })
    .refine((m) => NEGOCIOS_PANEL.some((n) => n.marca === m), "Elige el negocio"),
  /** Sala asignada (null = sin asignar). Interna y opcional. */
  espacio_id: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Las horas del desplegable son TODOS los cuartos de hora de los turnos del
// negocio (`configuracion_turnos`, sin escalera: rejilla interna de
// `lib/reservas/rejillaCuartos.ts`, reservas-sin-salas). El personal puede
// además escribir una hora fuera de franja ("Otra hora..."). El aforo lo
// sigue validando el trigger por turno.
const SIN_ASIGNAR = "__sin_asignar__";
const OTRA_HORA = "__otra__";

/** Claves de React Query a invalidar tras crear una reserva (desde aquí o
 * aceptando la propuesta de una solicitud). */
export const CLAVES_REFRESCO_RESERVAS = [
  "reservas-hoy",
  "reservas-kanban",
  "reservas-lista",
  "reservas_mes",
  "reservas_hoy_todas",
  "ocupacion_hoy",
  "ocupacion-reservas-hoy",
  "today-reservations",
  "today-confirmed-reservations",
  "dashboard-stats",
  "disponibilidad",
  "disponibilidad-detallada",
  "disponibilidad-rango",
  "resumen-ocupacion-hoy-completo",
  CLAVE_OCUPACION_SALAS_DIA,
];

interface ReservaMismoDia {
  hora: string;
  estado: string;
  nombre: string | null;
}

/** Reservas vivas ese día con el mismo teléfono (en cualquier formato) o email. */
async function buscarReservasMismoDia(
  telefono: string | undefined,
  email: string | undefined,
  fecha: string,
): Promise<ReservaMismoDia[]> {
  const filtros: string[] = [];
  const variantes = variantesTelefono(telefono);
  // Valores entre comillas dobles para el `.or()` de PostgREST (el "+" y los
  // espacios de las variantes no rompen el filtro).
  const lista = (vals: string[]) => vals.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
  if (variantes.length > 0) filtros.push(`telefono.in.(${lista(variantes)})`);
  const emailLimpio = email?.trim();
  if (emailLimpio && RE_EMAIL.test(emailLimpio)) {
    filtros.push(`email.in.(${lista(Array.from(new Set([emailLimpio, emailLimpio.toLowerCase()])))})`);
  }
  if (filtros.length === 0) return [];
  const { data, error } = await (supabase.from("reservas" as any) as any)
    .select("hora, estado, nombre")
    .eq("fecha", fecha)
    .not("estado", "in", "(cancelada,no_show)")
    .or(filtros.join(","))
    .order("hora");
  if (error) throw error;
  return ((data ?? []) as ReservaMismoDia[]).map((r) => ({ ...r, hora: String(r.hora) }));
}

/** Lo que se acaba de crear, para quien abrió el formulario (p. ej. cerrar una solicitud). */
export interface ReservaCreadaDesdeFormulario {
  /** null solo si la BD no devolvió la fila (no debería pasar). */
  id: string | null;
  fecha: string;
  hora: string;
  numero_comensales: number;
  espacio_id: string | null;
}

interface FormularioReservaProps {
  onSuccess?: (reserva?: ReservaCreadaDesdeFormulario) => void;
  isPublic?: boolean;
  datosPreseleccionados?: {
    fecha?: Date;
    hora?: string;
    // Datos del cliente: los usa "Convertir en reserva" desde una solicitud
    // pendiente del bot (ListaReservasAvanzada.tsx) para no reteclearlos.
    nombre?: string;
    telefono?: string;
    email?: string;
    numero_comensales?: number;
    notas_cliente?: string;
    /** Sala propuesta (diálogo de solicitudes del bot). */
    espacio_id?: string | null;
    /** Canal de la reserva: 'telefono' si viene de una solicitud del bot. */
    canal?: "telefono" | "manual";
    /** Solicitud del bot de la que sale (reservas.solicitud_id). */
    solicitud_id?: string | null;
    /** Negocio de la reserva (valor inicial del selector "Negocio"). Sin
     * valor, Casa Tomás. */
    marca?: string | null;
  } | null;
}

export const FormularioReserva = ({ onSuccess, isPublic = false, datosPreseleccionados }: FormularioReservaProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [disponibilidadInfo, setDisponibilidadInfo] = useState<{
    disponible: boolean;
    mensaje: string;
  } | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [blacklistEntry, setBlacklistEntry] = useState<BlacklistEntry | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = useState<string | null>(null);
  // Reservas vivas del mismo teléfono/email ese día (aviso, no bloqueo).
  const [duplicadas, setDuplicadas] = useState<ReservaMismoDia[]>([]);
  const verificarBlacklist = useVerificarBlacklist();
  const { data: configReservas } = useConfiguracionReservas();
  const [modoOtraHora, setModoOtraHora] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      numero_comensales: 2,
      fecha: datosPreseleccionados?.fecha,
      hora: datosPreseleccionados?.hora ?? "",
      marca: datosPreseleccionados?.marca ?? MARCA_POR_DEFECTO,
      espacio_id: datosPreseleccionados?.espacio_id ?? null,
    },
  });

  // Actualizar formulario cuando cambien los datos preseleccionados
  useEffect(() => {
    if (datosPreseleccionados?.fecha) {
      form.setValue("fecha", datosPreseleccionados.fecha);
    }
    if (datosPreseleccionados?.hora) {
      form.setValue("hora", datosPreseleccionados.hora);
    }
    if (datosPreseleccionados?.nombre) form.setValue("nombre", datosPreseleccionados.nombre);
    if (datosPreseleccionados?.telefono) form.setValue("telefono", datosPreseleccionados.telefono);
    if (datosPreseleccionados?.email) form.setValue("email", datosPreseleccionados.email);
    if (datosPreseleccionados?.numero_comensales) {
      form.setValue("numero_comensales", datosPreseleccionados.numero_comensales);
    }
    if (datosPreseleccionados?.notas_cliente) {
      form.setValue("notas_cliente", datosPreseleccionados.notas_cliente);
    }
    if (datosPreseleccionados?.marca != null) form.setValue("marca", datosPreseleccionados.marca);
    if (datosPreseleccionados?.espacio_id !== undefined) {
      form.setValue("espacio_id", datosPreseleccionados.espacio_id);
    }
  }, [datosPreseleccionados, form]);

  const watchedFecha = form.watch("fecha");
  const watchedHora = form.watch("hora");
  const watchedComensales = form.watch("numero_comensales");
  const watchedEmail = form.watch("email");
  const watchedTelefono = form.watch("telefono");
  const watchedEspacio = form.watch("espacio_id") ?? null;
  const watchedMarca = form.watch("marca");
  const fechaStr = watchedFecha ? format(watchedFecha, "yyyy-MM-dd") : null;

  // Reservas + salas del día (una sola consulta, compartida con las rejillas
  // por la clave de React Query), de TODOS los negocios. El negocio de la
  // reserva lo elige el personal en "Negocio" (obligatorio): la sala es
  // asignación interna y ya no lo decide. El aforo del turno, las horas y la
  // evaluación de la sala son las de ESE negocio.
  const { data: datosDia } = useOcupacionSalasDia(fechaStr);
  const todosLosEspacios = useMemo(() => (datosDia?.negocios ?? []).flatMap((n) => n.espacios), [datosDia]);
  const marcaAlta = normalizarMarca(watchedMarca);
  const datosNegocio = useMemo(() => datosDeNegocio(datosDia, marcaAlta), [datosDia, marcaAlta]);
  const salasDelNegocio = datosNegocio?.espacios ?? [];
  const { rejilla } = useRejillaCuartos({
    fecha: fechaStr,
    marca: marcaAlta,
    comensales: Number(watchedComensales) || 0,
    hora: watchedHora || null,
    enabled: !isPublic,
  });
  const horariosDisponibles = useMemo(
    () => (rejilla?.franjas ?? []).filter((f) => f.origen === "turno").map((f) => f.hora),
    [rejilla],
  );
  // Una hora fuera de las franjas (p. ej. propuesta a mano desde una
  // solicitud) ya NO se borra al cambiar de día: el personal puede reservar
  // a cualquier hora; el aforo lo sigue validando el trigger.
  const horaFueraDeFranja = !!rejilla && !!watchedHora && !horariosDisponibles.includes(watchedHora);

  /** Cambiar de negocio: la sala de otro negocio no vale; la única sala de
   * un negocio que solo tiene una (Touza: El Reservado) se preselecciona. */
  const cambiarMarca = (marca: string) => {
    form.setValue("marca", marca, { shouldValidate: true });
    const actual = form.getValues("espacio_id") ?? null;
    const actualEsDeOtro = !!actual && !todosLosEspacios.some((e) => e.id === actual && normalizarMarca(e.marca) === marca);
    if (actualEsDeOtro || !actual) form.setValue("espacio_id", espacioUnicoDeNegocio(marca, todosLosEspacios));
  };
  const nombreSalaElegida = watchedEspacio
    ? todosLosEspacios.find((e) => e.id === watchedEspacio)?.nombre ?? "Sala"
    : "sin sala";
  const mostrarInputHora = modoOtraHora || horaFueraDeFranja;

  // Aviso (no bloqueo) si la sala elegida se pasa de su capacidad en el
  // turno: mismo criterio que el Kanban al mover de espacio.
  const evaluacionSala = useMemo(() => {
    if (!datosNegocio || !watchedHora) return null;
    const ocupacion = calcularOcupacionSalas({
      espacios: datosNegocio.espacios,
      reservas: datosNegocio.reservas,
      horasBase: datosNegocio.horasBase,
      comensales: Number(watchedComensales) || 0,
    });
    return evaluarUbicacion(ocupacion, watchedEspacio, watchedHora);
  }, [datosNegocio, watchedHora, watchedComensales, watchedEspacio]);

  const superaMaximoAutomatico =
    !!configReservas && Number(watchedComensales) > configReservas.max_comensales_por_reserva;

  // Verificar el aforo del turno cuando hay fecha, hora y comensales.
  // Es solo una comprobación previa: la validación real la hace el trigger
  // `trg_validar_capacidad` en la base de datos al insertar.
  useEffect(() => {
    if (!watchedFecha || !watchedHora || !watchedComensales) {
      setDisponibilidadInfo(null);
      return;
    }

    let cancelado = false;
    const comprobar = async () => {
      setVerificando(true);
      try {
        // Aforo del turno DEL NEGOCIO de la reserva (igual que el trigger).
        const resultado = await verificarAforoTurno(
          format(watchedFecha, "yyyy-MM-dd"),
          watchedHora,
          watchedComensales,
          marcaAlta,
        );
        if (!cancelado) {
          setDisponibilidadInfo({ disponible: resultado.disponible, mensaje: resultado.mensaje });
        }
      } catch (error) {
        console.error("Error verificando aforo del turno:", error);
        // Si no se puede comprobar, no se bloquea el alta: la base de datos sigue validando.
        if (!cancelado) {
          setDisponibilidadInfo({
            disponible: true,
            mensaje: "No se pudo comprobar el aforo. Se validará al guardar la reserva.",
          });
        }
      } finally {
        if (!cancelado) setVerificando(false);
      }
    };

    const timeout = setTimeout(comprobar, 400);
    return () => {
      cancelado = true;
      clearTimeout(timeout);
    };
  }, [watchedFecha, watchedHora, watchedComensales, marcaAlta]);

  useEffect(() => {
    const checkBlacklist = async () => {
      if (watchedEmail || watchedTelefono) {
        try {
          const result = await verificarBlacklist.mutateAsync({
            email: watchedEmail,
            telefono: watchedTelefono,
          });
          setBlacklistEntry(result);
        } catch (error) {
          // No bloquea el formulario: la comprobación definitiva se repite al enviar.
          console.error("Error comprobando la lista negra:", error);
          setBlacklistEntry(null);
        }
      } else {
        setBlacklistEntry(null);
      }
    };

    const timeout = setTimeout(checkBlacklist, 500);
    return () => clearTimeout(timeout);
  }, [watchedEmail, watchedTelefono]);

  // Posible duplicado: otra reserva viva del mismo cliente ese día. Solo
  // avisa (puede ser legítimo: comida y cena); el límite configurado por
  // teléfono/email sí bloquea al enviar.
  useEffect(() => {
    if (isPublic || !fechaStr || (!watchedTelefono?.trim() && !watchedEmail?.trim())) {
      setDuplicadas([]);
      return;
    }
    let cancelado = false;
    const timeout = setTimeout(async () => {
      try {
        const encontradas = await buscarReservasMismoDia(watchedTelefono, watchedEmail, fechaStr);
        if (!cancelado) setDuplicadas(encontradas);
      } catch (error) {
        console.error("Error buscando reservas duplicadas:", error);
        if (!cancelado) setDuplicadas([]);
      }
    }, 600);
    return () => {
      cancelado = true;
      clearTimeout(timeout);
    };
  }, [isPublic, fechaStr, watchedTelefono, watchedEmail]);

  // Verificar límites de reservas por teléfono/email. El teléfono se busca
  // en todas sus formas (+34..., 0034..., con espacios): las reservas del bot
  // se guardan como "+34XXXXXXXXX" y las antiguas del panel tal cual.
  const verificarLimites = async (telefono: string | undefined, email: string | undefined, fecha: string) => {
    if (!configReservas) return null;

    const variantes = variantesTelefono(telefono);
    if (variantes.length > 0 && configReservas.max_reservas_por_telefono_dia > 0) {
      const { count, error } = await supabase
        .from("reservas" as any)
        .select("id", { count: "exact", head: true })
        .in("telefono", variantes)
        .eq("fecha", fecha)
        .not("estado", "in", "(cancelada,no_show)");

      if (error) throw error;

      if (count && count >= configReservas.max_reservas_por_telefono_dia) {
        return `Este teléfono ya tiene ${count} reserva(s) para ese día (máx: ${configReservas.max_reservas_por_telefono_dia})`;
      }
    }

    const emailLimpio = email?.trim();
    if (emailLimpio && configReservas.max_reservas_por_email_dia > 0) {
      const { count, error } = await supabase
        .from("reservas" as any)
        .select("id", { count: "exact", head: true })
        .in("email", Array.from(new Set([emailLimpio, emailLimpio.toLowerCase()])))
        .eq("fecha", fecha)
        .not("estado", "in", "(cancelada,no_show)");

      if (error) throw error;

      if (count && count >= configReservas.max_reservas_por_email_dia) {
        return `Este email ya tiene ${count} reserva(s) para ese día (máx: ${configReservas.max_reservas_por_email_dia})`;
      }
    }

    return null;
  };

  const onSubmit = async (values: FormValues) => {
    try {
      // Teléfono y email ya los exige el esquema (siempre obligatorios en el
      // panel; los flags telefono_obligatorio/email_obligatorio de
      // configuracion_reservas solo aplican a los canales automáticos).

      // Validate comensales limits
      if (configReservas) {
        if (values.numero_comensales < configReservas.min_comensales_por_reserva) {
          form.setError("numero_comensales", {
            message: `Mínimo ${configReservas.min_comensales_por_reserva} comensal(es)`,
          });
          toast.error(`Mínimo ${configReservas.min_comensales_por_reserva} comensal(es)`);
          return;
        }
        // El máximo por reserva es el límite de los canales AUTOMÁTICOS (bot,
        // web): un grupo grande es justo lo que el bot deriva al personal
        // (motivo "grupo_grande"). En el panel solo se avisa; en la web se bloquea.
        if (isPublic && values.numero_comensales > configReservas.max_comensales_por_reserva) {
          form.setError("numero_comensales", {
            message: `Máximo ${configReservas.max_comensales_por_reserva} comensales por reserva`,
          });
          toast.error(`Máximo ${configReservas.max_comensales_por_reserva} comensales por reserva`);
          return;
        }
      }

      const fechaStr = format(values.fecha, "yyyy-MM-dd");

      // El calendario no deja elegir un día pasado, pero una fecha
      // prerrellenada (p. ej. una solicitud antigua del bot) sí se colaba.
      if (fechaStr < format(new Date(), "yyyy-MM-dd")) {
        form.setError("fecha", { message: "La fecha ya ha pasado" });
        toast.error("La fecha de la reserva ya ha pasado");
        return;
      }

      // Mismo formato que el bot ("+34XXXXXXXXX") para que la búsqueda, los
      // límites y la lista negra casen entre canales.
      const telefonoGuardar = formatearTelefonoReserva(values.telefono);
      const emailGuardar = values.email.trim();

      // Check limits per phone/email
      const limiteMsg = await verificarLimites(values.telefono, emailGuardar, fechaStr);
      if (limiteMsg) {
        setLimiteAlcanzado(limiteMsg);
        toast.error(limiteMsg);
        return;
      }

      // Verificar blacklist antes de crear
      const blacklisted = await verificarBlacklist.mutateAsync({
        email: emailGuardar,
        telefono: values.telefono,
      });

      // Los estados válidos los fija el CHECK `reservas_estado_check`:
      // pendiente | verificada | confirmada | cancelada | completada | no_show.
      // Un cliente en blacklist entra como `pendiente` con `en_blacklist = true`
      // para que el equipo la revise a mano (antes se usaba "rechazada", que no existe
      // en el CHECK y hacía fallar el INSERT con el error 23514).
      //
      // Decisión del dueño (2026-09-23): un alta del panel NUNCA nace
      // 'confirmada' en silencio (se ignora configuracion_reservas.auto_confirmar).
      // Nace 'verificada' y se dispara notify-reservation-change, igual que al
      // pasar una reserva a 'verificada' desde la lista: emails-reserva manda
      // la plantilla 'propuesta' ("Confirma tu reserva") y el cliente la
      // confirma desde el enlace (-> 'confirmada' + correo de confirmación).
      const estadoInicial = estadoInicialAltaPanel(!!blacklisted);

      const fila: Record<string, unknown> = {
        nombre: values.nombre.trim(),
        telefono: telefonoGuardar,
        email: emailGuardar,
        fecha: fechaStr,
        hora: values.hora,
        numero_comensales: values.numero_comensales,
        notas_cliente: values.notas_cliente?.trim() || null,
        espacio_id: values.espacio_id || null,
        // Negocio: el elegido en el formulario (obligatorio). Ya no sale de
        // la sala: una reserva de Touza sin sala sigue siendo de Touza.
        marca: values.marca,
        estado: estadoInicial,
        // 'telefono' al convertir una solicitud del bot (el cliente llamó);
        // 'manual' para un alta del personal.
        canal: isPublic ? "web" : datosPreseleccionados?.canal ?? "manual",
        en_blacklist: !!blacklisted,
      };
      if (datosPreseleccionados?.solicitud_id) fila.solicitud_id = datosPreseleccionados.solicitud_id;

      const insertar = (valores: Record<string, unknown>) =>
        (supabase.from("reservas" as any) as any).insert(valores).select("id").single();
      let { data: insertada, error } = await insertar(fila);
      // Sin la migración 20260923210000 no existe reservas.solicitud_id.
      if (error && "solicitud_id" in fila && esErrorEsquemaPendiente(error)) {
        const { solicitud_id: _omitida, ...sinSolicitud } = fila;
        ({ data: insertada, error } = await insertar(sinSolicitud));
      }

      if (error) throw error;

      const idCreada = (insertada as { id?: string } | null)?.id ?? null;
      // Correo "Confirma tu reserva" (mismo camino que un cambio de estado en
      // la lista). En lista negra no se escribe al cliente: queda pendiente
      // de revisión.
      if (idCreada && debeNotificarAltaPanel(estadoInicial)) notificarCambioReserva(idCreada, { estado: estadoInicial });

      // Refrescar todo lo que muestra reservas del día, ocupación y disponibilidad:
      // sin esto la reserva se crea pero no aparece en ninguna pantalla y el hueco
      // recién ocupado se sigue ofreciendo como libre.
      CLAVES_REFRESCO_RESERVAS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

      if (blacklisted) {
        toast.info("Reserva registrada como pendiente de revisión (cliente en lista negra)");
      } else {
        toast.success("Reserva creada. Se ha enviado al cliente un correo para que la confirme.");
      }

      const creada: ReservaCreadaDesdeFormulario = {
        id: idCreada,
        fecha: fechaStr,
        hora: values.hora,
        numero_comensales: values.numero_comensales,
        espacio_id: values.espacio_id || null,
      };
      form.reset({ numero_comensales: 2, hora: "", marca: values.marca, espacio_id: null });
      setModoOtraHora(false);
      setLimiteAlcanzado(null);
      setDisponibilidadInfo(null);
      setDuplicadas([]);

      if (isPublic) {
        // No existe ninguna página de confirmación en el panel; se vuelve al listado.
        navigate("/reservas");
      } else if (onSuccess) {
        onSuccess(creada);
      }
    } catch (error: any) {
      console.error("Error creando reserva:", error);
      // 23514 = check_violation. Lo lanza el trigger `trg_validar_capacidad` cuando
      // se supera el aforo del turno, y también los CHECK de la tabla.
      const mensaje = error?.code === "23514" && String(error?.message || "").includes("Aforo")
        ? "No hay aforo suficiente en ese turno. Elige otra hora o reduce los comensales."
        : error?.code === "23505" && String(error?.message || "").includes("solicitud")
          ? "Esta solicitud ya se había convertido en una reserva."
          : error?.code === "42501"
            ? "No tienes permiso para crear reservas."
            : `Error al crear la reserva: ${error?.message ?? "error desconocido"}`;
      toast.error(mensaje);
    }
  };

  // Errores de validación visibles: sin esto el botón parecía no hacer nada.
  const erroresValidacion = Object.values(form.formState.errors)
    .map((error) => error?.message)
    .filter(Boolean) as string[];

  const maxFecha = configReservas?.dias_max_antelacion
    ? addDays(new Date(), configReservas.dias_max_antelacion)
    : undefined;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="nombre"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre completo</FormLabel>
                <FormControl>
                  <Input placeholder="Juan Pérez" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="telefono"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Teléfono</FormLabel>
                <FormControl>
                  <Input placeholder="612345678" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="juan@email.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="fecha"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Fecha</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value
                          ? format(field.value, "EEEE, d 'de' MMMM yyyy", { locale: es })
                          : "Seleccionar fecha"}
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) =>
                        date < startOfDay(new Date()) || (!!maxFecha && date > maxFecha)
                      }
                      initialFocus
                      locale={es}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="hora"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Hora</FormLabel>
                {mostrarInputHora ? (
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        type="time"
                        step={300}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(horaCorta(e.target.value) ?? "")}
                      />
                    </FormControl>
                    {horariosDisponibles.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-10 shrink-0 text-xs"
                        onClick={() => {
                          setModoOtraHora(false);
                          if (horaFueraDeFranja) field.onChange("");
                        }}
                      >
                        Turnos
                      </Button>
                    )}
                  </div>
                ) : (
                  <Select
                    value={field.value || undefined}
                    onValueChange={(v) => (v === OTRA_HORA ? setModoOtraHora(true) : field.onChange(v))}
                    disabled={!watchedFecha}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={watchedFecha ? "Seleccionar hora" : "Elige antes una fecha"}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {horariosDisponibles.map((hora) => (
                        <SelectItem key={hora} value={hora}>
                          {hora}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTRA_HORA}>Otra hora…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {horaFueraDeFranja && (
                  <p className="text-[11px] text-muted-foreground">Hora fuera de las franjas del día.</p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="numero_comensales"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Número de comensales</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={configReservas?.min_comensales_por_reserva || 1}
                    // Solo la web pública se limita al máximo automático; el
                    // personal puede dar de alta grupos grandes (ver onSubmit).
                    max={isPublic ? configReservas?.max_comensales_por_reserva || 100 : undefined}
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {!isPublic && (
            <FormField
              control={form.control}
              name="marca"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Negocio</FormLabel>
                  <Select value={field.value || undefined} onValueChange={cambiarMarca}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elige el negocio" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {NEGOCIOS_PANEL.map((n) => (
                        <SelectItem key={n.marca} value={n.marca}>
                          {n.etiqueta}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Cada negocio tiene su propio aforo. La sala no lo decide.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {!isPublic && superaMaximoAutomatico && configReservas && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Grupo de {watchedComensales} personas: supera el máximo automático ({configReservas.max_comensales_por_reserva}).
              Como alta manual se permite.
            </AlertDescription>
          </Alert>
        )}

        {!isPublic && (
          <div className="rounded-lg border p-3">
            <DisponibilidadCuartos
              fecha={fechaStr}
              marca={marcaAlta}
              comensales={Number(watchedComensales) || 0}
              hora={watchedHora || null}
              onSeleccionarHora={(hora) => {
                setModoOtraHora(false);
                form.setValue("hora", hora, { shouldValidate: true });
              }}
            />
          </div>
        )}

        {/* La sala es asignación INTERNA y opcional (reservas-sin-salas):
            plegada, con la rejilla de salas para decidir. Solo las salas del
            negocio elegido. */}
        {!isPublic && (
          <Collapsible className="space-y-3 rounded-lg border p-3">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="group h-8 w-full justify-between px-2 text-sm">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  Asignación interna (opcional)
                  <span className="text-muted-foreground">· {nombreSalaElegida}</span>
                </span>
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3">
              <FormField
                control={form.control}
                name="espacio_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sala</FormLabel>
                    <Select
                      value={field.value ?? SIN_ASIGNAR}
                      onValueChange={(v) => field.onChange(v === SIN_ASIGNAR ? null : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                        {salasDelNegocio.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.nombre} ({e.capacidad_maxima} plazas)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      No se le dice al cliente ni limita la hora. Se puede dejar sin asignar y ponerla más tarde.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <OcupacionSalas
                fecha={fechaStr}
                comensales={Number(watchedComensales) || 0}
                hora={watchedHora || null}
                espacioId={watchedEspacio}
                marca={marcaAlta}
                onSeleccionar={(espacioId, hora) => {
                  setModoOtraHora(false);
                  form.setValue("espacio_id", espacioId);
                  form.setValue("hora", hora, { shouldValidate: true });
                }}
              />
            </CollapsibleContent>
          </Collapsible>
        )}

        <FormField
          control={form.control}
          name="notas_cliente"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas adicionales (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Alergias, preferencias, ocasión especial..."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {erroresValidacion.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Faltan datos para crear la reserva:</strong>
              <ul className="list-disc pl-4 mt-1">
                {erroresValidacion.map((mensaje) => (
                  <li key={mensaje}>{mensaje}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {!isPublic && datosNegocio?.cerrado && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Ese día no tiene turnos configurados ({etiquetaNegocio(marcaAlta)} cierra). Se puede crear con "Otra hora…", pero
              revisa que sea correcto.
            </AlertDescription>
          </Alert>
        )}

        {!isPublic && duplicadas.length > 0 && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Este cliente ya tiene {duplicadas.length === 1 ? "una reserva" : `${duplicadas.length} reservas`} ese día:{" "}
              {duplicadas.map((d) => `${d.hora.slice(0, 5)} (${d.estado})`).join(", ")}. Comprueba que no sea un
              duplicado.
            </AlertDescription>
          </Alert>
        )}

        {limiteAlcanzado && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{limiteAlcanzado}</AlertDescription>
          </Alert>
        )}

        {blacklistEntry && !isPublic && (
          <Alert variant="destructive">
            <ShieldBan className="h-4 w-4" />
            <AlertDescription>
              <strong>Cliente en lista negra:</strong> {blacklistEntry.nombre || "Sin nombre"}
              {blacklistEntry.motivo && ` - ${blacklistEntry.motivo}`}
            </AlertDescription>
          </Alert>
        )}

        {evaluacionSala && evaluacionSala.cabeAforo && !evaluacionSala.cabeSala && evaluacionSala.sala && evaluacionSala.celda && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {evaluacionSala.sala.nombre} quedaría en {evaluacionSala.celda.tras}/{evaluacionSala.celda.capacidad} en
              el turno de {ETIQUETA_TURNO[evaluacionSala.turno].toLowerCase()} (supera su capacidad). Puedes crearla
              igualmente o elegir otra sala.
            </AlertDescription>
          </Alert>
        )}

        {disponibilidadInfo && (
          <Alert variant={disponibilidadInfo.disponible ? "default" : "destructive"}>
            {disponibilidadInfo.disponible ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <AlertDescription>{disponibilidadInfo.mensaje}</AlertDescription>
          </Alert>
        )}

        {!isPublic && (
          // La reserva nace 'verificada' y se invoca notify-reservation-change
          // (ver onSubmit): el cliente recibe "Confirma tu reserva".
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Se enviará al cliente un correo para que confirme su reserva. Queda como verificada hasta que la
              confirme desde el enlace.
            </span>
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={
            verificando ||
            form.formState.isSubmitting ||
            (disponibilidadInfo !== null && !disponibilidadInfo.disponible)
          }
        >
          {verificando
            ? "Verificando..."
            : form.formState.isSubmitting
              ? "Creando..."
              : "Crear Reserva"}
        </Button>
      </form>
    </Form>
  );
};
