import { useState } from "react";
import { Check, Pencil, Tags, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AvisoAbreviatura, useAvisosAbreviaturas, useResolverAbreviatura } from "@/hooks/useAvisosAbreviaturas";

/**
 * «LP parece Laurent-Perrier. ¿Confirmar?» en la pantalla de subida de Facturas.
 * Solo quien puede editar Facturas ve los avisos y los resuelve (lo vuelve a comprobar el servidor).
 * Confirmar o corregir guarda la abreviatura del proveedor y pone al producto su marca completa.
 */
export function AvisosAbreviaturas({ puedeEditar }: { puedeEditar: boolean }) {
  const { data: avisos = [] } = useAvisosAbreviaturas(puedeEditar);
  if (!puedeEditar || avisos.length === 0) return null;
  return (
    <section aria-label="Abreviaturas por confirmar" data-testid="avisos-abreviaturas" className="shrink-0 rounded-lg border border-gold/40 bg-muted/30 px-3 py-2">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Tags className="h-4 w-4" aria-hidden="true" />
        Abreviaturas por confirmar ({avisos.length})
      </h3>
      <ul className="divide-y">
        {avisos.map((a) => (
          <FilaAviso key={a.id} aviso={a} />
        ))}
      </ul>
    </section>
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
