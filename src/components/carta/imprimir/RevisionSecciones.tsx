import { useState } from "react";
import { AlertTriangle, Eye, Info, ListChecks, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { nombreSeccion, type ContenidoCarta, type SeccionCarta, type TipoCartaImpresa } from "@/lib/carta-pdf/datos";
import type { InformeSeccion, TamanoCarta } from "@/lib/carta-pdf/maquetacion";

/**
 * Lo que conviene saber antes de descargar la carta impresa. Cada sección va
 * en sus propias páginas (nunca dos en el mismo folio) y una larga sigue en las
 * siguientes: aquí se dice cuáles ocupan varias páginas, con la opción de ver
 * su primera página o de quitar platos o vinos solo de la carta impresa. También
 * recuerda lo quitado, con la forma de recuperarlo, y avisa en el caso raro de
 * un elemento que no cabe ni en una página entera (entonces no se descarga).
 */

interface Props {
  tipo: TipoCartaImpresa;
  tamano: TamanoCarta;
  secciones: readonly InformeSeccion[];
  /** Contenido sin los elementos quitados a mano (para poder volver a marcarlos). */
  completo: ContenidoCarta;
  excluidos: ReadonlySet<string>;
  alVerPagina: (indice: number) => void;
  alCambiarExcluidos: (ids: string[], excluir: boolean) => void;
}

const contar = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

function ListaElementos({
  seccion,
  excluidos,
  sustantivo,
  alCambiar,
}: {
  seccion: SeccionCarta;
  excluidos: ReadonlySet<string>;
  sustantivo: { singular: string; plural: string };
  alCambiar: (ids: string[], excluir: boolean) => void;
}) {
  const ids = seccion.grupos.flatMap((g) => g.elementos.map((e) => e.id));
  const marcados = ids.filter((id) => !excluidos.has(id)).length;
  return (
    <div className="mt-2 rounded-md border bg-background p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Marcados {marcados} de {ids.length}
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => alCambiar(ids, false)}>
          Marcar todos
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto pr-1">
        {seccion.grupos.map((grupo, g) => (
          <div key={g}>
            {grupo.titulo && <p className="px-1 pt-2 text-xs font-medium italic text-muted-foreground">{grupo.titulo}</p>}
            <ul>
              {grupo.elementos.map((elemento) => {
                const id = `carta-imprimir-elemento-${elemento.id}`;
                return (
                  <li key={elemento.id} className="flex min-h-8 items-center gap-2 px-1">
                    <Checkbox
                      id={id}
                      checked={!excluidos.has(elemento.id)}
                      onCheckedChange={(valor) => alCambiar([elemento.id], valor !== true)}
                    />
                    <Label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-2 py-1 text-sm font-normal">
                      <span className="min-w-0 break-words">{elemento.nombre}</span>
                      <span className="sr-only"> · </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{elemento.precio}</span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-1 px-1 text-xs text-muted-foreground">
        Los {sustantivo.plural} desmarcados solo se quitan de esta carta impresa: la web no cambia.
      </p>
    </div>
  );
}

export function RevisionSecciones({ tipo, tamano, secciones, completo, excluidos, alVerPagina, alCambiarExcluidos }: Props) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const sustantivo = tipo === "vinos" ? { singular: "vino", plural: "vinos" } : { singular: "plato", plural: "platos" };
  const problemas = secciones.filter((s) => !s.cabe);
  const largas = secciones.filter((s) => s.cabe && s.caras > 1);
  const quitados = completo.secciones
    .map((seccion) => ({
      seccion,
      quitados: seccion.grupos.reduce((t, g) => t + g.elementos.filter((e) => excluidos.has(e.id)).length, 0),
    }))
    .filter((q) => q.quitados > 0 && !secciones.some((s) => s.clave === q.seccion.clave && (!s.cabe || s.caras > 1)));
  if (!problemas.length && !largas.length && !quitados.length) return null;

  const seccionCompleta = (clave: string) => completo.secciones.find((s) => s.clave === clave);
  const quitadosDe = (clave: string) =>
    seccionCompleta(clave)?.grupos.reduce((t, g) => t + g.elementos.filter((e) => excluidos.has(e.id)).length, 0) ?? 0;
  const acciones = (clave: string, pagina?: number) => {
    const seccion = seccionCompleta(clave);
    const n = quitadosDe(clave);
    return (
      <>
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
          {pagina !== undefined && (
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => alVerPagina(pagina)}>
              <Eye className="mr-1.5 h-4 w-4" /> Ver
            </Button>
          )}
          {seccion && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              aria-expanded={abierta === clave}
              onClick={() => setAbierta(abierta === clave ? null : clave)}
            >
              <ListChecks className="mr-1.5 h-4 w-4" /> Elegir {sustantivo.plural}
            </Button>
          )}
          {seccion && n > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => alCambiarExcluidos(seccion.grupos.flatMap((g) => g.elementos.map((e) => e.id)), false)}
            >
              <Undo2 className="mr-1.5 h-4 w-4" /> Recuperarlos
            </Button>
          )}
        </div>
        {seccion && abierta === clave && (
          <div className="pl-6">
            <ListaElementos seccion={seccion} excluidos={excluidos} sustantivo={sustantivo} alCambiar={alCambiarExcluidos} />
          </div>
        )}
      </>
    );
  };
  const quitadosTexto = (clave: string) => {
    const n = quitadosDe(clave);
    return n ? ` ${contar(n, `${sustantivo.singular} quitado`, `${sustantivo.plural} quitados`)}.` : "";
  };

  return (
    <div className="mb-3 space-y-2">
      {problemas.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <ul className="space-y-2">
            {problemas.map((s) => (
              <li key={s.clave}>
                <p className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{nombreSeccion(tipo, s.clave)}</strong>: algún {sustantivo.singular} tiene un texto tan largo que no cabe ni
                    en una página {tamano}. Acórtalo en la carta o quítalo de la impresa para poder descargar.
                  </span>
                </p>
                {acciones(s.clave, s.pagina)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(largas.length > 0 || quitados.length > 0) && (
        <div className="rounded-md border bg-background p-3 text-sm">
          <ul className="space-y-2">
            {largas.map((s) => (
              <li key={`l-${s.clave}`}>
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong>{nombreSeccion(tipo, s.clave)}</strong> ocupa {s.caras} páginas {tamano} ({contar(s.elementos, sustantivo.singular, sustantivo.plural)}),
                    sin compartir página con otra sección.{quitadosTexto(s.clave)}
                  </span>
                </p>
                {acciones(s.clave, s.pagina)}
              </li>
            ))}
            {quitados.map(({ seccion, quitados: n }) => (
              <li key={`q-${seccion.clave}`}>
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong>{nombreSeccion(tipo, seccion.clave)}</strong>: {contar(n, `${sustantivo.singular} quitado`, `${sustantivo.plural} quitados`)} de la carta impresa.
                  </span>
                </p>
                {acciones(seccion.clave)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
