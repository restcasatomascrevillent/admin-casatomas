// ============================================================================
//  «Cómo se hizo la reserva» — sección plegable de la ficha (EditarReservaDialog).
// ----------------------------------------------------------------------------
//  Pedido del dueño (2026-11-10): ver en cada reserva a qué hora se hizo, cuánto
//  tardó el cliente en rellenar el formulario y toda la información de origen.
//
//  · Lo de la web sale de `reservas.origen` (ver src/lib/reservas/origenReserva.ts).
//  · Sin `origen` (teléfono, panel, reservas anteriores) se enseña lo que haya
//    en la fila: creada, canal, verificación de email y condiciones.
//  · El historial de cambios (quién y cuándo) es la AUDITORÍA del panel
//    (`audit_log_visible`, solo Super Admin por RLS). No se duplica: se lee al
//    desplegar la sección y, si el usuario no la puede ver, se dice.
//    Para el detalle completo, Super Admin › Auditoría.
// ============================================================================
import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { etiquetaCampo } from "@/lib/auditoria";
import {
  ETIQUETA_CAMPO_FORMULARIO,
  ETIQUETA_CANAL_ORIGEN,
  ETIQUETA_DISPOSITIVO,
  ETIQUETA_IDIOMA,
  ETIQUETA_PROCEDENCIA,
  camposCambiados,
  formatearDuracion,
  leerOrigen,
} from "@/lib/reservas/origenReserva";

/** Lo que la sección necesita de la fila (se pasa la fila completa de `select("*")`). */
export interface ReservaConOrigen {
  id: string;
  canal?: string | null;
  created_at?: string | null;
  condiciones_aceptadas_at?: string | null;
  email_verificado_at?: string | null;
  consentimiento_newsletter_at?: string | null;
  estado?: string | null;
  origen?: unknown;
}

export interface CambioHistorial {
  id: string;
  created_at: string;
  accion: string;
  actor: string | null;
  campos: string[];
}

async function cargarHistorial(reservaId: string): Promise<CambioHistorial[] | "sin_permiso"> {
  const { data, error } = await supabase
    .from("audit_log_visible" as "audit_log")
    .select("id, created_at, accion, actor_label, actor_email, detalles")
    .eq("tabla", "reservas")
    .eq("registro_id", reservaId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return "sin_permiso";
  const filas = (data ?? []) as Array<{
    id: string;
    created_at: string;
    accion: string;
    actor_label?: string | null;
    actor_email?: string | null;
    detalles: unknown;
  }>;
  return filas.map((f) => ({
    id: f.id,
    created_at: f.created_at,
    accion: f.accion,
    actor: f.actor_label || f.actor_email || null,
    campos: f.accion === "actualizar" ? camposCambiados(f.detalles) : [],
  }));
}

const fechaHora = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "EEEE d 'de' MMMM yyyy, HH:mm:ss", { locale: es });
};
const hora = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "HH:mm:ss", { locale: es });
};

const ACCION: Record<string, string> = { crear: "Creada", actualizar: "Modificada", eliminar: "Borrada" };

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid grid-cols-[minmax(8rem,12rem)_1fr] gap-2 py-1">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export interface ComoSeHizoReservaProps {
  reserva: ReservaConOrigen;
  /** Abierta de entrada (tests). Por defecto plegada: el historial se carga al abrir. */
  abiertaInicial?: boolean;
}

export function ComoSeHizoReserva({ reserva, abiertaInicial = false }: ComoSeHizoReservaProps) {
  const [abierta, setAbierta] = useState(abiertaInicial);
  const origen = leerOrigen(reserva.origen);
  const c = origen?.cliente ?? null;

  const historial = useQuery({
    queryKey: ["reserva-historial", reserva.id],
    queryFn: () => cargarHistorial(reserva.id),
    enabled: abierta,
    staleTime: 60_000,
  });
  const lista = Array.isArray(historial.data) ? historial.data : [];
  const alta = lista.find((h) => h.accion === "crear");

  const canal = reserva.canal ? ETIQUETA_CANAL_ORIGEN[reserva.canal] ?? reserva.canal : "Sin canal";
  const duracion = formatearDuracion(c?.duracionSegundos);
  const utm = c ? Object.entries(c.utm).map(([k, v]) => `${k}: ${v}`).join(" · ") : "";
  const dispositivo = origen
    ? [
        origen.dispositivo ? ETIQUETA_DISPOSITIVO[origen.dispositivo] ?? origen.dispositivo : null,
        origen.navegador,
        origen.sistema,
        c?.pantalla ? `pantalla ${c.pantalla}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const procedencia = origen?.procedencia
    ? [ETIQUETA_PROCEDENCIA[origen.procedencia.tipo] ?? origen.procedencia.tipo, origen.procedencia.detalle, origen.procedencia.campana]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <section aria-labelledby={`como-${reserva.id}`} className="mt-4 rounded-md border">
      <button
        type="button"
        id={`como-${reserva.id}`}
        aria-expanded={abierta}
        onClick={() => setAbierta((a) => !a)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${abierta ? "rotate-90" : ""}`} aria-hidden />
        Cómo se hizo la reserva
      </button>
      {abierta && (
        <div className="border-t px-3 py-2 text-sm">
          <dl>
            <Fila etiqueta="Creada">{fechaHora(reserva.created_at) ?? "Sin fecha de creación"}</Fila>
            <Fila etiqueta="Canal">
              {canal}
              {alta?.actor && reserva.canal !== "web" ? ` — apuntada por ${alta.actor}` : null}
            </Fila>
            {c ? (
              <>
                <Fila etiqueta="Rellenando el formulario">{duracion ?? "No se pudo medir"}</Fila>
                <Fila etiqueta="Abrió el formulario">{hora(c.formularioAbiertoAt)}</Fila>
                <Fila etiqueta="Empezó a escribir">{hora(c.primerContactoAt)}</Fila>
                <Fila etiqueta="Envió">{hora(c.enviadoAt)}</Fila>
                <Fila etiqueta="Campos tocados">
                  {c.camposCambiados.length ? c.camposCambiados.map((x) => ETIQUETA_CAMPO_FORMULARIO[x] ?? x).join(", ") : null}
                </Fila>
                <Fila etiqueta="Consultas de horas">
                  {c.consultasDisponibilidad !== null
                    ? `${c.consultasDisponibilidad}${c.consultasSinHueco ? ` (${c.consultasSinHueco} sin hueco o con error)` : ""}`
                    : null}
                </Fila>
                <Fila etiqueta="Intentos fallidos antes">{c.intentosFallidos !== null ? String(c.intentosFallidos) : null}</Fila>
                <Fila etiqueta="Idioma">
                  {[c.idioma ? ETIQUETA_IDIOMA[c.idioma] ?? c.idioma : null, c.idiomaNavegador ? `navegador ${c.idiomaNavegador}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Fila>
                <Fila etiqueta="Página de entrada">{c.paginaEntrada}</Fila>
                <Fila etiqueta="Página del formulario">{c.paginaFormulario}</Fila>
                <Fila etiqueta="Viene de">{procedencia || c.referente}</Fila>
                <Fila etiqueta="Campaña (utm)">{utm || (c.qr ? `QR ${c.qr}` : null)}</Fila>
              </>
            ) : origen ? (
              <Fila etiqueta="Formulario">Sin datos del navegador (versión anterior de la web).</Fila>
            ) : reserva.canal === "web" ? (
              <Fila etiqueta="Formulario">Reserva anterior al registro de cómo se hizo.</Fila>
            ) : null}
            {origen && (
              <>
                <Fila etiqueta="Recibida por el servidor">{fechaHora(origen.recibidoAt)}</Fila>
                <Fila etiqueta="Dispositivo">{dispositivo}</Fila>
                <Fila etiqueta="Navegador completo">
                  {origen.userAgent ? <span className="text-xs text-muted-foreground">{origen.userAgent}</span> : null}
                </Fila>
              </>
            )}
            <Fila etiqueta="Aceptó las condiciones">{fechaHora(reserva.condiciones_aceptadas_at)}</Fila>
            <Fila etiqueta="Email verificado">{fechaHora(reserva.email_verificado_at)}</Fila>
            <Fila etiqueta="Newsletter aceptada">{fechaHora(reserva.consentimiento_newsletter_at)}</Fila>
          </dl>

          <h4 className="mt-3 font-medium">Historial de cambios</h4>
          {historial.isLoading ? (
            <p className="text-muted-foreground">Cargando…</p>
          ) : historial.data === "sin_permiso" ? (
            <p className="text-muted-foreground">El historial (quién cambió qué) solo lo ve Super Admin, en Super Admin › Auditoría.</p>
          ) : lista.length === 0 ? (
            <p className="text-muted-foreground">Sin cambios registrados en la auditoría (o solo los ve Super Admin).</p>
          ) : (
            <ol className="mt-1 space-y-1">
              {lista.map((h) => (
                <li key={h.id}>
                  <span className="tabular-nums">{fechaHora(h.created_at)}</span> — {ACCION[h.accion] ?? h.accion}
                  {h.actor ? ` por ${h.actor}` : ""}
                  {h.campos.length ? `: ${h.campos.map(etiquetaCampo).join(", ")}` : ""}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
