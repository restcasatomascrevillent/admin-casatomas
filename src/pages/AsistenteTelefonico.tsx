import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Phone, PhoneCall, Bot, User, Clock, Info, Search, ListFilter, Calendar, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

    // Schedule state
    const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

    // Generador de ID corto local
    const genId = () => Math.random().toString(36).substring(2, 9);

    const DEFAULT_SCHEDULE = DAY_NAMES.map((name, i) => ({
        day: i,
        ranges: i === 1 ? [] : [{ id: genId(), start: "09:30", end: "23:00", mode: "human" }]
    }));

    const [schedule, setSchedule] = useState<any[]>(DEFAULT_SCHEDULE);
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleDirty, setScheduleDirty] = useState(false);

    const normalizeSchedule = (rawSchedule: any[]) => {
        if (!rawSchedule) return DEFAULT_SCHEDULE;
        return DAY_NAMES.map((name, i) => {
            const existing = rawSchedule.find(r => r.day === i);
            if (!existing) return { day: i, ranges: [] };

            // Backward compatibility para datos viejos
            if (!existing.ranges) {
                if (existing.start && existing.end) {
                    return { day: i, ranges: [{ id: genId(), start: existing.start, end: existing.end, mode: existing.mode || "human" }] };
                } else if (existing.mode === "human") {
                    return { day: i, ranges: [{ id: genId(), start: "00:00", end: "23:59", mode: "human" }] };
                } else {
                    return { day: i, ranges: [] };
                }
            }

            // Asegurar que cada rango tiene id
            const ranges = existing.ranges.map((r: any) => ({
                ...r,
                id: r.id || genId()
            }));

            return { ...existing, ranges };
        });
    };

    useEffect(() => {
        if (config) {
            setScheduleEnabled((config as any).schedule_enabled ?? false);
            const s = (config as any).schedule;
            if (s && Array.isArray(s) && s.length > 0) {
                setSchedule(normalizeSchedule(s));
            } else {
                setSchedule(normalizeSchedule(DEFAULT_SCHEDULE));
            }
        }
    }, [config]);

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

    const updateScheduleMutation = useMutation({
        mutationFn: async ({ enabled, rules }: { enabled: boolean; rules: any[] }) => {
            const { error } = await supabase
                .from("phone_system_config")
                .update({ schedule_enabled: enabled, schedule: rules } as any)
                .eq("restaurant_id", "default");
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["phoneConfig"] });
            setScheduleDirty(false);
            toast({ title: "Horario guardado", description: "Los horarios de conmutación se han actualizado." });
        },
        onError: (error) => {
            toast({ title: "Error", description: "No se pudo guardar el horario.", variant: "destructive" });
            console.error(error);
        },
    });

    const handleModeChange = (checked: boolean) => {
        updateModeMutation.mutate(checked ? "bot" : "human");
    };

    const handleScheduleToggle = (checked: boolean) => {
        setScheduleEnabled(checked);
        updateScheduleMutation.mutate({ enabled: checked, rules: schedule });
    };

    // Funciones Helper para Rangos
    const addRange = (dayIndex: number) => {
        setSchedule(prev => prev.map(rule => {
            if (rule.day === dayIndex) {
                const newRanges = [...(rule.ranges || []), { id: genId(), start: "12:00", end: "16:00", mode: "human" }];
                return { ...rule, ranges: newRanges };
            }
            return rule;
        }));
        setScheduleDirty(true);
    };

    const removeRange = (dayIndex: number, rangeId: string) => {
        setSchedule(prev => prev.map(rule => {
            if (rule.day === dayIndex && rule.ranges) {
                return { ...rule, ranges: rule.ranges.filter((r: any) => r.id !== rangeId) };
            }
            return rule;
        }));
        setScheduleDirty(true);
    };

    const updateRangeRule = (dayIndex: number, rangeId: string, field: string, value: string) => {
        setSchedule(prev => prev.map(rule => {
            if (rule.day === dayIndex && rule.ranges) {
                return {
                    ...rule,
                    ranges: rule.ranges.map((r: any) => r.id === rangeId ? { ...r, [field]: value } : r)
                };
            }
            return rule;
        }));
        setScheduleDirty(true);
    };

    const saveSchedule = () => {
        updateScheduleMutation.mutate({ enabled: scheduleEnabled, rules: schedule });
    };

    const isLoading = isLoadingConfig || isLoadingCalls;

    // Stats (calculados usando la zona horaria de Madrid)
    const todayMadrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

    const todayCalls = calls.filter((c: any) => {
        if (!c.started_at) return false;
        const callDateMadrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(c.started_at));
        return callDateMadrid === todayMadrid;
    });

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

                {/* Horario programado */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Calendar className="h-5 w-5" />
                                    Horario Programado
                                </CardTitle>
                                <CardDescription>
                                    Conmuta automáticamente entre bot y humano según el día y la hora.
                                    {scheduleEnabled && " (Activo — el toggle manual se ignora)"}
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={scheduleEnabled}
                                    onCheckedChange={handleScheduleToggle}
                                />
                                <Label className="text-sm">{scheduleEnabled ? "Activo" : "Inactivo"}</Label>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {DAY_NAMES.map((name, dayIndex) => {
                                const defaultRule = { day: dayIndex, ranges: [] };
                                const rule = schedule.find((r: any) => r.day === dayIndex) || defaultRule;

                                return (
                                    <div key={dayIndex} className={`p-4 rounded-lg border bg-card transition-opacity ${!scheduleEnabled ? "opacity-50" : ""}`}>
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="font-medium text-sm sm:text-base">{name}</h4>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => addRange(dayIndex)}
                                                disabled={!scheduleEnabled}
                                                className="h-8 shadow-sm"
                                            >
                                                <Plus className="w-3 h-3 mr-1" /> Añadir franja
                                            </Button>
                                        </div>
                                        {(!rule.ranges || rule.ranges.length === 0) ? (
                                            <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-md border border-dashed flex flex-col sm:flex-row items-center justify-center gap-2">
                                                <Bot className="w-4 h-4 text-blue-500" />
                                                <span>Fuera de franjas, <span className="font-medium text-foreground">Bot IA</span> responde las llamadas.</span>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {rule.ranges.map((range: any) => (
                                                    <div key={range.id} className={`flex flex-col sm:flex-row gap-3 items-start sm:items-center p-2 rounded-md border ${range.mode === "bot" ? "bg-blue-50/50 border-blue-100" : "bg-green-50/50 border-green-100"}`}>
                                                        <Select
                                                            value={range.mode}
                                                            onValueChange={(v) => updateRangeRule(dayIndex, range.id, "mode", v)}
                                                            disabled={!scheduleEnabled}
                                                        >
                                                            <SelectTrigger className="w-full sm:w-[140px] h-9 bg-background">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="human">👤 Humano</SelectItem>
                                                                <SelectItem value="bot">🤖 Bot IA</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <div className="flex items-center gap-2 w-full sm:w-auto">
                                                            <Input
                                                                type="time"
                                                                value={range.start}
                                                                onChange={(e) => updateRangeRule(dayIndex, range.id, "start", e.target.value)}
                                                                disabled={!scheduleEnabled}
                                                                className="h-9 w-full sm:w-auto bg-background"
                                                            />
                                                            <span className="text-muted-foreground text-sm">a</span>
                                                            <Input
                                                                type="time"
                                                                value={range.end}
                                                                onChange={(e) => updateRangeRule(dayIndex, range.id, "end", e.target.value)}
                                                                disabled={!scheduleEnabled}
                                                                className="h-9 w-full sm:w-auto bg-background"
                                                            />
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="text-destructive h-9 w-9 sm:ml-auto hover:bg-destructive/10"
                                                            onClick={() => removeRange(dayIndex, range.id)}
                                                            disabled={!scheduleEnabled}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {scheduleDirty && (
                            <Button
                                className="mt-6 w-full shadow-sm"
                                onClick={saveSchedule}
                                disabled={updateScheduleMutation.isPending}
                            >
                                {updateScheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Guardar horarios
                            </Button>
                        )}
                    </CardContent>
                </Card>

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
                                                <div className="flex flex-col gap-1 items-start">
                                                    {call.call_type === "bot" ? (
                                                        <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100"><Bot className="w-3 h-3 mr-1" /> Bot</Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="text-slate-600"><User className="w-3 h-3 mr-1" /> Humano</Badge>
                                                    )}

                                                    {call.tool_calls && call.tool_calls.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {call.tool_calls.some((t: any) => t.tool === 'create_reservation') && (
                                                                <Badge variant="outline" className="text-[10px] px-1 h-4 bg-green-50 text-green-700 border-green-200">Reserva Nueva</Badge>
                                                            )}
                                                            {call.tool_calls.some((t: any) => t.tool === 'modify_reservation') && (
                                                                <Badge variant="outline" className="text-[10px] px-1 h-4 bg-yellow-50 text-yellow-700 border-yellow-200">Modificación</Badge>
                                                            )}
                                                            {call.tool_calls.some((t: any) => t.tool === 'cancel_reservation') && (
                                                                <Badge variant="outline" className="text-[10px] px-1 h-4 bg-red-50 text-red-700 border-red-200">Cancelación</Badge>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
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
