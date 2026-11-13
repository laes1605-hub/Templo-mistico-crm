/**
 * Prueba del SEGUNDO WHATSAPP PERSONAL (src/lib/whatsapp-cuentas.ts).
 *
 * Valida las reglas puras que deciden:
 *   · qué cuenta personal es cada bandeja de Chatwoot,
 *   · qué instancia de Evolution se usa en cada envío,
 *   · qué mensaje ve el operador cuando una cuenta está bloqueada.
 *
 * Se corre con: npm run test:whatsapp2
 */

import {
  cuentaDeInboxChatwoot,
  esCuentaPersonal,
  etiquetaCuenta,
  instanciaDeCuenta,
  mensajeErrorCuenta,
  normalizarCuentaEnvio,
  normalizarCuentaPersonal,
  pareceErrorDeBloqueo,
} from "../src/lib/whatsapp-cuentas";

let fallos = 0;
let pruebas = 0;

function igual(actual: unknown, esperado: unknown, descripcion: string) {
  pruebas++;
  const ok = JSON.stringify(actual) === JSON.stringify(esperado);
  if (!ok) {
    fallos++;
    console.error(`✗ ${descripcion}\n   esperado: ${JSON.stringify(esperado)}\n   actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`✓ ${descripcion}`);
  }
}

function verdadero(valor: unknown, descripcion: string) {
  igual(Boolean(valor), true, descripcion);
}

// ---------------------------------------------------------------- normalización
igual(normalizarCuentaPersonal("personal"), "personal", "cuenta personal 1");
igual(normalizarCuentaPersonal("evolution"), "personal", "alias 'evolution' = cuenta 1");
igual(normalizarCuentaPersonal("personal2"), "personal_2", "alias 'personal2' = cuenta 2");
igual(normalizarCuentaPersonal("personal_2"), "personal_2", "cuenta personal 2");
igual(normalizarCuentaPersonal("2"), "personal_2", "alias '2' = cuenta 2");
igual(normalizarCuentaPersonal("desconocida"), null, "valor desconocido → null");
igual(normalizarCuentaEnvio("meta_business"), "meta_business", "cuenta API");
igual(normalizarCuentaEnvio("templo"), "meta_business", "alias 'templo' = API");
igual(normalizarCuentaEnvio("secundaria"), "personal_2", "alias 'secundaria' = cuenta 2");
verdadero(esCuentaPersonal("personal_2"), "esCuentaPersonal reconoce la cuenta 2");
verdadero(!esCuentaPersonal("meta_business"), "esCuentaPersonal rechaza la API");

// ---------------------------------------------------------------- instancias
igual(
  instanciaDeCuenta("personal", { instanciaPersonal: "evo-uno", instanciaPersonal2: "evo-dos" }),
  "evo-uno",
  "instancia configurada de la cuenta 1",
);
igual(
  instanciaDeCuenta("personal_2", { instanciaPersonal: "evo-uno", instanciaPersonal2: "evo-dos" }),
  "evo-dos",
  "instancia configurada de la cuenta 2",
);
igual(instanciaDeCuenta("personal_2", {}), "personal2", "instancia por defecto de la cuenta 2");

// ---------------------------------------------------------------- bandejas
igual(cuentaDeInboxChatwoot(7, "WhatsApp Personal 2", { inboxIdPersonal2: "7" }), "personal_2", "bandeja por ID configurado");
igual(cuentaDeInboxChatwoot(3, "WhatsApp Personal", { inboxIdPersonal2: "7" }), "personal", "bandeja principal por nombre");
igual(cuentaDeInboxChatwoot(9, "WhatsApp Personal Respaldo", {}), "personal_2", "nombre con 'respaldo' → cuenta 2");
igual(cuentaDeInboxChatwoot(9, "Evolution Secundaria", {}), "personal_2", "nombre con 'secundaria' → cuenta 2");
igual(cuentaDeInboxChatwoot(4, "WhatsApp API Templo", {}), "personal", "bandeja de API cae en la principal");
igual(cuentaDeInboxChatwoot(5, "WhatsApp Personal 2", { nombreBandejaPersonal2: "whatsapp personal 2" }), "personal_2", "nombre exacto configurado");

// ---------------------------------------------------------------- errores
verdadero(pareceErrorDeBloqueo(500, "Connection Closed"), "detecta sesión cerrada de Evolution");
verdadero(pareceErrorDeBloqueo(403, "account banned"), "detecta cuenta bloqueada");
verdadero(pareceErrorDeBloqueo(429, "rate limit"), "detecta límite temporal");
verdadero(!pareceErrorDeBloqueo(500, "invalid number"), "un error de formato no es bloqueo");

const mensaje = mensajeErrorCuenta("personal", 403, "banned", {
  personal: "WhatsApp 1",
  personal_2: "WhatsApp 2",
});
verdadero(mensaje.includes("WhatsApp 1"), "el error nombra la cuenta que falló");
verdadero(mensaje.includes("WhatsApp 2"), "el error sugiere la otra cuenta");
verdadero(mensaje.includes("Ajustes"), "el error indica dónde revisar la sesión");

igual(etiquetaCuenta("personal_2"), "WhatsApp 2", "etiqueta por defecto de la cuenta 2");
igual(etiquetaCuenta("personal_2", { personal_2: "Número nuevo" }), "Número nuevo", "respeta la etiqueta personalizada");

// ---------------------------------------------------------------- resolución
// (servidor) prioridad: cuenta pedida → cuenta del chat → cuenta activa
async function pruebaResolucion() {
  const { resolverCuentaPersonal } = await import("../src/lib/whatsapp-cuentas-servidor");
  const cfgBase: any = {
    activa: "personal",
    personal: { cuenta: "personal", etiqueta: "WhatsApp 1", numero: "573000000001", instancia: "personal", inboxId: "", configurada: true },
    personal2: { cuenta: "personal_2", etiqueta: "WhatsApp 2", numero: "573000000002", instancia: "personal2", inboxId: "7", configurada: true },
    etiquetas: { personal: "WhatsApp 1", personal_2: "WhatsApp 2" },
  };

  let r = await resolverCuentaPersonal({ solicitada: "personal_2", cfg: cfgBase });
  igual(r.cuenta, "personal_2", "la cuenta pedida manda");
  igual(r.instancia, "personal2", "instancia de la cuenta pedida");

  r = await resolverCuentaPersonal({ cuentaConversacion: "personal_2", cfg: cfgBase });
  igual(r.cuenta, "personal_2", "la cuenta del chat manda sobre la activa");

  r = await resolverCuentaPersonal({ cuentaConversacion: "evolution", cfg: cfgBase });
  igual(r.cuenta, "personal", "un valor viejo 'evolution' cae en la cuenta 1");

  r = await resolverCuentaPersonal({ cfg: { ...cfgBase, activa: "personal_2" } });
  igual(r.cuenta, "personal_2", "sin pistas se usa la cuenta activa");

  const cfgSinRespaldo = {
    ...cfgBase,
    personal2: { ...cfgBase.personal2, configurada: false, numero: "", inboxId: "" },
  };
  r = await resolverCuentaPersonal({ solicitada: "personal_2", cfg: cfgSinRespaldo });
  igual(r.cuenta, "personal", "si la cuenta 2 no está configurada no se usa");
  igual(r.instancia, "personal", "y se cae a la instancia principal");
}

// ---------------------------------------------------------------- estado Evolution
// Se simula fetch para no depender de la red ni del servidor real.
async function pruebaEstadoEvolution() {
  const { estadoCuentaEvolution } = await import("../src/lib/whatsapp-cuentas-servidor");
  const fetchReal = globalThis.fetch;
  process.env.EVOLUTION_API_KEY = "llave-de-prueba";

  const responder = (cuerpo: any, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(cuerpo), { status }));

  try {
    // Conectada: connectionState devuelve open y fetchInstances el dueño.
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("/instance/connectionState/")) return responder({ instance: { state: "open" } });
      if (u.includes("/instance/fetchInstances")) {
        return responder([{ name: "personal2", connectionStatus: "open", ownerJid: "573001112233@s.whatsapp.net" }]);
      }
      return responder({}, 404);
    }) as any;
    let estado = await estadoCuentaEvolution("personal2");
    igual(estado.conectado, true, "instancia open → conectada");
    igual(estado.estado, "open", "estado open");
    igual(estado.numeroEvolution, "573001112233", "número del dueño de la instancia");

    // Desconectada: close.
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("/instance/connectionState/")) return responder({ instance: { state: "close" } });
      return responder([], 200);
    }) as any;
    estado = await estadoCuentaEvolution("personal2");
    igual(estado.conectado, false, "instancia close → desconectada");
    verdadero(String(estado.detalle || "").includes("QR"), "el detalle indica reconectar con QR");

    // Instancia inexistente: 404 sin estado.
    globalThis.fetch = (async () => responder({ message: "not found" }, 404)) as any;
    estado = await estadoCuentaEvolution("personal2");
    igual(estado.conectado, false, "404 → desconectada");
    verdadero(String(estado.detalle || "").includes("404"), "el detalle conserva el 404");

    // Sin llave no se inventa nada.
    delete process.env.EVOLUTION_API_KEY;
    estado = await estadoCuentaEvolution("personal2");
    igual(estado.conectado, null, "sin EVOLUTION_API_KEY → sin verificar");
    verdadero(String(estado.detalle || "").includes("EVOLUTION_API_KEY"), "el detalle nombra la variable que falta");
  } finally {
    globalThis.fetch = fetchReal;
    process.env.EVOLUTION_API_KEY = "";
  }
}

// ---------------------------------------------------------------- resultado
pruebaResolucion()
  .then(() => pruebaEstadoEvolution())
  .catch((e) => {
    fallos++;
    console.error("✗ no se pudo probar la resolución de cuentas:", e?.message || e);
  })
  .finally(() => {
    console.log(`\n${pruebas - fallos}/${pruebas} comprobaciones correctas`);
    if (fallos > 0) {
      console.error(`${fallos} comprobación(es) fallida(s)`);
      process.exit(1);
    }
  });
