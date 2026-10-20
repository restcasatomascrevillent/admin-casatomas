// Base64 sin dependencias (Deno y Node/vitest). Por trozos de 32 KB para no
// reventar la pila con String.fromCharCode(...) en ficheros de hasta 10 MB.
export function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(bin);
}
