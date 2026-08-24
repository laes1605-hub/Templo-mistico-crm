import { NextResponse } from "next/server";

/**
 * Autenticación simple por secreto compartido para los endpoints del Cerebro
 * que consume n8n (inyección de memoria y extracción semanal).
 *
 * - Si NO existe CEREBRO_API_SECRET ni ADMIN_SECRET → el endpoint queda abierto
 *   (para no romper la instalación mientras se configuran las variables).
 * - Si existe → hay que mandar el header `x-cerebro-secret` (o `?key=`).
 */
export function secretoConfigurado(): boolean {
  return Boolean((process.env.CEREBRO_API_SECRET || process.env.ADMIN_SECRET || "").trim());
}

export function verificarSecreto(req: Request): NextResponse | null {
  const esperado = (process.env.CEREBRO_API_SECRET || process.env.ADMIN_SECRET || "").trim();
  if (!esperado) return null; // No configurado: modo abierto.

  const url = new URL(req.url);
  const recibido = (
    req.headers.get("x-cerebro-secret") ||
    req.headers.get("x-admin-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key") ||
    ""
  ).trim();

  if (!recibido || recibido !== esperado) {
    return NextResponse.json(
      { error: "No autorizado. Falta o es incorrecta la clave del Cerebro.", needsSecret: true },
      { status: 401 }
    );
  }
  return null;
}
