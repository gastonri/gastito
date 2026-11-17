# Logs

Los eventos estructurados empiezan con `EVENT` y usan `clave=valor`, así que se pueden buscar en Northflank con el texto exacto.
Nunca incluyen el texto del mensaje ni claves.

| Evento | Cuándo | Campos útiles |
|---|---|---|
| `update_in` | llega algo de Telegram | `update_id`, `type` (message, callback) |
| `msg_done` | un mensaje terminó bien | `kind`, `items`, `ai_ms`, `checks_ms`, `pending_ms`, `telegram_ms`, `total_ms`, `slow` |
| `msg_failed` | un mensaje falló | `kind`, `error_kind`, fases hasta el fallo, `total_ms`, `slow` |
| `gemini_call` | llamada exitosa a Gemini | `op`, `model`, `key`, `thinking`, `status`, `ms`, `prompt_tokens`, `thought_tokens`, `output_tokens` |
| `gemini_call_failed` | llamada fallida | `status`, `code`, `ms` |
| `gemini_key_cooldown` | un modelo con una key llegó al límite | `model`, `key`, `cooldown_s` |
| `gemini_timeout` | un modelo no respondió a tiempo: se descartan sus keys para ese mensaje y se pasa al siguiente modelo | `model`, `key`, `next_key`, `deprioritized_s` |
| `gemini_server_error` | Google respondió 5xx y se pasa al siguiente slot (modelo y key) | `model`, `key`, `status`, `next_key` |
| `gemini_model_unavailable` | el modelo respondió 404 y se saltea una hora | `model`, `next` |
| `gemini_thinking_rejected` | el modelo rechazó `thinkingLevel` | `level` |
| `callback_done` / `callback_failed` | botón de Telegram | `action`, `ms` |

`error_kind`: `quota`, `ai_timeout`, `ai_high_demand`, `ai_model_unavailable`, `ai_other`, `network`, `no_transaction`, `user_facing`, `unknown`.

Búsquedas útiles: `slow=true` (mensajes de más de 15 s), `msg_failed`, `error_kind=ai_high_demand`, `gemini_call_failed`, `Duplicate update`.
Para ver dónde se va el tiempo, comparar `ai_ms` contra `total_ms`.
