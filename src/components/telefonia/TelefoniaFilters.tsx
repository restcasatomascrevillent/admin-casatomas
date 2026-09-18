import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { CallLogFilters } from "./types";

interface Props {
    value: CallLogFilters;
    onChange: (filters: CallLogFilters) => void;
}

const INTENT_OPTIONS = [
    { value: "all", label: "Todas las intenciones" },
    { value: "crear", label: "Crear reserva" },
    { value: "modificar", label: "Modificar" },
    { value: "cancelar", label: "Cancelar" },
    { value: "info", label: "Información" },
    { value: "hablar_humano", label: "Hablar con humano" },
    { value: "buscar", label: "Buscar" },
    { value: "disponibilidad", label: "Disponibilidad" },
    { value: "otro", label: "Otro" },
];

const SENTIMENT_OPTIONS = [
    { value: "all", label: "Cualquier sentimiento" },
    { value: "positivo", label: "Positivo" },
    { value: "neutro", label: "Neutro" },
    { value: "negativo", label: "Negativo" },
];

const SUCCESS_OPTIONS = [
    { value: "all", label: "Éxito: todos" },
    { value: "pass", label: "Éxito: OK" },
    { value: "fail", label: "Éxito: fallidas" },
];

const CALL_TYPE_OPTIONS = [
    { value: "all", label: "Bot y humano" },
    { value: "bot", label: "Solo bot" },
    { value: "human", label: "Solo humano" },
];

export function TelefoniaFilters({ value, onChange }: Props) {
    const hasAnyFilter =
        (value.intent && value.intent !== "all") ||
        (value.sentiment && value.sentiment !== "all") ||
        (value.success && value.success !== "all") ||
        (value.callType && value.callType !== "all");

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <Select
                value={value.callType ?? "all"}
                onValueChange={(v) => onChange({ ...value, callType: v as any })}
            >
                <SelectTrigger className="h-8 w-auto min-w-[150px] text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {CALL_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select
                value={value.intent ?? "all"}
                onValueChange={(v) => onChange({ ...value, intent: v })}
            >
                <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {INTENT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select
                value={value.sentiment ?? "all"}
                onValueChange={(v) => onChange({ ...value, sentiment: v })}
            >
                <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {SENTIMENT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select
                value={value.success ?? "all"}
                onValueChange={(v) => onChange({ ...value, success: v as any })}
            >
                <SelectTrigger className="h-8 w-auto min-w-[150px] text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {SUCCESS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {hasAnyFilter && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    onClick={() =>
                        onChange({
                            intent: "all",
                            sentiment: "all",
                            success: "all",
                            callType: "all",
                        })
                    }
                >
                    <X className="h-3 w-3" />
                    Limpiar
                </Button>
            )}
        </div>
    );
}

export default TelefoniaFilters;
