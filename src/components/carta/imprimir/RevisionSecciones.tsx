import { useState } from "react";
import { AlertTriangle, Eye, Info, ListChecks, Split, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { nombreSeccion, type ContenidoCarta, type SeccionCarta, type TipoCartaImpresa } from "@/lib/carta-pdf/datos";
import type { InformeSeccion, TamanoCarta } from "@/lib/carta-pdf/maquetacion";

/**
 * Revisión de las secciones antes de descargar la carta impresa (una sección
 * por cara, 08/11/2026). Avisa de cada sección que no cabe en una cara del
 * tamaño elegido y deja resolverlo sin salir del diálogo:
 *  · ver su página (lo que entra con la letra mínima legible),
 *  · repartirla, a propósito, en las caras que necesita,
 *  · elegir qué platos o vinos entran,
 *  · o pasar al otro tamaño, si allí sí cabe.
 * También recuerda lo que ya se ha decidido (secciones repartidas y elementos
 * quitados), con la forma de deshacerlo.
 */

interface Props {
  tipo: TipoCartaImpresa;
  tamano: TamanoCarta;
  secciones: readonly InformeSeccion[];
  /** Contenido sin los elementos quitados a mano (para poder volver a marcarlos). */
  completo: ContenidoCarta;
  excluidos: ReadonlySet<string>;
  /** Secciones que no caben aquí pero sí en una cara del otro tamaño. */
  cabenEnOtro: ReadonlySet<string>;
  otroTamano: TamanoCarta;
  alVerPagina: (indice: number) => void;
  alRepartir: (clave: string, repartir: boolean) => void;
  alCambiarExcluidos: (ids: string[], excluir: boolean) => void;
  alCambiarTamano: (tamano: TamanoCarta) => void;
}

const contar = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

function ListaElementos({
  seccion,
  excluidos,
  caben,
  sustantivo,
  alCambiar,
}: {
  seccion: SeccionCarta;
  excluidos: ReadonlySet<string>;
  caben: number | null;
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
          {caben !== null && ` · en una cara caben unos ${caben}`}
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

export function RevisionSecciones({
  tipo,
  tamano,
  secciones,
  completo,
  excluidos,
  cabenEnOtro,
  otroTamano,
  alVerPagina,
  alRepartir,
  alCambiarExcluidos,
  alCambiarTamano,
}: Props) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const sustantivo = tipo === "vinos" ? { singular: "vino", plural: "vinos" } : { singular: "plato", plural: "platos" };
  const problemas = secciones.filter((s) => !s.cabe);
  const repartidas = secciones.filter((s) => s.cabe && s.repartida);
  const informe = new Map(secciones.map((s) => [s.clave, s]));
  const quitados = completo.secciones
    .map((seccion) => ({
      seccion,
      quitados: seccion.grupos.reduce((t, g) => t + g.elementos.filter((e) => excluidos.has(e.id)).length, 0),
    }))
    .filter((q) => q.quitados > 0);
  if (!problemas.length && !repartidas.length && !quitados.length) return null;

  const seccionCompleta = (clave: string) => completo.secciones.find((s) => s.clave === clave);
  const botonElegir = (clave: string) => {
    const seccion = seccionCompleta(clave);
    if (!seccion) return null;
    return (
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
    );
  };
  const lista = (clave: string) => {
    const seccion = seccionCompleta(clave);
    if (abierta !== clave || !seccion) return null;
    const datos = informe.get(clave);
    return (
      <ListaElementos
        seccion={seccion}
        excluidos={excluidos}
        caben={datos && !datos.cabe ? datos.caben : null}
        sustantivo={sustantivo}
        alCambiar={alCambiarExcluidos}
      />
    );
  };

  return (
    <div className="mb-3 space-y-2">
      {problemas.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <p className="flex items-start gap-2 font-medium text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {problemas.length === 1
              ? `Una sección no cabe en una cara ${tamano}. Revísala antes de descargar.`
              : `${problemas.length} secciones no caben en una cara ${tamano}. Revísalas antes de descargar.`}
          </p>
          <ul className="mt-2 space-y-3">
            {problemas.map((s) => {
              const nombre = nombreSeccion(tipo, s.clave);
              return (
                <li key={s.clave} className="border-t border-destructive/20 pt-2">
                  <p>
                    <strong>{nombre}</strong> · {tamano}: {contar(s.elementos, sustantivo.singular, sustantivo.plural)}.{" "}
                    {s.repartida
                      ? `Ni repartida en ${s.caras} caras: algún ${sustantivo.singular} es demasiado largo para la página.`
                      : `Con la letra más pequeña que se lee bien caben unos ${s.caben} en una cara; repartida necesitaría ${s.carasNecesarias} caras.`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => alVerPagina(s.pagina)}>
                      <Eye className="mr-1.5 h-4 w-4" /> Ver página
                    </Button>
                    {!s.repartida && (
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => alRepartir(s.clave, true)}>
                        <Split className="mr-1.5 h-4 w-4" /> Repartir en {s.carasNecesarias} caras
                      </Button>
                    )}
                    {botonElegir(s.clave)}
                    {cabenEnOtro.has(s.clave) && (
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => alCambiarTamano(otroTamano)}>
                        En {otroTamano} sí cabe: pasar a {otroTamano}
                      </Button>
                    )}
                  </div>
                  {lista(s.clave)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {(repartidas.length > 0 || quitados.length > 0) && (
        <div className="rounded-md border bg-background p-3 text-sm">
          <ul className="space-y-2">
            {repartidas.map((s) => (
              <li key={`r-${s.clave}`}>
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong>{nombreSeccion(tipo, s.clave)}</strong> ocupa {s.caras} caras {tamano}, repartida a petición tuya.
                  </span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => alVerPagina(s.pagina)}>
                    <Eye className="mr-1.5 h-4 w-4" /> Ver
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => alRepartir(s.clave, false)}>
                    <Undo2 className="mr-1.5 h-4 w-4" /> Volver a una cara
                  </Button>
                  {botonElegir(s.clave)}
                </div>
                <div className="pl-6">{lista(s.clave)}</div>
              </li>
            ))}
            {quitados
              .filter((q) => !problemas.some((s) => s.clave === q.seccion.clave) && !repartidas.some((s) => s.clave === q.seccion.clave))
              .map(({ seccion, quitados: n }) => (
                <li key={`q-${seccion.clave}`}>
                  <p className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      <strong>{nombreSeccion(tipo, seccion.clave)}</strong>: {contar(n, `${sustantivo.singular} quitado`, `${sustantivo.plural} quitados`)} de la carta impresa.
                    </span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                    {botonElegir(seccion.clave)}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => alCambiarExcluidos(seccion.grupos.flatMap((g) => g.elementos.map((e) => e.id)), false)}
                    >
                      <Undo2 className="mr-1.5 h-4 w-4" /> Recuperarlos
                    </Button>
                  </div>
                  <div className="pl-6">{lista(seccion.clave)}</div>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
