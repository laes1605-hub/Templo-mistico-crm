/**
 * Prueba del endpoint /api/clientes/eliminar y de src/lib/chatwoot.ts.
 *
 * Levanta un Chatwoot y un Supabase (PostgREST) simulados en localhost y ejecuta
 * el código REAL del repo:
 *   - src/lib/chatwoot.ts              → borrarConversacionCompleta()
 *   - src/app/api/clientes/eliminar/route.ts → POST()
 *
 * Se corre con: npm run test:eliminar
 */
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

const REPO = path.resolve(__dirname, "..");

// ------------------------------------------------------------------ utilidades
let fallos = 0;
function ok(condicion: boolean, mensaje: string) {
  if (condicion) console.log("  ✅ " + mensaje);
  else { fallos += 1; console.log("  ❌ " + mensaje); }
}

function leerCuerpo(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let crudo = "";
    req.on("data", (trozo) => { crudo += trozo; });
    req.on("end", () => {
      try { resolve(crudo ? JSON.parse(crudo) : null); } catch { resolve(crudo); }
    });
  });
}

function enviar(res: http.ServerResponse, estado: number, cuerpo: any) {
  const texto = cuerpo === null ? "" : JSON.stringify(cuerpo);
  res.writeHead(estado, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(texto),
  });
  res.end(texto);
}

// ------------------------------------------------------- Chatwoot de mentiras
type EstadoChatwoot = {
  modo: "permite_borrar" | "sin_permiso";
  borradas: string[];
  llamadas: { metodo: string; ruta: string; cuerpo?: any }[];
};

const chatwootEstado: EstadoChatwoot = { modo: "permite_borrar", borradas: [], llamadas: [] };

const servidorChatwoot = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const ruta = url.pathname.replace(/^\/api\/v1\/accounts\/1/, "");
  const cuerpo = await leerCuerpo(req);
  chatwootEstado.llamadas.push({ metodo: req.method || "", ruta, cuerpo });

  const coincideConv = ruta.match(/^\/conversations\/(\d+)$/);
  const coincideMensaje = ruta.match(/^\/conversations\/(\d+)\/messages\/(\d+)$/);

  if (coincideConv && req.method === "DELETE") {
    if (chatwootEstado.modo === "sin_permiso") return enviar(res, 403, { error: "no autorizado" });
    chatwootEstado.borradas.push(coincideConv[1]);
    return enviar(res, 200, {});
  }
  if (coincideConv && req.method === "GET") {
    if (chatwootEstado.borradas.includes(coincideConv[1])) return enviar(res, 404, { error: "no existe" });
    return enviar(res, 200, {
      id: Number(coincideConv[1]),
      labels: ["lead"],
      custom_attributes: {
        tipo_trabajo: "pareja",
        motivo_categoria: "amarre",
        motivo_resumen: "quiere recuperar a su esposo",
        motivo_conocido: true,
        nombre_cliente: "Marta",
        nombre_otra_persona: "Jorge",
        foto_cliente: true,
        foto_mano: false,
        foto_cliente_url: "https://x/foto.jpg",
        fotos_pendientes: '["foto_mano"]',
        luna_etapa: "datos",
        luna_etapa_crm_sync: true,
        clave_nueva_del_futuro: ["valor"],
      },
    });
  }
  if (ruta.match(/^\/conversations\/\d+\/custom_attributes$/) && req.method === "POST") {
    return enviar(res, 200, {});
  }
  if (ruta.match(/^\/conversations\/\d+\/labels$/) && req.method === "POST") {
    return enviar(res, 200, {});
  }
  if (ruta.startsWith("/conversations/") && ruta.includes("/messages/") && req.method === "DELETE") {
    return enviar(res, 200, {});
  }
  if (ruta.match(/^\/conversations\/\d+\/messages$/) && req.method === "GET") {
    // Historial corto: dos notas privadas de Luna y un mensaje del cliente.
    return enviar(res, 200, {
      data: [
        { id: 11, private: false, content: "hola", message_type: 0 },
        { id: 12, private: true, content: "🔎 Ficha de Luna (etapa: Datos)", message_type: 2 },
        { id: 13, private: true, content: "🔎 Ficha de Luna (etapa: Por consulta)", message_type: 2 },
      ],
      meta: {},
    });
  }
  return enviar(res, 404, { error: "ruta desconocida " + ruta });
});

// ---------------------------------------------- Supabase/PostgREST de mentiras
const ID_CLIENTE = "11111111-1111-4111-8111-111111111111";
const ID_CLIENTE_INEXISTENTE = "22222222-2222-4222-8222-222222222222";

const supabaseEstado = {
  rpcDisponible: true,
  llamadasRpc: [] as any[],
  deletes: [] as string[],
};

const RESUMEN_RPC = {
  cliente_id: ID_CLIENTE,
  cliente_eliminado: 1,
  conversaciones_eliminadas: 2,
  mensajes_eliminados: 57,
  pagos_eliminados: 2,
  tareas_eliminadas: 3,
  recordatorios_eliminados: 1,
  reglas_cerebro_eliminadas: 1,
  otras_tablas: { seguimientos: 1 },
};

const servidorSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const aceptaObjeto = String(req.headers.accept || "").includes("vnd.pgrst.object");

  if (url.pathname === "/rest/v1/clientes" && req.method === "GET") {
    const id = (url.searchParams.get("id") || "").replace("eq.", "");
    // maybeSingle() no cambia el Accept: PostgREST responde 200 con [] si no hay fila.
    if (id === ID_CLIENTE_INEXISTENTE) return enviar(res, 200, []);
    const fila = { id, telefono: "+573001112233", telefono_display: "+57 300 1112233", nombre: "Cliente WhatsApp", nombre_manual: "Marta" };
    return enviar(res, 200, aceptaObjeto ? fila : [fila]);
  }

  if (url.pathname === "/rest/v1/conversaciones" && req.method === "GET") {
    return enviar(res, 200, [
      { id: "c-1", chatwoot_conversation_id: "101", fuente: "meta_business", numero_whatsapp: "+573001112233" },
      { id: "c-2", chatwoot_conversation_id: "102", fuente: "evolution", numero_whatsapp: "+573001112233" },
    ]);
  }

  if (url.pathname === "/rest/v1/rpc/eliminar_cliente_completo" && req.method === "POST") {
    const cuerpo = await leerCuerpo(req);
    supabaseEstado.llamadasRpc.push(cuerpo);
    if (!supabaseEstado.rpcDisponible) {
      return enviar(res, 404, { code: "PGRST202", message: "Could not find the function public.eliminar_cliente_completo" });
    }
    return enviar(res, 200, RESUMEN_RPC);
  }

  if (req.method === "DELETE") {
    supabaseEstado.deletes.push(url.pathname + url.search);
    res.writeHead(204);
    return res.end();
  }

  return enviar(res, 404, { error: "ruta desconocida " + url.pathname });
});

// ---------------------------------------------------------------------- prueba
async function main() {
  await new Promise<void>((r) => servidorChatwoot.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => servidorSupabase.listen(0, "127.0.0.1", r));
  const puertoCw = (servidorChatwoot.address() as AddressInfo).port;
  const puertoSb = (servidorSupabase.address() as AddressInfo).port;

  // El cliente de Supabase del repo lee estas variables al cargar el módulo.
  process.env.SUPABASE_URL = `http://127.0.0.1:${puertoSb}`;
  process.env.CHATWOOT_URL = `http://127.0.0.1:${puertoCw}`;
  process.env.CHATWOOT_API_TOKEN = "token-de-prueba";
  process.env.CHATWOOT_ACCOUNT_ID = "1";

  const { POST } = require(`${REPO}/src/app/api/clientes/eliminar/route.ts`);

  const llamar = async (cuerpo: any) => {
    const peticion = new Request(`http://127.0.0.1:${puertoSb}/api/clientes/eliminar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const respuesta = await POST(peticion);
    let json: any = null;
    try { json = await respuesta.json(); } catch {}
    return { status: respuesta.status, json };
  };

  const reiniciar = () => {
    chatwootEstado.borradas = [];
    chatwootEstado.llamadas = [];
    chatwootEstado.modo = "permite_borrar";
    supabaseEstado.llamadasRpc = [];
    supabaseEstado.deletes = [];
    supabaseEstado.rpcDisponible = true;
    process.env.CHATWOOT_URL = `http://127.0.0.1:${puertoCw}`;
  };

  // ------------------------------------------------------------------ caso 1
  console.log("\n1) Eliminación completa (Chatwoot permite borrar la conversación)");
  reiniciar();
  let r = await llamar({ clienteId: ID_CLIENTE });
  ok(r.status === 200 && r.json?.ok === true, `responde 200 ok (status ${r.status})`);
  ok(r.json?.cliente === "Marta", `identifica al cliente por su nombre manual (${r.json?.cliente})`);
  ok(r.json?.crm?.mensajes_eliminados === 57, "devuelve el resumen de Supabase (57 mensajes)");
  ok(r.json?.crm?.otras_tablas?.seguimientos === 1, "informa las tablas extra barridas");
  ok(r.json?.chatwoot?.eliminadas === 2, "borró las 2 conversaciones de WhatsApp");
  ok([...chatwootEstado.borradas].sort().join(",") === "101,102", `pidió el DELETE de 101 y 102 (${chatwootEstado.borradas})`);
  ok(supabaseEstado.llamadasRpc.length === 1, "llamó eliminar_cliente_completo una vez");
  ok(supabaseEstado.llamadasRpc[0]?.p_cliente_id === ID_CLIENTE, "con el id del cliente correcto");
  ok((r.json?.advertencias || []).length === 0, "sin advertencias");

  // ------------------------------------------------------------------ caso 2
  console.log("\n2) Chatwoot no deja borrar la conversación → se vacía la memoria de Luna");
  reiniciar();
  chatwootEstado.modo = "sin_permiso";
  r = await llamar({ clienteId: ID_CLIENTE });
  ok(r.status === 200 && r.json?.ok === true, "igualmente elimina al cliente del CRM");
  ok(r.json?.chatwoot?.eliminadas === 0, "no reporta conversaciones borradas");
  ok(r.json?.chatwoot?.memoria_vaciada === 2, "vació la memoria de Luna en las 2 conversaciones");
  ok(r.json?.chatwoot?.fichas_luna_borradas === 4, `borró las fichas privadas de Luna (${r.json?.chatwoot?.fichas_luna_borradas})`);
  const reset = chatwootEstado.llamadas.find((l) => l.ruta.includes("custom_attributes"))?.cuerpo?.custom_attributes;
  ok(reset?.tipo_trabajo === "" && reset?.motivo_resumen === "", "vacía texto (tipo_trabajo, motivo_resumen)");
  ok(reset?.motivo_conocido === false && reset?.foto_cliente === false, "vacía booleanos (motivo_conocido, foto_cliente)");
  ok(reset?.fotos_pendientes === "", "vacía la lista de fotos pendientes");
  ok(reset?.luna_etapa === "", "vacía luna_etapa (Luna vuelve a empezar en Lead Nuevo)");
  ok(Array.isArray(reset?.clave_nueva_del_futuro) && reset.clave_nueva_del_futuro.length === 0, "vacía también claves desconocidas");
  ok(chatwootEstado.llamadas.some((l) => l.ruta.endsWith("/labels") && JSON.stringify(l.cuerpo) === '{"labels":[]}'), "quita las etiquetas de la conversación");
  ok((r.json?.advertencias || []).some((a: string) => a.includes("sin permiso")), "avisa que quedó el historial de Chatwoot");

  // ------------------------------------------------------------------ caso 3
  console.log("\n3) Chatwoot caído → NO se toca Supabase");
  reiniciar();
  process.env.CHATWOOT_URL = "http://127.0.0.1:1"; // puerto muerto
  r = await llamar({ clienteId: ID_CLIENTE });
  ok(r.status === 409, `responde 409 (status ${r.status})`);
  ok(r.json?.bloqueo === "chatwoot", "marca el bloqueo de chatwoot");
  ok(supabaseEstado.llamadasRpc.length === 0, "no llamó a Supabase: el cliente sigue intacto");
  ok(Array.isArray(r.json?.detalle) && r.json.detalle.length === 2, "explica qué falló en cada conversación");

  // ------------------------------------------------------------------ caso 4
  console.log("\n4) El operador decide eliminar sólo del CRM");
  reiniciar();
  process.env.CHATWOOT_URL = "http://127.0.0.1:1";
  r = await llamar({ clienteId: ID_CLIENTE, soloCrm: true });
  ok(r.status === 200 && r.json?.ok === true, "elimina del CRM aunque Chatwoot esté caído");
  ok(chatwootEstado.llamadas.length === 0, "no llama a Chatwoot");
  ok(r.json?.chatwoot?.omitidas === 2, "avisa cuántos chats quedaron sin tocar");
  ok((r.json?.advertencias || []).some((a: string) => a.includes("sólo del CRM")), "advierte que Luna puede recordar el caso");

  // ------------------------------------------------------------------ caso 5
  console.log("\n5) Cliente inexistente");
  reiniciar();
  r = await llamar({ clienteId: ID_CLIENTE_INEXISTENTE });
  ok(r.status === 404, `responde 404 (status ${r.status})`);
  ok(supabaseEstado.llamadasRpc.length === 0, "no intenta borrar nada");

  // ------------------------------------------------------------------ caso 6
  console.log("\n6) Sin la migración aplicada → borrado por tablas");
  reiniciar();
  supabaseEstado.rpcDisponible = false;
  r = await llamar({ clienteId: ID_CLIENTE });
  ok(r.status === 200 && r.json?.ok === true, "funciona aunque falte la función en Supabase");
  ok(r.json?.crm?.cliente_eliminado === 1, "borra el cliente por tablas");
  ok(supabaseEstado.deletes.some((d) => d.startsWith("/rest/v1/clientes?")), "borra la fila de clientes");
  ok(supabaseEstado.deletes.some((d) => d.startsWith("/rest/v1/mensajes?conversacion_id=in.")), "borra los mensajes por conversación");
  ok(supabaseEstado.deletes.some((d) => d.startsWith("/rest/v1/recordatorios_whatsapp?")), "borra los recordatorios");

  // ------------------------------------------------------------------ caso 7
  console.log("\n7) Validación de entrada");
  reiniciar();
  r = await llamar({ clienteId: "no-es-un-uuid" });
  ok(r.status === 400, `rechaza un id inválido (status ${r.status})`);

  servidorChatwoot.close();
  servidorSupabase.close();
  console.log(fallos === 0 ? "\n🎉 TODAS LAS PRUEBAS PASARON" : `\n💥 ${fallos} PRUEBAS FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
