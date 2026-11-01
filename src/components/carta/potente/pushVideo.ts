/**
 * Web Push (VAPID) para avisar al móvil que grabó el vídeo cuando el
 * dispositivo potente lo termina, aunque tenga el panel cerrado.
 *
 * Clave pública: VITE_VAPID_PUBLIC_KEY (env de Vercel). Sin ella, o sin
 * service worker / PushManager (p. ej. Safari de iPhone sin instalar el panel
 * en la pantalla de inicio), `pushDisponible()` es false y la UI lo dice.
 * La suscripción se guarda con la RPC guardar_suscripcion_push.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { describirDispositivo } from "./colaPendientes";

const sb = supabase as unknown as SupabaseClient;

export function clavePublicaVapid(): string {
  return ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "").trim();
}

export type DisponibilidadPush = { ok: true } | { ok: false; motivo: string };

export function pushDisponible(clave = clavePublicaVapid()): DisponibilidadPush {
  if (!clave) return { ok: false, motivo: "Avisos push sin configurar (falta VITE_VAPID_PUBLIC_KEY)." };
  if (typeof window === "undefined" || typeof navigator === "undefined") return { ok: false, motivo: "Sin navegador" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined")
    return {
      ok: false,
      motivo: "Este navegador no admite avisos push. En iPhone, añade el panel a la pantalla de inicio y ábrelo desde ahí.",
    };
  return { ok: true };
}

/** Clave VAPID base64url → bytes (applicationServerKey). */
export function base64UrlABytes(base64: string): Uint8Array {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function permisoNotificaciones(): NotificationPermission | "no-soportado" {
  return typeof Notification === "undefined" ? "no-soportado" : Notification.permission;
}

async function registroSW(msMax = 4000): Promise<ServiceWorkerRegistration | null> {
  const r = await navigator.serviceWorker.getRegistration();
  if (r) return r;
  // El SW solo se registra en producción (registrarServiceWorker.ts); no esperar para siempre.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((ok) => setTimeout(() => ok(null), msMax)),
  ]);
}

/**
 * Pide permiso (si hace falta), suscribe este navegador y guarda la
 * suscripción. Llamar desde un gesto del usuario (iOS lo exige).
 */
export async function activarAvisosPush(): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const disp = pushDisponible();
  if ("motivo" in disp) return disp;
  try {
    const permiso = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permiso !== "granted") return { ok: false, motivo: "No has dado permiso para las notificaciones." };
    const reg = await registroSW();
    if (!reg) return { ok: false, motivo: "El panel no tiene service worker activo (recarga la página)." };
    const clave = base64UrlABytes(clavePublicaVapid());
    let sus = await reg.pushManager.getSubscription();
    if (sus) {
      // Si la suscripción es de otra clave VAPID, rehacerla.
      const actual = sus.options?.applicationServerKey;
      if (actual && new Uint8Array(actual).toString() !== clave.toString()) {
        await sus.unsubscribe().catch(() => undefined);
        sus = null;
      }
    }
    sus ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });
    const json = sus.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, motivo: "Suscripción push incompleta" };
    const { error } = await sb.rpc("guardar_suscripcion_push", {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_etiqueta: describirDispositivo(),
    });
    if (error) return { ok: false, motivo: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: (e as Error)?.message || "No se pudieron activar los avisos" };
  }
}
