import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleOff, Info, LayoutDashboard, Loader2, Lock } from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { haceCuanto } from "@/lib/servicios";
import { GRUPOS_MODULOS, MODULOS_PANEL, type ModuloPanel } from "@/lib/modulosPanel";
import { cn } from "@/lib/utils";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_CONTROL = 360;

/**
 * Control del Panel (14/11/2026, «hay muchos módulos que no aparecen en el control del panel»): TODOS los
 * módulos del Admin Panel salen del catálogo (`lib/modulosPanel.ts`), agrupados y en el orden del menú,
 * tengan o no fila en `admin_feature_toggles`. Sin fila, está activado; la fila se crea al primer cambio.
 * Los que no se pueden apagar (Dashboard, Ayuda, Avisos, Mi cuenta) salen como «Siempre activo».
 */
function TarjetaModulo({
  modulo,
  activo,
  ultimoCambio,
  guardando,
  onCambiar,
}: {
  modulo: ModuloPanel;
  activo: boolean;
  ultimoCambio: string | null;
  guardando: boolean;
  onCambiar: (activo: boolean) => void;
}) {
  const Icono = modulo.icono;
  const idInterruptor = `toggle-${modulo.clave}`;
  const idEstado = `estado-${modulo.clave}`;
  const siempre = !modulo.desactivable;
  const estado = siempre ? "Siempre activo" : activo ? "Activado · lo ve el equipo" : "Desactivado · oculto para el equipo";
  return (
    <li
      data-testid={`funcionalidad-${modulo.clave}`}
      data-activa={activo}
      data-desactivable={modulo.desactivable}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border p-4 shadow-sm transition-colors",
        activo ? "border-border bg-card" : "border-dashed bg-muted/40",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
            siempre
              ? "bg-muted text-foreground/70"
              : activo
                ? "bg-status-confirmed/10 text-status-confirmed"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Icono className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          {siempre ? (
            <h4 className="text-base font-semibold leading-snug">{modulo.nombre}</h4>
          ) : (
            // La etiqueta ocupa el texto: tocar el nombre también cambia el interruptor (como antes).
            <Label htmlFor={idInterruptor} className="block cursor-pointer text-base font-semibold leading-snug">
              {modulo.nombre}
            </Label>
          )}
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{modulo.descripcion}</p>
        </div>
        {!siempre && (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {guardando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
            <Switch
              id={idInterruptor}
              checked={activo}
              disabled={guardando}
              aria-describedby={idEstado}
              className="data-[state=checked]:bg-status-confirmed"
              onCheckedChange={onCambiar}
            />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-xs">
        <span
          id={idEstado}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
            siempre
              ? "bg-muted text-foreground/70"
              : activo
                ? "bg-status-confirmed/10 text-status-confirmed"
                : "bg-muted text-muted-foreground",
          )}
        >
          {siempre ? (
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          ) : activo ? (
            <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {estado}
        </span>
        {siempre && modulo.motivoSiempreActivo && (
          <span className="min-w-0 text-muted-foreground">{modulo.motivoSiempreActivo}</span>
        )}
        {!siempre && ultimoCambio && (
          <span className="text-muted-foreground" title={new Date(ultimoCambio).toLocaleString("es-ES")}>
            Último cambio {haceCuanto(ultimoCambio)}
          </span>
        )}
      </div>
    </li>
  );
}

export default function SuperAdminPanel() {
  const { toggles, loading, isEnabled, setEnabled, refetch } = useAdminFeatureToggles();
  const [guardando, setGuardando] = useState<string | null>(null);
  // Alto de la pantalla (regla del dueño, 2026-10-07): el bloque mide justo lo
  // que queda bajo la cabecera del layout y es él quien hace scroll, no la
  // página. Sin medida (jsdom, primer pintado) cae al layout de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_CONTROL);

  // Al abrir Control del Panel se vuelve a preguntar (otro super admin puede haber cambiado algo).
  useEffect(() => {
    void refetch?.();
  }, [refetch]);

  const fechaDe = useMemo(() => {
    const fechas = new Map<string, string>();
    for (const t of toggles) if (t.updated_at) fechas.set(t.section_key, t.updated_at);
    return fechas;
  }, [toggles]);

  const desactivables = MODULOS_PANEL.filter((m) => m.desactivable);
  const activos = desactivables.filter((m) => isEnabled(m.clave)).length;
  const desactivados = desactivables.length - activos;
  const fechas = desactivables.map((m) => fechaDe.get(m.clave)).filter((f): f is string => !!f).sort();
  const ultimoCambio = fechas.length ? fechas[fechas.length - 1] : null;

  const cambiar = async (modulo: ModuloPanel, activo: boolean) => {
    setGuardando(modulo.clave);
    try {
      await setEnabled(modulo.clave, modulo.nombre, activo);
    } finally {
      setGuardando(null);
    }
  };

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        className="flex min-w-0 flex-col gap-5 overflow-y-auto overscroll-contain"
        style={alto ? { height: alto } : undefined}
      >
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive sm:size-12"
            >
              <LayoutDashboard className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight text-foreground">Control del Panel</h1>
              <p className="text-sm text-muted-foreground">Qué módulos del Admin Panel puede usar el equipo.</p>
            </div>
          </div>
          {!loading && (
            <TiraCifras
              data-testid="resumen-control"
              className="w-full sm:w-auto"
              cifras={[
                { etiqueta: "Activados", valor: activos, detalle: `de ${desactivables.length}` },
                { etiqueta: "Desactivados", valor: desactivados, tono: desactivados > 0 ? "ambar" : undefined },
                { etiqueta: "Último cambio", valor: <span className="text-base">{ultimoCambio ? haceCuanto(ultimoCambio) : "—"}</span> },
              ]}
            />
          )}
        </header>

        {/* 2026-10-10: la tarjeta «Funcionalidades exclusivas de Super Admin» (9 enlaces) se quitó: repetía el menú
            lateral, que ya lleva a todas esas páginas. */}
        <section aria-labelledby="titulo-funcionalidades" className="flex min-w-0 flex-col gap-4 pb-2">
          <div className="min-w-0">
            <h2 id="titulo-funcionalidades" className="text-base font-semibold leading-tight">
              Módulos del Admin Panel
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Al desactivar un módulo, desaparece del menú del equipo (administradores, managers y staff) y no se
                puede abrir ni con su dirección. Tú lo sigues viendo, marcado «Desactivado para el equipo».
              </span>
            </p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              Cargando los módulos…
            </div>
          ) : (
            GRUPOS_MODULOS.map((grupo) => {
              const modulos = MODULOS_PANEL.filter((m) => m.grupo === grupo.id);
              if (modulos.length === 0) return null;
              const idTitulo = `grupo-modulos-${grupo.id}`;
              return (
                <div key={grupo.id} className="flex min-w-0 flex-col gap-2">
                  <h3 id={idTitulo} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {grupo.titulo}
                  </h3>
                  <ul aria-labelledby={idTitulo} className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {modulos.map((modulo) => (
                      <TarjetaModulo
                        key={modulo.clave}
                        modulo={modulo}
                        activo={!modulo.desactivable || isEnabled(modulo.clave)}
                        ultimoCambio={fechaDe.get(modulo.clave) ?? null}
                        guardando={guardando === modulo.clave}
                        onCambiar={(activo) => void cambiar(modulo, activo)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      </div>
    </SuperAdminLayout>
  );
}
