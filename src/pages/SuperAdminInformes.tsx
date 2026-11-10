/**
 * Super Admin › Informes (/super-admin/informes), 10/11/2026: todos los
 * informes del panel en un sitio. Petición del dueño: «Añade un módulo en el
 * superadmin que sea Informes donde se puedan generar todos los informes que
 * hay a lo largo del superadmin de forma centralizada».
 *
 * A la izquierda (arriba en el móvil), los informes por sección, solo los que
 * el usuario puede ver (`informesPorSeccion`); al elegir uno se escoge el
 * periodo y sale la vista previa en diapositivas, con la descarga en PDF (y en
 * CSV los de tabla), con el mismo marco que «Generar informe» de Tráfico web.
 * La lista sale del registro `src/lib/informes/registro.ts`: para añadir un
 * informe no hay que tocar esta página.
 *
 * El informe y el periodo van en la URL (?informe=…&mes=… o &desde=…&hasta=…).
 */
import { createContext, lazy, Suspense, useContext, useMemo, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, ChevronRight, FileBarChart2, FileSpreadsheet, FileText } from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarcoInforme, SelectorMes } from "@/components/informes/MarcoInforme";
import { GeneradorTabla } from "@/components/informes/GeneradorTabla";
import { useFuenteInforme } from "@/components/informes/useFuenteInforme";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useUserRole } from "@/hooks/useUserRole";
import { atajosRango, mesesPorDefecto, periodoEnUrl, periodoInicial, validarRango, type Periodo } from "@/lib/informes/periodo";
import { buscarInforme, informesPorSeccion, type DefinicionInforme, type PropsGeneradorInforme } from "@/lib/informes/registro";
import { cn } from "@/lib/utils";

const ISO = "yyyy-MM-dd";
/** Suelo (px) del alto de la página: por debajo vuelve el scroll de página. */
const ALTURA_MINIMA_INFORMES = 480;

// ─── Marco de la página ──────────────────────────────────────────────────────
// Cada generador pinta su contenido dentro de `Marco`. Es un componente fijo (no
// se crea en cada render, o la vista previa se montaría de nuevo a cada cambio) que
// lee del contexto el informe y el selector de periodo.
const ContextoMarco = createContext<{ definicion: DefinicionInforme; selector: ReactNode; fuenteLista: boolean } | null>(null);

function MarcoPagina({ acciones, children }: { acciones: ReactNode; children: ReactNode }) {
  const c = useContext(ContextoMarco);
  if (!c) return null;
  const { definicion, selector, fuenteLista } = c;
  return (
    <MarcoInforme
      titulo={definicion.titulo}
      fuenteLista={fuenteLista}
      testId="vista-informe"
      descripcion={
        <>
          {definicion.descripcion}
          {definicion.origen && (
            <>
              {" "}
              También en{" "}
              <Link to={definicion.origen.ruta} className="underline underline-offset-2 hover:text-foreground">
                {definicion.origen.etiqueta}
              </Link>
              .
            </>
          )}
        </>
      }
      controles={
        <>
          {selector}
          {acciones}
        </>
      }
    >
      {children}
    </MarcoInforme>
  );
}

// Los generadores con diapositivas propias se cargan al elegirlos (un lazy por informe, siempre el mismo).
const generadoresCargados = new Map<string, LazyExoticComponent<ComponentType<PropsGeneradorInforme>>>();
function generadorDe(def: DefinicionInforme): LazyExoticComponent<ComponentType<PropsGeneradorInforme>> | null {
  if (def.generador.tipo !== "componente") return null;
  let c = generadoresCargados.get(def.id);
  if (!c) {
    c = lazy(def.generador.cargar);
    generadoresCargados.set(def.id, c);
  }
  return c;
}

function Esqueletos() {
  return <>{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="aspect-video w-full rounded-md" />)}</>;
}

// ─── Selector de periodo ─────────────────────────────────────────────────────
const PERSONALIZADO = "personalizado";

function SelectorRango({ desde, hasta, hoy, onCambio }: { desde: string; hasta: string; hoy: string; onCambio: (r: { desde: string; hasta: string }) => void }) {
  const atajos = useMemo(() => atajosRango(hoy), [hoy]);
  const atajo = atajos.find((a) => a.desde === desde && a.hasta === hasta)?.id;
  const [personalizado, setPersonalizado] = useState(!atajo);
  const [borrador, setBorrador] = useState({ desde, hasta });
  const valor = personalizado || !atajo ? PERSONALIZADO : atajo;
  const mal = validarRango(borrador.desde, borrador.hasta) === null;

  const cambiarBorrador = (campo: "desde" | "hasta", v: string) => {
    const nuevo = { ...borrador, [campo]: v };
    setBorrador(nuevo);
    const r = validarRango(nuevo.desde, nuevo.hasta);
    if (r) onCambio(r);
  };

  return (
    <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
      <Select
        value={valor}
        onValueChange={(v) => {
          if (v === PERSONALIZADO) {
            setPersonalizado(true);
            setBorrador({ desde, hasta });
            return;
          }
          const a = atajos.find((x) => x.id === v);
          if (!a) return;
          setPersonalizado(false);
          setBorrador({ desde: a.desde, hasta: a.hasta });
          onCambio({ desde: a.desde, hasta: a.hasta });
        }}
      >
        <SelectTrigger aria-label="Periodo del informe" className="h-11 w-full sm:w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {atajos.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.etiqueta}
            </SelectItem>
          ))}
          <SelectItem value={PERSONALIZADO}>Personalizado…</SelectItem>
        </SelectContent>
      </Select>
      {valor === PERSONALIZADO && (
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
          <div className="grid gap-1">
            <Label htmlFor="informe-desde" className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input id="informe-desde" type="date" className="h-11 sm:w-[150px]" value={borrador.desde} max={borrador.hasta || undefined} aria-invalid={mal} onChange={(e) => cambiarBorrador("desde", e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="informe-hasta" className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input id="informe-hasta" type="date" className="h-11 sm:w-[150px]" value={borrador.hasta} min={borrador.desde || undefined} aria-invalid={mal} onChange={(e) => cambiarBorrador("hasta", e.target.value)} />
          </div>
          {mal && (
            <p role="alert" className="col-span-2 text-xs text-destructive">
              «Desde» tiene que ser una fecha anterior o igual a «Hasta».
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel del informe elegido ───────────────────────────────────────────────
function PanelInforme({ definicion, hoy, periodo, onPeriodo }: { definicion: DefinicionInforme; hoy: string; periodo: Periodo; onPeriodo: (p: Periodo) => void }) {
  const fuenteLista = useFuenteInforme(true);
  const meses = useMemo(() => definicion.meses?.(hoy) ?? mesesPorDefecto(hoy), [definicion, hoy]);
  const selector =
    periodo.tipo === "mes" ? (
      <SelectorMes valor={periodo.mes} onCambio={(mes) => onPeriodo({ tipo: "mes", mes })} meses={meses} />
    ) : periodo.tipo === "rango" ? (
      <SelectorRango desde={periodo.desde} hasta={periodo.hasta} hoy={hoy} onCambio={(r) => onPeriodo({ tipo: "rango", ...r })} />
    ) : null;
  const Generador = generadorDe(definicion);
  // Se crea en cada render (el selector cambia): solo re-renderiza el marco, no monta de nuevo la vista previa.
  const contexto = { definicion, selector, fuenteLista };

  return (
    <ContextoMarco.Provider value={contexto}>
      <ErrorBoundary titulo="No se ha podido abrir este informe" contexto={`informes/${definicion.id}`} resetKey={definicion.id}>
        {Generador ? (
          <Suspense
            fallback={
              <MarcoPagina acciones={null}>
                <Esqueletos />
              </MarcoPagina>
            }
          >
            <Generador periodo={periodo} hoy={hoy} Marco={MarcoPagina} />
          </Suspense>
        ) : (
          <GeneradorTabla definicion={definicion} periodo={periodo} hoy={hoy} Marco={MarcoPagina} />
        )}
      </ErrorBoundary>
    </ContextoMarco.Provider>
  );
}

// ─── Lista de informes ───────────────────────────────────────────────────────
function IconoFormatos({ def }: { def: DefinicionInforme }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {def.formatos.includes("pdf") && <FileText className="h-3.5 w-3.5" aria-hidden />}
      {def.formatos.includes("csv") && <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />}
      {def.formatos.join(" · ")}
    </span>
  );
}

function ListaInformes({
  grupos,
  elegido,
  onElegir,
}: {
  grupos: ReturnType<typeof informesPorSeccion>;
  elegido: string | null;
  onElegir: (id: string) => void;
}) {
  return (
    <nav aria-label="Informes disponibles" className="flex flex-col gap-4">
      {grupos.map(({ seccion, informes }) => (
        <section key={seccion.id} aria-labelledby={`grupo-informes-${seccion.id}`}>
          <h2 id={`grupo-informes-${seccion.id}`} className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {seccion.titulo}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {informes.map((def) => {
              const activo = def.id === elegido;
              return (
                <li key={def.id}>
                  <button
                    type="button"
                    onClick={() => onElegir(def.id)}
                    aria-current={activo ? "true" : undefined}
                    className={cn(
                      "flex min-h-11 w-full items-start gap-3 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      activo && "border-foreground/50 bg-muted ring-1 ring-foreground/20 hover:bg-muted",
                    )}
                  >
                    <FileBarChart2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{def.titulo}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {def.periodo === "mes" ? "Por meses" : def.periodo === "rango" ? "Del periodo que elijas" : "Todos los datos"}
                      </span>
                    </span>
                    <IconoFormatos def={def} />
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground lg:hidden" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function EstadoSinInformes() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-background px-6 py-14 text-center">
      <div className="rounded-full bg-muted p-3">
        <FileBarChart2 className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="font-medium">No tienes informes disponibles</p>
      <p className="max-w-md text-sm text-muted-foreground">Cada informe sale a quien tiene permiso en su sección. Pide a un super admin que te dé acceso en Usuarios.</p>
    </div>
  );
}

function EstadoElige() {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-background px-6 py-14 text-center">
      <FileBarChart2 className="h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">Elige un informe</p>
      <p className="max-w-sm text-sm text-muted-foreground">Escoge uno de la lista y su periodo: saldrá la vista previa y podrás descargarlo en PDF (o en CSV para Excel).</p>
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────
export default function SuperAdminInformes() {
  const hoy = format(new Date(), ISO);
  const [params, setParams] = useSearchParams();
  const { isSuperAdmin, loading: cargandoSuper } = useSuperAdmin();
  const { permissions, loading: cargandoPermisos } = useUserRole();
  const cargando = cargandoSuper || cargandoPermisos;

  const grupos = useMemo(() => informesPorSeccion({ esSuperAdmin: isSuperAdmin, permisos: permissions }), [isSuperAdmin, permissions]);
  const visibles = useMemo(() => grupos.flatMap((g) => g.informes), [grupos]);
  const elegido = buscarInforme(params.get("informe"), visibles);

  const periodo = useMemo<Periodo | null>(() => {
    if (!elegido) return null;
    return periodoInicial(
      elegido.periodo,
      hoy,
      { mes: params.get("mes"), desde: params.get("desde"), hasta: params.get("hasta") },
      elegido.periodo === "mes" ? { meses: elegido.meses?.(hoy), mesPorDefecto: elegido.mesPorDefecto?.(hoy) } : undefined,
    );
  }, [elegido, hoy, params]);

  const elegir = (id: string | null, p?: Periodo) => {
    const def = buscarInforme(id, visibles);
    const siguiente: Record<string, string> = def ? { informe: def.id, ...(p ? periodoEnUrl(p) : {}) } : {};
    setParams(siguiente, { replace: !!(def && elegido && def.id === elegido.id) });
  };

  // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página): la lista y la vista previa con scroll propio.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_INFORMES);

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} className="flex min-h-0 flex-col gap-3 lg:flex-row lg:gap-4" style={alto ? { height: alto } : undefined}>
        <aside
          aria-label="Lista de informes"
          className={cn("flex min-h-0 flex-col gap-3 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:pr-1", elegido && "max-lg:hidden")}
        >
          <p className="px-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Todos los informes del panel.</span> Elige uno y su periodo para verlo y descargarlo.
          </p>
          {cargando ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando informes">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : grupos.length === 0 ? (
            <EstadoSinInformes />
          ) : (
            <ListaInformes grupos={grupos} elegido={elegido?.id ?? null} onElegir={(id) => elegir(id)} />
          )}
        </aside>

        <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-2", !elegido && "max-lg:hidden")}>
          {elegido && periodo ? (
            <>
              <Button variant="ghost" className="h-11 w-fit gap-2 px-2 lg:hidden" onClick={() => elegir(null)}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Todos los informes
              </Button>
              <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-lg border bg-background lg:min-h-0">
                <PanelInforme key={elegido.id} definicion={elegido} hoy={hoy} periodo={periodo} onPeriodo={(p) => elegir(elegido.id, p)} />
              </div>
            </>
          ) : !cargando && grupos.length > 0 ? (
            <EstadoElige />
          ) : null}
        </main>
      </div>
    </SuperAdminLayout>
  );
}
