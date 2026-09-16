import { getMetaConfig, metaGraph } from "@/lib/meta-config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
 * Devuelve las segmentaciones de la cuenta publicitaria configurada:
 *  - Públicos guardados (saved_audiences) ← los del Administrador de anuncios
 *  - Públicos personalizados (customaudiences)
 *  - Segmentaciones usadas en conjuntos de anuncios existentes (adsets)
 *
 * NOTA: solo se piden campos que existen en la API. Pedir un campo inválido
 * (p. ej. run_status) hace que Meta devuelva error en TODA la consulta y la
 * lista llegue vacía o incompleta.
 */
export async function GET() {
  try {
    const { metaToken, adAccountId } = await getMetaConfig();
    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        ok: false,
        segmentations: [],
        error: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID",
      });
    }

    const tokenParam = `access_token=${encodeURIComponent(metaToken)}`;
    const segmentations: Segmentacion[] = [];
    const debug: string[] = [];
    let nSaved = 0;
    let nCustom = 0;
    let nAdsets = 0;

    // 1) Públicos guardados (lo que en el Administrador de anuncios aparece como "Públicos guardados")
    try {
      const url = metaGraph(`/act_${adAccountId}/saved_audiences?fields=id,name,description,targeting,approximate_count,time_updated&limit=200&${tokenParam}`);
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      debug.push(`saved_audiences: ${res.status} (${data?.data?.length || 0})${data?.error ? " " + data.error.message : ""}`);
      for (const sa of data?.data || []) {
        nSaved++;
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
      const url = metaGraph(`/act_${adAccountId}/customaudiences?fields=id,name,description,subtype,approximate_count_lower_bound,approximate_count_upper_bound,time_updated&limit=200&${tokenParam}`);
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      debug.push(`customaudiences: ${res.status} (${data?.data?.length || 0})${data?.error ? " " + data.error.message : ""}`);
      for (const ca of data?.data || []) {
        nCustom++;
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
    //    Muchas veces la segmentación que se necesita nunca se guardó como público,
    //    solo vive dentro de un adset: aquí también se ofrece.
    try {
      const url = metaGraph(`/act_${adAccountId}/adsets?fields=id,name,targeting,effective_status,updated_time,campaign{name}&limit=200&${tokenParam}`);
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
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
        nAdsets++;
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
      counts: { saved: nSaved, custom: nCustom, adsets: nAdsets },
      ad_account_id: adAccountId,
      segmentations,
      debug,
      note:
        segmentations.length === 0
          ? `La cuenta act_${adAccountId} no devolvió segmentaciones. Verifica que el token tenga permiso ads_read sobre esa cuenta.`
          : nSaved === 0
            ? `${segmentations.length} segmentaciones en act_${adAccountId} (${nCustom} personalizados, ${nAdsets} en uso). Esta cuenta no tiene públicos guardados: créalos en el Administrador de anuncios → Públicos.`
            : `${nSaved} públicos guardados + ${nCustom} personalizados + ${nAdsets} en uso (cuenta act_${adAccountId}).`,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, segmentations: [], error: error.message }, { status: 500 });
  }
}
