import { NextResponse } from "next/server";
import {
  CambiosConfig,
  cargarConfigWhatsAppPersonal,
  estadoCuentasPersonales,
  guardarConfigWhatsAppPersonal,
} from "../../../lib/whatsapp-cuentas-servidor";

/**
 * API del SEGUNDO WhatsApp Personal.
 *
 * GET  /api/whatsapp-cuentas
 *      → configuración de las dos cuentas personales + estado real de cada
 *        instancia en Evolution (conectada / desconectada / sin verificar).
 *
 * POST /api/whatsapp-cuentas
 *      body { accion: "guardar", ...campos }  → guarda número, instancia,
 *           bandeja de Chatwoot y etiqueta de cada cuenta.
 *      body { accion: "activar", cuenta }     → elige la cuenta activa (manual).
 */

const LIMPIO = (valor: unknown) => String(valor ?? "").trim();

export async function GET() {
  try {
    const config = await cargarConfigWhatsAppPersonal();
    const cuentas = await estadoCuentasPersonales(config);
    return NextResponse.json({
      ok: true,
      config: {
        activa: config.activa,
        etiquetas: config.etiquetas,
        personal: config.personal,
        personal2: config.personal2,
      },
      cuentas,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "No se pudo consultar el estado de las cuentas." },
      { status: 500 },
    );
  }
}

function validarInstancia(valor: string): string | null {
  if (!valor) return null;
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(valor)) {
    return "El nombre de la instancia sólo admite letras, números, punto, guion y guion bajo.";
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const accion = LIMPIO(body?.accion) || "guardar";

    if (accion === "activar") {
      const cuenta = LIMPIO(body?.cuenta) === "personal_2" ? "personal_2" : "personal";
      const configActual = await cargarConfigWhatsAppPersonal();
      if (cuenta === "personal_2" && !configActual.personal2.configurada) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "El WhatsApp 2 todavía no está configurado. Indica su número (y la bandeja de Chatwoot) antes de activarlo.",
          },
          { status: 400 },
        );
      }
      const guardado = await guardarConfigWhatsAppPersonal({ activa: cuenta });
      if (!guardado.ok) {
        return NextResponse.json({ ok: false, error: guardado.error }, { status: 500 });
      }
      const cuentas = await estadoCuentasPersonales(guardado.config);
      return NextResponse.json({ ok: true, config: guardado.config, cuentas });
    }

    if (accion !== "guardar") {
      return NextResponse.json({ ok: false, error: `Acción desconocida: ${accion}` }, { status: 400 });
    }

    const cambios: CambiosConfig = {};

    if (body?.numero2 !== undefined) {
      const digitos = LIMPIO(body.numero2).replace(/\D/g, "");
      if (digitos && digitos.length < 8) {
        return NextResponse.json(
          { ok: false, error: "El número del WhatsApp 2 debe tener al menos 8 dígitos (con código de país)." },
          { status: 400 },
        );
      }
      cambios.numero2 = digitos;
    }
    if (body?.numero1 !== undefined) {
      cambios.numero1 = LIMPIO(body.numero1).replace(/\D/g, "");
    }
    if (body?.etiqueta2 !== undefined) cambios.etiqueta2 = LIMPIO(body.etiqueta2).slice(0, 40);
    if (body?.etiqueta1 !== undefined) cambios.etiqueta1 = LIMPIO(body.etiqueta1).slice(0, 40);
    if (body?.instancia2 !== undefined) {
      const instancia = LIMPIO(body.instancia2);
      const invalido = validarInstancia(instancia);
      if (invalido) return NextResponse.json({ ok: false, error: invalido }, { status: 400 });
      cambios.instancia2 = instancia;
    }
    if (body?.instancia1 !== undefined) {
      const instancia = LIMPIO(body.instancia1);
      const invalido = validarInstancia(instancia);
      if (invalido) return NextResponse.json({ ok: false, error: invalido }, { status: 400 });
      cambios.instancia1 = instancia;
    }
    if (body?.inbox2 !== undefined) {
      const inbox = LIMPIO(body.inbox2);
      if (inbox && !/^\d{1,10}$/.test(inbox)) {
        return NextResponse.json(
          { ok: false, error: "El ID de la bandeja de Chatwoot debe ser un número (lo ves en la URL de la bandeja)." },
          { status: 400 },
        );
      }
      cambios.inbox2 = inbox;
    }

    const guardado = await guardarConfigWhatsAppPersonal(cambios);
    if (!guardado.ok) {
      return NextResponse.json({ ok: false, error: guardado.error }, { status: 500 });
    }

    // Si acaban de configurar el WhatsApp 2 y la cuenta activa era la 1, no se
    // cambia nada: la activación es SIEMPRE una decisión aparte del operador.
    const cuentas = await estadoCuentasPersonales(guardado.config);
    return NextResponse.json({ ok: true, config: guardado.config, cuentas });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "No se pudo guardar la configuración." },
      { status: 500 },
    );
  }
}
