import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { AlertCircle, CalendarDays, Edit2, Loader2, RefreshCw, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

// ---------------------------------------------------------------------------
// Menús diarios y tapas (tablas `menus_diarios` y `tapas`)
//
// Cada día se guarda como TRES filas (idiom es/en/fr) con la misma fecha y
// ids distintos: la fecha es lo que las une. casa-tomas-story
// (EspaciosSection) las lee en vivo, ordenadas por fecha, y para "hoy" coge
// la primera fila con la fecha de hoy.
// ---------------------------------------------------------------------------

type SeccionEspecial = "menus_diarios" | "tapas";

const SECCION_CONFIG: Record<
  SeccionEspecial,
  {
    table: "menus_diarios" | "tapas";
    descripcion: string;
    singular: string;
    articulo: string;
    origenRebuild: string;
  }
> = {
  menus_diarios: {
    table: "menus_diarios",
    descripcion: "Se muestra en la sección «Espacios» de la web de Casa Tomás.",
    singular: "menú",
    articulo: "el",
    origenRebuild: "menu",
  },
  tapas: {
    table: "tapas",
    descripcion: "Se muestran en la sección «Espacios» de la web de Casa Tomás.",
    singular: "tapas",
    articulo: "las",
    origenRebuild: "tapas",
  },
};

interface MenuJson {
  primero: string;
  segundo: string;
  postre: string;
}

interface Registro {
  /** Clave real: es/en/fr comparten fecha, no id. */
  fecha: string;
  menu?: MenuJson;
  tapas?: string[];
}

const hoyLocal = () => new Date().toLocaleDateString("sv-SE");

const formatearFechaLarga = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

const parseMenuJson = (value: unknown): MenuJson => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { primero: "", segundo: "", postre: "" };
  }
  const obj = value as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : "");
  return {
    primero: texto(obj.primero ?? obj.primeros),
    segundo: texto(obj.segundo ?? obj.segundos),
    postre: texto(obj.postre ?? obj.postres),
  };
};

const parseTapasJson = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const lineas = (text: string) =>
  text
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

interface EditorMenuTapasWebProps {
  seccionActiva: SeccionEspecial;
}

export function EditorMenuTapasWeb({ seccionActiva }: EditorMenuTapasWebProps) {
  const config = SECCION_CONFIG[seccionActiva];
  const esMenu = seccionActiva === "menus_diarios";

  const [registros, setRegistros] = useState<Registro[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [registroAEliminar, setRegistroAEliminar] = useState<Registro | null>(null);

  /** Fecha del registro que se está editando (null = nuevo). */
  const [editandoFecha, setEditandoFecha] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoyLocal);
  const [primero, setPrimero] = useState("");
  const [segundo, setSegundo] = useState("");
  const [postre, setPostre] = useState("");
  const [tapasTexto, setTapasTexto] = useState("");
  const formRef = useRef<HTMLDivElement>(null);

  const cargarDatos = useCallback(async () => {
    setIsLoading(true);
    setErrorCarga(null);
    try {
      if (esMenu) {
        const { data, error } = await supabase
          .from("menus_diarios")
          .select("id, fecha, menu")
          .eq("idiom", "es")
          .order("fecha", { ascending: false });
        if (error) throw error;
        // Una entrada por fecha (si hubiera duplicados antiguos, gana la primera).
        const porFecha = new Map<string, Registro>();
        (data ?? []).forEach((row) => {
          if (!porFecha.has(row.fecha)) porFecha.set(row.fecha, { fecha: row.fecha, menu: parseMenuJson(row.menu) });
        });
        setRegistros(Array.from(porFecha.values()));
      } else {
        const { data, error } = await supabase
          .from("tapas")
          .select("id, fecha, tapas")
          .eq("idiom", "es")
          .order("fecha", { ascending: false });
        if (error) throw error;
        const porFecha = new Map<string, Registro>();
        (data ?? []).forEach((row) => {
          if (!porFecha.has(row.fecha)) porFecha.set(row.fecha, { fecha: row.fecha, tapas: parseTapasJson(row.tapas) });
        });
        setRegistros(Array.from(porFecha.values()));
      }
    } catch (error) {
      console.error(error);
      setErrorCarga(error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  }, [esMenu]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  const resetForm = () => {
    setEditandoFecha(null);
    setFecha(hoyLocal());
    setPrimero("");
    setSegundo("");
    setPostre("");
    setTapasTexto("");
  };

  const editar = (registro: Registro) => {
    setEditandoFecha(registro.fecha);
    setFecha(registro.fecha);
    if (registro.menu) {
      setPrimero(registro.menu.primero);
      setSegundo(registro.menu.segundo);
      setPostre(registro.menu.postre);
    }
    setTapasTexto((registro.tapas ?? []).join("\n"));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** Otro registro (no el que edito) que ya ocupa esa fecha: se sustituirá. */
  const choqueFecha = registros.find((r) => r.fecha === fecha && r.fecha !== editandoFecha);
  const hoy = hoyLocal();
  const hayContenido = esMenu ? !!(primero.trim() || segundo.trim() || postre.trim()) : lineas(tapasTexto).length > 0;

  const guardar = async () => {
    if (!fecha) {
      toast.error("Elige la fecha.");
      return;
    }
    const menu = { primero: primero.trim(), segundo: segundo.trim(), postre: postre.trim() };
    const tapas = lineas(tapasTexto);
    if (esMenu && (!menu.primero || !menu.segundo || !menu.postre)) {
      toast.error("Completa primero, segundo y postre.");
      return;
    }
    if (!esMenu && tapas.length === 0) {
      toast.error("Escribe al menos una tapa.");
      return;
    }

    setIsSaving(true);
    try {
      // 1) Traducir (no bloqueante: si falla se guarda solo en español).
      const { data: tradRes, error: tradError } = await supabase.functions.invoke("traducir-contenido", {
        body: esMenu ? { tipo: "menu", datos: menu } : { tipo: "tapas", datos: { tapas } },
      });
      const t = !tradError && tradRes?.ok ? tradRes.translations : null;

      // 2) Filas que había para las fechas afectadas (la editada y, si se ha
      //    movido a un día ocupado, también la de ese día). Se borran DESPUÉS
      //    de insertar las nuevas, para no dejar el día vacío si el insert falla.
      //    Antes, guardar dos veces el mismo día creaba filas duplicadas y la
      //    web enseñaba una cualquiera de ellas.
      const fechasAfectadas = Array.from(new Set([fecha, editandoFecha].filter(Boolean) as string[]));
      const { data: previas, error: previasError } = await supabase
        .from(config.table)
        .select("id")
        .in("fecha", fechasAfectadas);
      if (previasError) throw previasError;
      const idsPrevios = (previas ?? []).map((r) => r.id);

      if (esMenu) {
        const filas = [{ id: crypto.randomUUID(), fecha, idiom: "es", menu }];
        if (t?.menu_en && t?.menu_fr) {
          filas.push({ id: crypto.randomUUID(), fecha, idiom: "en", menu: t.menu_en });
          filas.push({ id: crypto.randomUUID(), fecha, idiom: "fr", menu: t.menu_fr });
        }
        const { error } = await supabase.from("menus_diarios").insert(filas);
        if (error) throw error;
      } else {
        const filas = [{ id: crypto.randomUUID(), fecha, idiom: "es", tapas }];
        if (t?.tapas_en && t?.tapas_fr) {
          filas.push({ id: crypto.randomUUID(), fecha, idiom: "en", tapas: t.tapas_en });
          filas.push({ id: crypto.randomUUID(), fecha, idiom: "fr", tapas: t.tapas_fr });
        }
        const { error } = await supabase.from("tapas").insert(filas);
        if (error) throw error;
      }

      if (idsPrevios.length > 0) {
        const { error: borrarError } = await supabase.from(config.table).delete().in("id", idsPrevios);
        if (borrarError) {
          console.error("No se pudieron borrar las filas anteriores:", borrarError);
          toast.warning("Guardado, pero no se pudo borrar la versión anterior de ese día. Recarga y revisa la lista.");
        }
      }

      if (!t) {
        toast.warning("Guardado solo en español: la traducción automática no está disponible ahora mismo.", {
          duration: 10000,
        });
      }

      notificarGuardadoYPublicacion(
        config.origenRebuild,
        editandoFecha || idsPrevios.length > 0 ? "Cambios guardados" : "Guardado",
      );

      resetForm();
      await cargarDatos();
    } catch (error) {
      console.error(error);
      toast.error(`No se pudo guardar: ${error instanceof Error ? error.message : "error desconocido"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!registroAEliminar) return;
    setIsDeleting(true);
    try {
      // La lista muestra solo el español, pero cada día son TRES filas: se
      // borra por fecha para no dejar huérfanas las de inglés y francés.
      const { error } = await supabase.from(config.table).delete().eq("fecha", registroAEliminar.fecha);
      if (error) throw error;

      if (editandoFecha === registroAEliminar.fecha) resetForm();
      setRegistroAEliminar(null);
      notificarGuardadoYPublicacion(config.origenRebuild, "Eliminado en los tres idiomas");
      await cargarDatos();
    } catch (error) {
      console.error(error);
      toast.error("No se pudo eliminar.");
    } finally {
      setIsDeleting(false);
    }
  };

  const vistaPrevia = useMemo(() => {
    if (esMenu) {
      return [
        { etiqueta: "Primero", valor: primero },
        { etiqueta: "Segundo", valor: segundo },
        { etiqueta: "Postre o café", valor: postre },
      ];
    }
    return null;
  }, [esMenu, primero, segundo, postre]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{config.descripcion}</p>
        <Button variant="outline" onClick={() => cargarDatos()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Recargar
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {/* ---------------------------------------------- Lista */}
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Guardados
                <Badge variant="secondary">{registros.length}</Badge>
              </CardTitle>
              <CardDescription>Pulsa uno para editarlo. Eliminar lo quita en los tres idiomas.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2 max-h-[28rem] overflow-y-auto">
              {isLoading ? (
                [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)
              ) : errorCarga ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="space-y-2">
                    <p>No se pudo cargar la lista: {errorCarga}</p>
                    <Button size="sm" variant="outline" className="bg-background" onClick={() => cargarDatos()}>
                      Reintentar
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : registros.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-2 py-8">
                  <UtensilsCrossed className="w-8 h-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium">Todavía no hay nada guardado</p>
                  <p className="text-xs text-muted-foreground">Usa el formulario de abajo para añadir el primero.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {registros.map((registro) => {
                    const detalle = registro.menu
                      ? [registro.menu.primero, registro.menu.segundo, registro.menu.postre].filter(Boolean).join(" · ")
                      : (registro.tapas ?? []).join(" · ");
                    const esEditado = registro.fecha === editandoFecha;
                    const esHoy = registro.fecha === hoy;
                    const pasado = registro.fecha < hoy;
                    return (
                      <li
                        key={registro.fecha}
                        className={`flex items-center gap-2 p-2 pr-1 rounded-lg border transition-colors ${
                          esEditado ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"
                        } ${pasado && !esEditado ? "opacity-70" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => editar(registro)}
                          className="min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <p className="text-sm font-medium flex items-center gap-2">
                            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate first-letter:uppercase">{formatearFechaLarga(registro.fecha)}</span>
                            {esHoy && <Badge className="text-[10px] px-1.5 py-0">Hoy</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{detalle || "Sin contenido"}</p>
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => editar(registro)}
                          aria-label="Editar"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setRegistroAEliminar(registro)}
                          aria-label="Eliminar"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          {/* ---------------------------------------------- Formulario */}
          <Card ref={formRef} className={`scroll-mt-20 ${editandoFecha ? "border-primary" : ""}`}>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                {editandoFecha ? `Editar ${config.singular}` : esMenu ? "Nuevo menú del día" : "Nuevas tapas del día"}
                {editandoFecha && (
                  <Badge variant="outline" className="border-primary text-primary font-normal">
                    {formatearFechaLarga(editandoFecha)}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Se escribe en español y se traduce solo al inglés y al francés al guardar.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="space-y-1.5 max-w-xs">
                <Label htmlFor={`${seccionActiva}-fecha`}>Día</Label>
                <Input
                  id={`${seccionActiva}-fecha`}
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-9"
                />
              </div>

              {choqueFecha && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Ya hay {config.articulo} {config.singular} del {formatearFechaLarga(fecha)}. Al guardar se
                    sustituirá por este.
                  </AlertDescription>
                </Alert>
              )}

              {esMenu ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="menu-primero">Primero</Label>
                    <Textarea
                      id="menu-primero"
                      value={primero}
                      onChange={(e) => setPrimero(e.target.value)}
                      placeholder="Ej: Ensalada templada de queso de cabra"
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="menu-segundo">Segundo</Label>
                    <Textarea
                      id="menu-segundo"
                      value={segundo}
                      onChange={(e) => setSegundo(e.target.value)}
                      placeholder="Ej: Carrillera con puré de patata"
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="menu-postre">Postre o café</Label>
                    <Textarea
                      id="menu-postre"
                      value={postre}
                      onChange={(e) => setPostre(e.target.value)}
                      placeholder="Ej: Tarta de queso o café"
                      className="min-h-20"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="tapas-texto">Tapas (una por línea)</Label>
                  <Textarea
                    id="tapas-texto"
                    value={tapasTexto}
                    onChange={(e) => setTapasTexto(e.target.value)}
                    placeholder={"Ensaladilla rusa\nCroquetas de jamón\nPulpo a feira"}
                    className="min-h-40"
                  />
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t">
                {(editandoFecha || hayContenido) && (
                  <Button variant="ghost" onClick={resetForm} disabled={isSaving}>
                    {editandoFecha ? "Cancelar edición" : "Vaciar"}
                  </Button>
                )}
                <Button onClick={guardar} disabled={isSaving} className="sm:min-w-40">
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      Traduciendo y guardando...
                    </>
                  ) : editandoFecha ? (
                    "Guardar cambios"
                  ) : (
                    "Guardar y publicar"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* ---------------------------------------------- Vista previa */}
        <aside className="xl:sticky xl:top-20 space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground text-center">Así se leerá en la web</h3>
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <p className="text-xs text-muted-foreground first-letter:uppercase">{fecha ? formatearFechaLarga(fecha) : "Sin fecha"}</p>
              <CardTitle className="text-lg text-primary">{esMenu ? "Menú del día" : "Tapas del día"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {vistaPrevia ? (
                vistaPrevia.map((p) => (
                  <div key={p.etiqueta}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.etiqueta}</p>
                    {lineas(p.valor).length > 0 ? (
                      lineas(p.valor).map((l, i) => <p key={i}>{l}</p>)
                    ) : (
                      <p className="text-muted-foreground italic">—</p>
                    )}
                  </div>
                ))
              ) : lineas(tapasTexto).length > 0 ? (
                <ul className="space-y-1">
                  {lineas(tapasTexto).map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary">•</span>
                      {t}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground italic">Escribe las tapas para verlas aquí.</p>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground text-center px-4">
            Vista orientativa. La web muestra el del día de hoy y los tres más recientes.
          </p>
        </aside>
      </div>

      <AlertDialog open={!!registroAEliminar} onOpenChange={(open) => !open && !isDeleting && setRegistroAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar {config.articulo} {config.singular} del{" "}
              {registroAEliminar ? formatearFechaLarga(registroAEliminar.fecha) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán las versiones en español, inglés y francés. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
