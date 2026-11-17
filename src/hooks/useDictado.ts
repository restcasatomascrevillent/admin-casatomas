// Dictado por voz para cajas de texto del panel (chat de Facturas).
//
// Dos motores, según el navegador:
//  · "navegador": Web Speech API (Chrome/Edge en Android y escritorio). Texto
//    provisional en directo. Va en frases (continuous=false) y se reengancha
//    solo, porque el modo continuo de Chrome Android duplica palabras.
//  · "servidor": MediaRecorder + Edge Function `transcribir-dictado` (OpenAI).
//    Se usa en iPhone/iPad (webkitSpeechRecognition de Safari corta solo y
//    depende de que Siri esté activo) y donde no hay Web Speech (Firefox).
//    No hay texto provisional: al parar se transcribe y se rellena la caja.
//
// El texto se escribe en la caja (onCambio) y NUNCA se envía solo.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type EstadoDictado = "inactivo" | "escuchando" | "transcribiendo";
export type MotorDictado = "navegador" | "servidor" | null;

export const MAX_SEGUNDOS_DICTADO = 90;

/* eslint-disable @typescript-eslint/no-explicit-any */
function constructorReconocimiento(): any {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function esIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1);
}

function puedeGrabar(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof (globalThis as any).MediaRecorder !== "undefined";
}

export function motorDeDictado(): MotorDictado {
  if (constructorReconocimiento() && !esIos()) return "navegador";
  if (puedeGrabar()) return "servidor";
  return null;
}

function mimeGrabacion(): string | undefined {
  const MR = (globalThis as any).MediaRecorder;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MR?.isTypeSupported?.(m)) return m;
  }
  return undefined;
}

const unir = (base: string, nuevo: string) => {
  const n = nuevo.trim();
  if (!n) return base;
  return base && !/\s$/.test(base) ? `${base} ${n}` : `${base}${n}`;
};

interface Opciones {
  /** Texto actual de la caja (para dictar a continuación de lo ya escrito). */
  valor: string;
  onCambio: (texto: string) => void;
}

export function useDictado({ valor, onCambio }: Opciones) {
  const [motor, setMotor] = useState<MotorDictado>(() => motorDeDictado());
  const [estado, setEstado] = useState<EstadoDictado>("inactivo");
  const [provisional, setProvisional] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valorRef = useRef(valor);
  valorRef.current = valor;
  const onCambioRef = useRef(onCambio);
  onCambioRef.current = onCambio;

  const quiereRef = useRef(false);
  const recRef = useRef<any>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");
  const vaciosRef = useRef(0);
  const grabRef = useRef<{ mr: any; flujo: MediaStream; trozos: Blob[]; inicio: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  const limpiarNavegador = () => {
    const r = recRef.current;
    recRef.current = null;
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      try { r.abort(); } catch { /* ya parado */ }
    }
  };

  const liberarGrabacion = () => {
    const g = grabRef.current;
    grabRef.current = null;
    if (g) {
      clearTimeout(g.timer);
      g.flujo.getTracks().forEach((t) => t.stop());
    }
  };

  useEffect(() => () => {
    quiereRef.current = false;
    limpiarNavegador();
    liberarGrabacion();
  }, []);

  const terminar = useCallback(() => {
    quiereRef.current = false;
    setProvisional("");
    setEstado("inactivo");
  }, []);

  // ── Motor del navegador ──────────────────────────────────────────────
  const arrancarNavegador = useCallback(() => {
    const Ctor = constructorReconocimiento();
    const rec = new Ctor();
    rec.lang = "es-ES";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    recRef.current = rec;
    rec.onresult = (ev: any) => {
      vaciosRef.current = 0;
      let interino = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = String(r[0]?.transcript ?? "");
        if (r.isFinal) finalRef.current = unir(finalRef.current, t);
        else interino += t;
      }
      setProvisional(interino.trim());
      onCambioRef.current(unir(unir(baseRef.current, finalRef.current), interino));
    };
    rec.onerror = (ev: any) => {
      const e = String(ev?.error ?? "");
      if (e === "no-speech") { vaciosRef.current += 1; return; }
      if (e === "aborted") return;
      if (e === "not-allowed" || e === "service-not-allowed") {
        setError("No hay permiso para el micrófono. Actívalo en los ajustes del navegador para esta web y vuelve a pulsar el micrófono.");
      } else if (e === "audio-capture") {
        setError("No se encuentra ningún micrófono.");
      } else if (e === "network" && puedeGrabar()) {
        // Sin conexión con el servicio de voz del navegador: se pasa a grabar y transcribir en servidor.
        quiereRef.current = false;
        limpiarNavegador();
        setMotor("servidor");
        setError("El reconocimiento del navegador no responde. Pulsa otra vez el micrófono.");
        setEstado("inactivo");
        setProvisional("");
        return;
      } else {
        setError("El dictado se ha interrumpido. Prueba otra vez.");
      }
      terminar();
    };
    rec.onend = () => {
      if (!quiereRef.current) return;
      if (vaciosRef.current >= 2) {
        setError("No te he oído. Pulsa el micrófono y habla cerca.");
        terminar();
        return;
      }
      baseRef.current = unir(baseRef.current, finalRef.current);
      finalRef.current = "";
      try { rec.start(); } catch { terminar(); }
    };
    try {
      rec.start();
    } catch {
      setError("No se pudo iniciar el dictado.");
      terminar();
    }
  }, [terminar]);

  // ── Motor de servidor ────────────────────────────────────────────────
  const enviarAudio = useCallback(async (blob: Blob, segundos: number) => {
    setEstado("transcribiendo");
    try {
      const form = new FormData();
      form.append("audio", blob, "dictado");
      form.append("segundos", String(Math.round(segundos)));
      const { data, error: err } = await supabase.functions.invoke("transcribir-dictado", { body: form });
      if (err || !data?.ok) throw new Error(data?.error ?? "fallo");
      const texto = String(data.texto ?? "").trim();
      if (!texto) setError("No he entendido nada. Prueba otra vez hablando más cerca.");
      else onCambioRef.current(unir(valorRef.current, texto));
    } catch {
      setError("No se pudo transcribir el dictado. Escríbelo o prueba otra vez.");
    } finally {
      setEstado("inactivo");
    }
  }, []);

  const arrancarServidor = useCallback(async () => {
    let flujo: MediaStream;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const nombre = (e as { name?: string })?.name;
      setError(nombre === "NotFoundError" ? "No se encuentra ningún micrófono." : "No hay permiso para el micrófono. Actívalo en los ajustes del navegador para esta web y vuelve a pulsar el micrófono.");
      return;
    }
    const MR = (globalThis as any).MediaRecorder;
    const mime = mimeGrabacion();
    let mr: any;
    try {
      mr = new MR(flujo, mime ? { mimeType: mime } : undefined);
    } catch {
      flujo.getTracks().forEach((t) => t.stop());
      setError("Este navegador no puede grabar audio.");
      return;
    }
    const trozos: Blob[] = [];
    const inicio = Date.now();
    mr.ondataavailable = (ev: BlobEvent) => { if (ev.data?.size) trozos.push(ev.data); };
    mr.onstop = () => {
      const tipo = mr.mimeType || mime || "audio/webm";
      const segundos = (Date.now() - inicio) / 1000;
      liberarGrabacion();
      if (!quiereRef.current) { setEstado("inactivo"); return; }
      quiereRef.current = false;
      void enviarAudio(new Blob(trozos, { type: tipo }), segundos);
    };
    const timer = setTimeout(() => { try { mr.stop(); } catch { /* parado */ } }, MAX_SEGUNDOS_DICTADO * 1000);
    grabRef.current = { mr, flujo, trozos, inicio, timer };
    mr.start();
    setEstado("escuchando");
  }, [enviarAudio]);

  const iniciar = useCallback(() => {
    if (estado !== "inactivo" || !motor) return;
    setError(null);
    setProvisional("");
    quiereRef.current = true;
    if (motor === "navegador") {
      baseRef.current = valorRef.current;
      finalRef.current = "";
      vaciosRef.current = 0;
      setEstado("escuchando");
      arrancarNavegador();
    } else {
      void arrancarServidor().then(() => { if (!grabRef.current) quiereRef.current = false; });
    }
  }, [estado, motor, arrancarNavegador, arrancarServidor]);

  const parar = useCallback(() => {
    if (motor === "navegador") {
      limpiarNavegador();
      terminar();
    } else if (grabRef.current) {
      try { grabRef.current.mr.stop(); } catch { terminar(); }
    }
  }, [motor, terminar]);

  const alternar = useCallback(() => {
    if (estado === "escuchando") parar();
    else if (estado === "inactivo") iniciar();
  }, [estado, iniciar, parar]);

  return { soportado: motor !== null, motor, estado, provisional, error, alternar, parar, limpiarError: () => setError(null) };
}
