import { useState } from "react";
import { Check, Pencil, Tags, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  type AvisoAbreviatura,
  useAbreviaturasAprendidas,
  useAvisosAbreviaturas,
  useQuitarAbreviatura,
  useResolverAbreviatura,
} from "@/hooks/useAvisosAbreviaturas";

/**
 * «LP parece Laurent-Perrier. ¿Confirmar?» en la pantalla de subida de Facturas.
 * Solo quien puede editar Facturas ve los avisos y los resuelve (lo vuelve a comprobar el servidor).
 * Confirmar o corregir guarda la abreviatura del proveedor y pone al producto su marca completa.
 */
export function AvisosAbreviaturas({ puedeEditar }: { puedeEditar: boolean }) {
  const { data: avisos } = useAvisosAbreviaturas(puedeEditar);
  if (!puedeEditar || !avisos) return null;
  return (
    <div className="shrink-0 space-y-1">
      {avisos.length > 0 && (
        // Alto máximo con scroll interior: una carga masiva puede traer 50 avisos y la pantalla no hace scroll de página.
        <section
          aria-label="Abreviaturas por confirmar"
          data-testid="avisos-abreviaturas"
          className="flex max-h-[30vh] flex-col rounded-lg border border-gold/40 bg-muted/30 px-3 py-2"
        >
          <h3 className="mb-1 flex shrink-0 items-center gap-1.5 text-sm font-semibold">
            <Tags className="h-4 w-4" aria-hidden="true" />
            Abreviaturas por confirmar ({avisos.length})
          </h3>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain" data-testid="avisos-abreviaturas-lista">
            {avisos.map((a) => (
              <FilaAviso key={a.id} aviso={a} />
            ))}
          </ul>
        </section>
      )}
      <AbreviaturasAprendidas />
    </div>
  );
}

/** «Abreviaturas aprendidas»: ventana con la lista y un «No es» para quitar una falsa (y que no se vuelva a aprender). */
function AbreviaturasAprendidas() {
  const [abierta, setAbierta] = useState(false);
  const { data = [], isLoading, isError } = useAbreviaturasAprendidas(abierta);
  const quitar = useQuitarAbreviatura();
  return (
    <Dialog open={abierta} onOpenChange={setAbierta}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
          <Tags className="h-3.5 w-3.5" aria-hidden="true" />
          Abreviaturas aprendidas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Abreviaturas aprendidas</DialogTitle>
          <DialogDescription>Si alguna no es una abreviatura, pulsa «No es»: se quita y no se vuelve a aprender.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading && <p className="py-4 text-sm text-muted-foreground">Cargando…</p>}
          {isError && <p className="py-4 text-sm text-destructive">No se ha podido cargar la lista.</p>}
          {!isLoading && !isError && data.length === 0 && <p className="py-4 text-sm text-muted-foreground">Todavía no hay ninguna.</p>}
          <ul className="divide-y">
            {data.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2" data-abreviatura-aprendida={a.abreviatura}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    «{a.abreviatura.toUpperCase()}» = {a.expansion}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.proveedor} · {a.origen === "manual" ? "confirmada" : `vista ${a.veces} ${a.veces === 1 ? "vez" : "veces"}`}
                    {a.usable ? "" : " · aún no se usa"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-1.5 px-3"
                  disabled={quitar.isPending}
                  onClick={() => quitar.mutate(a.id)}
                  aria-label={`${a.abreviatura.toUpperCase()} de ${a.proveedor} no es ${a.expansion}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  No es
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilaAviso({ aviso }: { aviso: AvisoAbreviatura }) {
  const resolver = useResolverAbreviatura();
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [texto, setTexto] = useState(aviso.propuesta);
  const ab = aviso.abreviatura.toUpperCase();
  const enviar = (accion: "confirmar" | "corregir" | "descartar", expansion?: string) =>
    resolver.mutate({ id: aviso.id, accion, expansion });
  return (
    <li className="flex flex-wrap items-center gap-2 py-2" data-aviso-abreviatura={aviso.abreviatura}>
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">
          «{ab}» parece {aviso.propuesta}. ¿Confirmar?
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {aviso.proveedor}
          {aviso.texto_linea ? ` · línea «${aviso.texto_linea}»` : ""}
          {aviso.producto ? ` · producto «${aviso.producto}»` : ""}
        </p>
      </div>
      {corrigiendo ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim().length >= 3) enviar("corregir", texto.trim());
          }}
        >
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-label={`Marca completa de ${ab}`}
            className="h-11 w-56"
            maxLength={80}
          />
          <Button type="submit" className="h-11 px-4" disabled={resolver.isPending || texto.trim().length < 3}>
            Guardar
          </Button>
          <Button type="button" variant="ghost" className="h-11 px-3" onClick={() => setCorrigiendo(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="h-11 gap-1.5 px-4" disabled={resolver.isPending} onClick={() => enviar("confirmar")} aria-label={`Confirmar ${ab} = ${aviso.propuesta}`}>
            <Check className="h-4 w-4" aria-hidden="true" />
            Confirmar
          </Button>
          <Button type="button" variant="outline" className="h-11 gap-1.5 px-4" disabled={resolver.isPending} onClick={() => setCorrigiendo(true)} aria-label={`Corregir ${ab}`}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Corregir
          </Button>
          <Button type="button" variant="ghost" className="h-11 gap-1.5 px-3 text-muted-foreground" disabled={resolver.isPending} onClick={() => enviar("descartar")} aria-label={`${ab} no es una abreviatura`} title="No es una abreviatura: no volver a avisar">
            <X className="h-4 w-4" aria-hidden="true" />
            No es
          </Button>
        </div>
      )}
    </li>
  );
}
