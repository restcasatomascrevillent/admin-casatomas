// Dashboard › «Avisos» (10/11/2026, petición del dueño). Los avisos que ya hay
// en el panel (los de la campana y la página Avisos: reservas, alertas de
// Facturas, subidas de precio de líneas de factura, encargos…), cada uno con
// el enlace a su origen. Solo los de las secciones que el usuario puede ver
// (ver lib/dashboard/avisosDashboard.ts). Tocar uno lo marca leído y abre su
// origen, como en la campana; «Ver todos» lleva a /avisos.
//
// 11/11/2026 (dueño: «añade algo más de información y que se pueda clicar para hacer cosas»): cada aviso
// enseña su detalle (`mensaje`: «Jorge Santos · 12/11 15:00 · 8 pers. · web»); el de una reserva abre su
// ficha aquí mismo (Verificar, Confirmar, Cancelar, editar); «✓» lo da por revisado sin salir; las
// etiquetas de sección filtran la lista y «Revisar todos» marca todos los que se ven.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Bell, Check, CheckCheck, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotificacionesDashboard, type NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { usePermisosFacturas } from "@/hooks/usePermisosFacturas";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { etiquetaDia, horaAviso, rutaDeAviso, TIPO_ICON } from "@/lib/avisos";
import {
  avisosParaDashboard,
  ETIQUETA_SECCION_AVISO,
  seccionDeAviso,
  sinLeerPorSeccion,
  type PermisosAvisos,
  type SeccionAviso,
} from "@/lib/dashboard/avisosDashboard";
import { cn } from "@/lib/utils";

const FOCO = "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MAX_FILAS = 15;

function usePermisosAvisos(): PermisosAvisos & { cargando: boolean } {
  const reservas = useCanAccessSection("reservas");
  const marketing = useCanAccessSection("marketing");
  const agencia = useCanAccessSection("instagram_agencia");
  const facturas = usePermisosFacturas();
  const { isSuperAdmin, loading } = useSuperAdmin();
  return {
    reservas: reservas.canAccess,
    facturas: facturas.consultar,
    rrss: marketing.canAccess || agencia.canAccess,
    superAdmin: isSuperAdmin,
    cargando: reservas.loading || marketing.loading || agencia.loading || facturas.cargando || loading,
  };
}

const cuando = (iso: string) => {
  const dia = etiquetaDia(iso);
  return dia === "Hoy" ? horaAviso(iso) : dia === "Ayer" ? `Ayer ${horaAviso(iso)}` : new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};

export function AvisosDashboard() {
  const { notificaciones, loading, marcarLeida, marcarTodasLeidas } = useNotificacionesDashboard();
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const [filtro, setFiltro] = useState<SeccionAviso | null>(null);
  const permisos = usePermisosAvisos();
  const navigate = useNavigate();
  const { cargando, reservas, facturas, rrss, superAdmin } = permisos;
  const avisos = useMemo(
    () => (cargando ? [] : avisosParaDashboard(notificaciones, { reservas, facturas, rrss, superAdmin })),
    [notificaciones, cargando, reservas, facturas, rrss, superAdmin],
  );
  const porSeccion = useMemo(() => sinLeerPorSeccion(avisos), [avisos]);
  const visibles = useMemo(() => (filtro ? avisos.filter((n) => seccionDeAviso(n) === filtro) : avisos), [avisos, filtro]);
  const haySinLeer = porSeccion.length > 0;

  // El aviso de una reserva abre su ficha aquí (se verifica o confirma sin cambiar de pantalla); el resto, su origen.
  const abrir = (n: NotificacionDashboard, ruta: string | null) => {
    void marcarLeida(n.id);
    if (reservas && n.referencia_tipo === "reserva" && n.referencia_id) editarReserva(n.referencia_id);
    else if (ruta) navigate(ruta);
  };

  return (
    <Card className="flex h-full flex-col" data-testid="widget-avisos">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 space-y-0 px-4 py-2.5 sm:px-5">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Avisos
        </CardTitle>
        <div className="flex items-center gap-1">
          {haySinLeer && (
            <button
              type="button"
              onClick={() => void marcarTodasLeidas()}
              className={cn("inline-flex min-h-8 items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground", FOCO)}
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Revisar todos
            </button>
          )}
          <Link to="/avisos" className={cn("inline-flex min-h-8 items-center gap-1 px-1 text-xs font-medium text-primary hover:underline", FOCO)}>
            Ver todos <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-[160px] flex-1 flex-col gap-2 overflow-hidden px-4 pb-3 pt-0 sm:px-5">
        {loading || cargando ? (
          <p className="m-auto text-sm text-muted-foreground" role="status">Cargando avisos…</p>
        ) : avisos.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">No hay avisos.</p>
        ) : (
          <>
            {porSeccion.length > 0 && (
              <ul aria-label="Sin leer por sección" className="flex shrink-0 flex-wrap gap-1.5">
                {porSeccion.map(({ seccion, n }) => (
                  <li key={seccion}>
                    <button
                      type="button"
                      aria-pressed={filtro === seccion}
                      onClick={() => setFiltro((f) => (f === seccion ? null : seccion))}
                      className={cn(
                        "min-h-7 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                        filtro === seccion ? "bg-destructive text-destructive-foreground" : "bg-destructive/10 text-destructive hover:bg-destructive/20",
                        FOCO,
                      )}
                    >
                      {ETIQUETA_SECCION_AVISO[seccion]} · {n}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ul aria-label="Últimos avisos" className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto overscroll-contain pr-1">
              {visibles.slice(0, MAX_FILAS).map((n) => {
                const Icono = TIPO_ICON[n.tipo] || Info;
                const ruta = rutaDeAviso(n);
                const seAbre = !!ruta || (reservas && n.referencia_tipo === "reserva" && !!n.referencia_id);
                const contenido = (
                  <>
                    <Icono className={cn("mt-0.5 h-4 w-4 shrink-0", n.leida ? "text-muted-foreground" : "text-destructive")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", !n.leida && "font-medium")}>{n.titulo}</span>
                      {n.mensaje ? <span className="block truncate text-xs text-foreground/80">{n.mensaje}</span> : null}
                      <span className="block truncate text-xs text-muted-foreground">
                        {ETIQUETA_SECCION_AVISO[seccionDeAviso(n)]} · {cuando(n.created_at)}
                        {n.leida ? " · Revisado" : ""}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={n.id} className="flex items-start gap-1">
                    {seAbre ? (
                      <button
                        type="button"
                        onClick={() => abrir(n, ruta)}
                        className={cn("flex min-w-0 flex-1 items-start gap-2 py-1.5 text-left hover:bg-muted/50", FOCO)}
                        aria-label={`Abrir: ${n.titulo}${n.mensaje ? `, ${n.mensaje}` : ""}`}
                      >
                        {contenido}
                      </button>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-start gap-2 py-1.5">{contenido}</div>
                    )}
                    {!n.leida && (
                      <button
                        type="button"
                        onClick={() => void marcarLeida(n.id)}
                        className={cn("mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground", FOCO)}
                        aria-label={`Marcar como revisado: ${n.titulo}`}
                        title="Revisado"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
              {visibles.length === 0 && <li className="py-3 text-center text-sm text-muted-foreground">No hay avisos de esta sección.</li>}
            </ul>
          </>
        )}
      </CardContent>
      {dialogoEdicion}
    </Card>
  );
}
