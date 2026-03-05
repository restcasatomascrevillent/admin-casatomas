import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Phone, PhoneCall, Bot, User, Clock, Info, Search, ListFilter } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// Fetchers
async function getPhoneConfig() {
    const { data, error } = await supabase
        .from("phone_system_config")
        .select("*")
        .eq("restaurant_id", "default")
        .single();
    if (error) throw error;
    return data;
}

async function getCallLogs() {
    const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(100);
    if (error) throw error;
    return data;
}

function formatDuration(seconds: number | null, startedAt: string, status: string) {
    let secs = seconds;
    if (status === 'active' && startedAt) {
        secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    }
    if (secs === null || secs === undefined) return '—';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AsistenteTelefonico() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [selectedCall, setSelectedCall] = useState<any | null>(null);

    // Queries
    const { data: config, isLoading: isLoadingConfig } = useQuery({
        queryKey: ["phoneConfig"],
        queryFn: getPhoneConfig,
    });

    const { data: calls = [], isLoading: isLoadingCalls } = useQuery({
        queryKey: ["callLogs"],
        queryFn: getCallLogs,
        refetchInterval: 5000, // Refrescar cada 5s para ver llamadas y duraciones
    });

    // Mutations
    const updateModeMutation = useMutation({
        mutationFn: async (newMode: string) => {
            const { error } = await supabase
                .from("phone_system_config")
                .update({ mode: newMode })
                .eq("restaurant_id", "default");
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["phoneConfig"] });
            toast({
                title: "Modo actualizado",
                description: "El modo del asistente telefónico se ha guardado correctamente.",
            });
        },
        onError: (error) => {
            toast({
                title: "Error",
                description: "No se pudo actualizar el modo.",
                variant: "destructive",
            });
            console.error(error);
        },
    });

    const handleModeChange = (checked: boolean) => {
        updateModeMutation.mutate(checked ? "bot" : "human");
    };

    const isLoading = isLoadingConfig || isLoadingCalls;

    // Stats
    const today = new Date().toISOString().split('T')[0];
    const todayCalls = calls.filter((c: any) => c.started_at.startsWith(today));
    const botCalls = todayCalls.filter((c: any) => c.call_type === 'bot').length;
    const humanCalls = todayCalls.filter((c: any) => c.call_type === 'human').length;

    const completedCalls = todayCalls.filter((c: any) => c.status === 'completed' && c.duration_seconds !== null);
    const avgDurationSeconds = completedCalls.length > 0
        ? Math.round(completedCalls.reduce((sum: number, c: any) => sum + parseInt(c.duration_seconds), 0) / completedCalls.length)
        : 0;

    if (isLoading && !config) {
        return (
            <DashboardLayout>
                <div className="flex h-[50vh] items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Asistente Telefónico</h2>
                    <p className="text-muted-foreground">
                        Gestiona las llamadas entrantes y audita las interacciones del asistente de Voz (IA).
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Modo Actual</CardTitle>
                            <Phone className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center space-x-2 mt-2">
                                <Switch
                                    id="mode-switch"
                                    checked={config?.mode === "bot"}
                                    onCheckedChange={handleModeChange}
                                    disabled={updateModeMutation.isPending}
                                />
                                <Label htmlFor="mode-switch" className="font-semibold text-lg">
                                    {config?.mode === "bot" ? "🤖 Bot IA" : "👤 Humano"}
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                {config?.mode === "bot"
                                    ? "Las llamadas son atendidas por el asistente virtual."
                                    : "Las llamadas se desvían a tu número personal."}
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Llamadas Hoy</CardTitle>
                            <PhoneCall className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{todayCalls.length}</div>
                            <p className="text-xs text-muted-foreground">
                                Total de llamadas recibidas hoy
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Atendidas por IA / Humano</CardTitle>
                            <Bot className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{botCalls} / {humanCalls}</div>
                            <p className="text-xs text-muted-foreground">
                                Distribución de llamadas de hoy
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Duración Media (IA)</CardTitle>
                            <Clock className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {completedCalls.length ? formatDuration(avgDurationSeconds, "", "completed") : "—"}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                De las llamadas completadas por el bot hoy
                            </p>
                        </CardContent>
                    </Card>
                </div>

                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Historial de Llamadas</CardTitle>
                        <CardDescription>
                            Últimas 100 llamadas registradas en el sistema. Selecciona una para ver los detalles.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {calls.length === 0 ? (
                            <div className="text-center py-6 text-muted-foreground">No hay llamadas registradas.</div>
                        ) : (
                            <div className="rounded-md border">
                                <div className="grid grid-cols-5 bg-muted/50 p-3 text-sm font-medium">
                                    <div>Fecha y Hora</div>
                                    <div>Número</div>
                                    <div>Tipo</div>
                                    <div>Estado</div>
                                    <div className="text-right">Duración</div>
                                </div>
                                <ScrollArea className="h-[400px]">
                                    {calls.map((call: any) => (
                                        <div
                                            key={call.id}
                                            className={`grid grid-cols-5 items-center border-t p-3 text-sm transition-colors hover:bg-muted/50 cursor-pointer ${call.call_type === 'bot' && call.tool_calls && call.tool_calls.length > 0 ? 'bg-primary/5' : ''}`}
                                            onClick={() => setSelectedCall(call)}
                                        >
                                            <div className="font-medium text-muted-foreground">
                                                {format(new Date(call.started_at), "dd MMM, HH:mm", { locale: es })}
                                            </div>
                                            <div className="font-mono">{call.caller_number || "Oculto"}</div>
                                            <div>
                                                {call.call_type === "bot" ? (
                                                    <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100"><Bot className="w-3 h-3 mr-1" /> Bot</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-slate-600"><User className="w-3 h-3 mr-1" /> Humano</Badge>
                                                )}
                                            </div>
                                            <div>
                                                {call.status === "completed" ? (
                                                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completada</Badge>
                                                ) : call.status === "active" ? (
                                                    <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 animate-pulse">En curso</Badge>
                                                ) : (
                                                    <Badge variant="outline">{call.status}</Badge>
                                                )}
                                            </div>
                                            <div className="text-right font-mono">
                                                {formatDuration(call.duration_seconds, call.started_at, call.status)}
                                            </div>
                                        </div>
                                    ))}
                                </ScrollArea>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Modal de Detalle de Llamada */}
                <Dialog open={!!selectedCall} onOpenChange={(open) => !open && setSelectedCall(null)}>
                    <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                Detalle de Llamada
                                {selectedCall?.call_type === "bot" ? (
                                    <Badge variant="secondary" className="bg-blue-100 text-blue-800"><Bot className="w-3 h-3 mr-1" /> Bot</Badge>
                                ) : (
                                    <Badge variant="outline"><User className="w-3 h-3 mr-1" /> Humano</Badge>
                                )}
                            </DialogTitle>
                            <DialogDescription>
                                Número: <span className="font-mono font-medium text-foreground">{selectedCall?.caller_number || "Oculto"}</span> •
                                Fecha: {selectedCall && format(new Date(selectedCall.started_at), "dd/MM/yyyy HH:mm")} •
                                Duración: {selectedCall && formatDuration(selectedCall.duration_seconds, selectedCall.started_at, selectedCall.status)}
                            </DialogDescription>
                        </DialogHeader>

                        <ScrollArea className="flex-1 mt-4 p-4 border rounded-md">
                            {selectedCall?.call_type === "human" ? (
                                <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-3">
                                    <User className="w-12 h-12 text-slate-200" />
                                    <p>Llamada transferida directamente al teléfono físico gestionado por un humano.</p>
                                    <p className="text-sm">El asistente de IA no procesó ninguna intención en esta llamada.</p>
                                </div>
                            ) : selectedCall?.summary ? (
                                <div className="mb-6 space-y-2">
                                    <h4 className="font-semibold flex items-center gap-2 text-primary">
                                        <Info className="w-4 h-4" />
                                        Resumen generado por la IA
                                    </h4>
                                    <p className="text-sm bg-muted p-3 rounded-md">{selectedCall.summary}</p>
                                </div>
                            ) : null}

                            {selectedCall?.call_type === "bot" && (
                                <div>
                                    <h4 className="font-semibold flex items-center gap-2 mb-4">
                                        <ListFilter className="w-4 h-4" />
                                        Registro de Herramientas Usadas
                                    </h4>

                                    {(!selectedCall.tool_calls || selectedCall.tool_calls.length === 0) ? (
                                        <p className="text-sm text-muted-foreground italic">El asistente no utilizó ninguna herramienta en esta llamada. (Probablemente fue una consulta general respondida mediante conocimiento del sistema).</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {selectedCall.tool_calls.map((tool: any, idx: number) => (
                                                <div key={idx} className="border rounded-md overflow-hidden text-sm">
                                                    <div className="bg-muted px-3 py-2 border-b flex justify-between items-center">
                                                        <span className="font-mono font-medium text-primary">{tool.tool}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {tool.timestamp ? format(new Date(tool.timestamp), "HH:mm:ss") : ""}
                                                        </span>
                                                    </div>

                                                    {/* Parámetros enviados por la IA */}
                                                    <div className="p-3 border-b border-dashed border-border/50 bg-slate-50">
                                                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Parámetros enviados (IA → Sistema)</span>
                                                        {Object.keys(tool.params || {}).length > 0 ? (
                                                            <pre className="text-xs bg-white p-2 text-slate-800 rounded border font-mono overflow-x-auto">
                                                                {JSON.stringify(tool.params, null, 2)}
                                                            </pre>
                                                        ) : (
                                                            <span className="text-xs text-slate-400 italic">Ningún parámetro</span>
                                                        )}
                                                    </div>

                                                    {/* Resultado devuelto a la IA */}
                                                    <div className="p-3 bg-white">
                                                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Resultado (Sistema → IA)</span>
                                                        {tool.result ? (
                                                            <div className="text-xs p-2 bg-green-50 text-green-900 rounded border border-green-100 max-h-40 overflow-y-auto">
                                                                {typeof tool.result === 'string'
                                                                    ? tool.result
                                                                    : <pre className="font-mono">{JSON.stringify(tool.result, null, 2)}</pre>}
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-slate-400 italic">Sin resultado</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </ScrollArea>
                    </DialogContent>
                </Dialog>

            </div>
        </DashboardLayout>
    );
}
