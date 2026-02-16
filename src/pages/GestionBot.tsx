import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Loader2, Save, Bot, MessageSquare, Utensils, Wine, Settings2 } from "lucide-react";
import { useChatbotConfig } from "@/hooks/useChatbotConfig";

export default function GestionBot() {
  const { configs, isLoading, updateConfig, getConfigValue } = useChatbotConfig();

  const [tono, setTono] = useState("");
  const [mensajeBienvenida, setMensajeBienvenida] = useState("");
  const [platosRecomendados, setPlatosRecomendados] = useState("");
  const [vinosRecomendados, setVinosRecomendados] = useState("");
  const [instruccionesExtra, setInstruccionesExtra] = useState("");
  const [frasesPersonalizadas, setFrasesPersonalizadas] = useState("");

  useEffect(() => {
    if (configs) {
      setTono(getConfigValue("tono"));
      setMensajeBienvenida(getConfigValue("mensaje_bienvenida"));
      setPlatosRecomendados(getConfigValue("platos_recomendados"));
      setVinosRecomendados(getConfigValue("vinos_recomendados"));
      setInstruccionesExtra(getConfigValue("instrucciones_extra"));
      setFrasesPersonalizadas(getConfigValue("frases_personalizadas"));
    }
  }, [configs]);

  const handleSave = async (clave: string, valor: string) => {
    await updateConfig.mutateAsync({ clave, valor });
  };

  const handleSaveAll = async () => {
    await Promise.all([
      handleSave("tono", tono),
      handleSave("mensaje_bienvenida", mensajeBienvenida),
      handleSave("platos_recomendados", platosRecomendados),
      handleSave("vinos_recomendados", vinosRecomendados),
      handleSave("instrucciones_extra", instruccionesExtra),
      handleSave("frases_personalizadas", frasesPersonalizadas),
    ]);
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestión Bot</h2>
            <p className="text-muted-foreground">
              Configura el comportamiento y personalidad del chatbot de la web
            </p>
          </div>
          <Button onClick={handleSaveAll} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Guardar todo
          </Button>
        </div>

        <Tabs defaultValue="tono" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="tono" className="gap-2">
              <Bot className="h-4 w-4" />
              Tono y estilo
            </TabsTrigger>
            <TabsTrigger value="recomendaciones" className="gap-2">
              <Utensils className="h-4 w-4" />
              Recomendaciones
            </TabsTrigger>
            <TabsTrigger value="mensajes" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Mensajes
            </TabsTrigger>
            <TabsTrigger value="avanzado" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Avanzado
            </TabsTrigger>
          </TabsList>

          {/* Tab: Tono y estilo */}
          <TabsContent value="tono" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Tono del chatbot</CardTitle>
                <CardDescription>
                  Define cómo se comunica el chatbot con los clientes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Label>Selecciona el tono</Label>
                <ToggleGroup
                  type="single"
                  value={tono}
                  onValueChange={(val) => val && setTono(val)}
                  className="flex flex-wrap gap-2"
                >
                  <ToggleGroupItem
                    value="cercano"
                    className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground px-6"
                  >
                    Cercano
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="formal"
                    className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground px-6"
                  >
                    Formal
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="divertido"
                    className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground px-6"
                  >
                    Divertido
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="exclusivo"
                    className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground px-6"
                  >
                    Exclusivo
                  </ToggleGroupItem>
                </ToggleGroup>

                <div className="pt-4 p-4 rounded-lg bg-muted/50 border">
                  <p className="text-sm text-muted-foreground">
                    {tono === "cercano" && "El chatbot hablará de forma amigable y cercana, como un camarero que conoce al cliente."}
                    {tono === "formal" && "El chatbot mantendrá un tono profesional y elegante en todas sus respuestas."}
                    {tono === "divertido" && "El chatbot usará un tono desenfadado con toques de humor para amenizar la conversación."}
                    {tono === "exclusivo" && "El chatbot transmitirá exclusividad y sofisticación, propio de alta gastronomía."}
                  </p>
                </div>

                <Button
                  variant="outline"
                  onClick={() => handleSave("tono", tono)}
                  disabled={updateConfig.isPending}
                >
                  Guardar tono
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Recomendaciones */}
          <TabsContent value="recomendaciones" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Utensils className="h-5 w-5" />
                  Platos recomendados
                </CardTitle>
                <CardDescription>
                  Indica los platos que el chatbot debe priorizar en sus recomendaciones
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label>Nombres de platos (separados por coma)</Label>
                <Textarea
                  value={platosRecomendados}
                  onChange={(e) => setPlatosRecomendados(e.target.value)}
                  placeholder="Ej: Chuletón de buey, Merluza a la gallega, Pulpo á feira..."
                  rows={3}
                />
                <Button
                  variant="outline"
                  onClick={() => handleSave("platos_recomendados", platosRecomendados)}
                  disabled={updateConfig.isPending}
                >
                  Guardar platos
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wine className="h-5 w-5" />
                  Vinos recomendados
                </CardTitle>
                <CardDescription>
                  Indica los vinos que el chatbot debe priorizar en sus recomendaciones
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label>Nombres de vinos (separados por coma)</Label>
                <Textarea
                  value={vinosRecomendados}
                  onChange={(e) => setVinosRecomendados(e.target.value)}
                  placeholder="Ej: Albariño Pazo de Señorans, Mencía Guímaro..."
                  rows={3}
                />
                <Button
                  variant="outline"
                  onClick={() => handleSave("vinos_recomendados", vinosRecomendados)}
                  disabled={updateConfig.isPending}
                >
                  Guardar vinos
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Mensajes */}
          <TabsContent value="mensajes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Mensaje de bienvenida</CardTitle>
                <CardDescription>
                  El primer mensaje que el chatbot envía al cliente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={mensajeBienvenida}
                  onChange={(e) => setMensajeBienvenida(e.target.value)}
                  placeholder="¡Hola! Soy el asistente virtual..."
                  rows={3}
                />
                <Button
                  variant="outline"
                  onClick={() => handleSave("mensaje_bienvenida", mensajeBienvenida)}
                  disabled={updateConfig.isPending}
                >
                  Guardar mensaje
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Frases personalizadas</CardTitle>
                <CardDescription>
                  Frases específicas que el chatbot debe usar (una por línea)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={frasesPersonalizadas}
                  onChange={(e) => setFrasesPersonalizadas(e.target.value)}
                  placeholder={"Nuestro chuletón es el mejor de la zona\nTenemos terraza con vistas al mar\nAbrimos de martes a domingo"}
                  rows={5}
                />
                <Button
                  variant="outline"
                  onClick={() => handleSave("frases_personalizadas", frasesPersonalizadas)}
                  disabled={updateConfig.isPending}
                >
                  Guardar frases
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Avanzado */}
          <TabsContent value="avanzado" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Instrucciones adicionales</CardTitle>
                <CardDescription>
                  Instrucciones avanzadas para personalizar el comportamiento del chatbot.
                  Escribe en lenguaje natural lo que quieres que haga o deje de hacer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={instruccionesExtra}
                  onChange={(e) => setInstruccionesExtra(e.target.value)}
                  placeholder={"Ej:\n- No recomendar productos con gluten si el cliente lo pide\n- Siempre mencionar las opciones veganas\n- Si preguntan por horarios, decir que abrimos de 13:00 a 16:00 y de 20:30 a 23:30"}
                  rows={8}
                />
                <Button
                  variant="outline"
                  onClick={() => handleSave("instrucciones_extra", instruccionesExtra)}
                  disabled={updateConfig.isPending}
                >
                  Guardar instrucciones
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
