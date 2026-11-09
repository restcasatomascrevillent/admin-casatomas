import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, LayoutGrid, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  categoriasPlatos,
  contenidoPlatos,
  contenidoVinos,
  hayPublicados,
  NOMBRE_CARTA,
  nombreFicheroCarta,
  nombreSeccion,
  tiposVino,
  type CartaImpresa,
  type FilaPlato,
  type FilaVino,
  type TipoCartaImpresa,
} from "@/lib/carta-pdf/datos";
import { maquetarCarta, seccionesQueNoCaben, TAMANOS_CARTA, type MaquetaCarta, type PaginaCarta, type TamanoCarta } from "@/lib/carta-pdf/maquetacion";
import { cargarMotorCarta, descargarPdf, type MotorCarta } from "@/lib/carta-pdf/navegador";
import { crearPdfCarta } from "@/lib/carta-pdf/pdf";
import { IDIOMAS_CARTA, NOMBRE_IDIOMA, TEXTOS, type IdiomaCarta } from "@/lib/carta-pdf/textos";
import { RevisionSecciones } from "./RevisionSecciones";
import { VistaPagina } from "./VistaPagina";

/**
 * «Carta para imprimir» (05/11/2026, dueño: «un botón en la carta de vinos y
 * en la de platos que formatee un PDF para la carta física, con el estilo de
 * la web y la identidad de Casa Tomás, en A5»; y luego: «da la opción de A4»).
 *
 * Opciones mínimas (tamaño, carta, idioma, categorías y sangrado), vista previa de
 * todas las páginas y «Descargar PDF». La maquetación y el PDF salen de
 * src/lib/carta-pdf; las fuentes y pdf-lib se cargan al abrir el diálogo.
 *
 * Una sección por cara (08/11/2026): si alguna no cabe en una cara del tamaño
 * elegido, se avisa (sección y tamaño) y no se descarga hasta revisarla
 * (RevisionSecciones): repartirla a propósito, quitar elementos o cambiar de
 * tamaño.
 */

interface Props {
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
  tipo: TipoCartaImpresa;
  platos?: readonly FilaPlato[];
  vinos?: readonly FilaVino[];
}

interface OpcionLista {
  clave: string;
  etiqueta: string;
  cantidad: number;
}

function ListaCasillas({
  opciones,
  excluidas,
  alCambiar,
}: {
  opciones: OpcionLista[];
  excluidas: ReadonlySet<string>;
  alCambiar: (claves: string[], incluir: boolean) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {opciones.map((opcion) => {
        const id = `carta-imprimir-${opcion.clave}`;
        return (
          <li key={opcion.clave} className="flex min-h-9 items-center gap-2.5">
            <Checkbox
              id={id}
              checked={!excluidas.has(opcion.clave)}
              onCheckedChange={(valor) => alCambiar([opcion.clave], valor === true)}
            />
            <Label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-2 py-1.5 font-normal">
              <span className="min-w-0 break-words">{opcion.etiqueta}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{opcion.cantidad}</span>
            </Label>
          </li>
        );
      })}
    </ul>
  );
}

// Por defecto, una lista vacía estable: con `= []` cada render estrenaba lista y se volvía a maquetar todo.
const SIN_FILAS = [] as const;
const SIN_PAGINAS: PaginaCarta[] = [];

export default function DialogoCartaImprimir({ abierto, onCambiarAbierto, tipo, platos = SIN_FILAS, vinos = SIN_FILAS }: Props) {
  const filas = tipo === "platos" ? platos : vinos;
  const hayTouza = useMemo(() => hayPublicados(filas, "touza"), [filas]);
  const [carta, setCarta] = useState<CartaImpresa>("restaurante");
  const [idioma, setIdioma] = useState<IdiomaCarta>("es");
  const [tamano, setTamano] = useState<TamanoCarta>("A5");
  const [excluidas, setExcluidas] = useState<Set<string>>(() => new Set());
  const [sangrado, setSangrado] = useState(false);
  const [desplegados, setDesplegados] = useState<Set<string>>(() => new Set());
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [motor, setMotor] = useState<MotorCarta | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  /** Secciones que se ha pedido repartir en varias caras, por tamaño: «A5:tinto». */
  const [repartidas, setRepartidas] = useState<Set<string>>(() => new Set());
  /** Platos o vinos (id) quitados a mano de la carta impresa. */
  const [excluidosElementos, setExcluidosElementos] = useState<Set<string>>(() => new Set());

  const cartaActiva: CartaImpresa = carta === "touza" && !hayTouza ? "restaurante" : carta;

  useEffect(() => {
    if (!abierto || motor) return;
    let vivo = true;
    setErrorCarga(null);
    cargarMotorCarta()
      .then((m) => vivo && setMotor(m))
      .catch((error: unknown) => {
        console.error("Carta para imprimir: no se han podido cargar las fuentes", error);
        if (vivo) setErrorCarga("No se han podido cargar las fuentes de la carta. Comprueba la conexión y vuelve a abrir.");
      });
    return () => {
      vivo = false;
    };
  }, [abierto, motor]);

  const categoriasPlatosOpciones = useMemo(
    () => (tipo === "platos" ? categoriasPlatos(platos, cartaActiva) : []),
    [tipo, platos, cartaActiva],
  );
  const tiposVinoOpciones = useMemo(() => (tipo === "vinos" ? tiposVino(vinos, cartaActiva) : []), [tipo, vinos, cartaActiva]);

  const { contenido, completo } = useMemo(() => {
    const incluidas = (tipo === "platos"
      ? categoriasPlatosOpciones.map((c) => c.clave)
      : tiposVinoOpciones.flatMap((t) => t.denominaciones.map((d) => d.clave))
    ).filter((clave) => !excluidas.has(clave));
    const opciones = { carta: cartaActiva, idioma, categorias: incluidas };
    const crear = (excluidos?: ReadonlySet<string>) =>
      tipo === "platos" ? contenidoPlatos(platos, { ...opciones, excluidos }) : contenidoVinos(vinos, { ...opciones, excluidos });
    const todo = crear();
    return { completo: todo, contenido: excluidosElementos.size ? crear(excluidosElementos) : todo };
  }, [tipo, platos, vinos, cartaActiva, idioma, excluidas, excluidosElementos, categoriasPlatosOpciones, tiposVinoOpciones]);

  const totalElementos = contenido.secciones.reduce((t, s) => t + s.grupos.reduce((u, g) => u + g.elementos.length, 0), 0);

  const maqueta: MaquetaCarta | null = useMemo(() => {
    if (!motor || totalElementos === 0) return null;
    const prefijo = `${tamano}:`;
    const repartir = [...repartidas].filter((k) => k.startsWith(prefijo)).map((k) => k.slice(prefijo.length));
    return maquetarCarta(motor.medidor, contenido, tamano, { repartir });
  }, [motor, contenido, totalElementos, tamano, repartidas]);
  const paginas: PaginaCarta[] = maqueta?.paginas ?? SIN_PAGINAS;
  const problemas = useMemo(() => (maqueta ? seccionesQueNoCaben(maqueta) : []), [maqueta]);
  const otroTamano: TamanoCarta = tamano === "A5" ? "A4" : "A5";
  // Solo si algo no cabe: ¿cabría en una cara del otro tamaño?
  const cabenEnOtro = useMemo(() => {
    if (!motor || !problemas.length) return new Set<string>();
    const otra = maquetarCarta(motor.medidor, contenido, otroTamano);
    return new Set(otra.secciones.filter((s) => s.cabe).map((s) => s.clave));
  }, [motor, contenido, otroTamano, problemas.length]);
  const nombrePorSeccion = useMemo(
    () => new Map((maqueta?.secciones ?? []).map((s) => [s.clave, nombreSeccion(tipo, s.clave)])),
    [maqueta, tipo],
  );

  useEffect(() => {
    if (ampliada !== null && ampliada >= paginas.length) setAmpliada(paginas.length ? paginas.length - 1 : null);
  }, [ampliada, paginas.length]);

  const cambiarSeleccion = (claves: string[], incluir: boolean) =>
    setExcluidas((previas) => {
      const nuevas = new Set(previas);
      for (const clave of claves) {
        if (incluir) nuevas.delete(clave);
        else nuevas.add(clave);
      }
      return nuevas;
    });

  const todasLasClaves =
    tipo === "platos" ? categoriasPlatosOpciones.map((c) => c.clave) : tiposVinoOpciones.flatMap((t) => t.denominaciones.map((d) => d.clave));

  const textos = TEXTOS[idioma];
  const tituloCarta = `${NOMBRE_CARTA[cartaActiva]} · ${tipo === "vinos" ? textos.tituloVinos : textos.tituloPlatos}`;

  const repartir = (clave: string, si: boolean) =>
    setRepartidas((previas) => {
      const nuevas = new Set(previas);
      if (si) nuevas.add(`${tamano}:${clave}`);
      else nuevas.delete(`${tamano}:${clave}`);
      return nuevas;
    });

  const cambiarExcluidos = (ids: string[], excluir: boolean) =>
    setExcluidosElementos((previos) => {
      const nuevos = new Set(previos);
      for (const id of ids) {
        if (excluir) nuevos.add(id);
        else nuevos.delete(id);
      }
      return nuevos;
    });

  const descargar = async () => {
    if (!motor || !paginas.length || problemas.length) return;
    setDescargando(true);
    try {
      const pdf = await crearPdfCarta(paginas, motor.recursos, { sangrado, titulo: tituloCarta, idioma, tamano });
      descargarPdf(pdf, nombreFicheroCarta(tipo, cartaActiva, idioma, tamano));
      toast.success(`PDF descargado: ${paginas.length} páginas ${tamano}`);
    } catch (error) {
      console.error("Carta para imprimir: error al generar el PDF", error);
      toast.error("No se ha podido generar el PDF. Inténtalo de nuevo.");
    } finally {
      setDescargando(false);
    }
  };

  const etiquetaPagina = (i: number) => `Página ${i + 1} de ${paginas.length}`;

  return (
    <Dialog open={abierto} onOpenChange={onCambiarAbierto}>
      <DialogContent className="max-w-5xl gap-5 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Carta para imprimir (PDF)</DialogTitle>
          <DialogDescription>
            {tipo === "vinos" ? "Carta de vinos" : "Carta de platos"} en A5 o A4 vertical con la letra y los colores de la web,
            con cada sección en su propia cara. Solo sale lo que está publicado en la carta elegida.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-5 md:grid-cols-[17rem_minmax(0,1fr)]">
          {/* Opciones */}
          <div className="min-w-0 space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Tamaño</legend>
              <ToggleGroup
                type="single"
                variant="outline"
                value={tamano}
                onValueChange={(valor) => valor && setTamano(valor as TamanoCarta)}
                className="grid grid-cols-2 gap-1"
                aria-label="Tamaño"
              >
                {TAMANOS_CARTA.map((valor) => (
                  <ToggleGroupItem
                    key={valor}
                    value={valor}
                    aria-label={valor === "A5" ? "A5, 148 × 210 mm" : "A4, 210 × 297 mm"}
                    className="h-auto flex-col gap-0 py-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <span className="font-semibold">{valor}</span>
                    <span className="text-xs font-normal opacity-80">{valor === "A5" ? "148 × 210 mm" : "210 × 297 mm"}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </fieldset>

            {hayTouza && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Carta</legend>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={cartaActiva}
                  onValueChange={(valor) => valor && setCarta(valor as CartaImpresa)}
                  className="grid grid-cols-2 gap-1"
                  aria-label="Carta"
                >
                  {(["restaurante", "touza"] as const).map((valor) => (
                    <ToggleGroupItem
                      key={valor}
                      value={valor}
                      className="h-10 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {NOMBRE_CARTA[valor]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </fieldset>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Idioma</legend>
              <ToggleGroup
                type="single"
                variant="outline"
                value={idioma}
                onValueChange={(valor) => valor && setIdioma(valor as IdiomaCarta)}
                className="grid grid-cols-3 gap-1"
                aria-label="Idioma"
              >
                {IDIOMAS_CARTA.map((valor) => (
                  <ToggleGroupItem
                    key={valor}
                    value={valor}
                    className="h-10 px-1 text-xs sm:text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {NOMBRE_IDIOMA[valor]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {idioma !== "es" && (
                <p className="text-xs text-muted-foreground">Lo que no esté traducido sale en español.</p>
              )}
            </fieldset>

            <fieldset className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <legend className="text-sm font-medium">{tipo === "vinos" ? "Tipos y denominaciones" : "Categorías"}</legend>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => cambiarSeleccion(todasLasClaves, true)}>
                    Todas
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => cambiarSeleccion(todasLasClaves, false)}>
                    Ninguna
                  </Button>
                </div>
              </div>
              {tipo === "platos" ? (
                <ListaCasillas opciones={categoriasPlatosOpciones} excluidas={excluidas} alCambiar={cambiarSeleccion} />
              ) : (
                <ul className="space-y-1">
                  {tiposVinoOpciones.map((t) => {
                    const claves = t.denominaciones.map((d) => d.clave);
                    const marcadas = claves.filter((c) => !excluidas.has(c)).length;
                    const id = `carta-imprimir-tipo-${t.tipo}`;
                    const desplegado = desplegados.has(t.tipo);
                    return (
                      <li key={t.tipo}>
                        <div className="flex min-h-9 items-center gap-2.5">
                          <Checkbox
                            id={id}
                            checked={marcadas === claves.length ? true : marcadas === 0 ? false : "indeterminate"}
                            onCheckedChange={(valor) => cambiarSeleccion(claves, valor === true)}
                          />
                          <Label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-2 py-1.5">
                            <span className="min-w-0 break-words">{t.etiqueta}</span>
                            <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{t.cantidad}</span>
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            aria-expanded={desplegado}
                            aria-label={`${desplegado ? "Ocultar" : "Elegir"} denominaciones de ${t.etiqueta.toLocaleLowerCase("es")}`}
                            onClick={() =>
                              setDesplegados((previos) => {
                                const nuevos = new Set(previos);
                                if (nuevos.has(t.tipo)) nuevos.delete(t.tipo);
                                else nuevos.add(t.tipo);
                                return nuevos;
                              })
                            }
                          >
                            <ChevronDown className={cn("h-4 w-4 transition-transform", desplegado && "rotate-180")} />
                          </Button>
                        </div>
                        {desplegado && (
                          <div className="ml-3 border-l pl-3">
                            <ListaCasillas opciones={t.denominaciones} excluidas={excluidas} alCambiar={cambiarSeleccion} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>

            <div className="flex items-start gap-3 rounded-md border p-3">
              <Switch id="carta-imprimir-sangrado" checked={sangrado} onCheckedChange={setSangrado} className="mt-0.5" />
              <Label htmlFor="carta-imprimir-sangrado" className="cursor-pointer font-normal leading-snug">
                Con sangrado de imprenta (3 mm) y marcas de corte
                <span className="mt-1 block text-xs text-muted-foreground">Solo si la imprenta lo pide; para imprimir en casa, apagado.</span>
              </Label>
            </div>
          </div>

          {/* Vista previa */}
          <section aria-label="Vista previa" className="min-w-0 rounded-md bg-muted/50 p-3">
            {errorCarga ? (
              <p role="alert" className="py-10 text-center text-sm text-destructive">{errorCarga}</p>
            ) : !motor ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparando la vista previa…
              </p>
            ) : !paginas.length ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {completo.secciones.length ? (
                  // Todo lo elegido se ha quitado a mano: que se pueda recuperar.
                  <>
                    <p>Has quitado todos los {tipo === "vinos" ? "vinos" : "platos"} de lo elegido.</p>
                    <Button type="button" variant="link" onClick={() => setExcluidosElementos(new Set())}>
                      Recuperar los quitados
                    </Button>
                  </>
                ) : (
                  <p>{todasLasClaves.length ? "Elige al menos una categoría." : "No hay nada publicado en esta carta."}</p>
                )}
              </div>
            ) : (
              <>
                {maqueta && (
                  <RevisionSecciones
                    tipo={tipo}
                    tamano={tamano}
                    secciones={maqueta.secciones}
                    completo={completo}
                    excluidos={excluidosElementos}
                    cabenEnOtro={cabenEnOtro}
                    otroTamano={otroTamano}
                    alVerPagina={setAmpliada}
                    alRepartir={repartir}
                    alCambiarExcluidos={cambiarExcluidos}
                    alCambiarTamano={setTamano}
                  />
                )}
                {ampliada !== null ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setAmpliada(null)}>
                    <LayoutGrid className="mr-2 h-4 w-4" /> Ver todas
                  </Button>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {ampliada + 1} / {paginas.length}
                  </span>
                  <div className="flex gap-1">
                    <Button type="button" variant="outline" size="icon" aria-label="Página anterior" disabled={ampliada === 0} onClick={() => setAmpliada(ampliada - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Página siguiente"
                      disabled={ampliada >= paginas.length - 1}
                      onClick={() => setAmpliada(ampliada + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {paginas[ampliada].desborda && (
                  <p className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    No cabe en una cara {tamano}: lo que se ve es lo que entra con la letra más pequeña que se lee bien.
                  </p>
                )}
                <VistaPagina
                  pagina={paginas[ampliada]}
                  etiqueta={etiquetaPagina(ampliada)}
                  className={cn("mx-auto block h-auto w-full max-w-lg shadow-md", paginas[ampliada].desborda && "ring-2 ring-destructive")}
                />
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  Una sección por cara. Toca una página para verla en grande.
                </p>
                <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {paginas.map((pagina, i) => (
                    <li key={i} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setAmpliada(i)}
                        aria-label={`Ver en grande: ${etiquetaPagina(i)}${pagina.desborda ? " (no cabe)" : ""}`}
                        className={cn(
                          "relative block w-full rounded-sm shadow-sm ring-offset-background transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          pagina.desborda && "ring-2 ring-destructive",
                        )}
                      >
                        <VistaPagina pagina={pagina} etiqueta={etiquetaPagina(i)} className="block h-auto w-full" />
                        {pagina.desborda && (
                          <span className="absolute inset-x-0 bottom-0 bg-destructive px-1 py-0.5 text-center text-[11px] font-medium text-destructive-foreground">
                            No cabe
                          </span>
                        )}
                      </button>
                      <span className="mt-1 block truncate text-center text-xs tabular-nums text-muted-foreground">
                        {i + 1}
                        {pagina.seccion && nombrePorSeccion.has(pagina.seccion) ? ` · ${nombrePorSeccion.get(pagina.seccion)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
              </>
            )}
          </section>
        </div>
        {/* Pie fijo abajo: el resumen y «Descargar PDF» siempre a la vista, aunque la lista sea larga. */}
        <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-background px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6">
          <div className="text-sm" aria-live="polite">
            <p className="text-muted-foreground">
              {paginas.length
                ? `${paginas.length} páginas ${tamano} · ${totalElementos} ${tipo === "vinos" ? "vinos" : "platos"}${sangrado ? " · con sangrado" : ""}`
                : "Sin páginas todavía"}
            </p>
            {problemas.length > 0 && (
              <p className="font-medium text-destructive">
                {problemas.length === 1
                  ? `${nombrePorSeccion.get(problemas[0].clave)} no cabe en una cara ${tamano}`
                  : `${problemas.length} secciones no caben en una cara ${tamano}`}
                : revísalo antes de descargar.
              </p>
            )}
          </div>
          <Button type="button" className="w-full sm:w-auto" onClick={descargar} disabled={!paginas.length || problemas.length > 0 || descargando}>
            {descargando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Descargar PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
