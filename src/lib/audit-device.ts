// Identificador de esta instalación del navegador; no es una prueba de identidad.
// No usa huellas ni datos personales. Si el almacenamiento está bloqueado dura
// solo mientras la página permanezca abierta.
let dispositivo: string | undefined;
export function auditDeviceId(): string {
  if (dispositivo) return dispositivo;
  try {
    const saved = localStorage.getItem("adminpanel.audit.device");
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) dispositivo = saved;
  } catch { /* navegación privada */ }
  dispositivo ??= crypto.randomUUID();
  try { localStorage.setItem("adminpanel.audit.device", dispositivo); } catch { /* solo memoria */ }
  return dispositivo;
}

export const auditFetch: typeof fetch = (input, init) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  // x-client-info ya está permitido por el CORS de las funciones existentes.
  headers.set("x-client-info", `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}`);
  return fetch(input, { ...init, headers });
};

export function describeDevice(agent: string | null | undefined): string {
  if (!agent) return "Dispositivo no registrado";
  const os = /iPad|Macintosh.*Mobile/i.test(agent) ? "iPad" : /iPhone/i.test(agent) ? "iPhone" :
    /Android/i.test(agent) ? "Android" : /Windows/i.test(agent) ? "Windows" : /Macintosh|Mac OS/i.test(agent) ? "Mac" : /Linux/i.test(agent) ? "Linux" : "Otro dispositivo";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox|FxiOS/.test(agent) ? "Firefox" :
    /Chrome|CriOS/.test(agent) ? "Chrome" : /Safari/.test(agent) ? "Safari" : "Otro navegador";
  return `${os} · ${browser}`;
}
