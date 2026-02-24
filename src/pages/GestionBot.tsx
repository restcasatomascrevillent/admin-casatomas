import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Bot, Utensils, Wine, MessageSquare, X, Search } from "lucide-react";
import { useConfigBotWeb } from "@/hooks/useConfigBotWeb";
import { usePlatos } from "@/hooks/usePlatos";
import { useVinos } from "@/hooks/useVinos";

export default function GestionBot() {
  const { config, isLoading, updateConfig } = useConfigBotWeb();
  const { platos, isLoading: loadingPlatos } = usePlatos();
  const { vinos, isLoading: loadingVinos } = useVinos();

  const [tono, setTono] = useState("");
  const [mensajeBienvenida, setMensajeBienvenida] = useState("");
  const [platosSeleccionados, setPlatosSeleccionados] = useState<string[]>([]);
  const [vinosSeleccionados, setVinosSeleccionados] = useState<string[]>([]);
  const [instruccionesExtra, setInstruccionesExtra] = useState("");
  const [frasesPersonalizadas, setFrasesPersonalizadas] = useState("");
  const [buscarPlato, setBuscarPlato] = useState("");
  const [buscarVino, setBuscarVino] = useState("");

  useEffect(() => {
    if (config) {
      setTono(config.tono ?? "");
      setMensajeBienvenida(config.mensaje_bienvenida ?? "");
      const platosStr = config.platos_recomendados ?? "";
      setPlatosSeleccionados(platosStr ? platosStr.split(",").map((s) => s.trim()).filter(Boolean) : []);
      const vinosStr = config.vinos_recomendados ?? "";
      setVinosSeleccionados(vinosStr ? vinosStr.split(",").map((s) => s.trim()).filter(Boolean) : []);
      setInstruccionesExtra(config.instrucciones_extra ?? "");
      setFrasesPersonalizadas(config.frases_personalizadas ?? "");
    }
  }, [config]);

  const handleSaveAll = async () => {
    await updateConfig.mutateAsync({
      tono,
      mensaje_bienvenida: mensajeBienvenida,
      platos_recomendados: platosSeleccionados.join(", "),
      vinos_recomendados: vinosSeleccionados.join(", "),
      instrucciones_extra: instruccionesExtra,
      frases_personalizadas: frasesPersonalizadas,
    });
  };

  const togglePlato = (nombre: string) => {
    setPlatosSeleccionados((prev) =>
    prev.includes(nombre) ? prev.filter((p) => p !== nombre) : [...prev, nombre]
    );
  };

  const toggleVino = (nombre: string) => {
    setVinosSeleccionados((prev) =>
    prev.includes(nombre) ? prev.filter((v) => v !== nombre) : [...prev, nombre]
    );
  };

  // Agrupar platos por categoría
  const platosActivos = useMemo(() => {
    const items = (platos || []).filter((p) => p.activado !== false && p.nombre);
    if (!buscarPlato) return items;
    const q = buscarPlato.toLowerCase();
    return items.filter((p) => p.nombre?.toLowerCase().includes(q) || p.categoria?.toLowerCase().includes(q));
  }, [platos, buscarPlato]);

  const platosPorCategoria = useMemo(() => {
    const map: Record<string, typeof platosActivos> = {};
    platosActivos.forEach((p) => {
      const cat = p.categoria || "Sin categoría";
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    });
    return map;
  }, [platosActivos]);

  // Agrupar vinos por categoría
  const vinosActivos = useMemo(() => {
    const items = (vinos || []).filter((v) => v.activado !== false && v.nombre);
    if (!buscarVino) return items;
    const q = buscarVino.toLowerCase();
    return items.filter((v) => v.nombre?.toLowerCase().includes(q) || v.categoria?.toLowerCase().includes(q));
  }, [vinos, buscarVino]);

  const vinosPorCategoria = useMemo(() => {
    const map: Record<string, typeof vinosActivos> = {};
    vinosActivos.forEach((v) => {
      const cat = v.categoria || "Sin categoría";
      if (!map[cat]) map[cat] = [];
      map[cat].push(v);
    });
    return map;
  }, [vinosActivos]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>);

  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestor Bot</h2>
            <p className="text-muted-foreground">
              Configura cómo se comporta el chatbot de la web
            </p>
          </div>
          <Button onClick={handleSaveAll} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Guardar todo
          </Button>
        </div>

        {/* Pregunta 1: Tono */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              ¿Cómo quieres que hable el bot?
            </CardTitle>
            <CardDescription>Selecciona el tono de comunicación</CardDescription>
          </CardHeader>
          <CardContent>
            <ToggleGroup
              type="single"
              value={tono}
              onValueChange={(val) => val && setTono(val)}
              className="flex flex-wrap gap-2">

              {[
              { value: "cercano", label: "😊 Cercano", desc: "Amigable, como un camarero que te conoce" },
              { value: "formal", label: "👔 Formal", desc: "Profesional y elegante" },
              { value: "divertido", label: "🎉 Divertido", desc: "Desenfadado con toques de humor" },
              { value: "exclusivo", label: "✨ Exclusivo", desc: "Sofisticado, alta gastronomía" }].
              map((t) =>
              <ToggleGroupItem
                key={t.value}
                value={t.value}
                className="flex flex-col items-start gap-1 h-auto py-3 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">

                  <span className="font-medium">{t.label}</span>
                  <span className="text-xs opacity-70">{t.desc}</span>
                </ToggleGroupItem>
              )}
            </ToggleGroup>
          </CardContent>
        </Card>

        {/* Pregunta 2: Mensaje de bienvenida */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              ¿Qué dice el bot al saludar?
            </CardTitle>
            <CardDescription>El primer mensaje que verá el cliente</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={mensajeBienvenida}
              onChange={(e) => setMensajeBienvenida(e.target.value)}
              placeholder="¡Hola! Soy el asistente virtual de Casa Tomás. ¿En qué puedo ayudarte?"
              rows={2} />

          </CardContent>
        </Card>

        {/* Pregunta 3: Platos a recomendar */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Utensils className="h-5 w-5" />
              ¿Qué platos debe recomendar?
            </CardTitle>
            <CardDescription>
              Selecciona los platos que el bot priorizará cuando un cliente pida sugerencias
              {platosSeleccionados.length > 0 &&
              <span className="ml-2 text-primary font-medium">
                  ({platosSeleccionados.length} seleccionados)
                </span>
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Chips de seleccionados */}
            {platosSeleccionados.length > 0 &&
            <div className="flex flex-wrap gap-2 pb-2 border-b">
                {platosSeleccionados.map((nombre) =>
              <span
                key={nombre}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">

                    {nombre}
                    <button onClick={() => togglePlato(nombre)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
              )}
              </div>
            }

            {/* Buscador */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar platos..."
                value={buscarPlato}
                onChange={(e) => setBuscarPlato(e.target.value)}
                className="pl-9" />

            </div>

            {/* Lista por categorías */}
            <div className="max-h-64 overflow-y-auto space-y-3 border rounded-md p-3">
              {loadingPlatos ?
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div> :
              Object.keys(platosPorCategoria).length === 0 ?
              <p className="text-sm text-muted-foreground text-center py-4">No se encontraron platos</p> :

              Object.entries(platosPorCategoria).map(([cat, items]) =>
              <div key={cat}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
                    <div className="space-y-1">
                      {items.map((p) =>
                  <label
                    key={p.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors">

                          <Checkbox
                      checked={platosSeleccionados.includes(p.nombre || "")}
                      onCheckedChange={() => togglePlato(p.nombre || "")} />

                          <span className="text-sm flex-1">{p.nombre}</span>
                          {p.precio_eur != null &&
                    <span className="text-xs text-muted-foreground">{p.precio_eur.toFixed(2)}€</span>
                    }
                        </label>
                  )}
                    </div>
                  </div>
              )
              }
            </div>
          </CardContent>
        </Card>

        {/* Pregunta 4: Vinos a recomendar */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wine className="h-5 w-5" />
              ¿Qué vinos debe recomendar?
            </CardTitle>
            <CardDescription>
              Selecciona los vinos que el bot priorizará
              {vinosSeleccionados.length > 0 &&
              <span className="ml-2 text-primary font-medium">
                  ({vinosSeleccionados.length} seleccionados)
                </span>
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Chips de seleccionados */}
            {vinosSeleccionados.length > 0 &&
            <div className="flex flex-wrap gap-2 pb-2 border-b">
                {vinosSeleccionados.map((nombre) =>
              <span
                key={nombre}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">

                    {nombre}
                    <button onClick={() => toggleVino(nombre)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
              )}
              </div>
            }

            {/* Buscador */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar vinos..."
                value={buscarVino}
                onChange={(e) => setBuscarVino(e.target.value)}
                className="pl-9" />

            </div>

            {/* Lista por categorías */}
            <div className="max-h-64 overflow-y-auto space-y-3 border rounded-md p-3">
              {loadingVinos ?
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div> :
              Object.keys(vinosPorCategoria).length === 0 ?
              <p className="text-sm text-muted-foreground text-center py-4">No se encontraron vinos</p> :

              Object.entries(vinosPorCategoria).map(([cat, items]) =>
              <div key={cat}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
                    <div className="space-y-1">
                      {items.map((v) =>
                  <label
                    key={v.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors">

                          <Checkbox
                      checked={vinosSeleccionados.includes(v.nombre || "")}
                      onCheckedChange={() => toggleVino(v.nombre || "")} />

                          <span className="text-sm flex-1">{v.nombre}</span>
                          {v.precio_eur != null &&
                    <span className="text-xs text-muted-foreground">{v.precio_eur.toFixed(2)}€</span>
                    }
                        </label>
                  )}
                    </div>
                  </div>
              )
              }
            </div>
          </CardContent>
        </Card>

        {/* Pregunta 5: Frases que debe decir */}
        














        {/* Pregunta 6: Instrucciones extra */}
        <Card>
          <CardHeader>
            <CardTitle>¿Algo más que deba saber el bot?</CardTitle>
            <CardDescription>Instrucciones libres en lenguaje natural</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={instruccionesExtra}
              onChange={(e) => setInstruccionesExtra(e.target.value)}
              placeholder={"Ej:\n- Si preguntan por horarios: abrimos de 13:00 a 16:00 y de 20:30 a 23:30\n- Siempre mencionar opciones veganas\n- No recomendar productos con gluten si lo piden"}
              rows={5} />

          </CardContent>
        </Card>

        {/* Botón final */}
        <div className="flex justify-end pb-6">
          <Button size="lg" onClick={handleSaveAll} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Guardar toda la configuración
          </Button>
        </div>
      </div>
    </DashboardLayout>);

}
