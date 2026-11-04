import { useState, type ReactNode } from "react";
import { Coins, EyeOff, ListChecks, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type ConfigServicios, useBorrarServicio, useGuardarServicio } from "@/hooks/useServicios";
import { type ServicioContratado, TEXTO_CATEGORIA, textoPrecio } from "@/lib/servicios";
import { Bloque } from "./Bloque";
import { TipoCambio } from "./TipoCambio";

interface Props {
  enUso: ServicioContratado[];
  quitados: ServicioContratado[];
  /** false si falta 20261103160000: sin «Lo usamos», categorías ni altas. */
  costes: boolean;
  config: ConfigServicios | null;
  onEditar: (s: ServicioContratado) => void;
  onAnadir: () => void;
}

function FilaServicio({ s, children }: { s: ServicioContratado; children: ReactNode }) {
  const categoria = TEXTO_CATEGORIA[s.categoria] ?? null;
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4" data-servicio={s.proveedor}>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-words text-sm font-medium text-foreground">{s.nombre}</span>
          {categoria && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{categoria}</span>}
          {s.por_confirmar && (
            <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
              Por confirmar
            </span>
          )}
        </p>
        <p className="break-words text-xs text-muted-foreground">
          Plan {s.plan || "sin dato"} · {textoPrecio(s)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
    </li>
  );
}

/**
 * Super Admin › Servicios › Configurar: qué servicios salen en el panel.
 *   · Añadir uno nuevo (diálogo de edición vacío; la clave sale del nombre).
 *   · Quitar (= «no lo usamos»: no se lee ni suma al coste; no se borra y se
 *     puede volver a poner, con «Deshacer» en el aviso).
 *   · Borrar del todo, solo lo ya quitado y con confirmación (se van también
 *     sus lecturas).
 *   · Editar plan, precio, renovación, límites… (el mismo diálogo de siempre).
 * Y el tipo de cambio del dólar, que pasa a euros todos los precios en US$.
 */
export function PestanaConfigurar({ enUso, quitados, costes, config, onEditar, onAnadir }: Props) {
  const guardar = useGuardarServicio();
  const borrar = useBorrarServicio();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<ServicioContratado | null>(null);

  const cambiarUso = async (s: ServicioContratado, activo: boolean, deshacer = true) => {
    setOcupado(s.proveedor);
    try {
      await guardar.mutateAsync({ proveedor: s.proveedor, cambios: { activo }, costes });
      const texto = activo ? `${s.nombre} vuelve a estar en uso` : `${s.nombre} quitado: ya no se lee ni suma al coste`;
      if (deshacer) toast.success(texto, { action: { label: "Deshacer", onClick: () => void cambiarUso(s, !activo, false) } });
      else toast.success(texto);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el cambio.");
    } finally {
      setOcupado(null);
    }
  };

  const confirmarBorrado = async () => {
    const s = aBorrar;
    if (!s) return;
    setOcupado(s.proveedor);
    try {
      await borrar.mutateAsync(s.proveedor);
      toast.success(`${s.nombre}: borrado`);
      setABorrar(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo borrar el servicio.");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      <Bloque
        id="configurar-servicios"
        icono={<ListChecks />}
        titulo="Servicios del panel"
        descripcion="Añade lo que contratéis, quita lo que ya no uséis (no se borra: lo puedes volver a poner) y edita su plan, precio, renovación y límites."
        acciones={
          costes && (
            <Button type="button" className="gap-1.5" onClick={onAnadir}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Añadir servicio
            </Button>
          )
        }
      >
        <div className="flex min-w-0 flex-col gap-2">
          <h3 id="configurar-en-uso" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">En uso ({enUso.length})</h3>
          {enUso.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguno. Añade uno o vuelve a poner alguno de los quitados.</p>
          ) : (
            <ul className="min-w-0 divide-y divide-border/60" aria-labelledby="configurar-en-uso">
              {enUso.map((s) => (
                <FilaServicio key={s.proveedor} s={s}>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onEditar(s)} aria-label={`Editar ${s.nombre}`}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Editar
                  </Button>
                  {costes && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={ocupado === s.proveedor}
                      onClick={() => void cambiarUso(s, false)}
                      aria-label={`Quitar ${s.nombre} del panel`}
                    >
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                      Quitar
                    </Button>
                  )}
                </FilaServicio>
              ))}
            </ul>
          )}
        </div>

        {quitados.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2 border-t pt-3">
            <div className="min-w-0">
              <h3 id="configurar-quitados" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quitados ({quitados.length})</h3>
              <p className="text-xs text-muted-foreground">No se leen ni suman al coste. «Borrar» los quita para siempre.</p>
            </div>
            <ul className="min-w-0 divide-y divide-border/60" aria-labelledby="configurar-quitados">
              {quitados.map((s) => (
                <FilaServicio key={s.proveedor} s={s}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={ocupado === s.proveedor}
                    onClick={() => void cambiarUso(s, true)}
                    aria-label={`Volver a usar ${s.nombre}`}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Volver a usar
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => onEditar(s)} aria-label={`Editar ${s.nombre}`}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={ocupado === s.proveedor}
                    onClick={() => setABorrar(s)}
                    aria-label={`Borrar ${s.nombre} del todo`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Borrar
                  </Button>
                </FilaServicio>
              ))}
            </ul>
          </div>
        )}
      </Bloque>

      <Bloque
        id="configurar-cambio"
        icono={<Coins />}
        titulo="Tipo de cambio del dólar"
        descripcion="Con él se pasan a euros los precios y gastos en dólares (Vercel, OpenAI, Vapi…)."
      >
        <TipoCambio config={config} editable={costes && !!config?.guardada} />
      </Bloque>

      <AlertDialog open={!!aBorrar} onOpenChange={(abierto) => { if (!abierto && !borrar.isPending) setABorrar(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {aBorrar?.nombre} del todo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran su ficha (plan, precio, límites y notas) y sus lecturas de consumo. No se puede deshacer. Si solo no lo usáis, basta con dejarlo quitado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={borrar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={borrar.isPending}
              onClick={(e) => {
                // Se cierra al terminar (o se queda abierto si falla).
                e.preventDefault();
                void confirmarBorrado();
              }}
            >
              Borrar del todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
