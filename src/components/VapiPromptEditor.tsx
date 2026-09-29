import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Save, RefreshCw, Settings, BrainCircuit } from "lucide-react";

export function VapiPromptEditor({ config }: { config: any }) {
    const [webhookUrl, setWebhookUrl] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isConfigOpen, setIsConfigOpen] = useState(false);

    useEffect(() => {
        if (config) {
            setWebhookUrl(config.webhook_url || "");
            if (config.webhook_url && config.vapi_assistant_id) {
                loadPrompt(config.webhook_url, config.vapi_assistant_id);
            }
        }
    }, [config]);

    const loadPrompt = async (url: string, assistantId: string) => {
        if (!url || !assistantId) return;
        setIsLoading(true);
        try {
            const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            const res = await fetch(`${cleanUrl}/api/vapi-prompt?assistantId=${assistantId}`);
            if (!res.ok) throw new Error("Fallo de red");
            const data = await res.json();
            if (data.prompt) setSystemPrompt(data.prompt);
        } catch (e) {
            console.error(e);
            toast.error("Error de lectura", {
                description: "No se pudo conectar con el proxy para leer el prompt de VAPI.",
            });
        }
        setIsLoading(false);
    };

    const savePrompt = async () => {
        if (!webhookUrl || !config?.vapi_assistant_id) {
            toast.error("Configuración incompleta", {
                description: "Asegúrate de configurar la URL del proxy primero.",
            });
            setIsConfigOpen(true);
            return;
        }

        setIsSaving(true);
        try {
            // Guardar url por si se ha modificado
            await supabase.from("phone_system_config").update({ webhook_url: webhookUrl } as any).eq("restaurant_id", "default");

            const cleanUrl = webhookUrl.endsWith('/') ? webhookUrl.slice(0, -1) : webhookUrl;
            const res = await fetch(`${cleanUrl}/api/vapi-prompt`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    assistantId: config.vapi_assistant_id,
                    prompt: systemPrompt
                })
            });

            if (res.ok) {
                toast.success("Instrucciones guardadas en VAPI", {
                    description: "El asistente atenderá con este texto a partir de la próxima llamada.",
                });
                setIsConfigOpen(false);
            } else {
                throw new Error("Respuesta no OK");
            }
        } catch (e) {
            console.error(e);
            toast.error("No se pudo guardar el prompt en VAPI", {
                description: "El asistente sigue con las instrucciones anteriores.",
            });
        }
        setIsSaving(false);
    };

    return (
        <Card className="mt-6 border-blue-100/50 shadow-sm overflow-hidden">
            <CardHeader className="bg-slate-50/50 pb-4 border-b">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-primary">
                            <BrainCircuit className="h-5 w-5 text-purple-500" />
                            Cerebro IA (Instrucciones Base)
                        </CardTitle>
                        <CardDescription className="mt-1">
                            Edita el comportamiento y la personalidad del asistente que recibe las llamadas.
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsConfigOpen(!isConfigOpen)}
                            className={isConfigOpen ? "bg-slate-200" : ""}
                        >
                            <Settings className="h-4 w-4 text-slate-500" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadPrompt(webhookUrl, config?.vapi_assistant_id)}
                            disabled={isLoading}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            Recargar
                        </Button>
                        <Button size="sm" onClick={savePrompt} disabled={isSaving || !systemPrompt}>
                            <Save className="h-4 w-4 mr-2" />
                            {isSaving ? "Guardando..." : "Guardar Cerebro"}
                        </Button>
                    </div>
                </div>

                {isConfigOpen && (
                    <div className="mt-4 p-4 bg-slate-100 rounded-md border flex flex-col gap-2">
                        <Label htmlFor="webhook_url" className="text-slate-600 font-semibold text-xs uppercase">URL del Proxy VAPI (Vercel Backend)</Label>
                        <div className="flex gap-2">
                            <Input
                                id="webhook_url"
                                value={webhookUrl}
                                onChange={(e) => setWebhookUrl(e.target.value)}
                                placeholder="https://restaurante-bot.vercel.app"
                                className="bg-white"
                            />
                            <Button variant="secondary" onClick={() => loadPrompt(webhookUrl, config?.vapi_assistant_id)}>
                                Conectar
                            </Button>
                        </div>
                        <p className="text-xs text-slate-500">Ejemplo: https://tu-dominio-en-vercel.app (necesario para inyectar este prompt directamente a VAPI sin exponer el token)</p>
                    </div>
                )}
            </CardHeader>
            <CardContent className="p-0">
                <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="min-h-[400px] border-0 rounded-none focus-visible:ring-0 font-mono text-sm leading-relaxed p-6 bg-slate-50/30 resize-y"
                    placeholder={isLoading ? "Cargando instrucciones desde la IA..." : "Escribe las instrucciones detalladas del asistente aquí (Prompt de Sistema)..."}
                    disabled={isLoading}
                />
            </CardContent>
        </Card>
    );
}
