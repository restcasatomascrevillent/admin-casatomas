import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    Cell,
} from "recharts";
import type { CallLogsAnalytics } from "./types";

interface Props {
    data?: CallLogsAnalytics["byMotivoFallo"];
    isLoading?: boolean;
}

const MOTIVO_LABELS: Record<string, string> = {
    sin_disponibilidad: "Sin disponibilidad",
    grupo_grande: "Grupo grande",
    reserva_hoy: "Reserva para hoy",
    corte_horario: "Corte horario",
    max_reservas_telefono: "Máx. por teléfono",
    max_reservas_email: "Máx. por email",
    blacklist: "En blacklist",
    sin_telefono: "Sin teléfono",
    fuera_rango: "Fuera de rango",
    fecha_pasada: "Fecha pasada",
    fecha_lejana: "Fecha muy lejana",
    error_interno: "Error interno",
};

const MOTIVO_COLORS: Record<string, string> = {
    sin_disponibilidad: "hsl(38 92% 50%)",
    grupo_grande: "hsl(262 83% 58%)",
    reserva_hoy: "hsl(199 89% 48%)",
    corte_horario: "hsl(173 58% 39%)",
    max_reservas_telefono: "hsl(221 83% 53%)",
    max_reservas_email: "hsl(221 60% 60%)",
    blacklist: "hsl(0 84% 60%)",
    sin_telefono: "hsl(215 20% 55%)",
    fuera_rango: "hsl(25 90% 55%)",
    fecha_pasada: "hsl(215 20% 55%)",
    fecha_lejana: "hsl(215 20% 55%)",
    error_interno: "hsl(0 84% 60%)",
};

function labelFor(m: string) {
    return MOTIVO_LABELS[m] || m;
}

function colorFor(m: string) {
    return MOTIVO_COLORS[m] || "hsl(215 20% 65%)";
}

export function TelefoniaMotivoFalloChart({ data, isLoading }: Props) {
    const sorted = [...(data || [])].sort((a, b) => b.count - a.count);
    const chartData = sorted.map((d) => ({
        name: labelFor(d.motivo),
        motivo: d.motivo,
        count: d.count,
    }));
    const hasData = chartData.some((d) => d.count > 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Motivos de fallo</CardTitle>
                <CardDescription>
                    Por qué el bot no pudo completar reservas
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Skeleton className="h-[260px] w-full" />
                ) : !hasData ? (
                    <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                        Ninguna reserva fallida en este periodo — el bot va fino.
                    </div>
                ) : (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    className="stroke-border/50"
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="name"
                                    tickLine={false}
                                    axisLine={false}
                                    className="text-xs"
                                    interval={0}
                                    angle={-25}
                                    textAnchor="end"
                                    height={72}
                                />
                                <YAxis
                                    tickLine={false}
                                    axisLine={false}
                                    allowDecimals={false}
                                    className="text-xs"
                                />
                                <Tooltip
                                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                                    contentStyle={{
                                        background: "hsl(var(--popover))",
                                        border: "1px solid hsl(var(--border))",
                                        borderRadius: 8,
                                        fontSize: 12,
                                        color: "hsl(var(--popover-foreground))",
                                    }}
                                />
                                <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Incidencias">
                                    {chartData.map((entry) => (
                                        <Cell key={entry.motivo} fill={colorFor(entry.motivo)} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default TelefoniaMotivoFalloChart;
