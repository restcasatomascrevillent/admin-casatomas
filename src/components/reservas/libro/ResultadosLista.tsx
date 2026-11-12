import { useMemo, type ReactNode } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { agruparPorDia, type ReservaEncontrada } from "@/hooks/useBusquedaReservas";
import { tituloHoja } from "@/lib/reservas/libroReservas";
import { RenglonReserva } from "./RenglonReserva";

// ============================================================================
// Resultados de la Lista cuando no se mira un día: lo encontrado por el buscador
// (todo el histórico) o «Pendientes» / el estado que trae un aviso. Agrupado por
// día, con «Ver el día» para saltar a esa hoja. Tocar un renglón abre la ficha.
// ============================================================================

interface Props {
  titulo: ReactNode;
  reservas: ReservaEncontrada[] | undefined;
  cargando: boolean;
  error: boolean;
  onReintentar: () => void;
  vacio: string;
  /** Pie (p. ej. «Se enseñan las 100 más recientes»). */
  nota?: string | null;
  conTelefono?: boolean;
  onAbrir: (id: string) => void;
  /** «Ver el día» de cada grupo. Sin él (móvil, que no cambia de día) el botón no sale. */
  onVerDia?: (fecha: string) => void;
  /** Sin la tarjeta ni el título (dentro de un diálogo que ya lo pone, p. ej. «Pendientes» de la pestaña Reservas). */
  sinMarco?: boolean;
  /**
   * «Verificar» en cada fila pendiente (12/11/2026, petición del dueño: «que haya un botón de verificar en cada fila
   * cuando pulsas Pendientes»). La misma acción que en la ficha (correo al cliente y aviso). Solo con permiso de editar.
   */
  conVerificar?: boolean;
}

export function ResultadosLista({ titulo, reservas, cargando, error, onReintentar, vacio, nota, conTelefono, onAbrir, onVerDia, sinMarco = false, conVerificar = false }: Props) {
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { aceptar, estaEnCurso } = useAccionesServicioReserva();
  const verificar = conVerificar && puedeEditar;
  const { data: espacios } = useEspaciosReserva();
  const nombreSala = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of (espacios ?? []) as Array<{ id: string; nombre: string }>) m.set(e.id, e.nombre);
    return m;
  }, [espacios]);
  const grupos = useMemo(() => agruparPorDia(reservas ?? []), [reservas]);

  let cuerpo: ReactNode;
  if (cargando) cuerpo = <Skeleton className="h-24 w-full" />;
  else if (error) {
    cuerpo = (
      <p role="alert" className="text-sm text-red-700">
        No se pudo buscar.{" "}
        <button type="button" className="underline" onClick={onReintentar}>
          Reintentar
        </button>
      </p>
    );
  } else if (!grupos.length) cuerpo = <p className="py-4 text-base text-muted-foreground">{vacio}</p>;
  else {
    cuerpo = (
      <div className="space-y-4">
        {grupos.map((g) => (
          <section key={g.fecha} aria-label={tituloHoja(g.fecha)}>
            <div className="mb-1 flex items-center gap-2 rounded-md bg-muted py-1 pl-3 pr-1">
              <h3 className="mr-auto text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {tituloHoja(g.fecha)} · {g.reservas.length} {g.reservas.length === 1 ? "reserva" : "reservas"}
              </h3>
              {onVerDia && (
                <Button type="button" variant="ghost" size="sm" className="h-11 gap-1 text-sm" onClick={() => onVerDia(g.fecha)}>
                  Ver el día <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
            <ul>
              {g.reservas.map((r) => (
                <RenglonReserva
                  key={r.id}
                  reserva={r}
                  sala={r.espacio_id ? nombreSala.get(r.espacio_id) : null}
                  conTelefono={conTelefono}
                  onAbrir={onAbrir}
                  sinEstado={verificar}
                  accion={
                    verificar && r.estado === "pendiente" ? (
                      <Button
                        type="button"
                        className="h-11 shrink-0 gap-1.5 bg-emerald-600 px-3 font-semibold text-white hover:bg-emerald-700"
                        disabled={estaEnCurso(r.id)}
                        onClick={() => void aceptar(r as unknown as Parameters<typeof aceptar>[0])}
                        aria-label={`Verificar la reserva de ${r.nombre || "Sin nombre"}`}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Verificar
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          </section>
        ))}
        {nota ? <p className="text-sm text-muted-foreground">{nota}</p> : null}
      </div>
    );
  }

  if (sinMarco) return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="resultados-scroll">{cuerpo}</div>;

  return (
    <article aria-label="Resultados" className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <h2 className="text-xl font-semibold sm:text-2xl">{titulo}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5" data-testid="resultados-scroll">
        {cuerpo}
      </div>
    </article>
  );
}
