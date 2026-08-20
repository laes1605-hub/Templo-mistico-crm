import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("x-admin-secret");
    if (!auth || auth !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: "Clave admin incorrecta" }, { status: 401 });
    }

    let rawOpenAI = (process.env.OPENAI_API_KEY || "")
      .replace(/[\r\n\t "']/g, "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    let rawFish = (process.env.FISH_AUDIO_API_KEY || "")
      .replace(/[\r\n\t "']/g, "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    let openaiHeader = `Bearer ${rawOpenAI}`;
    let fishHeader = `Bearer ${rawFish}`;

    let openai = { ok: false, balance: null as number | null, note: "No consultado" };
    let fish = { ok: false, balance: null as number | null, note: "No consultado" };

    // ---------- 1. OPENAI ----------
    if (rawOpenAI) {
      try {
        const r = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", {
          headers: { Authorization: openaiHeader },
          cache: "no-store",
        });

        if (r.ok) {
          const data = await r.json();
          const available = Number(data?.total_available ?? data?.total_granted ?? 0);
          openai = {
            ok: true,
            balance: isNaN(available) ? null : available,
            note: "Crédito disponible",
          };
        } else {
          const rModels = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: openaiHeader },
            cache: "no-store",
          });
          if (rModels.ok) {
            openai = { ok: true, balance: null, note: "API Key activa y lista" };
          } else {
            openai = { ok: false, balance: null, note: `Error ${rModels.status}` };
          }
        }
      } catch (e: any) {
        openai = { ok: false, balance: null, note: e.message || "Error OpenAI" };
      }
    } else {
      openai.note = "Falta OPENAI_API_KEY en Vercel";
    }

    // ---------- 2. FISH AUDIO (Endpoint Oficial Confirmado) ----------
    if (rawFish) {
      const keyMasked = rawFish.length > 8
        ? `${rawFish.substring(0, 8)}...${rawFish.substring(rawFish.length - 4)}`
        : "Clave corta";

      try {
        const res = await fetch("https://api.fish.audio/model?self=true", {
          method: "GET",
          headers: {
            "Authorization": fishHeader,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        if (res.ok) {
          fish = {
            ok: true,
            balance: null,
            note: `API Conectada (${keyMasked})`,
          };
        } else {
          const txt = await res.text();
          fish = {
            ok: false,
            balance: null,
            note: `HTTP ${res.status}: ${txt.substring(0, 30)}`,
          };
        }
      } catch (e: any) {
        fish = {
          ok: false,
          balance: null,
          note: `Error de red: ${e.message}`,
        };
      }
    } else {
      fish.note = "Falta FISH_AUDIO_API_KEY en Vercel";
    }

    return NextResponse.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      openai,
      fish,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno del servidor" }, { status: 500 });
  }
}