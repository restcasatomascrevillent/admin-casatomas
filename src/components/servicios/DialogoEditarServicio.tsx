import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCrearServicio, useGuardarServicio } from "@/hooks/useServicios";
import { type BorradorServicio, CATEGORIAS, type ServicioContratado, borradorDe, cambiosDeBorrador, proveedorDeNombre } from "@/lib/servicios";

interface Props {
  servicio: ServicioContratado | null;
  onCerrar: () => void;
  /** false si falta 20261103160000: no se enseñan los campos nuevos. */
  costes?: boolean;
  /**
   * Alta (Configurar › «Añadir servicio»): `servicio` es una ficha vacía
   * (`servicioNuevo`) y al guardar se da de alta con una clave sacada del
   * nombre que no choque con `existentes`.
   */
  nuevo?: boolean;
  existentes?: string[];
}

function MensajeError({ id, texto }: { id: string; texto?: string }) {
  return texto ? <p id={id} className="text-xs text-destructive">{texto}</p> : null;
}

/**
 * Edición (o alta, con `nuevo`) de plan, precio, renovación, cuenta, enlaces,
 * categoría, «lo usamos», notas y límites del plan.
 */
export function DialogoEditarServicio({ servicio, onCerrar, costes = true, nuevo = false, existentes = [] }: Props) {
  const [b, setB] = useState<BorradorServicio | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const guardar = useGuardarServicio();
  const crear = useCrearServicio();
  const ocupado = guardar.isPending || crear.isPending;

  useEffect(() => {
    setB(servicio ? borradorDe(servicio) : null);
    setErrores({});
  }, [servicio]);

  if (!servicio || !b) return null;
  const id = (campo: string) => `servicio-${servicio.proveedor}-${campo}`;
  const cambiar = (campo: keyof BorradorServicio, valor: string | boolean) => setB((x) => (x ? { ...x, [campo]: valor } : x));
  const anual = b.ciclo === "anual";
  const cambiarLimite = (clave: string, campo: "limite" | "unidad", valor: string) =>
    setB((x) => (x ? { ...x, limites: { ...x.limites, [clave]: { ...x.limites[clave], [campo]: valor } } } : x));
  const limites = Object.entries(servicio.limites ?? {}).sort(([, x], [, y]) => (x.orden ?? 99) - (y.orden ?? 99));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = cambiosDeBorrador(b, servicio);
    // `in` y no `!r.ok`: sin strictNullChecks TS no estrecha la rama `false`.
    if ("errores" in r) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    try {
      if (nuevo) {
        await crear.mutateAsync({ proveedor: proveedorDeNombre(r.cambios.nombre, existentes), ...r.cambios });
        toast.success(`${r.cambios.nombre}: añadido`);
      } else {
        await guardar.mutateAsync({ proveedor: servicio.proveedor, cambios: r.cambios, costes });
        toast.success(`${r.cambios.nombre}: cambios guardados`);
      }
      onCerrar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los cambios.");
    }
  };

  return (
    <Dialog open onOpenChange={(abierto) => { if (!abierto) onCerrar(); }}>
      <DialogContent className="max-w-[calc(100vw-1rem)] p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle>{nuevo ? "Añadir un servicio" : `Editar ${servicio.nombre}`}</DialogTitle>
          <DialogDescription>
            {nuevo
              ? "Lo que sepas del plan: el nombre basta y lo demás se puede completar luego. Su consumo no se lee solo: se mira en el panel del proveedor."
              : "Plan, precio y límites del plan. Los límites son los que se usan para calcular el % de consumo; déjalos vacíos si no los sabes."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="flex min-w-0 flex-col gap-4" noValidate>
          {costes && (
            <div className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
              {!nuevo && (
                <div className="flex min-h-11 items-center gap-3">
                  <Checkbox id={id("activo")} checked={b.activo} onCheckedChange={(v) => cambiar("activo", v === true)} className="h-5 w-5" />
                  <Label htmlFor={id("activo")} className="cursor-pointer leading-snug">
                    Lo usamos <span className="font-normal text-muted-foreground">(si no, no se lee ni suma al coste)</span>
                  </Label>
                </div>
              )}
              <div className="flex min-h-11 items-center gap-3">
                <Checkbox id={id("por-confirmar")} checked={b.por_confirmar} onCheckedChange={(v) => cambiar("por_confirmar", v === true)} className="h-5 w-5" />
                <Label htmlFor={id("por-confirmar")} className="cursor-pointer leading-snug">
                  Plan y precio por confirmar
                </Label>
              </div>
            </div>
          )}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("nombre")}>Nombre</Label>
              <Input id={id("nombre")} value={b.nombre} maxLength={80} onChange={(e) => cambiar("nombre", e.target.value)} aria-invalid={!!errores.nombre} aria-describedby={errores.nombre ? id("nombre-error") : undefined} />
              <MensajeError id={id("nombre-error")} texto={errores.nombre} />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("plan")}>Plan</Label>
              <Input id={id("plan")} value={b.plan} maxLength={80} placeholder="Por ejemplo: Hobby, Free, Pro" onChange={(e) => cambiar("plan", e.target.value)} />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("precio")}>{anual ? "Precio al año" : "Precio al mes"}</Label>
              <Input id={id("precio")} value={b.precio} inputMode="decimal" placeholder="0" onChange={(e) => cambiar("precio", e.target.value)} aria-invalid={!!errores.precio} aria-describedby={errores.precio ? id("precio-error") : undefined} />
              <MensajeError id={id("precio-error")} texto={errores.precio} />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("moneda")}>Moneda</Label>
              <Select value={b.moneda} onValueChange={(v) => cambiar("moneda", v)}>
                <SelectTrigger id={id("moneda")} aria-label="Moneda"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">Euros (EUR)</SelectItem>
                  <SelectItem value="USD">Dólares (USD)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("ciclo")}>Forma de pago</Label>
              <Select value={b.ciclo} onValueChange={(v) => cambiar("ciclo", v)}>
                <SelectTrigger id={id("ciclo")} aria-label="Forma de pago"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gratuito">Gratis</SelectItem>
                  <SelectItem value="mensual">Cada mes</SelectItem>
                  <SelectItem value="anual">Cada año</SelectItem>
                  <SelectItem value="por_uso">Según uso (sin cuota)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("renovacion")}>Próxima renovación o caducidad</Label>
              <Input id={id("renovacion")} type="date" value={b.renovacion} onChange={(e) => cambiar("renovacion", e.target.value)} aria-invalid={!!errores.renovacion} />
              <MensajeError id={id("renovacion-error")} texto={errores.renovacion} />
            </div>
            {costes && (
              <>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={id("categoria")}>Categoría</Label>
                  <Select value={b.categoria} onValueChange={(v) => cambiar("categoria", v)}>
                    <SelectTrigger id={id("categoria")} aria-label="Categoría"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS.map((c) => <SelectItem key={c.valor} value={c.valor}>{c.texto}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <MensajeError id={id("categoria-error")} texto={errores.categoria} />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={id("orden")}>Posición en la lista</Label>
                  <Input id={id("orden")} inputMode="numeric" value={b.orden} onChange={(e) => cambiar("orden", e.target.value)} aria-invalid={!!errores.orden} aria-describedby={errores.orden ? id("orden-error") : undefined} />
                  <MensajeError id={id("orden-error")} texto={errores.orden} />
                </div>
              </>
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={id("cuenta")}>Cuenta o equipo</Label>
            <Input id={id("cuenta")} value={b.cuenta} maxLength={300} onChange={(e) => cambiar("cuenta", e.target.value)} />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={id("panel")}>Enlace al panel del proveedor</Label>
            <Input id={id("panel")} type="url" inputMode="url" value={b.panel_url} placeholder="https://" onChange={(e) => cambiar("panel_url", e.target.value)} aria-invalid={!!errores.panel_url} aria-describedby={errores.panel_url ? id("panel-error") : undefined} />
            <MensajeError id={id("panel-error")} texto={errores.panel_url} />
          </div>
          {costes && (
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("fuente-precio")}>Página oficial del precio</Label>
              <Input id={id("fuente-precio")} type="url" inputMode="url" value={b.fuente_precio} placeholder="https://" onChange={(e) => cambiar("fuente_precio", e.target.value)} aria-invalid={!!errores.fuente_precio} aria-describedby={errores.fuente_precio ? id("fuente-precio-error") : undefined} />
              <MensajeError id={id("fuente-precio-error")} texto={errores.fuente_precio} />
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <Label htmlFor={id("notas")}>Notas</Label>
            <Textarea id={id("notas")} value={b.notas} maxLength={2000} rows={3} onChange={(e) => cambiar("notas", e.target.value)} />
          </div>

          {limites.length > 0 && (
            <fieldset className="min-w-0 space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-semibold">Límites del plan</legend>
              <p className="text-xs text-muted-foreground">Vacío = «sin dato». Las cifras de fábrica salen de la documentación oficial de cada proveedor (enlace «Fuente»).</p>
              <ul className="min-w-0 divide-y divide-border/60">
                {limites.map(([clave, l]) => (
                  <li key={clave} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,6rem)] items-end gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_8rem_6rem]">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="break-words text-sm font-medium">{l.etiqueta ?? clave}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.periodo ?? ""}
                        {l.fuente && (
                          <>
                            {l.periodo ? " · " : ""}
                            <a href={l.fuente} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                              Fuente<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> de {l.etiqueta ?? clave} (se abre en otra pestaña)</span>
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor={id(`limite-${clave}`)} className="text-xs">Límite</Label>
                      <Input
                        id={id(`limite-${clave}`)}
                        inputMode="decimal"
                        value={b.limites[clave]?.limite ?? ""}
                        placeholder={l.limite_desde && !("limite" in l) ? "automático" : "sin dato"}
                        onChange={(e) => cambiarLimite(clave, "limite", e.target.value)}
                        aria-invalid={!!errores[`limite.${clave}`]}
                        aria-describedby={errores[`limite.${clave}`] ? id(`limite-${clave}-error`) : l.limite_desde ? id(`limite-${clave}-desde`) : undefined}
                      />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor={id(`unidad-${clave}`)} className="text-xs">Unidad</Label>
                      <Input id={id(`unidad-${clave}`)} value={b.limites[clave]?.unidad ?? ""} maxLength={30} onChange={(e) => cambiarLimite(clave, "unidad", e.target.value)} />
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      {l.limite_desde && !("limite" in l) && (
                        <p id={id(`limite-${clave}-desde`)} className="text-xs text-muted-foreground">Vacío = automático: {l.limite_desde}.</p>
                      )}
                      <MensajeError id={id(`limite-${clave}-error`)} texto={errores[`limite.${clave}`]} />
                    </div>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onCerrar}>Cancelar</Button>
            <Button type="submit" className="h-11 gap-2" disabled={ocupado}>
              {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {nuevo ? "Añadir servicio" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
