import { useEffect, useMemo, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2 } from "lucide-react";
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
    <form onSubmit={(e) => void enviar(e)} className="flex max-w-3xl flex-col gap-5" noValidate>
      <fieldset disabled={!puedeEditar || guardar.isPending} className="flex flex-col gap-5">
        <legend className="sr-only">Ajustes de la tienda</legend>

        <div className="flex flex-col gap-2">
          <Label htmlFor="tienda-descuento">Descuento sobre el precio de carta (%)</Label>
          <Input
            id="tienda-descuento"
            inputMode="decimal"
            value={form.descuento}
            onChange={(e) => cambiar("descuento", e.target.value)}
            aria-invalid={!!errores.descuento}
            aria-describedby="tienda-descuento-ayuda"
            className="h-11 max-w-40"
          />
          <p id="tienda-descuento-ayuda" className={errores.descuento ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
            {errores.descuento ?? `Entre ${LIMITES_TIENDA.descuentoMin} y ${LIMITES_TIENDA.descuentoMax} %. Por defecto, 30 %. La web enseña solo el precio de tienda; el descuento no se menciona.`}
          </p>
        </div>

        <section aria-labelledby="tienda-vista-previa" className="rounded-xl border bg-muted/30 p-4">
          <h3 id="tienda-vista-previa" className="text-sm font-semibold">Así quedan los precios</h3>
          {descuentoVista === null ? (
            <p className="mt-1 text-sm text-muted-foreground">Escribe un descuento válido para ver la vista previa.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm tabular-nums" aria-live="polite">
              {ejemplos.map((p) => (
                <li key={p} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-muted-foreground">Carta {euro(p)}</span>
                  <span aria-hidden="true">→</span>
                  <span className="font-semibold">Tienda {euro(precioTienda(p, descuentoVista))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

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
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Para cambiar los ajustes necesitas el permiso «Puede editar» de Tienda.</p>
        )}
        {config.updated_at && (
          <p className="text-xs text-muted-foreground sm:ml-auto">
            Último cambio: {format(new Date(config.updated_at), "d MMM yyyy, HH:mm", { locale: es })}
          </p>
        )}
      </div>
    </form>
  );
}
