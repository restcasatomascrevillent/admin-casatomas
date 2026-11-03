import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import {
  CircleCheck,
  CircleOff,
  Gift,
  Globe,
  Info,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  Megaphone,
  Receipt,
  Shield,
  UtensilsCrossed,
} from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { useAdminFeatureToggles, type AdminFeatureToggle } from "@/hooks/useAdminFeatureToggles";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { haceCuanto } from "@/lib/servicios";
import { cn } from "@/lib/utils";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_CONTROL = 360;

type Icono = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Cómo se presenta cada interruptor: mismo icono y orden que en el menú del
 * Admin Panel (AppSidebar.tsx) y una línea con lo que esconde. Una clave nueva sin
 * entrada aquí sale al final, con un icono genérico y sin descripción.
 */
const SECCIONES: Record<string, { icono: Icono; descripcion: string }> = {
  reservas: { icono: UtensilsCrossed, descripcion: "Libro de reservas, mesas, llegadas y calendario." },
  gestion_web: { icono: Globe, descripcion: "Carta, novedades, menús y tapas de la web." },
  marketing: { icono: Megaphone, descripcion: "Envíos de la newsletter y sus suscriptores." },
  cheques: { icono: Gift, descripcion: "Venta, consulta y canje de cheques regalo." },
  facturas: { icono: Receipt, descripcion: "Facturas de proveedores y su lectura automática." },
  usuarios: { icono: Shield, descripcion: "Consulta de usuarios y permisos (solo administradores)." },
};
const ORDEN = Object.keys(SECCIONES);
const posicion = (clave: string) => (ORDEN.includes(clave) ? ORDEN.indexOf(clave) : ORDEN.length);

function TarjetaFuncionalidad({
  toggle,
  activa,
  guardando,
  onCambiar,
}: {
  toggle: AdminFeatureToggle;
  activa: boolean;
  guardando: boolean;
  onCambiar: (activa: boolean) => void;
}) {
  const info = SECCIONES[toggle.section_key];
  const Icono = info?.icono ?? LayoutGrid;
  const idInterruptor = `toggle-${toggle.section_key}`;
  const idEstado = `estado-${toggle.section_key}`;
  return (
    <li
      data-testid={`funcionalidad-${toggle.section_key}`}
      data-activa={activa}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border p-4 shadow-sm transition-colors",
        activa ? "border-border bg-card" : "border-dashed bg-muted/40",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
            activa ? "bg-status-confirmed/10 text-status-confirmed" : "bg-muted text-muted-foreground",
          )}
        >
          <Icono className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          {/* La etiqueta ocupa el texto: tocar el nombre también cambia el interruptor (como antes). */}
          <Label htmlFor={idInterruptor} className="block cursor-pointer text-base font-semibold leading-snug">
            {toggle.label}
          </Label>
          {info?.descripcion && <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{info.descripcion}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {guardando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
          <Switch
            id={idInterruptor}
            checked={activa}
            disabled={guardando}
            aria-describedby={idEstado}
            className="data-[state=checked]:bg-status-confirmed"
            onCheckedChange={onCambiar}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-xs">
        <span
          id={idEstado}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
            activa ? "bg-status-confirmed/10 text-status-confirmed" : "bg-muted text-muted-foreground",
          )}
        >
          {activa ? <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />}
          {activa ? "Activa · se ve en el menú" : "Desactivada · oculta para todos"}
        </span>
        {toggle.updated_at && (
          <span className="text-muted-foreground" title={new Date(toggle.updated_at).toLocaleString("es-ES")}>
            Cambiada {haceCuanto(toggle.updated_at)}
          </span>
        )}
      </div>
    </li>
  );
}

export default function SuperAdminPanel() {
  const { toggles, loading, isEnabled, setEnabled } = useAdminFeatureToggles();
  const [guardando, setGuardando] = useState<string | null>(null);
  // Alto de la pantalla (regla del dueño, 2026-10-07): el bloque mide justo lo
  // que queda bajo la cabecera del layout y es él quien hace scroll, no la
  // página. Sin medida (jsdom, primer pintado) cae al layout de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_CONTROL);

  const lista = useMemo(
    () => [...toggles].sort((a, b) => posicion(a.section_key) - posicion(b.section_key) || a.label.localeCompare(b.label, "es")),
    [toggles],
  );
  const activas = lista.filter((t) => isEnabled(t.section_key)).length;
  const desactivadas = lista.length - activas;
  const fechas = lista.map((t) => t.updated_at).filter((f): f is string => !!f).sort();
  const ultimoCambio = fechas.length ? fechas[fechas.length - 1] : null;

  const cambiar = async (toggle: AdminFeatureToggle, activa: boolean) => {
    setGuardando(toggle.section_key);
    try {
      await setEnabled(toggle.section_key, toggle.label, activa);
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
              <p className="text-sm text-muted-foreground">Qué secciones del Admin Panel puede usar el equipo.</p>
            </div>
          </div>
          {!loading && lista.length > 0 && (
            <TiraCifras
              data-testid="resumen-control"
              className="w-full sm:w-auto"
              cifras={[
                { etiqueta: "Activas", valor: activas, detalle: `de ${lista.length}` },
                { etiqueta: "Desactivadas", valor: desactivadas, tono: desactivadas > 0 ? "ambar" : undefined },
                { etiqueta: "Último cambio", valor: <span className="text-base">{ultimoCambio ? haceCuanto(ultimoCambio) : "—"}</span> },
              ]}
            />
          )}
        </header>

        {/* 2026-10-10: la tarjeta «Funcionalidades exclusivas de Super Admin» (9 enlaces) se quitó: repetía el menú
            lateral, que ya lleva a todas esas páginas. */}
        <section aria-labelledby="titulo-funcionalidades" className="flex min-w-0 flex-col gap-3">
          <div className="min-w-0">
            <h2 id="titulo-funcionalidades" className="text-base font-semibold leading-tight">
              Funcionalidades del Admin Panel
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Al desactivar una funcionalidad, desaparece de la barra lateral para todos los usuarios
                (administradores, managers y staff) hasta que la vuelvas a activar.
              </span>
            </p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              Cargando las funcionalidades…
            </div>
          ) : lista.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay funcionalidades configurables. Todas las secciones se ven en el menú.
            </p>
          ) : (
            <ul aria-label="Funcionalidades del Admin Panel" className="grid min-w-0 grid-cols-1 gap-3 pb-2 md:grid-cols-2 xl:grid-cols-3">
              {lista.map((toggle) => (
                <TarjetaFuncionalidad
                  key={toggle.section_key}
                  toggle={toggle}
                  activa={isEnabled(toggle.section_key)}
                  guardando={guardando === toggle.section_key}
                  onCambiar={(activa) => void cambiar(toggle, activa)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </SuperAdminLayout>
  );
}
