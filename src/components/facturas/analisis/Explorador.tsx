// «Explorar»: la gráfica a medida de Facturas › Análisis, sin pasar por la IA.
//
//   Estantería (como Vega-Lite): MEDIDA · EJE · COLOR · GRÁFICA, más filtros
//   en chips quitables (proveedor, familia, producto, tipo; el local es el de
//   la barra de arriba) y presets de un toque. Cambia al instante (la consulta
//   se retrasa 250 ms y se queda la gráfica anterior mientras llega la nueva).
//
//   Tocar una barra o un punto lo selecciona y, debajo, ofrece: ver solo ese
//   tramo (tiempo) o filtrar por él (proveedor, familia, producto, tipo,
//   local), ver sus documentos y abrirlo en Compras.
//
//   «Ver como tabla», exportar CSV y «Fijar en el tablero» (se guarda la
//   configuración, no la imagen).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  BarChart3,
  ChevronDown,
  Filter,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Search,
  Table2,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatEntero } from "@/components/facturas/shared/formatters";
import { useBuscarProductosComprados } from "@/hooks/useTableroCompras";
import { useExplorarCompras, useFamiliasFiltro, useProveedoresFiltro } from "@/hooks/useExplorarCompras";
import {
  accionDePunto,
  AGRUPACIONES,
  ajustarConfig,
  aplicarPreset,
  claveConfig,
  csvExploracion,
  DESGLOSES,
  esTiempo,
  etiquetasClave,
  formatoValor,
  GRAFICAS,
  graficaEfectiva,
  infoMedida,
  MAX_EXPLORACIONES_FIJADAS,
  MEDIDAS,
  motivoMedidaNoDisponible,
  parametrosExplorar,
  PRESETS,
  presetActivo,
  resumenExploracion,
  TIPOS_DOC,
  tituloConfig,
  type ConfigExplorador,
  type Exploracion,
  type LocalRpc,
  type PuntoExploracion,
  type TipoDoc,
} from "@/lib/facturas/explorador";
import { enlaceMesCompras, enlaceProveedorCompras, fechaCorta, nombreCorto, textoPct } from "@/lib/facturas/tableroCompras";
import type { PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import type { FiltroLocal } from "@/lib/facturas/resumenCompras";
import { EstadoError, EstadoVacio } from "@/components/facturas/compras/estilo";
import { GraficaExplorador, TablaExploracion } from "./GraficaExplorador";
import { FOCO } from "./piezas";
import { desplazarDentro, esTactil } from "./desplazar";

export interface PropsExplorador {
  config: ConfigExplorador;
  onConfig: (c: ConfigExplorador) => void;
  periodo: { desde: string | null; hasta: string | null };
  /** «1 ene – 31 dic 2026», para títulos y el CSV. */
  textoPeriodo: string;
  local: LocalRpc;
  onLocal: (l: FiltroLocal) => void;
  /** «Ver solo este tramo»: cambia el periodo de TODO el tablero. */
  onTramo: (desde: string, hasta: string) => void;
  onDocumentos: (p: PeticionDocumentos) => void;
  onIrA?: (enlace: string) => void;
  fijadas: ReadonlySet<string>;
  onFijar: (c: ConfigExplorador) => void;
  onQuitarFijada: (id: string) => void;
  /** Abrir el buscador de producto (desde el preset «Precio de un producto» o la IA). */
  pedirProducto?: number;
  /** Tras «Ver solo este tramo»: a qué se vuelve («al año 2026») y cómo. */
  volverTramo?: { texto: string; volver: () => void } | null;
}

const ETIQUETA = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground";
const CHIP =
  "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-border bg-background pl-3 pr-1 text-sm hover:bg-muted/50";
const ACCION =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

const bonito = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const LOCALES: Record<"casa_tomas" | "touza", string> = { casa_tomas: "Casa Tomás", touza: "Touza" };

function Campo({ etiqueta, children, className }: { etiqueta: string; children: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)} role="group" aria-labelledby={id}>
      <span id={id} className={ETIQUETA}>
        {etiqueta}
      </span>
      {children}
    </div>
  );
}

// ─── Añadir filtro ──────────────────────────────────────────────────────────

type PestanaFiltro = "proveedor" | "familia" | "producto" | "tipo";

function AnadirFiltro({
  config,
  onFiltros,
  abierto,
  onAbierto,
  pestana,
  onPestana,
}: {
  config: ConfigExplorador;
  onFiltros: (f: ConfigExplorador["filtros"]) => void;
  abierto: boolean;
  onAbierto: (o: boolean) => void;
  pestana: PestanaFiltro;
  onPestana: (p: PestanaFiltro) => void;
}) {
  const [texto, setTexto] = useState("");
  const proveedores = useProveedoresFiltro(abierto && pestana === "proveedor");
  const familias = useFamiliasFiltro(abierto && pestana === "familia");
  const productos = useBuscarProductosComprados(abierto && pestana === "producto" ? texto : "");
  const f = config.filtros;
  const t = texto.trim().toLowerCase();
  const tactil = esTactil();
  const disparador = useRef<HTMLButtonElement>(null);
  // Abierto con el botón en la parte de abajo del tablero, la lista salía pegada
  // al borde y con 3 filas (QA 05/11/2026): se sube el botón y la lista cabe.
  useEffect(() => {
    if (abierto) desplazarDentro(disparador.current, "start");
  }, [abierto]);

  useEffect(() => setTexto(""), [pestana, abierto]);

  const listaProveedores = useMemo(
    () =>
      (proveedores.data ?? [])
        .filter((p) => !f.proveedores.some((x) => x.id === p.id) && (!t || p.nombre.toLowerCase().includes(t)))
        .slice(0, 40),
    [proveedores.data, f.proveedores, t],
  );
  const fila = cn("flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted/60", FOCO);

  return (
    <Popover open={abierto} onOpenChange={onAbierto}>
      <PopoverTrigger asChild>
        <button
          ref={disparador}
          type="button"
          className={cn("inline-flex h-11 w-full items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed border-input bg-background px-3 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground", FOCO)}
          data-testid="explorador-anadir-filtro"
        >
          <Plus className="h-4 w-4" aria-hidden /> Añadir filtro
        </button>
      </PopoverTrigger>
      {/* Sin pegarse al borde de la pantalla y, con el dedo, sin abrir el teclado al abrirse (QA 05/11/2026). */}
      <PopoverContent
        align="start"
        className="w-80 p-2"
        aria-label="Añadir filtro"
        collisionPadding={12}
        onOpenAutoFocus={(e) => {
          if (tactil) e.preventDefault();
        }}
      >
        <div role="group" aria-label="Filtrar por" className="mb-2 grid grid-cols-4 gap-1 rounded-lg bg-muted/40 p-1">
          {(["proveedor", "familia", "producto", "tipo"] as PestanaFiltro[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={pestana === p}
              onClick={() => onPestana(p)}
              className={cn(
                "min-h-11 rounded-md text-xs font-medium capitalize text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm",
                FOCO,
              )}
            >
              {p}
            </button>
          ))}
        </div>
        {(pestana === "proveedor" || pestana === "producto") && (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              autoFocus={!tactil}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={pestana === "proveedor" ? "Busca un proveedor…" : "Busca un producto: gamba, aceite…"}
              aria-label={pestana === "proveedor" ? "Buscar proveedor" : "Buscar producto"}
              className="h-11 pl-9 text-base"
            />
          </div>
        )}
        <ul className="max-h-64 overflow-y-auto" aria-label={`Elegir ${pestana}`}>
          {pestana === "proveedor" &&
            (proveedores.isLoading ? (
              <li className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
              </li>
            ) : listaProveedores.length === 0 ? (
              <li className="p-2 text-sm text-muted-foreground">Ningún proveedor se llama así.</li>
            ) : (
              listaProveedores.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={fila}
                    onClick={() => {
                      onFiltros({ ...f, proveedores: [...f.proveedores, { id: p.id, nombre: nombreCorto(p.nombre) }] });
                      onAbierto(false);
                    }}
                  >
                    <span className="truncate">{nombreCorto(p.nombre)}</span>
                  </button>
                </li>
              ))
            ))}
          {pestana === "familia" &&
            [...(familias.data ?? []), { id: 0, nombre: "Sin clasificar" }]
              .filter((x) => !f.familias.some((y) => y.id === x.id))
              .map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className={fila}
                    onClick={() => {
                      onFiltros({ ...f, familias: [...f.familias, x] });
                      onAbierto(false);
                    }}
                  >
                    {x.nombre}
                  </button>
                </li>
              ))}
          {pestana === "producto" &&
            (texto.trim().length < 2 ? (
              <li className="p-2 text-xs text-muted-foreground">Escribe al menos 2 letras.</li>
            ) : productos.isLoading ? (
              <li className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Buscando…
              </li>
            ) : (productos.data ?? []).length === 0 ? (
              <li className="p-2 text-sm text-muted-foreground">Ningún producto comprado se llama así.</li>
            ) : (
              (productos.data ?? [])
                .filter((p) => !f.productos.some((x) => x.toLowerCase() === p.toLowerCase()))
                .map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className={fila}
                      onClick={() => {
                        onFiltros({ ...f, productos: [...f.productos, p], unidad: null });
                        onAbierto(false);
                      }}
                    >
                      <span className="truncate">{bonito(p)}</span>
                    </button>
                  </li>
                ))
            ))}
          {pestana === "tipo" &&
            TIPOS_DOC.map((x) => {
              const activo = f.tipos.includes(x.valor);
              return (
                <li key={x.valor}>
                  <button
                    type="button"
                    className={fila}
                    aria-pressed={activo}
                    onClick={() => onFiltros({ ...f, tipos: activo ? f.tipos.filter((y) => y !== x.valor) : [...f.tipos, x.valor] })}
                  >
                    <span className={cn("mr-2 inline-block h-4 w-4 rounded border", activo ? "border-primary bg-primary" : "border-input")} aria-hidden />
                    {x.etiqueta}
                  </button>
                </li>
              );
            })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ─── Totales ────────────────────────────────────────────────────────────────

function Totales({
  ex,
  config,
  onVerDocumentos,
  sinClasificarAparte,
}: {
  ex: Exploracion;
  config: ConfigExplorador;
  /** Sin él (cargando otra consulta), «Ver los N documentos» queda desactivado. */
  onVerDocumentos?: () => void;
  /** «Sin clasificar» va aparte, fuera de la gráfica: no cuenta como punto. */
  sinClasificarAparte: boolean;
}) {
  const m = infoMedida(ex.parametros.medida);
  const unidad = ex.parametros.unidad;
  const var_ = ex.total.variacionPct;
  const ant = ex.anterior;
  const conDatos = ex.puntos.filter((p) => p.documentos > 0).length;
  const enGrafica = sinClasificarAparte ? ex.puntos.filter((p) => p.clave !== "0").length : ex.puntos.length;
  const entidades = esTiempo(config.agrupar)
    ? `${formatEntero(conDatos)} de ${formatEntero(ex.puntos.length)} ${ex.puntos.length === 1 ? "tramo" : "tramos"} con datos`
    : `${formatEntero(enGrafica)}${ex.resto ? ` de ${formatEntero(enGrafica + ex.resto.entidades)}` : ""} en la gráfica`;
  return (
    <dl className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">
          {m.valor === "precio" ? "Precio medio del periodo" : "Total del periodo"}
          {m.iva ? ` · ${m.iva}` : ""}
        </dt>
        <dd className="text-2xl font-semibold leading-tight tabular-nums tracking-tight text-foreground">{formatoValor(ex.total.valor, ex.parametros.medida, unidad)}</dd>
      </div>
      {var_ !== null && ant && (
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">
            Frente a {fechaCorta(ant.desde)} – {fechaCorta(ant.hasta)}
          </dt>
          <dd
            className={cn(
              "text-sm font-semibold tabular-nums",
              (m.valor === "abonos" || m.valor === "regalado" ? var_ < 0 : var_ > 0) ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {textoPct(var_)} <span className="font-normal text-muted-foreground">({formatoValor(ant.valor, ex.parametros.medida, unidad)})</span>
          </dd>
        </div>
      )}
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">Documentos</dt>
        <dd className="text-sm font-semibold tabular-nums">
          {formatEntero(ex.total.documentos)}
          {ex.total.lineas !== null && <span className="font-normal text-muted-foreground"> · {formatEntero(ex.total.lineas)} líneas</span>}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">Puntos</dt>
        <dd className="text-sm font-semibold tabular-nums">{entidades}</dd>
      </div>
      <div className="ml-auto">
        <button type="button" className={cn(ACCION, "text-primary", FOCO)} onClick={onVerDocumentos} disabled={!onVerDocumentos || ex.total.documentos === 0}>
          Ver los {formatEntero(ex.total.documentos)} documentos
        </button>
      </div>
    </dl>
  );
}

// ─── Explorador ─────────────────────────────────────────────────────────────

export function Explorador({
  config,
  onConfig,
  periodo,
  textoPeriodo,
  local,
  onLocal,
  onTramo,
  onDocumentos,
  onIrA,
  fijadas,
  onFijar,
  onQuitarFijada,
  pedirProducto,
  volverTramo,
}: PropsExplorador) {
  const idTitulo = useId();
  const [aviso, setAviso] = useState<string | null>(null);
  const [verTabla, setVerTabla] = useState(false);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [verSinClasificar, setVerSinClasificar] = useState(false);
  const [filtroAbierto, setFiltroAbierto] = useState(false);
  const [pestanaFiltro, setPestanaFiltro] = useState<PestanaFiltro>("proveedor");
  const [precioPendiente, setPrecioPendiente] = useState(false);
  const raiz = useRef<HTMLElement>(null);
  const tiraPunto = useRef<HTMLDivElement>(null);

  const params = useMemo(() => parametrosExplorar(config, periodo, local), [config, periodo, local]);
  const q = useExplorarCompras(params);
  const ex = q.data;
  const tipo = graficaEfectiva(config);
  const idFijada = claveConfig(config);
  const fijada = fijadas.has(idFijada);
  const actualizando = q.isFetching && !q.isLoading;
  // Se ve la gráfica de la consulta ANTERIOR (o la nueva aún no ha salido): sus
  // cifras no se tocan, porque sus documentos serían de otra consulta (QA 05/11/2026).
  const listo = q.alDia;
  // Mientras llega la respuesta nueva se ve la anterior: para leerla se usan SUS parámetros.
  const exConfig: ConfigExplorador = ex ? { ...config, agrupar: ex.parametros.agrupar, medida: ex.parametros.medida, desglose: ex.parametros.desglose } : config;
  const apartar = exConfig.agrupar === "familia" && !verSinClasificar && !config.filtros.familias.some((f) => f.id === 0);
  const apartado = apartar ? ex?.puntos.find((p) => p.clave === "0") ?? null : null;

  useEffect(() => setSeleccion(null), [params]);
  // En tablet la tira del punto elegido puede quedar por debajo: que se vea.
  // Se desplaza SOLO el tablero (scrollIntoView movía también la página).
  useEffect(() => {
    if (seleccion) desplazarDentro(tiraPunto.current, "nearest");
  }, [seleccion]);
  useEffect(() => {
    if (!pedirProducto) return;
    setPestanaFiltro("producto");
    setFiltroAbierto(true);
    setPrecioPendiente(true);
    desplazarDentro(raiz.current, "start");
  }, [pedirProducto]);

  const cambiar = (parcial: Partial<ConfigExplorador>) => {
    const r = ajustarConfig({ ...config, ...parcial });
    setAviso(r.aviso);
    onConfig(r.config);
  };
  const cambiarFiltros = (filtros: ConfigExplorador["filtros"]) => {
    if (precioPendiente && filtros.productos.length > 0) {
      setPrecioPendiente(false);
      cambiar({ filtros, medida: "precio" });
    } else cambiar({ filtros });
  };

  const peticion = (clave: string | null, claveDesglose: string | null, titulo: string, cifra: number | null): PeticionDocumentos => ({
    titulo,
    detalle: tituloConfig(exConfig),
    desde: periodo.desde,
    hasta: periodo.hasta,
    medida: exConfig.medida,
    agrupar: exConfig.agrupar,
    desglose: exConfig.desglose,
    filtros: params.p_filtros,
    clave,
    claveDesglose,
    top: config.top,
    cifra,
  });

  const punto: PuntoExploracion | undefined = seleccion ? ex?.puntos.find((p) => p.clave === seleccion) : undefined;
  const etiquetaPunto = (p: PuntoExploracion) => {
    const e = etiquetasClave(exConfig.agrupar, p.clave, p.etiqueta);
    return exConfig.agrupar === "proveedor" ? e.corta : e.larga;
  };
  // El tramo no se sale del periodo de la gráfica (la semana del 29 dic en un año que empieza el 1 ene).
  const accion = punto && ex ? accionDePunto(exConfig, punto, { desde: ex.parametros.desde, hasta: ex.parametros.hasta }) : null;
  const enlaceCompras = punto
    ? exConfig.agrupar === "mes"
      ? enlaceMesCompras(punto.clave, local)
      : exConfig.agrupar === "proveedor" && punto.id
        ? enlaceProveedorCompras(punto.id)
        : null
    : null;

  const exportar = () => {
    if (!ex) return;
    const titulo = `${tituloConfig(exConfig)} · ${textoPeriodo}`;
    const blob = new Blob([csvExploracion(ex, titulo)], { type: "text/csv;charset=utf-8" });
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compras-${exConfig.medida}-por-${exConfig.agrupar}${periodo.desde ? `-${periodo.desde}_${periodo.hasta}` : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const chipsFiltro: { clave: string; texto: string; quitar: () => void }[] = [
    ...(local ? [{ clave: `l-${local}`, texto: `Local: ${LOCALES[local]}`, quitar: () => onLocal("todos") }] : []),
    ...config.filtros.proveedores.map((p) => ({
      clave: `p-${p.id}`,
      texto: p.nombre,
      quitar: () => cambiar({ filtros: { ...config.filtros, proveedores: config.filtros.proveedores.filter((x) => x.id !== p.id) } }),
    })),
    ...config.filtros.familias.map((p) => ({
      clave: `f-${p.id}`,
      texto: p.nombre,
      quitar: () => cambiar({ filtros: { ...config.filtros, familias: config.filtros.familias.filter((x) => x.id !== p.id) } }),
    })),
    ...config.filtros.productos.map((p) => ({
      clave: `pr-${p}`,
      texto: bonito(p),
      quitar: () => cambiar({ filtros: { ...config.filtros, productos: config.filtros.productos.filter((x) => x !== p), unidad: null } }),
    })),
    ...config.filtros.tipos.map((t) => ({
      clave: `t-${t}`,
      texto: TIPOS_DOC.find((x) => x.valor === t)?.etiqueta ?? t,
      quitar: () => cambiar({ filtros: { ...config.filtros, tipos: config.filtros.tipos.filter((x) => x !== (t as TipoDoc)) } }),
    })),
  ];
  const hayFiltros = chipsFiltro.length > 0;
  const quitarFiltros = () => {
    if (local) onLocal("todos");
    cambiar({ filtros: { proveedores: [], familias: [], productos: [], tipos: [], unidad: null } });
  };
  const preset = presetActivo(config);

  let cuerpo;
  if (q.isLoading && !ex) {
    cuerpo = <div className="h-[300px] animate-pulse rounded-lg bg-muted/50" role="status" aria-label="Calculando la gráfica" />;
  } else if (q.isError && !ex) {
    cuerpo = <EstadoError titulo="No se ha podido calcular la gráfica" detalle={(q.error as Error)?.message} onReintentar={() => void q.refetch()} />;
  } else if (!ex || ex.sinDatos || ex.puntos.length === 0) {
    cuerpo = (
      <EstadoVacio
        icono={<BarChart3 />}
        titulo="No hay compras con esta combinación"
        texto={`Nada en ${textoPeriodo.toLowerCase()}${hayFiltros ? " con estos filtros" : ""}. Prueba otro periodo${hayFiltros ? " o quita filtros" : ""}.`}
        accion={hayFiltros ? { etiqueta: "Quitar los filtros", onClick: quitarFiltros } : undefined}
      />
    );
  } else {
    const descripcion = `${tituloConfig(exConfig)}. ${resumenExploracion(ex)}`;
    cuerpo = (
      <div className={cn("flex min-w-0 flex-col gap-2 transition-opacity", actualizando && "opacity-60")}>
        {tipo === "tabla" || verTabla ? (
          <TablaExploracion
            exploracion={ex}
            seleccion={seleccion}
            onSeleccion={listo ? (c) => setSeleccion((s) => (s === c ? null : c)) : undefined}
            onCelda={!listo ? undefined : (clave, serie) => {
              const p = ex.puntos.find((x) => x.clave === clave);
              const s = ex.series.find((x) => x.clave === serie);
              if (p && s) onDocumentos(peticion(clave, serie, `${etiquetaPunto(p)} · ${s.etiqueta}`, p.desglose?.[serie] ?? null));
            }}
            apartarSinClasificar={apartar}
          />
        ) : (
          <GraficaExplorador
            exploracion={ex}
            tipo={tipo}
            seleccion={seleccion}
            onSeleccion={listo ? (c) => setSeleccion((s) => (s === c ? null : c)) : undefined}
            apartarSinClasificar={apartar}
            descripcion={descripcion}
          />
        )}
        <p className="sr-only" aria-live="polite">
          {resumenExploracion(ex)}
        </p>
        {ex.resto && ex.resto.entidades > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              Y {formatEntero(ex.resto.entidades)} más fuera de la gráfica: <span className="font-medium tabular-nums text-foreground">{formatoValor(ex.resto.valor, ex.parametros.medida, ex.parametros.unidad)}</span>
            </span>
            <button
              type="button"
              className={cn(ACCION, "px-1.5 text-xs text-primary", FOCO)}
              disabled={!listo}
              onClick={() => onDocumentos(peticion("__otros__", null, `Otros (${formatEntero(ex.resto?.entidades ?? 0)})`, ex.resto?.valor ?? null))}
            >
              Ver sus documentos
            </button>
          </p>
        )}
        {apartado && (
          <p className="flex flex-wrap items-center gap-x-2 rounded-md bg-muted/50 px-2 text-xs text-muted-foreground">
            <span className="py-1">
              Sin clasificar: <span className="font-medium tabular-nums text-foreground">{formatoValor(apartado.valor, ex.parametros.medida, ex.parametros.unidad)}</span> (
              {formatEntero(apartado.documentos)} docs.), fuera de la gráfica para que se vean las familias.
            </span>
            <button type="button" className={cn(ACCION, "px-1.5 text-xs text-primary", FOCO)} onClick={() => setVerSinClasificar(true)}>
              Incluirlo
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      ref={raiz}
      aria-labelledby={idTitulo}
      className="flex min-w-0 scroll-mt-2 flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4"
      data-testid="explorador"
      data-tour="facturas-analisis-explorador"
    >
      {/* Cabecera */}
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {/* min-w: con poco ancho, los botones bajan a otra línea en vez de aplastar el título. */}
        <div className="min-w-[12rem] flex-1">
          <h3 id={idTitulo} className="flex items-center gap-2 text-base font-semibold leading-tight text-foreground">
            Explorar
            {actualizando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Actualizando" />}
          </h3>
          <p className="mt-0.5 line-clamp-2 break-words text-sm text-muted-foreground">
            {tituloConfig(config)} · {textoPeriodo}
          </p>
          {volverTramo && (
            <button type="button" className={cn(ACCION, "-ml-2.5 text-primary", FOCO)} onClick={volverTramo.volver}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Volver {volverTramo.texto}
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-0.5">
          <button type="button" className={cn(ACCION, FOCO)} aria-pressed={verTabla || tipo === "tabla"} onClick={() => setVerTabla((v) => !v)} disabled={tipo === "tabla"}>
            <Table2 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Ver como tabla</span>
            <span className="sr-only sm:hidden">Ver como tabla</span>
          </button>
          <button type="button" className={cn(ACCION, FOCO)} onClick={exportar} disabled={!ex || ex.sinDatos}>
            <ArrowDownToLine className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">CSV</span>
            <span className="sr-only sm:hidden">Exportar CSV</span>
          </button>
          <button
            type="button"
            className={cn(ACCION, FOCO, fijada && "text-primary")}
            aria-pressed={fijada}
            onClick={() => {
              if (fijada) return onQuitarFijada(idFijada);
              // Caben 8: la 9.ª quita la más antigua, y se avisa (QA 05/11/2026).
              setAviso(
                fijadas.size >= MAX_EXPLORACIONES_FIJADAS
                  ? `Caben ${MAX_EXPLORACIONES_FIJADAS} gráficas fijadas: para dejar esta se ha quitado la más antigua.`
                  : null,
              );
              onFijar(config);
            }}
          >
            {fijada ? <PinOff className="h-4 w-4" aria-hidden /> : <Pin className="h-4 w-4" aria-hidden />}
            {fijada ? "Fijada" : "Fijar en el tablero"}
          </button>
        </div>
      </header>

      {/* Presets de un toque */}
      <div role="group" aria-label="Gráficas rápidas" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => {
              const base = aplicarPreset(config, p);
              setAviso(null);
              if (p.pideProducto && base.filtros.productos.length === 0) {
                onConfig({ ...base, medida: "gasto" });
                setPestanaFiltro("producto");
                setPrecioPendiente(true);
                setFiltroAbierto(true);
              } else onConfig(base);
            }}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              "aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-foreground",
              FOCO,
            )}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {/* Estantería */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto]">
        <Campo etiqueta="Medida">
          <Select value={config.medida} onValueChange={(v) => cambiar({ medida: v as ConfigExplorador["medida"] })}>
            <SelectTrigger className="h-11" aria-label="Medida">
              <SelectValue>
                {infoMedida(config.medida).etiqueta}
                {infoMedida(config.medida).iva && <span className="text-muted-foreground"> · {infoMedida(config.medida).iva}</span>}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MEDIDAS.map((m) => {
                const motivo = motivoMedidaNoDisponible(m.valor, config);
                return (
                  <SelectItem key={m.valor} value={m.valor} disabled={!!motivo} className="min-h-11">
                    <span className="flex flex-col">
                      <span>
                        {m.etiqueta}
                        {m.iva && <span className="text-muted-foreground"> · {m.iva}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{motivo ?? m.ayuda}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Campo>
        <Campo etiqueta="Eje">
          <Select value={config.agrupar} onValueChange={(v) => cambiar({ agrupar: v as ConfigExplorador["agrupar"] })}>
            <SelectTrigger className="h-11" aria-label="Agrupar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGRUPACIONES.map((a) => (
                <SelectItem key={a.valor} value={a.valor} className="min-h-11">
                  {a.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo etiqueta="Color">
          <Select value={config.desglose ?? "ninguno"} onValueChange={(v) => cambiar({ desglose: v === "ninguno" ? null : (v as ConfigExplorador["desglose"]) })}>
            <SelectTrigger className="h-11" aria-label="Desglosar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ninguno" className="min-h-11">
                Sin desglose
              </SelectItem>
              {DESGLOSES.filter((d) => d.valor !== config.agrupar).map((d) => (
                <SelectItem key={d.valor} value={d.valor} className="min-h-11">
                  {d.etiqueta}
                  {d.valor === "proveedor" ? ` (los ${config.top} primeros)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo etiqueta="Gráfica">
          <Select value={config.grafica} onValueChange={(v) => cambiar({ grafica: v as ConfigExplorador["grafica"] })}>
            <SelectTrigger className="h-11" aria-label="Tipo de gráfica">
              <SelectValue>{config.grafica === "auto" ? "Automática" : GRAFICAS.find((g) => g.valor === config.grafica)?.etiqueta}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="min-h-11">
                Automática ({GRAFICAS.find((g) => g.valor === graficaEfectiva({ ...config, grafica: "auto" }))?.etiqueta.toLowerCase()})
              </SelectItem>
              {GRAFICAS.filter((g) => g.valor !== "apiladas" || config.desglose).map((g) => (
                <SelectItem key={g.valor} value={g.valor} className="min-h-11">
                  {g.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        {(config.agrupar === "proveedor" || config.agrupar === "producto" || config.desglose === "proveedor") && (
          <Campo etiqueta="Cuántos" className="col-span-2 sm:col-span-1">
            <Select value={String(config.top)} onValueChange={(v) => cambiar({ top: Number(v) })}>
              <SelectTrigger className="h-11 min-w-[6.5rem]" aria-label="Cuántos se enseñan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20, 30, 50].map((n) => (
                  <SelectItem key={n} value={String(n)} className="min-h-11">
                    Los {n} primeros
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        )}
        <Campo etiqueta="Filtros">
          <AnadirFiltro
            config={config}
            onFiltros={cambiarFiltros}
            abierto={filtroAbierto}
            onAbierto={(o) => {
              setFiltroAbierto(o);
              if (!o) setPrecioPendiente(false);
            }}
            pestana={pestanaFiltro}
            onPestana={setPestanaFiltro}
          />
        </Campo>
      </div>

      {/* Filtros puestos (solo si hay) */}
      {(hayFiltros || ((config.medida === "cantidad" || config.medida === "precio") && (ex?.unidades?.length ?? 0) > 1)) && (
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros puestos">
        <Filter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {chipsFiltro.map((c) => (
          <span key={c.clave} className={cn(CHIP, "bg-muted/40")}>
            <span className="line-clamp-2 max-w-[14rem] break-words py-1">{c.texto}</span>
            <button
              type="button"
              onClick={c.quitar}
              className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted pointer-coarse:h-11 pointer-coarse:w-11", FOCO)}
              aria-label={`Quitar filtro: ${c.texto}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ))}
        {(config.medida === "cantidad" || config.medida === "precio") && ex?.unidades && ex.unidades.length > 1 && (
          <Select value={config.filtros.unidad ?? ex.parametros.unidad ?? ""} onValueChange={(v) => cambiar({ filtros: { ...config.filtros, unidad: v } })}>
            <SelectTrigger className="h-11 w-auto min-w-[9rem] rounded-full" aria-label="Unidad">
              <span className="text-muted-foreground">Unidad:&nbsp;</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ex.unidades.map((u) => (
                <SelectItem key={u.unidad} value={u.unidad} className="min-h-11">
                  {u.unidad} ({formatEntero(u.lineas)} líneas)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hayFiltros && (
          <button type="button" onClick={quitarFiltros} className={cn(ACCION, "text-xs", FOCO)}>
            Quitar todos
          </button>
        )}
      </div>
      )}

      {aviso && (
        <p className="flex items-start gap-1.5 rounded-md bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-900 dark:text-sky-200" role="status">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {aviso}
        </p>
      )}
      {ex?.parametros.soloProductos && (
        <p className="text-xs text-muted-foreground">Solo productos: sin portes, servicios, envases ni energía.</p>
      )}

      {ex && !ex.sinDatos && (
        <Totales
          ex={ex}
          config={exConfig}
          sinClasificarAparte={!!apartado}
          onVerDocumentos={listo ? () => onDocumentos(peticion(null, null, `${tituloConfig(exConfig)}`, ex.total.valor)) : undefined}
        />
      )}

      {cuerpo}

      {/* Punto elegido */}
      {/* La cifra en su línea y los botones debajo: en el móvil se pisaban (QA 05/11/2026). */}
      {punto && ex && listo && (
        <div
          ref={tiraPunto}
          className="flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5"
          role="region"
          aria-label="Punto elegido"
        >
          <p className="min-w-0 basis-full break-words pt-1 text-sm">
            <span className="font-medium">{etiquetaPunto(punto)}</span>
            <span className="ml-2 tabular-nums">{formatoValor(punto.valor, ex.parametros.medida, ex.parametros.unidad)}</span>
            <span className="ml-2 text-xs text-muted-foreground">{formatEntero(punto.documentos)} docs.</span>
          </p>
          {accion && (
            <button
              type="button"
              className={cn(ACCION, "text-foreground", FOCO)}
              onClick={() => {
                if (accion.tipo === "tramo") {
                  onTramo(accion.desde, accion.hasta);
                  if (accion.eje !== config.agrupar) cambiar({ agrupar: accion.eje });
                } else if (accion.tipo === "filtro") cambiar({ filtros: accion.filtros });
                else onLocal(accion.local);
                setSeleccion(null);
              }}
            >
              <Filter className="h-4 w-4" aria-hidden />
              {accion.tipo === "tramo" ? "Ver solo este tramo" : accion.tipo === "local" ? `Ver solo ${LOCALES[accion.local]}` : accion.etiqueta}
            </button>
          )}
          <button
            type="button"
            className={cn(ACCION, "text-primary", FOCO)}
            onClick={() => onDocumentos(peticion(punto.clave, null, etiquetaPunto(punto), punto.valor))}
            disabled={punto.documentos === 0}
          >
            Ver documentos
          </button>
          {enlaceCompras && onIrA && (
            <button type="button" className={cn(ACCION, FOCO)} onClick={() => onIrA(enlaceCompras)}>
              Abrir en Compras
            </button>
          )}
          <button type="button" className={cn(ACCION, "ml-auto px-2", FOCO)} onClick={() => setSeleccion(null)} aria-label="Quitar la selección">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {!punto && ex && !ex.sinDatos && ex.puntos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <ChevronDown className="mr-1 inline h-3 w-3 -rotate-90" aria-hidden />
          Toca una barra o un punto para {esTiempo(exConfig.agrupar) ? "ver solo ese tramo" : "filtrar por él"} o ver sus documentos.
        </p>
      )}
    </section>
  );
}
