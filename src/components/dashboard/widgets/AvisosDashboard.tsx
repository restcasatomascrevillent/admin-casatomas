// Dashboard › «Avisos» (10/11/2026, petición del dueño). Los avisos que ya hay
// en el panel (los de la campana y la página Avisos: reservas, alertas de
// Facturas, subidas de precio de líneas de factura, encargos…), cada uno con
// el enlace a su origen. Solo los de las secciones que el usuario puede ver
// (ver lib/dashboard/avisosDashboard.ts). Tocar uno lo marca leído y abre su
// origen, como en la campana; «Ver todos» lleva a /avisos.
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Bell, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotificacionesDashboard, type NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { usePermisosFacturas } from "@/hooks/usePermisosFacturas";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { etiquetaDia, horaAviso, rutaDeAviso, TIPO_ICON } from "@/lib/avisos";
import { avisosParaDashboard, ETIQUETA_SECCION_AVISO, seccionDeAviso, sinLeerPorSeccion, type PermisosAvisos } from "@/lib/dashboard/avisosDashboard";
import { cn } from "@/lib/utils";

const FOCO = "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MAX_FILAS = 12;

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
  const { notificaciones, loading, marcarLeida } = useNotificacionesDashboard();
  const permisos = usePermisosAvisos();
  const navigate = useNavigate();
  const { cargando, reservas, facturas, rrss, superAdmin } = permisos;
  const avisos = useMemo(
    () => (cargando ? [] : avisosParaDashboard(notificaciones, { reservas, facturas, rrss, superAdmin })),
    [notificaciones, cargando, reservas, facturas, rrss, superAdmin],
  );
  const porSeccion = useMemo(() => sinLeerPorSeccion(avisos), [avisos]);

  const abrir = (n: NotificacionDashboard, ruta: string) => {
    void marcarLeida(n.id);
    navigate(ruta);
  };

  return (
    <Card className="flex h-full flex-col" data-testid="widget-avisos">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 space-y-0 px-4 py-2.5 sm:px-5">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Avisos
        </CardTitle>
        <Link to="/avisos" className={cn("inline-flex min-h-8 items-center gap-1 px-1 text-xs font-medium text-primary hover:underline", FOCO)}>
          Ver todos <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
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
                  <li key={seccion} className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    {ETIQUETA_SECCION_AVISO[seccion]} · {n}
                  </li>
                ))}
              </ul>
            )}
            <ul aria-label="Últimos avisos" className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto overscroll-contain pr-1">
              {avisos.slice(0, MAX_FILAS).map((n) => {
                const Icono = TIPO_ICON[n.tipo] || Info;
                const ruta = rutaDeAviso(n);
                const contenido = (
                  <>
                    <Icono className={cn("mt-0.5 h-4 w-4 shrink-0", n.leida ? "text-muted-foreground" : "text-destructive")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", !n.leida && "font-medium")}>{n.titulo}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {ETIQUETA_SECCION_AVISO[seccionDeAviso(n)]} · {cuando(n.created_at)}
                        {n.leida ? " · Leído" : ""}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={n.id}>
                    {ruta ? (
                      <button
                        type="button"
                        onClick={() => abrir(n, ruta)}
                        className={cn("flex w-full items-start gap-2 py-1.5 text-left hover:bg-muted/50", FOCO)}
                        aria-label={`Abrir: ${n.titulo}`}
                      >
                        {contenido}
                      </button>
                    ) : (
                      <div className="flex items-start gap-2 py-1.5">{contenido}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
