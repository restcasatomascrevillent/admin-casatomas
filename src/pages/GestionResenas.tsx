import { useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { ListaPlana } from "@/components/panel/ListaPlana";
import { Plegable } from "@/components/panel/Plegable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Star, RefreshCw, Settings, ExternalLink, AlertCircle } from "lucide-react";
import { useResenas, useConfigGooglePlaces } from "@/hooks/useResenas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

/** Suelo (px) del alto de la página: por debajo deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_RESENAS = 360;

export default function GestionResenas() {
    const { data: resenas, isLoading: resenasLoading } = useResenas();
    const { data: config, isLoading: configLoading } = useConfigGooglePlaces();
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
    const queryClient = useQueryClient();

    const handleSync = async () => {
        setSyncing(true);
        try {
            const { error } = await supabase.functions.invoke("sync-google-reviews");
            if (error) throw error;
            // El realtime se encargará de actualizar la UI automáticamente
            toast.success("✅ Reseñas sincronizadas desde Google");
        } catch (error: any) {
            console.error("Error syncing reviews:", error);
            const msg = error?.message ?? "Error desconocido";
            if (msg.includes("GOOGLE_PLACES_API_KEY")) {
                toast.error("Falta la API Key de Google. Añádela en Supabase Secrets.", { duration: 6000 });
            } else {
                toast.error(`Error al sincronizar: ${msg}`);
            }
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
        } catch (error: any) {
            toast.error(`Error al guardar Place ID: ${mensajeUsuario(error, "inténtalo de nuevo")}`);
        } finally {
            setSavingPlaceId(false);
        }
    };

    const renderEstrellas = (valoracion: number) => (
        <div className="flex gap-0.5" role="img" aria-label={`${valoracion} de 5 estrellas`}>
            {[1, 2, 3, 4, 5].map((star) => (
                <Star
                    key={star}
                    className={`h-3.5 w-3.5 ${star <= valoracion ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
                />
            ))}
        </div>
    );

    const googleRating = config?.rating_promedio ? Number(config.rating_promedio) : 0;
    const isPlaceholderPlaceId = config?.place_id?.includes("_casa_") || !config?.place_id?.startsWith("ChIJ");
    const ultimaSync = config?.ultima_sincronizacion ? new Date(config.ultima_sincronizacion) : null;

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
                                        {renderEstrellas(Math.round(googleRating))}
                                    </span>
                                ),
                                detalle: `de ${config?.total_resenas ?? 0} reseñas`,
                            },
                            {
                                etiqueta: "Última sincronización",
                                valor: ultimaSync ? formatDistanceToNow(ultimaSync, { addSuffix: true, locale: es }) : "Nunca",
                                detalle: ultimaSync ? format(ultimaSync, "dd MMM HH:mm", { locale: es }) : undefined,
                            },
                            { etiqueta: "En base de datos", valor: resenasLoading ? "—" : resenas?.length ?? 0, detalle: "reseñas" },
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
                        </div>
                    </div>
                </Plegable>

                {/* Lista de reseñas: ocupa el resto y es lo único que hace scroll. */}
                <h2 className="shrink-0 text-base font-semibold leading-tight">
                    Todas las reseñas
                    <span className="ml-2 text-xs font-normal text-muted-foreground">se actualizan en tiempo real tras cada sincronización</span>
                </h2>
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
                                <p>No hay reseñas todavía.</p>
                                <p className="mt-1 text-sm">Pulsa "Sincronizar ahora" para obtener las reseñas de Google.</p>
                            </div>
                        }
                    >
                        {(resenas ?? []).map((resena: any) => (
                            <li key={resena.id} className="space-y-1 px-2 py-2.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <span className="text-sm font-semibold">{resena.nombre_cliente}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {resena.fuente === "google" ? "Google" : resena.fuente} · {resena.estado} ·{" "}
                                            {format(new Date(resena.fecha), "dd MMMM yyyy", { locale: es })}
                                        </span>
                                    </div>
                                    {renderEstrellas(resena.valoracion)}
                                </div>
                                {resena.comentario && <p className="line-clamp-3 text-sm text-muted-foreground">{resena.comentario}</p>}
                            </li>
                        ))}
                    </ListaPlana>
                )}
            </div>
        </SuperAdminLayout>
    );
}
