import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("x-admin-secret");
    if (!auth || auth !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: "Clave admin incorrecta" }, { status: 401 });
    }

    const openaiKey = (process.env.OPENAI_API_KEY || "").trim().replace(/^["']|["']$/g, "");
    let fishKey = (process.env.FISH_AUDIO_API_KEY || "").trim().replace(/^["']|["']$/g, "");

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
            openai = {
              ok: true,
              balance: null,
              note: "API Key activa",
            };
          } else {
            const txt = await rModels.text();
            openai = {
              ok: false,
              balance: null,
              note: `Error ${rModels.status}`,
            };
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
      // Probar variaciones de endpoints y headers
      const testConfigs = [
        { url: "https://api.fish.audio/v1/user/wallet", authHeader: `Bearer ${fishKey}` },
        { url: "https://api.fish.audio/v1/user/wallet", authHeader: fishKey },
        { url: "https://api.fish.audio/v1/wallet", authHeader: `Bearer ${fishKey}` },
        { url: "https://api.fish.audio/wallet", authHeader: `Bearer ${fishKey}` },
      ];

      let success = false;
      let lastErrNote = "";

      for (const config of testConfigs) {
        try {
          const res = await fetch(config.url, {
            headers: { Authorization: config.authHeader },
            cache: "no-store",
          });

          if (res.ok) {
            const data = await res.json();
            const bal = Number(
              data?.credit ??
              data?.balance ??
              data?.amount ??
              data?.wallet?.credit ??
              data?.data?.balance ??
              0
            );
            fish = {
              ok: true,
              balance: isNaN(bal) ? 0 : bal,
              note: "Saldo Fish Audio",
            };
            success = true;
            break;
          } else {
            const txt = await res.text();
            lastErrNote = `HTTP ${res.status}: ${txt.substring(0, 30)}`;
          }
        } catch (e: any) {
          lastErrNote = `Error: ${e.message}`;
        }
      }

      if (!success) {
        fish = { ok: false, balance: null, note: `${lastErrNote} (Revisa la API Key en Fish.audio)` };
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