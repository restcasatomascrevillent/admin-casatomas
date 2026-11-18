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
 *
 * 18/11/2026, petición del dueño: «que tú elijas el mes y ya cuando entres a
 * cualquier informe te detecte ese mes». Arriba de la página va el MES DE LOS
 * INFORMES (◀ desplegable ▶): se elige una vez y se queda al cambiar de informe
 * (en la URL y, para volver luego en la misma pestaña, en sessionStorage). Los
 * informes por meses salen de ese mes sin más selector; los de fechas empiezan
 * por ese mes entero (y se pueden ajustar); los que no van por fechas lo ignoran.
 */
import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, FileBarChart2, FileSpreadsheet, FileText } from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarcoInforme } from "@/components/informes/MarcoInforme";
import { GeneradorTabla } from "@/components/informes/GeneradorTabla";
import { useFuenteInforme } from "@/components/informes/useFuenteInforme";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useUserRole } from "@/hooks/useUserRole";
import { atajosRango, mesDeLaPagina, mesesPorDefecto, periodoEnUrl, rangoDeMes, textoMes, textoPeriodo, validarRango, type OpcionMes, type Periodo } from "@/lib/informes/periodo";
import { buscarInforme, informesPorSeccion, type DefinicionInforme, type PropsGeneradorInforme } from "@/lib/informes/registro";
import { cn } from "@/lib/utils";

const ISO = "yyyy-MM-dd";
/** Suelo (px) del alto de la página: por debajo vuelve el scroll de página. */
const ALTURA_MINIMA_INFORMES = 480;
/** Último mes elegido en esta pestaña (sessionStorage): al volver a Informes sigue el mismo. */
export const CLAVE_MES_INFORMES = "casa-tomas:informes:mes";

function leerMesGuardado(): string | null {
  try {
    return window.sessionStorage.getItem(CLAVE_MES_INFORMES);
  } catch {
    return null;
  }
}
function guardarMes(mes: string) {
  try {
    window.sessionStorage.setItem(CLAVE_MES_INFORMES, mes);
  } catch {
    /* modo privado o almacenamiento bloqueado: se queda solo en la URL */
  }
}

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

function SelectorRango({
  desde,
  hasta,
  hoy,
  mes,
  onCambio,
}: {
  desde: string;
  hasta: string;
  hoy: string;
  /** El mes de la página: primera opción, «Todo octubre de 2026». */
  mes: string;
  onCambio: (r: { desde: string; hasta: string }) => void;
}) {
  const atajos = useMemo(() => {
    const delMes = { id: "mes-elegido", etiqueta: `Todo ${textoMes(mes)}`, ...rangoDeMes(mes) };
    return [delMes, ...atajosRango(hoy).filter((a) => a.desde !== delMes.desde || a.hasta !== delMes.hasta)];
  }, [hoy, mes]);
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
        <SelectTrigger aria-label="Periodo del informe" className="h-11 w-full sm:w-[230px]">
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
/** Lo que se ve en la cabecera del informe cuando no hay nada que elegir: el mes de la página o «Todos los datos». */
function ChipPeriodo({ texto, etiqueta, soloEscritorio = false }: { texto: string; etiqueta: string; soloEscritorio?: boolean }) {
  return (
    <span
      aria-label={`${etiqueta}: ${texto}`}
      // En el móvil, el mes ya se ve justo encima (barra del mes): no se repite.
      className={cn("h-11 w-full items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm font-medium sm:w-auto", soloEscritorio ? "hidden sm:inline-flex" : "inline-flex")}
    >
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {texto}
    </span>
  );
}

function PanelInforme({
  definicion,
  hoy,
  mes,
  periodo,
  onPeriodo,
}: {
  definicion: DefinicionInforme;
  hoy: string;
  mes: string;
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
}) {
  const fuenteLista = useFuenteInforme(true);
  const selector =
    periodo.tipo === "rango" ? (
      // key: al cambiar el mes de la página, el selector vuelve a «Todo <mes>».
      <SelectorRango key={mes} desde={periodo.desde} hasta={periodo.hasta} hoy={hoy} mes={mes} onCambio={(r) => onPeriodo({ tipo: "rango", ...r })} />
    ) : periodo.tipo === "mes" ? (
      <ChipPeriodo etiqueta="Mes del informe" texto={textoPeriodo(periodo)} soloEscritorio />
    ) : (
      <ChipPeriodo etiqueta="Periodo del informe" texto="Todos los datos" />
    );
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
                        {def.periodo === "mes" ? "Del mes elegido" : def.periodo === "rango" ? "Del mes elegido o de las fechas que quieras" : "Sin fechas: todos los datos"}
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
      <p className="max-w-sm text-sm text-muted-foreground">Escoge uno de la lista: saldrá del mes que tienes arriba, con su vista previa, y podrás descargarlo en PDF (o en CSV para Excel).</p>
    </div>
  );
}

// ─── Mes de la página ────────────────────────────────────────────────────────
/** ◀ desplegable ▶. `meses` va del más nuevo (el que está en curso) al más viejo. */
function SelectorMesPagina({ mes, meses, onCambio }: { mes: string; meses: OpcionMes[]; onCambio: (mes: string) => void }) {
  const i = meses.findIndex((m) => m.clave === mes);
  const anterior = i >= 0 && i < meses.length - 1 ? meses[i + 1].clave : null;
  const siguiente = i > 0 ? meses[i - 1].clave : null;
  return (
    <div className="flex w-full items-center gap-1.5 sm:w-auto">
      <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Mes anterior" disabled={!anterior} onClick={() => anterior && onCambio(anterior)}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Button>
      <Select value={mes} onValueChange={onCambio}>
        <SelectTrigger aria-label="Mes de los informes" className="h-11 min-w-0 flex-1 gap-2 font-medium sm:w-[250px] sm:flex-none">
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {meses.map((m) => (
            <SelectItem key={m.clave} value={m.clave}>
              {m.etiqueta}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Mes siguiente" disabled={!siguiente} onClick={() => siguiente && onCambio(siguiente)}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

function BarraMes({ mes, meses, onCambio }: { mes: string; meses: OpcionMes[]; onCambio: (mes: string) => void }) {
  const enCurso = meses.find((m) => m.clave === mes)?.enCurso ?? false;
  const nombre = textoMes(mes);
  return (
    <section
      aria-label="Mes de los informes"
      className="flex shrink-0 flex-col gap-2 rounded-lg border bg-background px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4"
    >
      <div className="min-w-0">
        <h1 className="text-base font-semibold leading-tight">
          Informes de {nombre}
          {enCurso && <span className="ml-1.5 text-sm font-normal text-muted-foreground">(mes en curso)</span>}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Elige el mes una vez: cualquier informe que abras sale de ese mes.</p>
      </div>
      <SelectorMesPagina mes={mes} meses={meses} onCambio={onCambio} />
    </section>
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

  // El mes de la página: el de la URL, el último elegido en esta pestaña o el último mes cerrado.
  const meses = useMemo(() => mesesPorDefecto(hoy), [hoy]);
  const mesUrl = params.get("mes");
  const mes = mesDeLaPagina(hoy, mesUrl, leerMesGuardado(), meses);
  useEffect(() => guardarMes(mes), [mes]);

  const periodo = useMemo<Periodo | null>(() => {
    if (!elegido) return null;
    if (elegido.periodo === "ninguno") return { tipo: "ninguno" };
    if (elegido.periodo === "mes") {
      // Un informe con su propia lista de meses: si el de la página no está, el suyo por defecto.
      const propios = elegido.meses?.(hoy);
      const vale = !propios || propios.some((m) => m.clave === mes);
      return { tipo: "mes", mes: vale ? mes : (elegido.mesPorDefecto?.(hoy) ?? propios[0]?.clave ?? mes) };
    }
    // Fechas a medida en la URL (si las hay); si no, el mes de la página entero.
    const rango = validarRango(params.get("desde"), params.get("hasta"));
    return { tipo: "rango", ...(rango ?? rangoDeMes(mes)) };
  }, [elegido, hoy, mes, params]);

  /** Cambia la URL conservando siempre el mes de la página. */
  const ir = (siguiente: Record<string, string>, reemplazar: boolean) => setParams({ ...siguiente, mes }, { replace: reemplazar });
  const elegir = (id: string | null) => {
    const def = buscarInforme(id, visibles);
    ir(def ? { informe: def.id } : {}, false);
  };
  const cambiarPeriodo = (p: Periodo) => elegido && ir({ informe: elegido.id, ...(p.tipo === "rango" ? periodoEnUrl(p) : {}) }, true);
  // Otro mes: las fechas a medida de un informe de rango se descartan (vuelve a «Todo <mes>»).
  const cambiarMes = (m: string) => setParams({ ...(elegido ? { informe: elegido.id } : {}), mes: m }, { replace: true });

  // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página): la lista y la vista previa con scroll propio.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_INFORMES);

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} className="flex min-h-0 flex-col gap-3" style={alto ? { height: alto } : undefined}>
        {!cargando && grupos.length > 0 && <BarraMes mes={mes} meses={meses} onCambio={cambiarMes} />}
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
          <aside
            aria-label="Lista de informes"
            className={cn("flex min-h-0 flex-col gap-3 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:pr-1", elegido && "max-lg:hidden")}
          >
            <p className="px-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Todos los informes del panel.</span> Elige uno para verlo y descargarlo.
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
                  <PanelInforme key={elegido.id} definicion={elegido} hoy={hoy} mes={mes} periodo={periodo} onPeriodo={cambiarPeriodo} />
                </div>
              </>
            ) : !cargando && grupos.length > 0 ? (
              <EstadoElige />
            ) : null}
          </main>
        </div>
      </div>
    </SuperAdminLayout>
  );
}
