# Google Apps Script de la planilla

Archivos para copiar en **Extensiones > Apps Script** de la planilla. El código vive acá para
que quede versionado: si se cambia en el editor, actualizar también este directorio.

| Archivo | Qué hace |
|---|---|
| `Orden.gs` | Mantiene `GASTOS` ordenada por fecha. Solo ordena, no escribe otras columnas. |
| `Dolar.gs` | Trae el dólar tarjeta y el blue de dolarapi.com a `Dolar Tarjeta` / `Dolar Blue`. |

## Instalación (reemplaza al script anterior)
1. Abrir **Extensiones > Apps Script** en la planilla.
2. Borrar el contenido de los archivos `Código`, `dolar_tarjeta` y `dolar_blue`
   (el viejo `onSheetChange` reescribía `imp_mensual` y `mes`; ahora lo hacen fórmulas).
3. Pegar `Orden.gs` y `Dolar.gs` (pueden ser dos archivos nuevos).
4. Elegir la función `instalarDisparadores` y ejecutarla **una vez** (autorizar permisos).
   Borra el disparador viejo y crea el de `ordenarGastos`.
5. En **Activadores** verificar que quede:
   - `ordenarGastos` ► De la hoja de cálculo ► Al cambiar.
   - `fetchDolarTarjeta` ► Basado en tiempo ► diario (por ejemplo entre 8 y 9 h).
   - `fetchDolarBlue` ► Basado en tiempo ► diario (crearlo si no existe).
   - Ningún `onSheetChange`.
6. Recién después desplegar la app (en Northflank el deploy se dispara al pushear a `main`).

Más contexto en `docs/SHEETS.md`.
