"use strict";(()=>{var e={};e.id=43,e.ids=[43],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},4181:(e,a,s)=>{s.r(a),s.d(a,{originalPathname:()=>m,patchFetch:()=>x,requestAsyncStorage:()=>c,routeModule:()=>p,serverHooks:()=>l,staticGenerationAsyncStorage:()=>u});var o={};s.r(o),s.d(o,{POST:()=>d});var t=s(9303),r=s(8716),n=s(670),i=s(7070);async function d(e){try{let{campaigns:a}=await e.json();if(!Array.isArray(a)||0===a.length)return i.NextResponse.json({error:"No hay campa\xf1as para analizar"},{status:400});let s=(process.env.OPENAI_API_KEY||"").replace(/[\r\n\t "']/g,"").trim();if(!s)return i.NextResponse.json({error:"Falta OPENAI_API_KEY en Vercel"},{status:400});let o=`Eres un experto estratega de Meta Ads (Facebook e Instagram Ads) especializado en servicios esot\xe9ricos y consultas espirituales en Colombia y Latinoam\xe9rica.

Analiza los siguientes datos de rendimiento de campa\xf1as actuales:

${JSON.stringify(a,null,2)}

NOTA IMPORTANTE SOBRE MONEDA: Todos los valores monetarios de inversi\xf3n, presupuesto y CPL est\xe1n expresados en PESOS COLOMBIANOS (COP). Expresa todas tus cifras y presupuestos siempre en COP (ejemplo: $10.000 COP, $50.000 COP).

Entrega una auditor\xeda ejecutiva breve y contundente en espa\xf1ol para el director del negocio, organizada estrictamente en estas 3 secciones:

🏆 1. CAMPA\xd1A ESTRELLA (Mina de oro):
Identifica cu\xe1l es la mejor campa\xf1a basada en el CPL (Costo Por Lead en COP) m\xe1s bajo y alto n\xfamero de conversiones. Explica por qu\xe9 es eficiente y sugiere cu\xe1nto aumentar su presupuesto diario en COP.

⚠️ 2. CAMPA\xd1A DEFICIENTE (Botadero de dinero):
Identifica si hay alguna campa\xf1a activa o pausada con CPL demasiado alto en COP. Recomienda expl\xedcitamente si se debe PAUSAR o descartar de inmediato.

💡 3. CONSEJOS PR\xc1CTICOS DE MEJORA:
Entrega 2 a 3 recomendaciones t\xe1cticas sobre copys, creativos o segmentaci\xf3n para mejorar los anuncios del Templo M\xedstico.

Usa un tono profesional, directo, con emojis y sin rodeos.`,t=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${s}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini",messages:[{role:"user",content:o}],temperature:.4,max_tokens:650})});if(!t.ok){let e=await t.text();return i.NextResponse.json({error:`Error OpenAI ${t.status}: ${e}`},{status:500})}let r=await t.json(),n=r.choices?.[0]?.message?.content||"No se pudo generar la recomendaci\xf3n.";return i.NextResponse.json({ok:!0,recommendation:n})}catch(e){return i.NextResponse.json({error:e.message},{status:500})}}let p=new t.AppRouteRouteModule({definition:{kind:r.x.APP_ROUTE,page:"/api/ads/ai-advisor/route",pathname:"/api/ads/ai-advisor",filename:"route",bundlePath:"app/api/ads/ai-advisor/route"},resolvedPagePath:"C:\\Users\\57310\\Desktop\\esteban\\Templo-mistico-crm\\src\\app\\api\\ads\\ai-advisor\\route.ts",nextConfigOutput:"",userland:o}),{requestAsyncStorage:c,staticGenerationAsyncStorage:u,serverHooks:l}=p,m="/api/ads/ai-advisor/route";function x(){return(0,n.patchFetch)({serverHooks:l,staticGenerationAsyncStorage:u})}}};var a=require("../../../../webpack-runtime.js");a.C(e);var s=e=>a(a.s=e),o=a.X(0,[276,972],()=>s(4181));module.exports=o})();