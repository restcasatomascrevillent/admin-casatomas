import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, Megaphone, Percent, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useGuardarAjustesTienda, useVinosTienda } from "@/hooks/useTienda";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import {
  type ConfiguracionTienda,
  type FormularioAjustesTienda,
  LIMITES_TIENDA,
  ejemplosPrecio,
  euro,
  formularioDesdeConfiguracion,
  precioTienda,
  validarAjustes,
} from "@/lib/tienda";
import { cn } from "@/lib/utils";

interface Props {
  config: ConfiguracionTienda;
  puedeEditar: boolean;
}

type Errores = Partial<Record<keyof FormularioAjustesTienda, string>>;

/**
 * Tienda › Ajustes: % de descuento (con ejemplos) y los textos de la web. Si la
 * tienda sale o no en la web va arriba de la página, en el interruptor «Visible
 * en la web» (`InterruptorTiendaWeb`, se guarda al momento): este formulario ya
 * no envía `activa`, para no deshacer lo que se cambie allí.
 *
 * Dos tarjetas (10/11/2026, repaso de estética): «Precio de tienda» (el % con
 * la vista previa al lado desde 640 px) y «Textos de la web» (aviso y cómo
 * comprar). Debajo, la barra de guardar, pegada abajo mientras hay cambios sin guardar.
 */
export function AjustesTienda({ config, puedeEditar }: Props) {
  const guardar = useGuardarAjustesTienda();
  const vinos = useVinosTienda();
  const [form, setForm] = useState<FormularioAjustesTienda>(() => formularioDesdeConfiguracion(config));
  const [errores, setErrores] = useState<Errores>({});
  const original = useMemo(() => formularioDesdeConfiguracion(config), [config]);
  const cambiado = JSON.stringify(form) !== JSON.stringify(original);

  // Si otra persona guarda (o se recarga) y aquí no hay cambios a medias, se ve lo último.
  useEffect(() => {
    if (!cambiado) setForm(original);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original]);

  const cambiar = <K extends keyof FormularioAjustesTienda>(k: K, v: FormularioAjustesTienda[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrores((e) => ({ ...e, [k]: undefined }));
  };

  const validacion = validarAjustes(form);
  const descuentoVista = "cambios" in validacion ? validacion.cambios.descuento_pct : null;
  const ejemplos = useMemo(() => ejemplosPrecio(vinos.data ?? []), [vinos.data]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!puedeEditar || guardar.isPending) return;
    const r = validarAjustes(form);
    if ("errores" in r) {
      setErrores(r.errores);
      toast.error("Revisa los campos marcados.");
      return;
    }
    try {
      const nueva = await guardar.mutateAsync(r.cambios);
      setForm(formularioDesdeConfiguracion(nueva));
      toast.success(nueva.activa ? "Ajustes de la tienda guardados" : "Ajustes guardados: la tienda está oculta en la web");
    } catch (err) {
      toast.error("No se pudieron guardar los ajustes", { description: mensajeUsuario(err) });
    }
  };

  const contador = (texto: string) => `${texto.trim().length}/${LIMITES_TIENDA.texto}`;

  return (
    <form onSubmit={(e) => void enviar(e)} className="flex max-w-4xl flex-col gap-4 pb-1" noValidate>
      <fieldset disabled={!puedeEditar || guardar.isPending} className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Ajustes de la tienda</legend>

        <Tarjeta icono={Percent} titulo="Precio de tienda" descripcion="El descuento se aplica a todos los vinos a la venta.">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tienda-descuento">Descuento sobre el precio de carta (%)</Label>
              <Input
                id="tienda-descuento"
                inputMode="decimal"
                value={form.descuento}
                onChange={(e) => cambiar("descuento", e.target.value)}
                aria-invalid={!!errores.descuento}
                aria-describedby="tienda-descuento-ayuda"
                className="h-11 max-w-40 text-base tabular-nums"
              />
              <p id="tienda-descuento-ayuda" className={errores.descuento ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
                {errores.descuento ?? `Entre ${LIMITES_TIENDA.descuentoMin} y ${LIMITES_TIENDA.descuentoMax} %. Por defecto, 30 %. La web enseña solo el precio de tienda; el descuento no se menciona.`}
              </p>
            </div>

            <section aria-labelledby="tienda-vista-previa" className="rounded-lg border bg-muted/30 p-3">
              <h4 id="tienda-vista-previa" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Así quedan los precios</h4>
              {descuentoVista === null ? (
                <p className="mt-2 text-sm text-muted-foreground">Escribe un descuento válido para ver la vista previa.</p>
              ) : (
                <ul className="mt-2 flex flex-col divide-y text-sm tabular-nums" aria-live="polite">
                  {ejemplos.map((p) => (
                    <li key={p} className="flex items-baseline justify-between gap-3 py-1.5">
                      <span className="text-muted-foreground">Carta {euro(p)}</span>
                      <span aria-hidden="true" className="text-muted-foreground/60">→</span>
                      <span className="font-semibold">Tienda {euro(precioTienda(p, descuentoVista))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Tarjeta>

        <Tarjeta icono={Megaphone} titulo="Textos de la web" descripcion="Salen en la página Tienda de la web. Se compra en el restaurante, no por internet.">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="tienda-aviso">Aviso para la web</Label>
                <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">{contador(form.aviso)}</span>
              </div>
              <Textarea
                id="tienda-aviso"
                rows={3}
                maxLength={LIMITES_TIENDA.texto}
                value={form.aviso}
                onChange={(e) => cambiar("aviso", e.target.value)}
                aria-invalid={!!errores.aviso}
                aria-describedby="tienda-aviso-ayuda"
                placeholder="Ej.: Del 1 al 15 de diciembre, 30 % en todos nuestros vinos."
              />
              <p id="tienda-aviso-ayuda" className={errores.aviso ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
                {errores.aviso ?? "Sale arriba en la tienda de la web. Déjalo vacío si no hace falta."}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="tienda-recogida">Cómo comprar en el restaurante</Label>
                <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">{contador(form.recogida)}</span>
              </div>
              <Textarea
                id="tienda-recogida"
                rows={3}
                maxLength={LIMITES_TIENDA.texto}
                value={form.recogida}
                onChange={(e) => cambiar("recogida", e.target.value)}
                aria-invalid={!!errores.recogida}
                aria-describedby="tienda-recogida-ayuda"
                placeholder="Ej.: Pregunta en la barra, de martes a domingo de 12:00 a 16:00. También por teléfono para tenerlos preparados."
              />
              <p id="tienda-recogida-ayuda" className={errores.recogida ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
                {errores.recogida ?? "Horario, dónde preguntar… Sale en la tienda de la web."}
              </p>
            </div>
          </div>
        </Tarjeta>
      </fieldset>

      {/* Barra de guardar: con cambios a medias se pega abajo de la pestaña (que hace scroll por dentro) para no perderla de vista. */}
      <div
        data-testid="barra-guardar-tienda"
        className={cn(
          "flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center",
          cambiado && "sticky bottom-0 z-10 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80",
        )}
      >
        {puedeEditar ? (
          <>
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={!cambiado || guardar.isPending}>
              {guardar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Guardar ajustes
            </Button>
            {cambiado && (
              <Button type="button" variant="ghost" className="h-11 w-full sm:w-auto" disabled={guardar.isPending} onClick={() => { setForm(original); setErrores({}); }}>
                Descartar cambios
              </Button>
            )}
            {cambiado && <span className="text-xs font-medium text-amber-700 dark:text-amber-300 sm:hidden">Hay cambios sin guardar</span>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Para cambiar los ajustes necesitas el permiso «Puede editar» de Tienda.</p>
        )}
        {config.updated_at && (
          <p className="text-xs text-muted-foreground sm:ml-auto">
            {cambiado && <span className="mr-2 hidden font-medium text-amber-700 dark:text-amber-300 sm:inline">Hay cambios sin guardar ·</span>}
            Último cambio: {format(new Date(config.updated_at), "d MMM yyyy, HH:mm", { locale: es })}
          </p>
        )}
      </div>
    </form>
  );
}

/** Tarjeta de un grupo de ajustes: icono, título y una línea de explicación encima de los campos. */
function Tarjeta({ icono: Icono, titulo, descripcion, children }: { icono: LucideIcon; titulo: string; descripcion: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
          <Icono className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{titulo}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{descripcion}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
