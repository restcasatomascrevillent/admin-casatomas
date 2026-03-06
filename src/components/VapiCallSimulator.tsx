import { useState, useEffect, useRef } from "react";
import Vapi from "@vapi-ai/web";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Loader2, Play } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

// Inicializar el SDK fuera o dentro con useRef
const vapi = new Vapi("69894e66-681b-4395-9494-df0a196191c9"); // Public Key genérica o la que encontremos

export function VapiCallSimulator({ assistantId }: { assistantId: string }) {
    const { toast } = useToast();
    const [isCalling, setIsCalling] = useState(false);
    const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "active">("idle");
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(0);

    useEffect(() => {
        const onCallStart = () => {
            setCallStatus("active");
            setIsCalling(true);
        };
        const onCallEnd = () => {
            setCallStatus("idle");
            setIsCalling(false);
        };
        const onVolumeLevel = (level: number) => setVolume(level);
        const onError = (error: any) => {
            console.error("Vapi Error:", error);
            toast({
                title: "Error de conexión",
                description: "No se pudo iniciar la llamada de prueba. Revisa los permisos del micrófono.",
                variant: "destructive"
            });
            setCallStatus("idle");
            setIsCalling(false);
        };

        vapi.on("call-start", onCallStart);
        vapi.on("call-end", onCallEnd);
        vapi.on("volume-level", onVolumeLevel);
        vapi.on("error", onError);

        return () => {
            vapi.off("call-start", onCallStart);
            vapi.off("call-end", onCallEnd);
            vapi.off("volume-level", onVolumeLevel);
            vapi.off("error", onError);
        };
    }, []);

    const handleToggleCall = async () => {
        if (isCalling) {
            vapi.stop();
        } else {
            if (!assistantId) {
                toast({
                    title: "Configuración requerida",
                    description: "No se ha encontrado un ID de asistente para llamar.",
                    variant: "destructive"
                });
                return;
            }
            setCallStatus("connecting");
            try {
                await vapi.start(assistantId);
            } catch (err) {
                console.error(err);
                setCallStatus("idle");
            }
        }
    };

    return (
        <Card className="border-purple-100 shadow-sm overflow-hidden bg-gradient-to-br from-white to-purple-50/20">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Phone className="h-5 w-5 text-purple-600" />
                            Simulador de Llamada (Gratis)
                        </CardTitle>
                        <CardDescription>
                            Prueba el bot directamente desde tu navegador usando tu micrófono.
                        </CardDescription>
                    </div>
                    {callStatus !== "idle" && (
                        <Badge variant={callStatus === "active" ? "default" : "secondary"} className={callStatus === "active" ? "bg-green-500 animate-pulse" : ""}>
                            {callStatus === "active" ? "En vivo" : "Conectando..."}
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col items-center justify-center py-6 space-y-6">
                    {/* Visualización de Voz */}
                    <div className="relative flex items-center justify-center">
                        <div
                            className={`absolute inset-0 rounded-full bg-purple-200 transition-transform duration-75 ${isCalling ? 'scale-110 opacity-20' : 'scale-0'}`}
                            style={{ transform: `scale(${1 + volume * 2})` }}
                        />
                        <div className={`h-24 w-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${isCalling ? 'bg-purple-600' : 'bg-slate-100'}`}>
                            {isCalling ? (
                                <Mic className="h-10 w-10 text-white animate-bounce" />
                            ) : (
                                <Phone className="h-10 w-10 text-slate-400" />
                            )}
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <Button
                            size="lg"
                            variant={isCalling ? "destructive" : "default"}
                            className={`px-8 h-12 rounded-full font-bold shadow-md transition-all active:scale-95 ${!isCalling ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                            onClick={handleToggleCall}
                            disabled={callStatus === "connecting"}
                        >
                            {callStatus === "connecting" ? (
                                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            ) : isCalling ? (
                                <PhoneOff className="h-5 w-5 mr-2" />
                            ) : (
                                <Play className="h-5 w-5 mr-2 fill-current" />
                            )}
                            {callStatus === "connecting" ? "Conectando..." : isCalling ? "Colgar Llamada" : "Iniciar Prueba de Voz"}
                        </Button>

                        {isCalling && (
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-12 w-12 rounded-full"
                                onClick={() => {
                                    vapi.setMuted(!isMuted);
                                    setIsMuted(!isMuted);
                                }}
                            >
                                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                            </Button>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground text-center max-w-[250px]">
                        Las llamadas realizadas aquí no tienen coste de telefonía personal, se descuentan de tu saldo de minutos de VAPI.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
