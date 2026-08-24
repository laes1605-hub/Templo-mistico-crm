# 📲 Enrutado de leads por número de llegada

## El problema
Los leads de la **publicidad paga** están dirigidos al número del **WhatsApp API Templo**, pero el webhook los guardaba con `grupo = personal` y una etapa del pipeline personal (ej: **"No Contesta"**). Resultado: los leads de los anuncios aparecían en la bandeja del WhatsApp personal en vez de caer en **Lead Nuevo → Templo**.

## La regla ahora
**La procedencia la manda el número al que escribió el lead**, no lo que diga el webhook:

| Número que recibió el mensaje | `conversaciones.fuente` | Grupo del cliente | Etapa inicial |
|---|---|---|---|
| WhatsApp API Templo (publicidad) | `meta_business` | **Templo** | `nuevo_lead_templo` (Lead Nuevo) |
| WhatsApp personal | `evolution` | Personal | La que ponga la automatización (ej: "No Contesta" sigue igual) |

## Cómo se corrige (3 capas)

1. **En la app (automático, ya activo)**: cada vez que llegan datos, el CRM detecta clientes con conversación en el número Templo que estén mal ubicados (grupo personal o etapa personal como "No Contesta") y los corrige a **Lead Nuevo del Templo** en segundos.
2. **En la base de datos (migración)**: triggers que corrigen en el instante en que cualquier webhook escriba mal, venga de donde venga. Ejecuta una vez en **Supabase → SQL Editor → Run**:
   ```
   supabase/migrations/20260830_enrutar_leads_por_numero.sql
   ```
   La migración también corrige de una vez todos los leads que ya están mal clasificados (backfill).
3. **Al mover de etapa a mano**: si en la ficha mueves un cliente a una etapa del Templo, el cliente pasa automáticamente a la bandeja Templo (y viceversa con Personal).

## Detalles importantes
- Las etapas personales se convierten a su equivalente Templo: `nuevo_lead → nuevo_lead_templo`, `consulta_hecha → consulta_hecha_templo`, etc. Las etapas **personalizadas** del personal (como "No Contesta") caen a **Lead Nuevo Templo**, que es justo donde debe estar un lead de la publicidad.
- Lo que el operador mueva a mano dentro de etapas del Templo **no se toca**.
- Los leads del WhatsApp personal siguen exactamente igual que siempre (su "No Contesta" sigue funcionando).
- Si un cliente escribiera a ambos números, sus conversaciones no se re-enrutan a la fuerza (no se le roba al grupo donde ya estaba).
