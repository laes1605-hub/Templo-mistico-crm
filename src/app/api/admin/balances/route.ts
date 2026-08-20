import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("x-admin-secret");
    if (!auth || auth !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: "Clave admin incorrecta" }, { status: 401 });
    }

    const openaiKey = (process.env.OPENAI_API_KEY || "")
      .replace(/[\r\n\t "']/g, "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    let rawFishKey = (process.env.FISH_AUDIO_API_KEY || "")
      .replace(/[\r\n\t "']/g, "")
      .trim();

    // Limpiar si la variable ya incluye la palabra "Bearer"
    const fishKey = rawFishKey.replace(/^Bearer\s*/i, "").trim();

    let openai = { ok: false, balance: null as number | null, note: "No consultado" };
    let fish = { ok: false, balance: null as number | null, note: "No consultado" };

    // ---------- OPENAI ----------
    if (openaiKey) {
      try {
        const r = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", {
          headers: { Authorization: `Bearer ${openaiKey}` },
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
            headers: { Authorization: `Bearer ${openaiKey}` },
            cache: "no-store",
          });
          if (rModels.ok) {
            openai = { ok: true, balance: null, note: "API Key activa" };
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

    // ---------- FISH AUDIO ----------
    if (fishKey) {
      const keyMasked = fishKey.length > 10
        ? `${fishKey.substring(0, 8)}...${fishKey.substring(fishKey.length - 4)}`
        : "Clave corta";

      try {
        const res = await fetch("https://api.fish.audio/v1/user/wallet", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${fishKey}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        if (res.ok) {
          const data = await res.json();
          const bal = Number(
            data?.credit ??
            data?.balance ??
            data?.amount ??
            data?.wallet?.credit ??
            data?.data?.credit ??
            0
          );
          fish = {
            ok: true,
            balance: isNaN(bal) ? 0 : bal,
            note: `Saldo activo (${keyMasked})`,
          };
        } else {
          const txt = await res.text();
          fish = {
            ok: false,
            balance: null,
            note: `HTTP ${res.status}: ${txt.substring(0, 30)} | Key: ${keyMasked}`,
          };
        }
      } catch (e: any) {
        fish = {
          ok: false,
          balance: null,
          note: `Error red: ${e.message}`,
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