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
import { ListaCocteles } from "@/components/carta/ListaCocteles";
import { AjustePreciosModal } from "@/components/carta/AjustePreciosModal";
import { BotonVinoDesdeFoto, type VinoDesdeFoto } from "@/components/carta/BotonVinoDesdeFoto";
import { OrdenarCategoria } from "@/components/carta/OrdenarCategoria";

type Seccion = "platos" | "bebidas" | "vinos" | "cocteles";
type FiltroEstado = "todos" | "activos" | "inactivos_rest" | "activos_touza" | "inactivos_touza";

const ETIQUETAS_FILTRO_ESTADO: Record<FiltroEstado, string> = {
  todos: "Todos",
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
  const { platos, isLoading: isLoadingPlatos, categorias: categoriasPlatos, guardarOrden: guardarOrdenPlatos } = usePlatos();
  const { bebidas, isLoading: isLoadingBebidas, categorias: categoriasBebidas, guardarOrden: guardarOrdenBebidas } = useBebidas();
  const { vinos, isLoading: isLoadingVinos, categorias: categoriasVinos, guardarOrden: guardarOrdenVinos } = useVinos();
  const { cocteles, isLoading: isLoadingCocteles, categorias: categoriasCocteles, guardarOrden: guardarOrdenCocteles } = useCocteles();

  const [seccionActiva, setSeccionActiva] = useState<Seccion>("platos");
  const [categoriaPlatos, setCategoriaPlatos] = useState<string>("");
  const [categoriaBebidas, setCategoriaBebidas] = useState<string>("");
  const [categoriaVinos, setCategoriaVinos] = useState<string>("");
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
    if (categoriasVinos.length > 0 && !categoriaVinos) setCategoriaVinos(categoriasVinos[0] || "");
  }, [categoriasVinos, categoriaVinos]);
  useEffect(() => {
    if (categoriasCocteles.length > 0 && !categoriaCocteles) setCategoriaCocteles(categoriasCocteles[0] || "");
  }, [categoriasCocteles, categoriaCocteles]);

  const termino = busqueda.toLowerCase().trim();
  const hayBusqueda = termino.length > 0;

  // Estado + búsqueda; sin búsqueda se limita además a la categoría seleccionada
  const filtrarSeccion = <T extends ItemCarta>(items: T[] | undefined, categoria: string): T[] => {
    let resultado = items || [];
    if (filtroEstado === "activos") resultado = resultado.filter((i) => i.restaurante === true);
    else if (filtroEstado === "inactivos_rest") resultado = resultado.filter((i) => i.restaurante !== true);
    else if (filtroEstado === "activos_touza") resultado = resultado.filter((i) => i.touza === true);
    else if (filtroEstado === "inactivos_touza") resultado = resultado.filter((i) => i.touza !== true);

    if (hayBusqueda) {
      return resultado.filter(
        (i) => i.nombre?.toLowerCase().includes(termino) || i.descripcion?.toLowerCase().includes(termino)
      );
    }
    return resultado.filter((i) => i.categoria === categoria);
  };

  const platosFiltrados = filtrarSeccion(platos, categoriaPlatos);
  const bebidasFiltradas = filtrarSeccion(bebidas, categoriaBebidas);
  const vinosFiltrados = filtrarSeccion(vinos, categoriaVinos);
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
      vacio: "No hay platos todavía. Haz clic en \"Añadir plato\" para comenzar.",
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
      vacio: "No hay bebidas todavía. Haz clic en \"Añadir bebida\" para comenzar.",
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
      vacio: "No hay vinos todavía. Haz clic en \"Añadir vino\" para comenzar.",
      total: vinos?.length ?? 0,
      filtrados: vinosFiltrados.length,
      categorias: categoriasVinos,
      categoria: categoriaVinos,
      setCategoria: setCategoriaVinos,
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
      vacio: "No hay cócteles todavía. Haz clic en \"Añadir cóctel\" para comenzar.",
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
  const puedeOrdenar = !hayBusqueda && Boolean(actual.categoria) && elementosCategoria.length > 1;
  const enModoOrdenar = ordenando && puedeOrdenar;
  // Si deja de poder ordenarse (p. ej. la categoría se queda con un solo
  // elemento), se sale del modo para no volver a entrar solo más tarde.
  useEffect(() => {
    if (ordenando && !puedeOrdenar) setOrdenando(false);
  }, [ordenando, puedeOrdenar]);

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
          {/* A 390 px las cuatro secciones con su número no caben junto a los botones (F-47):
              en el móvil los botones van en su fila, encima, y el número se ve desde `sm`. */}
          <PestanasPagina
            accionesArribaEnMovil
            pestanas={(Object.keys(secciones) as Seccion[]).map((seccion) => ({
              valor: seccion,
              etiqueta: secciones[seccion].etiqueta,
              contador: secciones[seccion].total,
              etiquetaContador: `${secciones[seccion].total} ${secciones[seccion].etiqueta.toLowerCase()}`,
              tour: seccion === "vinos" ? "gw-carta-vinos" : undefined,
            }))}
            acciones={
              <div className="flex flex-wrap items-center gap-2" data-tour="gw-carta-acciones">
                <Button variant="outline" onClick={() => setDialogAjustePreciosOpen(true)} title="Ajustar precios">
                  <Percent className="h-4 w-4 sm:mr-2" />
                  <span className="sr-only sm:not-sr-only">Ajustar precios</span>
                </Button>
                {seccionActiva === "vinos" && (
                  <div className="flex flex-wrap items-center gap-2" data-tour="gw-carta-vinos-foto">
                    <BotonVinoDesdeFoto
                      categorias={categoriasVinos.filter((c): c is string => Boolean(c))}
                      onLeido={(resultado) => {
                        setPrecargaVino(resultado);
                        setDialogVinoOpen(true);
                      }}
                    />
                  </div>
                )}
                <Button onClick={actual.abrirDialogo} title={actual.añadir}>
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="sr-only sm:not-sr-only">{actual.añadir}</span>
                </Button>
              </div>
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

              {actual.categorias.length > 0 && (
                <Select value={actual.categoria} onValueChange={actual.setCategoria} disabled={hayBusqueda}>
                  <SelectTrigger
                    className="w-full sm:w-[220px] bg-background"
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
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectSeparator />
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
                </SelectContent>
              </Select>

              {puedeOrdenar && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full sm:w-auto"
                  title={`Cambiar el orden de «${actual.categoria}» en la web`}
                  onClick={() => setOrdenando(true)}
                >
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  Ordenar
                </Button>
              )}
            </div>

            <TabsContent value="platos" className="mt-0 space-y-4">
              {renderContenido("platos", <ListaPlatos platos={platosFiltrados} />)}
            </TabsContent>
            <TabsContent value="bebidas" className="mt-0">
              {renderContenido("bebidas", <ListaBebidas bebidas={bebidasFiltradas} />)}
            </TabsContent>
            <TabsContent value="vinos" className="mt-0">
              {renderContenido("vinos", <ListaVinos vinos={vinosFiltrados} />)}
            </TabsContent>
            <TabsContent value="cocteles" className="mt-0">
              {renderContenido("cocteles", <ListaCocteles cocteles={coctelesFiltrados} />)}
            </TabsContent>
          </>
        )}
      </Tabs>

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
        categoriaInicial={categoriaVinos}
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
    </div>
  );
}
