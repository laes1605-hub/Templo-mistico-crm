import { NextResponse } from "next/server";
import { getMetaConfig, metaGraph } from "@/lib/meta-config";

export async function POST(req: Request) {
  try {
    const { campaignId, newStatus } = await req.json();

    if (!campaignId || !newStatus) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    const { metaToken } = await getMetaConfig();

    if (metaToken && !String(campaignId).startsWith("camp_")) {
      const res = await fetch(metaGraph(`/${campaignId}`), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: newStatus, access_token: metaToken }).toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        return NextResponse.json({ error: "Error en Meta API: " + (data?.error?.message || res.status) }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, campaignId, newStatus });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
