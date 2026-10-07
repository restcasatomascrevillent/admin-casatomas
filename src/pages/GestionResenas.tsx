import { useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Star, RefreshCw, Settings, ExternalLink, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { useResenas, useConfigGooglePlaces } from "@/hooks/useResenas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/** Suelo (px) del alto de la página: por debajo deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_RESENAS = 360;

export default function GestionResenas() {
    const { data: resenas, isLoading: resenasLoading } = useResenas();
    const { data: config, isLoading: configLoading } = useConfigGooglePlaces();
    // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página).
    // Solución provisional de la auditoría (clase C): botón, aviso y cifras fijos
    // arriba; la configuración y la lista de reseñas en una región con scroll
    // propio. Sin medida (jsdom, primer pintado) cae al layout de siempre.
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
            toast.error(`Error al guardar Place ID: ${error.message}`);
        } finally {
            setSavingPlaceId(false);
        }
    };

    const renderEstrellas = (valoracion: number) => (
        <div className="flex gap-0.5">
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

    return (
        <SuperAdminLayout>
            <div ref={setRaiz} className="flex flex-col gap-6" style={alto ? { height: alto } : undefined}>
                {/* Sin título de página (2026-09-25): la pestaña "Reseñas
                    Google" activa en el menú lateral ya dice dónde estás; el
                    subtítulo era relleno. Se conserva el botón, que sí es una
                    acción. */}
                <div className="flex justify-end">
                    <Button onClick={handleSync} disabled={syncing} className="h-11 gap-2 self-start px-5 sm:self-auto">
                        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                        {syncing ? "Sincronizando..." : "Sincronizar ahora"}
                    </Button>
                </div>

                {/* Aviso si el Place ID es placeholder */}
                {!configLoading && isPlaceholderPlaceId && (
                    <Card className="border-yellow-500/50 bg-yellow-500/5">
                        <CardContent className="flex items-start gap-3 pt-4">
                            <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="font-medium text-sm text-yellow-600 dark:text-yellow-400">
                                    Place ID de Google no configurado
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    El Place ID actual es un valor de ejemplo. Para sincronizar reseñas reales necesitas el Place ID de Google Maps del restaurante.
                                    Puedes encontrarlo en{" "}
                                    <a
                                        href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline text-yellow-600 dark:text-yellow-400 hover:no-underline"
                                    >
                                        Place ID Finder
                                    </a>.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Stats + Configuración */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Rating promedio */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Rating Google</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-end gap-2">
                                <span className="text-4xl font-bold">
                                    {configLoading ? "—" : googleRating.toFixed(1)}
                                </span>
                                <div className="mb-1">
                                    {renderEstrellas(Math.round(googleRating))}
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Basado en {config?.total_resenas ?? 0} reseñas
                            </p>
                        </CardContent>
                    </Card>

                    {/* Última sync */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Última Sincronización</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {config?.ultima_sincronizacion ? (
                                <>
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                                        <span className="font-semibold text-sm">
                                            {formatDistanceToNow(new Date(config.ultima_sincronizacion), { addSuffix: true, locale: es })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {format(new Date(config.ultima_sincronizacion), "dd MMM yyyy HH:mm", { locale: es })}
                                    </p>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Clock className="h-5 w-5" />
                                    <span className="text-sm">Nunca sincronizado</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Reseñas totales en BD */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">En Base de Datos</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <span className="text-4xl font-bold">{resenasLoading ? "—" : resenas?.length ?? 0}</span>
                            <p className="text-xs text-muted-foreground mt-1">reseñas almacenadas</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Región con scroll: configuración y lista de reseñas. La configuración
                    va aquí (y no fija arriba) porque mide casi una pantalla: fija dejaría
                    a la lista sin sitio. `min-h-48`: suelo de la región; si lo fijo no
                    deja sitio (móvil) vuelve el scroll de página. */}
                <div className="min-h-48 flex-1 space-y-6 overflow-y-auto overscroll-contain">
                    {/* Configuración Google Places */}
                    <Card>
                        <CardHeader>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <Settings className="h-4 w-4" />
                                        Configuración Google Places
                                    </CardTitle>
                                    <CardDescription>
                                        Ajusta el Place ID y la API Key para la sincronización
                                    </CardDescription>
                                </div>
                                <a
                                    href={`https://www.google.com/maps/place/?q=place_id:${config?.place_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Button variant="ghost" size="sm" className="h-11 gap-1.5 px-4">
                                        <ExternalLink className="h-4 w-4" />
                                        Ver en Maps
                                    </Button>
                                </a>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label>Nombre del lugar</Label>
                                    <p className="text-sm font-medium">{config?.place_name ?? "—"}</p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Place ID actual</Label>
                                    <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                                        {config?.place_id ?? "—"}
                                    </code>
                                </div>
                            </div>

                            {/* Editar Place ID */}
                            {editingPlaceId ? (
                                <div className="space-y-2 p-4 border border-border rounded-lg bg-muted/30">
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

                            {/* Instrucciones API Key */}
                            <div className="p-4 border border-border rounded-lg bg-muted/20 space-y-2">
                                <p className="text-sm font-medium">🔑 Google Places API Key</p>
                                <p className="text-sm text-muted-foreground">
                                    La API Key se gestiona como secreto seguro en Supabase. Para añadirla o cambiarla:
                                </p>
                                <ol className="text-sm text-muted-foreground space-y-1 ml-4 list-decimal">
                                    <li>Ve a <strong>Supabase Dashboard → Edge Functions → Secrets</strong></li>
                                    <li>Añade el secreto con nombre: <code className="bg-muted px-1 rounded">GOOGLE_PLACES_API_KEY</code></li>
                                    <li>Valor: tu API Key de Google Cloud con permiso de <em>Places API (New)</em></li>
                                    <li>Guarda y pulsa <strong>"Sincronizar ahora"</strong> arriba</li>
                                </ol>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Lista de reseñas */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Todas las Reseñas</CardTitle>
                            <CardDescription>
                                Se actualizan automáticamente en tiempo real tras cada sincronización
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {resenasLoading ? (
                                <div className="space-y-3">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                                    ))}
                                </div>
                            ) : resenas && resenas.length > 0 ? (
                                <div className="space-y-3">
                                    {resenas.map((resena: any) => (
                                        <div key={resena.id} className="p-4 border border-border rounded-lg space-y-2 hover:bg-muted/30 transition-colors">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-semibold text-sm">{resena.nombre_cliente}</span>
                                                    <Badge variant={resena.fuente === "google" ? "default" : "secondary"} className="text-xs">
                                                        {resena.fuente === "google" ? "🔍 Google" : resena.fuente}
                                                    </Badge>
                                                    <Badge
                                                        variant={resena.estado === "publicada" ? "outline" : "secondary"}
                                                        className="text-xs"
                                                    >
                                                        {resena.estado}
                                                    </Badge>
                                                </div>
                                                {renderEstrellas(resena.valoracion)}
                                            </div>
                                            {resena.comentario && (
                                                <p className="text-sm text-muted-foreground line-clamp-3">{resena.comentario}</p>
                                            )}
                                            <p className="text-xs text-muted-foreground">
                                                {format(new Date(resena.fecha), "dd MMMM yyyy", { locale: es })}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground">
                                    <Star className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                    <p>No hay reseñas todavía.</p>
                                    <p className="text-sm mt-1">Pulsa "Sincronizar ahora" para obtener las reseñas de Google.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </SuperAdminLayout>
    );
}
