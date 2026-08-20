import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("x-admin-secret");
    if (!auth || auth !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: "Clave admin incorrecta" }, { status: 401 });
    }

    const openaiKey = process.env.OPENAI_API_KEY || "";
    const fishKey = process.env.FISH_AUDIO_API_KEY || "";

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
          openai = {
            ok: false,
            balance: null,
            note: `OpenAI respondió ${r.status}. Revisa el Billing en su panel.`,
          };
        }
      } catch (e: any) {
        openai = { ok: false, balance: null, note: e.message || "Error conexión OpenAI" };
      }
    } else {
      openai.note = "Falta OPENAI_API_KEY en Vercel";
    }

    // ---------- FISH AUDIO ----------
    if (fishKey) {
      try {
        const r = await fetch("https://api.fish.audio/wallet", {
          headers: { Authorization: `Bearer ${fishKey}` },
          cache: "no-store",
        });

        if (r.ok) {
          const data = await r.json();
          const bal = Number(data?.balance ?? data?.credit ?? data?.amount ?? data?.data?.balance ?? 0);
          fish = {
            ok: true,
            balance: isNaN(bal) ? null : bal,
            note: "Saldo Fish Audio",
          };
        } else {
          const r2 = await fetch("https://api.fish.audio/user", {
            headers: { Authorization: `Bearer ${fishKey}` },
            cache: "no-store",
          });
          if (r2.ok) {
            const data2 = await r2.json();
            const bal2 = Number(data2?.credit ?? data2?.balance ?? data2?.wallet ?? 0);
            fish = { ok: true, balance: isNaN(bal2) ? null : bal2, note: "Saldo Fish (user)" };
          } else {
            fish = { ok: false, balance: null, note: `Fish respondió Error ${r.status}` };
          }
        }
      } catch (e: any) {
        fish = { ok: false, balance: null, note: e.message || "Error conexión Fish" };
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