import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
    CartesianGrid,
} from "recharts";
import type { CallLogsAnalytics } from "./types";

interface Props {
    data?: CallLogsAnalytics["byEndedReason"];
    isLoading?: boolean;
}

const REASON_LABELS: Record<string, string> = {
    "customer-ended-call": "Cliente colgó",
    "assistant-ended-call": "Bot despidió",
    "silence-timed-out": "Silencio",
    "max-duration-exceeded": "Duración máx.",
    "exceeded-max-duration": "Duración máx.",
    "pipeline-error": "Error pipeline",
    "assistant-error": "Error bot",
    "assistant-request-returned-error": "Webhook devolvió error",
    voicemail: "Buzón de voz",
    error: "Error",
    "customer-busy": "Cliente ocupado",
    "customer-did-not-answer": "No contestó",
};

function isErrorReason(reason: string) {
    return /error/i.test(reason);
}

function labelFor(reason: string) {
    return REASON_LABELS[reason] || reason;
}

export function TelefoniaEndedReasonChart({ data, isLoading }: Props) {
    const rawList = data || [];
    const sorted = [...rawList].sort((a, b) => b.count - a.count);
    const chartData = sorted.map((d) => ({
        name: labelFor(d.reason),
        reason: d.reason,
        count: d.count,
        isError: isErrorReason(d.reason),
    }));

    const totalErrors = chartData
        .filter((d) => d.isError)
        .reduce((s, d) => s + d.count, 0);
    const hasData = chartData.some((d) => d.count > 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Motivos de fin de llamada</CardTitle>
                <CardDescription>Cómo terminan las conversaciones</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {totalErrors > 0 && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Hay {totalErrors} llamada(s) con errores</AlertTitle>
                        <AlertDescription>
                            Revisa los logs del webhook — puede haber un bug de producción.
                        </AlertDescription>
                    </Alert>
                )}
                {isLoading ? (
                    <Skeleton className="h-[240px] w-full" />
                ) : !hasData ? (
                    <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                        Sin datos en este periodo.
                    </div>
                ) : (
                    <div
                        className="w-full"
                        style={{ height: Math.max(200, chartData.length * 32 + 40) }}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={chartData}
                                layout="vertical"
                                margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    className="stroke-border/50"
                                    horizontal={false}
                                />
                                <XAxis
                                    type="number"
                                    allowDecimals={false}
                                    tickLine={false}
                                    axisLine={false}
                                    className="text-xs"
                                />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={140}
                                    tickLine={false}
                                    axisLine={false}
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
                                <Bar dataKey="count" radius={[0, 6, 6, 0]} name="Llamadas">
                                    {chartData.map((entry) => (
                                        <Cell
                                            key={entry.reason}
                                            fill={
                                                entry.isError
                                                    ? "hsl(0 84% 60%)"
                                                    : "hsl(199 89% 48%)"
                                            }
                                        />
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

export default TelefoniaEndedReasonChart;
