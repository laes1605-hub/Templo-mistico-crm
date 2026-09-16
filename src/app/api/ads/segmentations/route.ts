import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getMetaCredentials() {
  const metaToken = (process.env.META_MARKETING_TOKEN || "")
    .replace(/[\r\n\t "']/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  let adAccountId = (process.env.META_AD_ACCOUNT_ID || "")
    .replace(/[\r\n\t "']/g, "")
    .replace(/^act_/, "")
    .trim();
  return { metaToken, adAccountId };
}

type Segmentacion = {
  id: string;
  nombre: string;
  descripcion?: string;
  origen: "saved_audience" | "custom_audience" | "adset" | "local";
  tamano_aprox?: number | string | null;
  paises?: string[];
  ciudades?: string[];
  regiones?: string[];
  edad_min?: number | null;
  edad_max?: number | null;
  generos?: number[];
  intereses?: string[];
  comportamientos?: string[];
  idiomas?: any[];
  placements?: string[];
  targeting_raw?: any;
  actualizado?: string | null;
};

function extraerDeTargeting(t: any): Partial<Segmentacion> {
  if (!t) return {};
  const geo = t.geo_locations || {};
  const flexibles: any[] = [];
  if (Array.isArray(t.flexible_spec)) {
    for (const spec of t.flexible_spec) {
      for (const key of Object.keys(spec || {})) {
        if (Array.isArray(spec[key])) flexibles.push(...spec[key]);
      }
    }
  }
  const intereses = [
    ...(t.interests || []),
    ...flexibles.filter((f: any) => f?.name),
  ]
    .map((i: any) => i?.name || String(i))
    .filter(Boolean);

  const comportamientos = (t.behaviors || []).map((b: any) => b?.name || String(b)).filter(Boolean);

  const placements: string[] = [];
  if (Array.isArray(t.publisher_platforms)) placements.push(...t.publisher_platforms);
  if (Array.isArray(t.facebook_positions)) placements.push(...t.facebook_positions.map((p: string) => `fb:${p}`));
  if (Array.isArray(t.instagram_positions)) placements.push(...t.instagram_positions.map((p: string) => `ig:${p}`));

  return {
    paises: geo.countries || [],
    ciudades: (geo.cities || []).map((c: any) => c?.name || c?.key || String(c)),
    regiones: (geo.regions || []).map((r: any) => r?.name || r?.key || String(r)),
    edad_min: t.age_min ?? null,
    edad_max: t.age_max ?? null,
    generos: t.genders || [1, 2],
    intereses: Array.from(new Set(intereses)),
    comportamientos: Array.from(new Set(comportamientos)),
    idiomas: t.locales || [],
    placements: Array.from(new Set(placements)),
    targeting_raw: t,
  };
}

/**
 * GET /api/ads/segmentations
 *
 * Devuelve TODAS las segmentaciones guardadas en la cuenta publicitaria:
 *  - Públicos guardados (saved_audiences)
 *  - Públicos personalizados (custom_audiences)
 *  - Segmentaciones usadas en los conjuntos de anuncios existentes (adsets)
 */
export async function GET() {
  try {
    const { metaToken, adAccountId } = getMetaCredentials();
    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        ok: false,
        segmentations: [],
        error: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID",
      });
    }

    const segmentations: Segmentacion[] = [];
    const debug: string[] = [];

    // 1) Públicos guardados (lo que en el Administrador de anuncios aparece como "Públicos guardados")
    try {
      const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/saved_audiences?fields=id,name,description,targeting,approximate_count,time_updated,run_status&limit=200&access_token=${encodeURIComponent(metaToken)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      debug.push(`saved_audiences: ${res.status} (${data?.data?.length || 0})${data?.error ? " " + data.error.message : ""}`);
      for (const sa of data?.data || []) {
        segmentations.push({
          id: String(sa.id),
          nombre: sa.name || `Público guardado ${sa.id}`,
          descripcion: sa.description || "",
          origen: "saved_audience",
          tamano_aprox: sa.approximate_count ?? null,
          actualizado: sa.time_updated || null,
          ...extraerDeTargeting(sa.targeting),
        });
      }
    } catch (e: any) {
      debug.push(`saved_audiences error: ${e.message}`);
    }

    // 2) Públicos personalizados (listas, lookalikes, retargeting)
    try {
      const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/customaudiences?fields=id,name,description,subtype,approximate_count_lower_bound,approximate_count_upper_bound,time_updated,delivery_status&limit=200&access_token=${encodeURIComponent(metaToken)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      debug.push(`customaudiences: ${res.status} (${data?.data?.length || 0})${data?.error ? " " + data.error.message : ""}`);
      for (const ca of data?.data || []) {
        segmentations.push({
          id: String(ca.id),
          nombre: ca.name || `Público personalizado ${ca.id}`,
          descripcion: ca.description || ca.subtype || "",
          origen: "custom_audience",
          tamano_aprox:
            ca.approximate_count_lower_bound != null
              ? `${Number(ca.approximate_count_lower_bound).toLocaleString("es-CO")} - ${Number(ca.approximate_count_upper_bound || 0).toLocaleString("es-CO")}`
              : null,
          actualizado: ca.time_updated ? new Date(Number(ca.time_updated) * 1000).toISOString() : null,
        });
      }
    } catch (e: any) {
      debug.push(`customaudiences error: ${e.message}`);
    }

    // 3) Segmentaciones que ya se usan en conjuntos de anuncios existentes.
    //    Muchas veces la segmentación "que necesito" nunca se guardó como público,
    //    solo vive dentro de un adset: aquí también la ofrecemos.
    try {
      const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/adsets?fields=id,name,targeting,effective_status,updated_time,campaign{name}&limit=200&access_token=${encodeURIComponent(metaToken)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      debug.push(`adsets: ${res.status} (${data?.data?.length || 0})${data?.error ? " " + data.error.message : ""}`);
      const vistos = new Set<string>();
      for (const adset of data?.data || []) {
        const extraido = extraerDeTargeting(adset.targeting);
        // Huella para no repetir la misma segmentación 20 veces
        const huella = JSON.stringify({
          p: extraido.paises,
          c: extraido.ciudades,
          a: [extraido.edad_min, extraido.edad_max],
          g: extraido.generos,
          i: (extraido.intereses || []).slice().sort(),
        });
        if (vistos.has(huella)) continue;
        vistos.add(huella);
        segmentations.push({
          id: `adset_${adset.id}`,
          nombre: adset.name || `Conjunto ${adset.id}`,
          descripcion: `Segmentación en uso • Campaña: ${adset.campaign?.name || "—"}`,
          origen: "adset",
          actualizado: adset.updated_time || null,
          ...extraido,
        });
      }
    } catch (e: any) {
      debug.push(`adsets error: ${e.message}`);
    }

    return NextResponse.json({
      ok: true,
      total: segmentations.length,
      segmentations,
      debug,
      note:
        segmentations.length === 0
          ? "No se encontraron segmentaciones guardadas. Verifica que el token tenga permiso ads_read sobre la cuenta."
          : `${segmentations.length} segmentaciones encontradas (públicos guardados, personalizados y en uso).`,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, segmentations: [], error: error.message }, { status: 500 });
  }
}
