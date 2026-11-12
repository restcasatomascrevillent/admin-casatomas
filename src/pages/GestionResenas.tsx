import { useEffect, useMemo, useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { ListaPlana } from "@/components/panel/ListaPlana";
import { Plegable } from "@/components/panel/Plegable";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Star, RefreshCw, Settings, ExternalLink, AlertCircle, Bot, Link2, Eye, EyeOff, MessageSquareReply, Sparkles } from "lucide-react";
import { useResenas, useConfigGooglePlaces, useAjustesContestador } from "@/hooks/useResenas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { mensajeUsuario, ErrorNegocio } from "@/lib/mensaje-usuario";
import {
  contar,
  enlaceGoogle,
  estadoDe,
  ETIQUETA_ESTADO,
  filtrar,
  llamarContestador,
  TONO_ESTADO,
  type EstadoContestador,
  type FiltroResenas,
  type ResenaPanel,
} from "@/lib/resenas/contestador";
import { Estrellas } from "@/components/resenas/Estrellas";
import { DialogoRespuesta } from "@/components/resenas/DialogoRespuesta";
import { AjustesContestadorForm, ConexionGoogle } from "@/components/resenas/AjustesContestador";

/** Suelo (px) del alto de la página: por debajo deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_RESENAS = 360;

const AVISOS_GOOGLE: Record<string, [ "success" | "error" | "info", string ]> = {
  conectado: ["success", "Cuenta de Google conectada. Las respuestas aprobadas se publicarán directamente."],
  error: ["error", "No se pudo conectar con Google. Mira el aviso en «Google Business Profile»."],
  cancelado: ["info", "Conexión con Google cancelada."],
};

export default function GestionResenas() {
    const { data: resenas, isLoading: resenasLoading } = useResenas();
    const { data: config, isLoading: configLoading } = useConfigGooglePlaces();
    const { data: ajustes } = useAjustesContestador();
    const { data: estadoContestador } = useQuery({
        queryKey: ["resenas-contestador-estado"],
        queryFn: async () => {
            try {
                return await llamarContestador<EstadoContestador>({ accion: "estado" });
            } catch {
                return null;
            }
        },
        retry: false,
        staleTime: 60_000,
    });
    // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página).
    // Cifras y botón fijos arriba; la configuración va plegada (acordeón) y la
    // lista de reseñas ocupa el resto con su propio scroll. Sin medida (jsdom,
    // primer pintado) cae al layout de siempre.
    const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
    const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_RESENAS);
    const [syncing, setSyncing] = useState(false);
    const [editingPlaceId, setEditingPlaceId] = useState(false);
    const [newPlaceId, setNewPlaceId] = useState("");
    const [savingPlaceId, setSavingPlaceId] = useState(false);
    const [abierta, setAbierta] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const lista = useMemo(() => (resenas ?? []) as ResenaPanel[], [resenas]);
    const cuentas = useMemo(() => contar(lista), [lista]);
    const [filtro, setFiltro] = useState<FiltroResenas | null>(null);
    // Por defecto «Por responder» si hay alguna; si no, todas.
    const filtroActivo: FiltroResenas = filtro ?? (cuentas.por_responder > 0 ? "por_responder" : "todas");
    const visibles = useMemo(() => filtrar(lista, filtroActivo), [lista, filtroActivo]);
    const resenaAbierta = lista.find((r) => r.id === abierta) ?? null;
    const googleConectado = !!estadoContestador?.google?.conectada && !!estadoContestador?.google?.ubicacion;

    // Vuelta de Google OAuth: ?google=conectado|error|cancelado
    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        const g = p.get("google");
        if (g && AVISOS_GOOGLE[g]) {
            const [tipo, texto] = AVISOS_GOOGLE[g];
            toast[tipo](texto, { duration: 7000 });
            p.delete("google");
            window.history.replaceState(null, "", `${window.location.pathname}${p.toString() ? `?${p}` : ""}`);
        }
    }, []);

    const refrescar = () => {
        queryClient.invalidateQueries({ queryKey: ["resenas"] });
        queryClient.invalidateQueries({ queryKey: ["resenas-ajustes"] });
        queryClient.invalidateQueries({ queryKey: ["resenas-contestador-estado"] });
        queryClient.invalidateQueries({ queryKey: ["config-google-places"] });
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            try {
                const r = await llamarContestador<{ propuestas?: number; errores?: string[]; ok?: boolean }>({ accion: "ciclo" });
                const extra = r.propuestas ? ` · ${r.propuestas} respuesta${r.propuestas === 1 ? "" : "s"} propuesta${r.propuestas === 1 ? "" : "s"}` : "";
                if (r.errores?.length) toast.warning(`Sincronizado con avisos${extra}: ${r.errores[0]}`, { duration: 8000 });
                else toast.success(`Reseñas sincronizadas desde Google${extra}`);
            } catch (e) {
                // Mientras el contestador no esté desplegado, la sincronización de siempre.
                if (!(e instanceof ErrorNegocio && /no está desplegado/.test(e.message))) throw e;
                const { error } = await supabase.functions.invoke("sync-google-reviews");
                if (error) throw error;
                toast.success("Reseñas sincronizadas desde Google");
            }
            refrescar();
        } catch (error: unknown) {
            const msg = (error as Error)?.message ?? "";
            if (msg.includes("GOOGLE_PLACES_API_KEY")) toast.error("Falta la API Key de Google. Añádela en Supabase Secrets.", { duration: 6000 });
            else toast.error(`Error al sincronizar: ${mensajeUsuario(error, "inténtalo de nuevo")}`);
        } finally {
            setSyncing(false);
        }
    };

    const handleSavePlaceId = async () => {
        if (!newPlaceId.trim()) return;
        setSavingPlaceId(true);
        try {
            const { error } = await supabase
                .from("config_google_places")
                .update({ place_id: newPlaceId.trim(), updated_at: new Date().toISOString() })
                .eq("id", config?.id);

            if (error) throw error;
            queryClient.invalidateQueries({ queryKey: ["config-google-places"] });
            toast.success("Place ID actualizado correctamente");
            setEditingPlaceId(false);
            setNewPlaceId("");
        } catch (error: unknown) {
            toast.error(`Error al guardar Place ID: ${mensajeUsuario(error, "inténtalo de nuevo")}`);
        } finally {
            setSavingPlaceId(false);
        }
    };

    const alternarWeb = async (r: ResenaPanel) => {
        const nuevo = r.estado === "oculta" ? "publicada" : "oculta";
        const { error } = await supabase.from("resenas").update({ estado: nuevo }).eq("id", r.id);
        if (error) toast.error(mensajeUsuario(error, "No se pudo cambiar."));
        else {
            toast.success(nuevo === "oculta" ? "Oculta en la web" : "Visible en la web");
            queryClient.invalidateQueries({ queryKey: ["resenas"] });
        }
    };

    const googleRating = config?.rating_promedio ? Number(config.rating_promedio) : 0;
    const isPlaceholderPlaceId = config?.place_id?.includes("_casa_") || !config?.place_id?.startsWith("ChIJ");
    const ultimaSync = config?.ultima_sincronizacion ? new Date(config.ultima_sincronizacion) : null;
    const resumenContestador = !ajustes
        ? undefined
        : ajustes.autorespuesta_activa
            ? `Automática: ${[...ajustes.autorespuesta_estrellas].sort((a, b) => b - a).join(", ")} ★`
            : "Todo con tu aprobación";

    return (
        <SuperAdminLayout>
            <div ref={setRaiz} className="flex flex-col gap-3 overflow-y-auto overscroll-contain" style={alto ? { height: alto } : undefined}>
                {/* Sin título de página (2026-09-25): la pestaña "Reseñas Google" activa en el menú lateral ya dice
                    dónde estás. Cifras en una tira y la única acción («Sincronizar ahora») a la derecha. */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <TiraCifras
                        data-testid="resenas-cifras"
                        cifras={[
                            {
                                etiqueta: "Rating Google",
                                valor: configLoading ? "—" : (
                                    <span className="inline-flex items-center gap-2">
                                        {googleRating.toFixed(1)}
                                        <Estrellas valor={Math.round(googleRating)} />
                                    </span>
                                ),
                                detalle: `de ${config?.total_resenas ?? 0} reseñas`,
                            },
                            { etiqueta: "Por responder", valor: resenasLoading ? "—" : cuentas.por_responder, detalle: `de ${lista.length} aquí` },
                            {
                                etiqueta: "Última sincronización",
                                valor: ultimaSync ? formatDistanceToNow(ultimaSync, { addSuffix: true, locale: es }) : "Nunca",
                                detalle: ultimaSync ? format(ultimaSync, "dd MMM HH:mm", { locale: es }) : undefined,
                            },
                        ]}
                    />
                    <Button onClick={handleSync} disabled={syncing} className="h-11 gap-2 px-5">
                        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                        {syncing ? "Sincronizando..." : "Sincronizar ahora"}
                    </Button>
                </div>

                {/* Aviso si el Place ID es placeholder: una línea ámbar, sin tarjeta. */}
                {!configLoading && isPlaceholderPlaceId && (
                    <div role="alert" className="flex shrink-0 items-start gap-2 text-sm">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                        <p className="text-muted-foreground">
                            <span className="font-medium text-amber-600 dark:text-amber-400">Place ID de Google no configurado.</span>{" "}
                            El actual es un valor de ejemplo: para sincronizar reseñas reales hace falta el Place ID de Google Maps del
                            restaurante (
                            <a
                                href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:no-underline"
                            >
                                Place ID Finder
                            </a>
                            ).
                        </p>
                    </div>
                )}

                {/* Contestador: ajustes (respuesta automática apagada por defecto). */}
                <Plegable titulo="Contestador" icono={<Bot />} resumen={resumenContestador} data-testid="resenas-contestador-ajustes">
                    <AjustesContestadorForm ajustes={ajustes} estado={estadoContestador} onCambio={refrescar} />
                </Plegable>

                {/* Google Business Profile: para publicar respuestas desde aquí. */}
                <Plegable
                    titulo="Google Business Profile"
                    icono={<Link2 />}
                    resumen={estadoContestador === undefined ? undefined : googleConectado ? "Conectada" : "Sin conectar"}
                    data-testid="resenas-google-plegable"
                >
                    <ConexionGoogle estado={estadoContestador} onCambio={refrescar} />
                </Plegable>

                {/* Configuración Google Places: plegada, se usa una vez. */}
                <Plegable
                    titulo="Configuración Google Places"
                    icono={<Settings />}
                    resumen={config?.place_name ?? undefined}
                    forzarMontaje
                    data-testid="resenas-configuracion"
                >
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label>Nombre del lugar</Label>
                                    <p className="text-sm font-medium">{config?.place_name ?? "—"}</p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Place ID actual</Label>
                                    <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{config?.place_id ?? "—"}</code>
                                </div>
                            </div>
                            <Button asChild variant="ghost" size="sm" className="h-11 gap-1.5 px-4">
                                <a href={`https://www.google.com/maps/place/?q=place_id:${config?.place_id}`} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4" />
                                    Ver en Maps
                                </a>
                            </Button>
                        </div>

                        {editingPlaceId ? (
                            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
                                <Label htmlFor="new-place-id">Nuevo Place ID de Google Maps</Label>
                                <p className="text-xs text-muted-foreground">
                                    Busca el restaurante en{" "}
                                    <a
                                        href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline"
                                    >
                                        Place ID Finder
                                    </a>{" "}
                                    y copia el ID que empieza por ChIJ...
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Input
                                        id="new-place-id"
                                        placeholder="ChIJxxxxxxxxxxxxxxxxx"
                                        value={newPlaceId}
                                        onChange={(e) => setNewPlaceId(e.target.value)}
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        className="h-11 min-w-[14rem] flex-1 text-base md:text-base"
                                    />
                                    <Button className="h-11 px-5" onClick={handleSavePlaceId} disabled={savingPlaceId || !newPlaceId.trim()}>
                                        Guardar
                                    </Button>
                                    <Button variant="ghost" className="h-11 px-5" onClick={() => { setEditingPlaceId(false); setNewPlaceId(""); }}>
                                        Cancelar
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button variant="outline" size="sm" className="h-11 px-4" onClick={() => { setEditingPlaceId(true); setNewPlaceId(config?.place_id ?? ""); }}>
                                Cambiar Place ID
                            </Button>
                        )}

                        {/* Instrucciones de la API Key, dentro del mismo bloque plegado. */}
                        <div className="space-y-2 border-t border-border/60 pt-3">
                            <p className="text-sm font-medium">Google Places API Key</p>
                            <p className="text-sm text-muted-foreground">
                                La API Key se gestiona como secreto seguro en Supabase. Para añadirla o cambiarla:
                            </p>
                            <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
                                <li>Ve a <strong>Supabase Dashboard → Edge Functions → Secrets</strong></li>
                                <li>Añade el secreto con nombre: <code className="rounded bg-muted px-1">GOOGLE_PLACES_API_KEY</code></li>
                                <li>Valor: tu API Key de Google Cloud con permiso de <em>Places API (New)</em></li>
                                <li>Guarda y pulsa <strong>"Sincronizar ahora"</strong> arriba</li>
                            </ol>
                            <p className="text-xs text-muted-foreground">
                                Se sincroniza sola dos veces al día (9:10 y 21:10). Google Places solo deja leer las 5 reseñas más recientes de cada vez;
                                con Business Profile conectado se leen todas.
                            </p>
                        </div>
                    </div>
                </Plegable>

                {/* Lista de reseñas: ocupa el resto y es lo único que hace scroll. */}
                <Tabs value={filtroActivo} onValueChange={(v) => setFiltro(v as FiltroResenas)} className="shrink-0">
                    <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
                        <ChipsSubnivel
                            className="flex-nowrap"
                            chips={[
                                { valor: "por_responder", etiqueta: `Por responder · ${cuentas.por_responder}` },
                                { valor: "aprobadas", etiqueta: `Aprobadas · ${cuentas.aprobadas}` },
                                { valor: "respondidas", etiqueta: `Respondidas · ${cuentas.respondidas}` },
                                { valor: "todas", etiqueta: `Todas · ${cuentas.todas}` },
                            ]}
                        />
                    </div>
                </Tabs>
                {resenasLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
                        ))}
                    </div>
                ) : (
                    <ListaPlana
                        scroll
                        aria-label="Reseñas"
                        data-testid="lista-resenas"
                        className="min-h-48"
                        vacio={
                            <div className="py-12 text-center text-muted-foreground">
                                <Star className="mx-auto mb-3 h-10 w-10 opacity-20" />
                                {lista.length ? (
                                    <p>No hay reseñas en este filtro.</p>
                                ) : (
                                    <>
                                        <p>No hay reseñas todavía.</p>
                                        <p className="mt-1 text-sm">Pulsa "Sincronizar ahora" para obtener las reseñas de Google.</p>
                                    </>
                                )}
                            </div>
                        }
                    >
                        {visibles.map((resena) => {
                            const estado = estadoDe(resena);
                            const enlace = enlaceGoogle(resena, config?.place_id);
                            const borrador = estado === "publicada" ? resena.respuesta : resena.respuesta_propuesta;
                            return (
                                <li key={resena.id} className="space-y-1.5 px-2 py-3" data-testid="resena-fila">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                            <span className="text-sm font-semibold">{resena.nombre_cliente}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {resena.fuente === "google" ? "Google" : resena.fuente} · {format(new Date(resena.fecha), "d MMM yyyy", { locale: es })}
                                            </span>
                                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${TONO_ESTADO[estado]}`}>{ETIQUETA_ESTADO[estado]}</span>
                                            {resena.estado === "oculta" && (
                                                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">Oculta en la web</span>
                                            )}
                                        </div>
                                        <Estrellas valor={resena.valoracion} />
                                    </div>
                                    {resena.comentario && <p className="line-clamp-3 text-sm text-muted-foreground">{resena.comentario}</p>}
                                    {borrador && (
                                        <p className={`line-clamp-2 whitespace-pre-line border-l-2 pl-2.5 text-sm ${estado === "publicada" ? "border-emerald-400/70 text-foreground/80" : "border-amber-400/70 italic text-muted-foreground"}`}>
                                            {borrador}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        {estado !== "publicada" ? (
                                            <Button size="sm" variant={estado === "pendiente" ? "outline" : "default"} className="h-9 gap-1.5 px-3 pointer-coarse:h-11" onClick={() => setAbierta(resena.id)} data-testid="resena-abrir">
                                                {estado === "pendiente" ? <Sparkles className="h-4 w-4" /> : <MessageSquareReply className="h-4 w-4" />}
                                                {estado === "pendiente" ? "Responder" : "Revisar respuesta"}
                                            </Button>
                                        ) : (
                                            <Button size="sm" variant="ghost" className="h-9 gap-1.5 px-3 pointer-coarse:h-11" onClick={() => setAbierta(resena.id)}>
                                                <MessageSquareReply className="h-4 w-4" /> Ver respuesta
                                            </Button>
                                        )}
                                        {enlace && (
                                            <Button asChild size="sm" variant="ghost" className="h-9 gap-1.5 px-3 pointer-coarse:h-11">
                                                <a href={enlace} target="_blank" rel="noopener noreferrer" aria-label="Abrir la reseña en Google">
                                                    <ExternalLink className="h-4 w-4" /> <span className="hidden min-[400px]:inline">En Google</span>
                                                </a>
                                            </Button>
                                        )}
                                        <Button size="sm" variant="ghost" className="ml-auto h-9 gap-1.5 px-3 text-muted-foreground pointer-coarse:h-11" onClick={() => alternarWeb(resena)}
                                            aria-label={resena.estado === "oculta" ? "Mostrar en la web" : "Ocultar en la web"}>
                                            {resena.estado === "oculta" ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                            <span className="hidden sm:inline">{resena.estado === "oculta" ? "Mostrar en la web" : "Ocultar en la web"}</span>
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ListaPlana>
                )}
            </div>
            <DialogoRespuesta
                resena={resenaAbierta}
                placeId={config?.place_id}
                googleConectado={googleConectado}
                onClose={() => setAbierta(null)}
                onCambio={() => queryClient.invalidateQueries({ queryKey: ["resenas"] })}
            />
        </SuperAdminLayout>
    );
}
