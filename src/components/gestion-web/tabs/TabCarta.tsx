import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, Percent, Search, X, ArrowUpDown } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { useCocteles } from "@/hooks/useCocteles";
import { PlatoForm } from "@/components/carta/PlatoForm";
import { BebidaForm } from "@/components/carta/BebidaForm";
import { VinoForm } from "@/components/carta/VinoForm";
import { CoctelForm } from "@/components/carta/CoctelForm";
import { ListaPlatos } from "@/components/carta/ListaPlatos";
import { ListaBebidas } from "@/components/carta/ListaBebidas";
import { ListaVinos } from "@/components/carta/ListaVinos";
import { EncuestaVinoFavorito } from "@/components/carta/EncuestaVinoFavorito";
import { ListaCocteles } from "@/components/carta/ListaCocteles";
import { AjustePreciosModal } from "@/components/carta/AjustePreciosModal";
import { BotonVinoDesdeFoto, type VinoDesdeFoto } from "@/components/carta/BotonVinoDesdeFoto";
import { OrdenarCategoria } from "@/components/carta/OrdenarCategoria";
import { FiltrosVinos } from "@/components/carta/FiltrosVinos";
import { BotonCartaImprimir } from "@/components/carta/imprimir/BotonCartaImprimir";
import { BotonHerramientaCarta } from "@/components/carta/BotonHerramientaCarta";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import {
  categoriaDelFiltro,
  FILTRO_TODOS,
  filtrarVinos,
  filtroCategoria,
  ordenarVinosPorCategoria,
  type FiltroVinos,
} from "@/components/carta/filtroVinos";
import { esCategoriaOrigenPendiente } from "@/lib/tipos-vino";
import { categoriasConOrigen } from "@/lib/origen-vino";
import { filtrarPorVisibilidad, type FiltroVisibilidad } from "@/lib/visibilidad-carta";

type Seccion = "platos" | "bebidas" | "vinos" | "cocteles";
type FiltroEstado = FiltroVisibilidad;

// Cerrado, el desplegable dice qué filtra (como en Reservas, «Estado»): en Vinos
// tenía al lado la píldora «Todos» del tipo y se confundían.
const ETIQUETAS_FILTRO_ESTADO: Record<FiltroEstado, string> = {
  todos: "Visibilidad",
  activos: "Casa Tomás · visibles",
  inactivos_rest: "Casa Tomás · ocultos",
  activos_touza: "Touza · visibles",
  inactivos_touza: "Touza · ocultos",
};

type ItemCarta = {
  id: string;
  nombre: string | null;
  descripcion?: string | null;
  categoria?: string | null;
  restaurante?: boolean | null;
  touza?: boolean | null;
  imagen_url?: string | null;
  activado?: boolean | null;
};

export default function TabCarta() {
  // «Editar» en la carta (decisión del dueño, 06/11/2026). Con solo «Ver» se consulta (lista, buscador,
  // filtros y tarjetas en lectura); todo lo que escribe o gasta IA se OCULTA (añadir, «Varias
  // botellas», ajustar precios, ordenar, interruptores, fotos, editar, borrar, la votación y, desde el
  // 10/11/2026, el «PDF Carta») y arriba sale «Solo lectura». La base de datos y las funciones exigen lo mismo
  // (migración 20261106500000_permisos_carta_newsletter). El super admin siempre edita.
  const { canAccess: puedeEditar } = useCanAccessSection("gestor_carta", "edit");
  const soloLectura = !puedeEditar;
  const { platos, isLoading: isLoadingPlatos, categorias: categoriasPlatos, guardarOrden: guardarOrdenPlatos } = usePlatos();
  const { bebidas, isLoading: isLoadingBebidas, categorias: categoriasBebidas, guardarOrden: guardarOrdenBebidas } = useBebidas();
  const { vinos, isLoading: isLoadingVinos, categorias: categoriasVinos, guardarOrden: guardarOrdenVinos } = useVinos();
  const { cocteles, isLoading: isLoadingCocteles, categorias: categoriasCocteles, guardarOrden: guardarOrdenCocteles } = useCocteles();

  const [seccionActiva, setSeccionActiva] = useState<Seccion>("platos");
  const [categoriaPlatos, setCategoriaPlatos] = useState<string>("");
  const [categoriaBebidas, setCategoriaBebidas] = useState<string>("");
  // Vinos: píldoras por tipo y denominación como en la carta de la web (04/11/2026); empieza en «Todos».
  const [filtroVinos, setFiltroVinos] = useState<FiltroVinos>(FILTRO_TODOS);
  const categoriaVinos = categoriaDelFiltro(filtroVinos) ?? "";
  const [categoriaCocteles, setCategoriaCocteles] = useState<string>("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  const [precargaVino, setPrecargaVino] = useState<VinoDesdeFoto | null>(null);
  const [busqueda, setBusqueda] = useState<string>("");
  // Modo «Ordenar»: la categoría seleccionada de la sección activa en lista compacta reordenable.
  const [ordenando, setOrdenando] = useState(false);

  const [dialogPlatoOpen, setDialogPlatoOpen] = useState(false);
  const [dialogBebidaOpen, setDialogBebidaOpen] = useState(false);
  const [dialogVinoOpen, setDialogVinoOpen] = useState(false);
  const [dialogCoctelOpen, setDialogCoctelOpen] = useState(false);
  const [dialogAjustePreciosOpen, setDialogAjustePreciosOpen] = useState(false);

  const isLoading = isLoadingPlatos || isLoadingBebidas || isLoadingVinos || isLoadingCocteles;

  // Inicializar la primera categoría cuando se carguen los datos
  useEffect(() => {
    if (categoriasPlatos.length > 0 && !categoriaPlatos) setCategoriaPlatos(categoriasPlatos[0] || "");
  }, [categoriasPlatos, categoriaPlatos]);
  useEffect(() => {
    if (categoriasBebidas.length > 0 && !categoriaBebidas) setCategoriaBebidas(categoriasBebidas[0] || "");
  }, [categoriasBebidas, categoriaBebidas]);
  useEffect(() => {
    if (categoriasCocteles.length > 0 && !categoriaCocteles) setCategoriaCocteles(categoriasCocteles[0] || "");
  }, [categoriasCocteles, categoriaCocteles]);

  const termino = busqueda.toLowerCase().trim();
  const hayBusqueda = termino.length > 0;

  // Estado + búsqueda (sin categoría).
  const filtrarEstadoYBusqueda = <T extends ItemCarta>(items: T[] | undefined): T[] => {
    // Visible = activado Y en esa carta, como la web (antes solo miraba la carta y en Platos no filtraba nada).
    const resultado = filtrarPorVisibilidad(items || [], filtroEstado);

    if (hayBusqueda) {
      return resultado.filter(
        (i) => i.nombre?.toLowerCase().includes(termino) || i.descripcion?.toLowerCase().includes(termino)
      );
    }
    return resultado;
  };

  // Estado + búsqueda; sin búsqueda se limita además a la categoría seleccionada
  const filtrarSeccion = <T extends ItemCarta>(items: T[] | undefined, categoria: string): T[] => {
    const resultado = filtrarEstadoYBusqueda(items);
    return hayBusqueda ? resultado : resultado.filter((i) => i.categoria === categoria);
  };

  const platosFiltrados = filtrarSeccion(platos, categoriaPlatos);
  const bebidasFiltradas = filtrarSeccion(bebidas, categoriaBebidas);
  // Vinos: la búsqueda se suma a las píldoras (como en la web) y los contadores
  // cuentan lo que deja la visibilidad y la búsqueda.
  const vinosParaFiltros = filtrarEstadoYBusqueda(vinos);
  const vinosFiltrados = ordenarVinosPorCategoria(filtrarVinos(vinosParaFiltros, filtroVinos));
  const coctelesFiltrados = filtrarSeccion(cocteles, categoriaCocteles);

  const secciones: Record<
    Seccion,
    {
      etiqueta: string;
      añadir: string;
      vacio: string;
      total: number;
      filtrados: number;
      categorias: (string | null)[];
      categoria: string;
      setCategoria: (valor: string) => void;
      abrirDialogo: () => void;
      /** Todos los elementos (sin filtros), ya en su orden. */
      todos: ItemCarta[];
      guardarOrden: typeof guardarOrdenPlatos;
    }
  > = {
    platos: {
      etiqueta: "Platos",
      todos: platos ?? [],
      guardarOrden: guardarOrdenPlatos,
      añadir: "Añadir plato",
      vacio: soloLectura ? "No hay platos todavía." : "No hay platos todavía. Haz clic en \"Añadir plato\" para comenzar.",
      total: platos?.length ?? 0,
      filtrados: platosFiltrados.length,
      categorias: categoriasPlatos,
      categoria: categoriaPlatos,
      setCategoria: setCategoriaPlatos,
      abrirDialogo: () => setDialogPlatoOpen(true),
    },
    bebidas: {
      etiqueta: "Bebidas",
      todos: bebidas ?? [],
      guardarOrden: guardarOrdenBebidas,
      añadir: "Añadir bebida",
      vacio: soloLectura ? "No hay bebidas todavía." : "No hay bebidas todavía. Haz clic en \"Añadir bebida\" para comenzar.",
      total: bebidas?.length ?? 0,
      filtrados: bebidasFiltradas.length,
      categorias: categoriasBebidas,
      categoria: categoriaBebidas,
      setCategoria: setCategoriaBebidas,
      abrirDialogo: () => setDialogBebidaOpen(true),
    },
    vinos: {
      etiqueta: "Vinos",
      todos: vinos ?? [],
      guardarOrden: guardarOrdenVinos,
      añadir: "Añadir vino",
      vacio: soloLectura ? "No hay vinos todavía." : "No hay vinos todavía. Haz clic en \"Añadir vino\" para comenzar.",
      total: vinos?.length ?? 0,
      filtrados: vinosFiltrados.length,
      categorias: categoriasVinos,
      categoria: categoriaVinos,
      setCategoria: (categoria) => setFiltroVinos(filtroCategoria(categoria)),
      abrirDialogo: () => {
        setPrecargaVino(null);
        setDialogVinoOpen(true);
      },
    },
    cocteles: {
      etiqueta: "Cócteles",
      todos: cocteles ?? [],
      guardarOrden: guardarOrdenCocteles,
      añadir: "Añadir cóctel",
      vacio: soloLectura ? "No hay cócteles todavía." : "No hay cócteles todavía. Haz clic en \"Añadir cóctel\" para comenzar.",
      total: cocteles?.length ?? 0,
      filtrados: coctelesFiltrados.length,
      categorias: categoriasCocteles,
      categoria: categoriaCocteles,
      setCategoria: setCategoriaCocteles,
      abrirDialogo: () => setDialogCoctelOpen(true),
    },
  };
  const actual = secciones[seccionActiva];

  // Se ordena la categoría entera, sin el filtro de visibilidad: si no, al
  // numerar solo los visibles chocarían con los ocultos.
  const elementosCategoria = actual.categoria ? actual.todos.filter((i) => i.categoria === actual.categoria) : [];
  // (En Vinos, con una denominación elegida en las píldoras.)
  const puedeOrdenar = puedeEditar && !hayBusqueda && Boolean(actual.categoria) && elementosCategoria.length > 1;
  const enModoOrdenar = ordenando && puedeOrdenar;
  // Si deja de poder ordenarse (p. ej. la categoría se queda con un solo
  // elemento), se sale del modo para no volver a entrar solo más tarde.
  useEffect(() => {
    if (ordenando && !puedeOrdenar) setOrdenando(false);
  }, [ordenando, puedeOrdenar]);

  // Herramientas de la barra (botones secundarios), en el orden en que se ven. El «PDF Carta» solo
  // con «Editar» en la carta o super admin (10/11/2026, petición del dueño; antes también con «Ver»).
  const herramientas = [
    puedeEditar && (seccionActiva === "platos" || seccionActiva === "vinos") && (
      <BotonCartaImprimir key="pdf" tipo={seccionActiva} platos={platos} vinos={vinos} />
    ),
    puedeEditar && (
      <BotonHerramientaCarta
        key="precios"
        icono={<Percent />}
        etiqueta="Ajustar precios"
        etiquetaCorta="Precios"
        ayuda="Sube o baja los precios de una categoría en %, o cambia uno solo"
        onClick={() => setDialogAjustePreciosOpen(true)}
      />
    ),
  ].filter(Boolean);

  const renderContenido = (seccion: Seccion, lista: ReactNode) => {
    const config = secciones[seccion];
    if (config.categorias.length === 0) {
      return (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {config.vacio}
        </p>
      );
    }
    if (config.filtrados === 0) {
      return <p className="py-6 text-center text-sm text-muted-foreground">Nada coincide con los filtros.</p>;
    }
    return lista;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={seccionActiva}
        onValueChange={(value) => {
          setSeccionActiva(value as Seccion);
          setOrdenando(false);
          if (value === "platos" && (filtroEstado === "activos_touza" || filtroEstado === "inactivos_touza")) {
            setFiltroEstado("todos");
          }
        }}
        className="w-full space-y-4"
      >
        {/* Barra: secciones + acciones */}
        <div data-tour="gw-carta-secciones">
          {/* A 390 px las cuatro secciones con su número no caben junto a los botones (F-47): en el
              móvil las secciones van arriba, a todo el ancho, y los botones debajo, con su texto
              (02/11/2026: antes iban encima, apretados a la derecha, solo con iconos y con un hueco
              vacío). El número de cada sección se ve desde `sm`. */}
          <PestanasPagina
            accionesDebajoEnMovil="xl"
            pestanas={(Object.keys(secciones) as Seccion[]).map((seccion) => ({
              valor: seccion,
              etiqueta: secciones[seccion].etiqueta,
              contador: secciones[seccion].total,
              etiquetaContador: `${secciones[seccion].total} ${secciones[seccion].etiqueta.toLowerCase()}`,
              tour: seccion === "vinos" ? "gw-carta-vinos" : undefined,
            }))}
            acciones={
              soloLectura ? (
                // Solo «Ver»: la etiqueta común y, en Platos y Vinos, el «PDF Carta».
                <div className="flex w-full items-center justify-between gap-2 sm:justify-end xl:w-auto" data-tour="gw-carta-acciones">
                  <EtiquetaSoloLectura />
                  {herramientas.length > 0 && <div className="flex min-w-0 items-center gap-2">{herramientas}</div>}
                </div>
              ) : (
                // Botones de la carta (06/11/2026, dueño: «mejora la estética de los botones»):
                //  · «Añadir …» es la acción principal (relleno de marca); «PDF Carta» y «Ajustar
                //    precios» son herramientas (contorno, unidas en un grupo) y «Varias botellas» va
                //    junto a «Añadir vino», porque también añade.
                //  · Desde 1280 px, una fila a la derecha de las secciones, con la principal al final
                //    (textos cortos y ayuda emergente hasta 1536 px). Entre 640 y 1280 px (tableta,
                //    portátil con el menú lateral) bajan a su propia fila: herramientas a la izquierda y
                //    «Añadir» a la derecha; en una fila con las secciones no cabían y se cortaban.
                //  · En el móvil, una rejilla de 2 columnas sin huecos: arriba «Añadir …» (a todo el
                //    ancho, o con «Varias botellas» al lado en Vinos, o con «Ajustar precios» en Bebidas
                //    y Cócteles) y debajo las herramientas, todas de 44 px con dedo.
                <div
                  className="grid w-full grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-between sm:gap-3 xl:w-auto xl:justify-end"
                  data-tour="gw-carta-acciones"
                >
                  <div
                    className={cn(
                      "grid min-w-0 gap-2 sm:order-2 sm:flex sm:items-center",
                      herramientas.length > 1 || seccionActiva === "vinos" ? "col-span-2 grid-cols-2" : "col-span-1 grid-cols-1",
                    )}
                    data-tour={seccionActiva === "vinos" ? "gw-carta-vinos-foto" : undefined}
                  >
                    <Button
                      className={cn("order-1 min-w-0 px-3 shadow-sm sm:order-2 sm:px-4", seccionActiva !== "vinos" && herramientas.length > 1 && "col-span-2")}
                      onClick={actual.abrirDialogo}
                    >
                      <Plus />
                      <span className="truncate">{actual.añadir}</span>
                    </Button>
                    {seccionActiva === "vinos" && (
                      <BotonVinoDesdeFoto
                        className="order-2 sm:order-1"
                        categorias={categoriasConOrigen(categoriasVinos)}
                        onLeido={(resultado) => {
                          setPrecargaVino(resultado);
                          setDialogVinoOpen(true);
                        }}
                      />
                    )}
                  </div>
                  <div
                    role="group"
                    aria-label="Herramientas de la carta"
                    className={cn(
                      "grid min-w-0 gap-2 sm:order-1 sm:flex sm:gap-0",
                      // Desde `sm`, botones unidos: un solo grupo de contorno.
                      "sm:[&>*+*]:-ml-px sm:[&>*]:rounded-none sm:[&>*:first-child]:rounded-l-md sm:[&>*:last-child]:rounded-r-md sm:[&>*:focus-visible]:z-10 sm:[&>*:hover]:z-10 sm:[&>*]:relative",
                      herramientas.length > 1 ? "col-span-2 grid-cols-2" : "col-span-1 grid-cols-1",
                    )}
                  >
                    {herramientas}
                  </div>
                </div>
              )
            }
          />
        </div>

        {enModoOrdenar ? (
          <OrdenarCategoria
            key={`${seccionActiva}:${actual.categoria}`}
            categoria={actual.categoria}
            elementos={elementosCategoria}
            nombrePlural={actual.etiqueta.toLowerCase()}
            guardando={actual.guardarOrden.isPending}
            onGuardar={(ids) => actual.guardarOrden.mutateAsync({ categoria: actual.categoria, idsEnOrden: ids })}
            onSalir={() => setOrdenando(false)}
          />
        ) : (
          <>
            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-2" data-tour="gw-carta-filtros">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre o descripción..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="pl-10 pr-11"
                />
                {busqueda && (
                  <button
                    type="button"
                    onClick={() => setBusqueda("")}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {seccionActiva !== "vinos" && actual.categorias.length > 0 && (
                <Select value={actual.categoria} onValueChange={actual.setCategoria} disabled={hayBusqueda}>
                  <SelectTrigger
                    className="w-full sm:w-[180px] lg:w-[220px] bg-background"
                    aria-label="Categoría"
                    title={hayBusqueda ? "La búsqueda incluye todas las categorías" : undefined}
                  >
                    <SelectValue placeholder="Selecciona categoría" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    {actual.categorias.filter(Boolean).map((categoria) => (
                      <SelectItem key={categoria} value={categoria!} className="capitalize">
                        {categoria}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={filtroEstado} onValueChange={(value) => setFiltroEstado(value as FiltroEstado)}>
                <SelectTrigger className="w-full sm:w-[200px] bg-background" aria-label="Filtrar visibilidad">
                  <SelectValue>{ETIQUETAS_FILTRO_ESTADO[filtroEstado]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Casa Tomás</SelectLabel>
                    <SelectItem value="activos">Visibles</SelectItem>
                    <SelectItem value="inactivos_rest">Ocultos</SelectItem>
                  </SelectGroup>
                  {seccionActiva !== "platos" && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Touza</SelectLabel>
                        <SelectItem value="activos_touza">Visibles</SelectItem>
                        <SelectItem value="inactivos_touza">Ocultos</SelectItem>
                      </SelectGroup>
                    </>
                  )}
                  {/* «Todos» al final (11/11/2026, petición del dueño), en Platos y en Vinos (y en el resto). */}
                  <SelectSeparator />
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>

              {puedeOrdenar && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  title={`Cambiar el orden de «${actual.categoria}» en la web`}
                  onClick={() => setOrdenando(true)}
                >
                  <ArrowUpDown />
                  Ordenar
                </Button>
              )}

              {/* Vinos: las píldoras de la carta de la web en vez del desplegable de categorías. */}
              {seccionActiva === "vinos" && actual.categorias.length > 0 && (
                <FiltrosVinos vinos={vinosParaFiltros} valor={filtroVinos} onChange={setFiltroVinos} />
              )}
            </div>

            <TabsContent value="platos" className="mt-0 space-y-4">
              {renderContenido("platos", <ListaPlatos platos={platosFiltrados} soloLectura={soloLectura} />)}
            </TabsContent>
            <TabsContent value="bebidas" className="mt-0">
              {renderContenido("bebidas", <ListaBebidas bebidas={bebidasFiltradas} soloLectura={soloLectura} />)}
            </TabsContent>
            <TabsContent value="vinos" className="mt-0 space-y-4">
              {/* Votación del vino favorito (04/11/2026): una franja, encima de la lista. */}
              <EncuestaVinoFavorito />
              {renderContenido("vinos", <ListaVinos vinos={vinosFiltrados} soloLectura={soloLectura} />)}
            </TabsContent>
            <TabsContent value="cocteles" className="mt-0">
              {renderContenido("cocteles", <ListaCocteles cocteles={coctelesFiltrados} soloLectura={soloLectura} />)}
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* Formularios de alta y ajuste de precios: con solo «Ver» ni se montan. */}
      {puedeEditar && (
        <>
          <PlatoForm
            open={dialogPlatoOpen}
            onOpenChange={setDialogPlatoOpen}
            categoriaInicial={categoriaPlatos}
          />
          <BebidaForm
            open={dialogBebidaOpen}
            onOpenChange={setDialogBebidaOpen}
            categoriaInicial={categoriaBebidas}
          />
          <VinoForm
            open={dialogVinoOpen}
            onOpenChange={(abierto) => {
              setDialogVinoOpen(abierto);
              if (!abierto) setPrecargaVino(null);
            }}
            categoriaInicial={esCategoriaOrigenPendiente(categoriaVinos) ? "" : categoriaVinos}
            precarga={precargaVino}
          />
          <CoctelForm
            open={dialogCoctelOpen}
            onOpenChange={setDialogCoctelOpen}
            categoriaInicial={categoriaCocteles}
          />

          <AjustePreciosModal
            open={dialogAjustePreciosOpen}
            onOpenChange={setDialogAjustePreciosOpen}
          />
        </>
      )}
    </div>
  );
}
