import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, MinusCircle, Search, SearchX, Wine, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMarcarVinosTienda, useVinosTienda } from "@/hooks/useTienda";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import {
  type ConfiguracionTienda,
  type MotivoNoVendible,
  type VinoTiendaPanel,
  TEXTO_MOTIVO_NO_VENDIBLE,
  euro,
  motivoNoVendible,
  porcentaje,
  precioTienda,
  puedeVenderse,
  urlTiendaWeb,
} from "@/lib/tienda";
import { VERSION_APP } from "@/lib/version";
import { cn } from "@/lib/utils";

const TODAS = "__todas__";
type FiltroVenta = "todos" | "venta" | "fuera";

/** Cómo se pinta cada vino: a la venta, quitado con el interruptor o imposible de vender (con su motivo). */
type EstadoVino = "venta" | "excluido" | "no-vendible";

interface FilaVino {
  vino: VinoTiendaPanel;
  nombre: string;
  motivo: MotivoNoVendible | null;
  /** Precio de tienda (con el descuento), o `null` si el vino no tiene precio de carta. */
  precio: number | null;
  estado: EstadoVino;
  /** Se puede poner o quitar con el interruptor (lo demás se arregla en Gestor Web › Carta). */
  conmutable: boolean;
}

const estadoDe = (motivo: MotivoNoVendible | null): EstadoVino =>
  motivo === null ? "venta" : motivo === "excluido" ? "excluido" : "no-vendible";

/** «el vino mostrado» / «los 12 mostrados». */
const mostrados = (n: number) => (n === 1 ? "el vino mostrado" : `los ${n} mostrados`);
const vinos = (n: number) => (n === 1 ? "vino" : "vinos");

const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

interface Props {
  config: ConfiguracionTienda;
  puedeEditar: boolean;
}

/** `/tienda` de la web del mismo entorno (demo o producción). */
const URL_TIENDA_WEB = urlTiendaWeb(VERSION_APP.entorno, import.meta.env.VITE_WEB_URL as string | undefined);

/**
 * Tienda › Vinos: los vinos activos de la carta con su precio de carta y el de
 * tienda (con el descuento vigente) y el interruptor «A la venta», que gestiona
 * `vinos_excluidos` (solo con «Puede editar» en Tienda; con solo «Ver» se ve el
 * estado de cada vino, sin interruptor ni acciones sobre los mostrados). Los vinos sin precio o fuera de la carta de Casa Tomás
 * salen con su motivo y el interruptor bloqueado: se arreglan en Gestor Web ›
 * Carta. La web solo los enseña; se compran en el restaurante.
 *
 * Arriba, fijos: el resumen, los filtros (buscador, categoría y a la venta /
 * fuera, con cuántos hay de cada) y debajo el contador y las acciones sobre los
 * mostrados. Desde 768 px, tabla (vino con su categoría debajo, precios a la
 * derecha con cifras tabulares, el de tienda destacado, y el estado con su
 * interruptor) que hace scroll por dentro con la cabecera pegada arriba cuando
 * Tienda.tsx mide el alto. En el móvil, una tarjeta por vino y scroll de la
 * pestaña entera.
 */
export function VinosTienda({ config, puedeEditar }: Props) {
  const consulta = useVinosTienda();
  const marcar = useMarcarVinosTienda();
  const esMovil = useIsMobile();
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState(TODAS);
  const [venta, setVenta] = useState<FiltroVenta>("todos");
  const [masivo, setMasivo] = useState<{ aLaVenta: boolean; ids: string[] } | null>(null);

  const categorias = useMemo(
    () => [...new Set((consulta.data ?? []).map((v) => v.categoria?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es")),
    [consulta.data],
  );
  // Primero buscador y categoría; las cuentas de «A la venta» y «Fuera» salen de ahí, y luego se aplica ese filtro.
  const { filas, cuentas } = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const base: FilaVino[] = (consulta.data ?? [])
      .filter((vino) =>
        (categoria === TODAS || vino.categoria?.trim() === categoria) &&
        (!q || normalizar(`${vino.nombre ?? ""} ${vino.categoria ?? ""}`).includes(q)),
      )
      .map((vino) => {
        const motivo = motivoNoVendible(vino, config);
        return {
          vino,
          nombre: vino.nombre?.trim() || "Vino sin nombre",
          motivo,
          precio: precioTienda(vino.precio_eur, config.descuento_pct),
          estado: estadoDe(motivo),
          conmutable: puedeVenderse(vino, config),
        };
      });
    const enVenta = base.filter(({ motivo }) => motivo === null).length;
    return {
      filas: venta === "todos" ? base : base.filter(({ motivo }) => (venta === "venta" ? motivo === null : motivo !== null)),
      cuentas: { todos: base.length, venta: enVenta, fuera: base.length - enVenta } satisfies Record<FiltroVenta, number>,
    };
  }, [consulta.data, config, busqueda, categoria, venta]);

  const total = consulta.data?.length ?? 0;
  const aLaVenta = (consulta.data ?? []).filter((v) => motivoNoVendible(v, config) === null).length;
  const conmutables = filas.filter(({ conmutable }) => conmutable);
  const paraPoner = conmutables.filter(({ motivo }) => motivo === "excluido").map(({ vino }) => vino.id);
  const paraQuitar = conmutables.filter(({ motivo }) => motivo === null).map(({ vino }) => vino.id);
  const hayFiltro = busqueda.trim() !== "" || categoria !== TODAS || venta !== "todos";
  const hayNoVendibles = filas.some(({ estado }) => estado === "no-vendible");

  const quitarFiltros = () => {
    setBusqueda("");
    setCategoria(TODAS);
    setVenta("todos");
  };

  const cambiar = async (ids: string[], aLaVentaNuevo: boolean, nombre?: string) => {
    try {
      await marcar.mutateAsync({ ids, aLaVenta: aLaVentaNuevo });
      const que = nombre ? `«${nombre}»` : `${ids.length} ${vinos(ids.length)}`;
      toast.success(aLaVentaNuevo ? `${que} a la venta en la tienda` : `${que} fuera de la tienda`);
    } catch (e) {
      toast.error("No se pudo cambiar la tienda", { description: mensajeUsuario(e) });
    }
  };

  // El mismo interruptor en la tabla y en las tarjetas; el estado (con su motivo) lo describe. Con solo
  // «Ver» no hay interruptor (06/11/2026, decisión del dueño: se oculta, no se desactiva): queda el estado.
  const interruptor = (f: FilaVino) => !puedeEditar ? null : (
    <Switch
      id={`venta-${f.vino.id}`}
      checked={f.motivo === null}
      disabled={!f.conmutable || marcar.isPending}
      aria-label={`A la venta: ${f.nombre}`}
      aria-describedby={`estado-${f.vino.id}`}
      onCheckedChange={(v) => void cambiar([f.vino.id], v, f.nombre)}
    />
  );

  if (consulta.isLoading) {
    return <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Cargando vinos…</p>;
  }
  if (consulta.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-destructive/40 p-4 text-sm">
        <p>No se pudieron cargar los vinos. Comprueba la conexión.</p>
        <Button variant="outline" onClick={() => void consulta.refetch()}>Reintentar</Button>
      </div>
    );
  }

  const vacio = <SinVinos hayFiltro={hayFiltro} onQuitarFiltros={quitarFiltros} />;

  return (
    // En escritorio ocupa el alto de la pestaña (flex-1) para que la tabla haga scroll por dentro;
    // en el móvil crece con las tarjetas y hace scroll la pestaña entera.
    <div className={cn("flex min-w-0 flex-col gap-3", !esMovil && "min-h-0 flex-1")} data-vista={esMovil ? "tarjetas" : "tabla"}>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <strong className="tabular-nums text-foreground">{aLaVenta} de {total}</strong> vinos activos a la venta con un {porcentaje(config.descuento_pct)} de descuento sobre la carta.
          {!config.activa && (
            <span className="ml-1 font-medium text-amber-800 dark:text-amber-300">
              {puedeEditar ? "La tienda está oculta en la web (actívala en Ajustes)." : "La tienda está oculta en la web."}
            </span>
          )}
        </p>
        <Button asChild variant="outline" className="h-11 shrink-0 gap-2 self-start">
          <a href={URL_TIENDA_WEB} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Ver la tienda en la web
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </Button>
      </div>

      {/* Filtros: buscador (lo que sobra), categoría y a la venta / fuera, en una fila si caben. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
          <Label htmlFor="tienda-buscar-vino" className="sr-only">Buscar vino</Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="tienda-buscar-vino" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o categoría" className="h-11 pl-9" />
        </div>
        <div className="w-full min-w-0 sm:w-56">
          <Label htmlFor="tienda-categoria" className="sr-only">Categoría</Label>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger id="tienda-categoria" className="h-11" aria-label="Filtrar por categoría"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas las categorías</SelectItem>
              {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={venta}
          onValueChange={(v) => v && setVenta(v as FiltroVenta)}
          aria-label="Filtrar por venta"
          className="w-full gap-1 sm:w-auto"
        >
          {([["todos", "Todos"], ["venta", "A la venta"], ["fuera", "Fuera"]] as const).map(([valor, etiqueta]) => (
            <ToggleGroupItem
              key={valor}
              value={valor}
              className="h-11 flex-1 gap-1.5 whitespace-nowrap px-3 hover:bg-muted hover:text-foreground pointer-coarse:h-11 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground sm:flex-none"
            >
              {/* El espacio no se ve (flex), pero separa el número en el nombre accesible: «Fuera 2». */}
              {etiqueta}{" "}
              <span className="text-xs tabular-nums opacity-70">{cuentas[valor]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Contador y acciones sobre los mostrados (solo con un filtro puesto, para no tocar la carta entera sin querer). */}
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-h-11 items-center gap-1">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {hayFiltro ? (
              <>Mostrando <strong className="tabular-nums text-foreground">{filas.length}</strong> de {total} {vinos(total)}</>
            ) : (
              <><strong className="tabular-nums text-foreground">{total}</strong> {vinos(total)}</>
            )}
          </p>
          {hayFiltro && (
            <Button variant="ghost" className="h-11 gap-1 px-3 text-muted-foreground" onClick={quitarFiltros}>
              <X className="h-4 w-4" aria-hidden="true" />
              Quitar filtros
            </Button>
          )}
        </div>
        {puedeEditar && hayFiltro && (paraPoner.length > 0 || paraQuitar.length > 0) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {paraPoner.length > 0 && (
              <Button variant="outline" className="h-11" disabled={marcar.isPending} onClick={() => setMasivo({ aLaVenta: true, ids: paraPoner })}>
                Poner a la venta {mostrados(paraPoner.length)}
              </Button>
            )}
            {paraQuitar.length > 0 && (
              <Button variant="outline" className="h-11" disabled={marcar.isPending} onClick={() => setMasivo({ aLaVenta: false, ids: paraQuitar })}>
                Quitar de la venta {mostrados(paraQuitar.length)}
              </Button>
            )}
          </div>
        )}
      </div>

      {esMovil ? (
        filas.length === 0 ? (
          <div className="rounded-xl border bg-card">{vacio}</div>
        ) : (
          <TarjetasVinos filas={filas} interruptor={interruptor} />
        )
      ) : (
        // Él es quien hace scroll (con alto medido): la cabecera `sticky` se pega a su borde de arriba.
        <div className="min-h-48 flex-1 overflow-auto overscroll-contain rounded-xl border bg-card">
          {filas.length === 0 ? vacio : <TablaVinos filas={filas} interruptor={interruptor} />}
        </div>
      )}
      {hayNoVendibles && (
        <p className="shrink-0 text-xs text-muted-foreground">
          Los vinos sin precio o fuera de la carta de Casa Tomás no pueden salir en la tienda: se arreglan en Gestor Web › Carta.
        </p>
      )}

      <AlertDialog open={masivo !== null} onOpenChange={(abierto) => !abierto && setMasivo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{masivo?.aLaVenta ? "¿Poner a la venta estos vinos?" : "¿Quitar de la venta estos vinos?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {masivo?.aLaVenta
                ? `${masivo?.ids.length === 1 ? "El vino mostrado aparecerá" : `Los ${masivo?.ids.length} vinos mostrados aparecerán`} en la tienda de la web.`
                : `${masivo?.ids.length === 1 ? "El vino mostrado dejará" : `Los ${masivo?.ids.length} vinos mostrados dejarán`} de aparecer en la tienda de la web. Siguen en la carta.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (masivo) void cambiar(masivo.ids, masivo.aLaVenta);
                setMasivo(null);
              }}
            >
              {masivo?.aLaVenta ? "Poner a la venta" : "Quitar de la venta"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface VistaVinosProps {
  filas: FilaVino[];
  interruptor: (f: FilaVino) => ReactNode;
}

const CABECERA = "h-11 px-3 py-2 align-middle text-xs font-medium leading-tight text-muted-foreground first:pl-4 last:pr-4";
const CELDA = "px-3 py-2.5 align-middle first:pl-4 last:pr-4";

/**
 * Escritorio y tablet: tabla de reparto fijo (nunca más ancha que su caja). El nombre se queda con lo que
 * dejan las demás columnas; la cabecera, pegada arriba, con una sombra de 1 px como línea (el borde de una
 * tabla `border-collapse` no acompaña a la cabecera pegajosa).
 */
function TablaVinos({ filas, interruptor }: VistaVinosProps) {
  return (
    <table aria-label="Vinos de la tienda" className="w-full table-fixed text-sm">
      <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
        <tr>
          <th scope="col" className={cn(CABECERA, "text-left")}>Vino</th>
          <th scope="col" className={cn(CABECERA, "w-28 text-right lg:w-32")}>Precio de carta</th>
          <th scope="col" className={cn(CABECERA, "w-32 text-right text-foreground")}>Precio de tienda</th>
          {/* Interruptor (56 px con dedo) + «Quitado de la tienda» en una línea; desde 1280 px, también el motivo más largo. */}
          <th scope="col" className={cn(CABECERA, "w-[17rem] text-left lg:w-72 xl:w-[21rem]")}>A la venta</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {filas.map((f) => (
          <tr key={f.vino.id} data-estado={f.estado} className={cn("transition-colors hover:bg-muted/30", f.estado === "no-vendible" && "bg-muted/20")}>
            <td className={CELDA}>
              <span className="block break-words font-medium leading-snug">{f.nombre}</span>
              <span className="block truncate text-xs text-muted-foreground">{f.vino.categoria?.trim() || "Sin categoría"}</span>
            </td>
            <td className={cn(CELDA, "text-right tabular-nums text-muted-foreground")}>
              {f.vino.precio_eur ? euro(f.vino.precio_eur) : <SinPrecio />}
            </td>
            <td className={cn(CELDA, "text-right tabular-nums", f.estado === "venta" ? "text-[15px] font-semibold" : "text-muted-foreground")}>
              {f.precio != null ? euro(f.precio) : <SinPrecio />}
            </td>
            <td className={CELDA}>
              <div className="flex items-center gap-3">
                {interruptor(f)}
                <EtiquetaEstado fila={f} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Móvil: una tarjeta por vino. Arriba el nombre (con su categoría) y los precios, el de tienda grande;
 * abajo el estado y el interruptor, en una franja de 44 px.
 */
function TarjetasVinos({ filas, interruptor }: VistaVinosProps) {
  return (
    <ul aria-label="Vinos de la tienda" className="flex flex-col gap-2">
      {filas.map((f) => (
        <li key={f.vino.id} data-estado={f.estado} className={cn("rounded-xl border bg-card p-3", f.estado === "no-vendible" && "bg-muted/20")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words font-medium leading-snug">{f.nombre}</p>
              <p className="break-words text-xs text-muted-foreground">{f.vino.categoria?.trim() || "Sin categoría"}</p>
            </div>
            {f.precio != null && (
              <div className="shrink-0 text-right tabular-nums">
                <p className={cn("leading-snug", f.estado === "venta" ? "text-base font-semibold" : "text-sm text-muted-foreground")}>
                  <span className="text-xs font-normal text-muted-foreground">Tienda</span> {euro(f.precio)}
                </p>
                <p className="text-xs text-muted-foreground">Carta {euro(f.vino.precio_eur)}</p>
              </div>
            )}
          </div>
          <div className="mt-2 flex min-h-11 items-center justify-between gap-3 border-t pt-2">
            <EtiquetaEstado fila={f} />
            {interruptor(f)}
          </div>
        </li>
      ))}
    </ul>
  );
}

const ESTILO_ESTADO: Record<EstadoVino, { clase: string; Icono: LucideIcon }> = {
  venta: {
    clase: "bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900",
    Icono: CheckCircle2,
  },
  excluido: { clase: "bg-muted/50 text-muted-foreground ring-border", Icono: MinusCircle },
  "no-vendible": {
    clase: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900",
    Icono: AlertTriangle,
  },
};

/** «A la venta», «Quitado de la tienda» o por qué no puede salir. Describe al interruptor (`aria-describedby`). */
function EtiquetaEstado({ fila }: { fila: FilaVino }) {
  const { clase, Icono } = ESTILO_ESTADO[fila.estado];
  return (
    <span
      id={`estado-${fila.vino.id}`}
      title={fila.estado === "no-vendible" ? "Se arregla en Gestor Web › Carta" : undefined}
      className={cn("inline-flex min-w-0 items-start gap-1.5 rounded-md px-2 py-1 text-xs font-medium leading-snug ring-1 ring-inset", clase)}
    >
      <Icono className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {fila.motivo ? TEXTO_MOTIVO_NO_VENDIBLE[fila.motivo] : "A la venta"}
    </span>
  );
}

function SinPrecio() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Sin precio</span>
    </>
  );
}

function SinVinos({ hayFiltro, onQuitarFiltros }: { hayFiltro: boolean; onQuitarFiltros: () => void }) {
  const Icono = hayFiltro ? SearchX : Wine;
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      <Icono className="mb-1 h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium">{hayFiltro ? "Ningún vino coincide con el filtro" : "No hay vinos activos en la carta"}</p>
      <p className="text-xs text-muted-foreground">
        {hayFiltro ? "Prueba con otra búsqueda o quita los filtros." : "Los vinos se añaden y se activan en Gestor Web › Carta."}
      </p>
      {hayFiltro && (
        <Button variant="outline" className="mt-2 h-11" onClick={onQuitarFiltros}>
          Quitar filtros
        </Button>
      )}
    </div>
  );
}
