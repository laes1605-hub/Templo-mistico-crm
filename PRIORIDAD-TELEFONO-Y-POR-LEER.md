# 📞 Prioridad teléfono + 📬 Chats por leer

## Qué cambió

### 1. El número de teléfono manda
En **todas** las vistas del CRM (bandeja de chats, ficha del cliente, cartera, pipeline, tareas, archivados y notificaciones) la identidad del cliente se muestra así:

1. **Por defecto**: solo el **número de teléfono** en formato internacional con el indicativo del país y el `+`, sin espacios ni guiones.
   - Ej: `+573054021111` (Colombia) o `+595985123456` (Paraguay).
2. **Solo si el operador le puso un nombre a mano** (lápiz ✏️ en la ficha del cliente): se muestra ese nombre. Al lado siempre queda visible el número.

**Nunca se muestran**:
- El nombre cargado automáticamente de WhatsApp (perfil del cliente / pushname).
- El nombre guardado en la agenda del teléfono del maestro o del cliente.
- Ningún "nombre cargado" por los webhooks.

Internamente: el campo `clientes.nombre` (el que llenan los webhooks automáticamente) **deja de mostrarse**. El nombre que el operador escribe con ✏️ se guarda en la columna nueva **`clientes.nombre_manual`**, que ningún webhook toca.

- Dejar el campo vacío al guardar = **quitar el nombre manual** y volver a mostrar solo el número.
- La búsqueda acepta el número con o sin espacios (`305 402` encuentra `+573054021111`).

### 2. Pestaña "Por leer" 📬
En la bandeja de chats, **al lado de "Leads Nuevos"** hay una pestaña roja **"Por leer"**:

- Ahí aparecen los chats de **todas las categorías** del grupo activo (Personal o Templo) que tienen **mensajes pendientes por leer** (`no_leidos > 0`).
- El contador del chip muestra cuántos chats están pendientes; el tooltip muestra el total de mensajes.
- Al abrir un chat se marca como leído y sale de la lista automáticamente.
- La pestaña **principal sigue siendo "Leads Nuevos"** (es la que abre por defecto).

---

## ⚠️ Migra en Supabase (una sola vez)

Ejecuta en **Supabase → SQL Editor → New query → Run**:

```
supabase/migrations/20260829_nombre_manual_prioridad_telefono.sql
```

Es idempotente (se puede correr de nuevo sin romper nada). Solo agrega la columna `nombre_manual` a `clientes`.

**Mientras no la ejecutes**: la app funciona igual y muestra los números (que es el comportamiento principal), pero al intentar guardar un nombre con ✏️ verás un aviso pidiendo la migración.

---

## Resumen técnico

| Dónde | Antes | Ahora |
|---|---|---|
| Título del chat / tarjetas | `nombre` (auto-cargado) | `nombre_manual` o número `+XXX` |
| Número mostrado | `telefono_display` con formato variable | Siempre E.164 compacto: `+573054021111` |
| Editar nombre (✏️) | Guardaba en `nombre` | Guarda en `nombre_manual` (+ sincroniza `nombre` para el Cerebro IA) |
| Notificaciones push | Título con nombre cargado | Título con nombre manual o número `+XXX` |
| Subpestañas de chats | Etapas del pipeline + Spam | Etapas + **"Por leer"** (junto a Leads Nuevos) + Spam |
