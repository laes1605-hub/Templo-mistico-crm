import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { campaignId, newStatus } = await req.json();

    if (!campaignId || !newStatus) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    const metaToken = process.env.META_MARKETING_TOKEN || "";

    if (metaToken && !campaignId.startsWith("camp_")) {
      const url = `https://graph.facebook.com/v19.0/${campaignId}?status=${newStatus}&access_token=${metaToken}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const txt = await res.text();
        return NextResponse.json({ error: "Error en Meta API: " + txt }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, campaignId, newStatus });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}