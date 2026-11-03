import { useMemo, useState } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useMarcarVinosTienda, useVinosTienda } from "@/hooks/useTienda";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import {
  type ConfiguracionTienda,
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

/** «el vino mostrado» / «los 12 mostrados». */
const mostrados = (n: number) => (n === 1 ? "el vino mostrado" : `los ${n} mostrados`);

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
 * `vinos_excluidos`. Los vinos sin precio o fuera de la carta de Casa Tomás no
 * salen: se arreglan en Gestor Web › Carta. La web solo los enseña; se compran
 * en el restaurante.
 */
export function VinosTienda({ config, puedeEditar }: Props) {
  const vinos = useVinosTienda();
  const marcar = useMarcarVinosTienda();
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState(TODAS);
  const [venta, setVenta] = useState<FiltroVenta>("todos");
  const [masivo, setMasivo] = useState<{ aLaVenta: boolean; ids: string[] } | null>(null);

  const categorias = useMemo(
    () => [...new Set((vinos.data ?? []).map((v) => v.categoria?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es")),
    [vinos.data],
  );
  const filas = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return (vinos.data ?? [])
      .map((v) => ({ vino: v, motivo: motivoNoVendible(v, config), precio: precioTienda(v.precio_eur, config.descuento_pct) }))
      .filter(({ vino, motivo }) =>
        (categoria === TODAS || vino.categoria?.trim() === categoria) &&
        (venta === "todos" || (venta === "venta" ? motivo === null : motivo !== null)) &&
        (!q || normalizar(`${vino.nombre ?? ""} ${vino.categoria ?? ""}`).includes(q)),
      );
  }, [vinos.data, config, busqueda, categoria, venta]);

  const total = vinos.data?.length ?? 0;
  const aLaVenta = (vinos.data ?? []).filter((v) => motivoNoVendible(v, config) === null).length;
  const conmutables = filas.filter(({ vino }) => puedeVenderse(vino, config));
  const paraPoner = conmutables.filter(({ motivo }) => motivo === "excluido").map(({ vino }) => vino.id);
  const paraQuitar = conmutables.filter(({ motivo }) => motivo === null).map(({ vino }) => vino.id);
  const hayFiltro = busqueda.trim() !== "" || categoria !== TODAS || venta !== "todos";

  const cambiar = async (ids: string[], aLaVentaNuevo: boolean, nombre?: string) => {
    try {
      await marcar.mutateAsync({ ids, aLaVenta: aLaVentaNuevo });
      const que = nombre ? `«${nombre}»` : `${ids.length} ${ids.length === 1 ? "vino" : "vinos"}`;
      toast.success(aLaVentaNuevo ? `${que} a la venta en la tienda` : `${que} fuera de la tienda`);
    } catch (e) {
      toast.error("No se pudo cambiar la tienda", { description: mensajeUsuario(e) });
    }
  };

  if (vinos.isLoading) {
    return <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Cargando vinos…</p>;
  }
  if (vinos.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-destructive/40 p-4 text-sm">
        <p>No se pudieron cargar los vinos. Comprueba la conexión.</p>
        <Button variant="outline" onClick={() => void vinos.refetch()}>Reintentar</Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{aLaVenta} de {total}</strong> vinos activos a la venta con un {porcentaje(config.descuento_pct)} de descuento sobre la carta.
          {!config.activa && <span className="ml-1 font-medium text-amber-800">La tienda está oculta en la web (actívala en Ajustes).</span>}
        </p>
        <Button asChild variant="outline" className="h-11 shrink-0 gap-2 self-start">
          <a href={URL_TIENDA_WEB} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Ver la tienda en la web
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,12rem)]">
        <div className="relative min-w-0">
          <Label htmlFor="tienda-buscar-vino" className="sr-only">Buscar vino</Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="tienda-buscar-vino" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar vino" className="h-11 pl-9" />
        </div>
        <div className="min-w-0">
          <Label htmlFor="tienda-categoria" className="sr-only">Categoría</Label>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger id="tienda-categoria" className="h-11" aria-label="Filtrar por categoría"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas las categorías</SelectItem>
              {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="tienda-filtro-venta" className="sr-only">A la venta</Label>
          <Select value={venta} onValueChange={(v) => setVenta(v as FiltroVenta)}>
            <SelectTrigger id="tienda-filtro-venta" className="h-11" aria-label="Filtrar por venta"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">A la venta y fuera</SelectItem>
              <SelectItem value="venta">Solo a la venta</SelectItem>
              <SelectItem value="fuera">Solo fuera de la tienda</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
      {!puedeEditar && <p className="text-sm text-muted-foreground">Para poner o quitar vinos necesitas el permiso «Puede editar» de Tienda.</p>}

      <div className="min-w-0 rounded-xl border">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6.5rem_6.5rem_6.5rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Vino</span><span>Categoría</span><span className="text-right">Carta</span><span className="text-right">Tienda</span><span className="text-right">A la venta</span>
        </div>
        {filas.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Ningún vino coincide con el filtro.</p>
        ) : (
          <ul aria-label="Vinos de la tienda" className="divide-y">
            {filas.map(({ vino, motivo, precio }) => {
              const nombre = vino.nombre?.trim() || "Vino sin nombre";
              const conmutable = puedeVenderse(vino, config);
              const idSwitch = `venta-${vino.id}`;
              return (
                <li key={vino.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6.5rem_6.5rem_6.5rem] md:px-4">
                  <div className="min-w-0">
                    <span className="block break-words font-medium">{nombre}</span>
                    <span className="block text-xs text-muted-foreground md:hidden">{vino.categoria}</span>
                    <span className="block text-xs tabular-nums md:hidden">
                      {precio != null ? (
                        <><span className="text-muted-foreground line-through">{euro(vino.precio_eur)}</span> <span className="font-semibold">{euro(precio)}</span></>
                      ) : <span className="text-muted-foreground">Sin precio</span>}
                    </span>
                    {motivo && motivo !== "excluido" && (
                      <span className="block text-xs text-amber-800">{TEXTO_MOTIVO_NO_VENDIBLE[motivo]}</span>
                    )}
                  </div>
                  <span className="hidden truncate text-sm text-muted-foreground md:block">{vino.categoria}</span>
                  <span className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">{vino.precio_eur ? euro(vino.precio_eur) : "—"}</span>
                  <span className={cn("hidden text-right text-sm font-semibold tabular-nums md:block", motivo && "text-muted-foreground font-normal")}>{precio != null ? euro(precio) : "—"}</span>
                  <span className="flex justify-end">
                    <Switch
                      id={idSwitch}
                      checked={motivo === null}
                      disabled={!puedeEditar || !conmutable || marcar.isPending}
                      aria-label={`A la venta: ${nombre}`}
                      onCheckedChange={(v) => void cambiar([vino.id], v, nombre)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
