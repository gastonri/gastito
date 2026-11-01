# Planilla: quién escribe cada columna

Principio: **cada columna tiene un único dueño**. La app escribe solo datos de entrada; lo
derivado lo calculan fórmulas de la planilla; el script solo ordena.

## Hoja `GASTOS`
| Col | Campo | Dueño |
|---|---|---|
| A | fecha | app (fecha real) |
| B–I | persona, descripcion, macro_categoria, subcategoria, monto, moneda, cuotas, n_cuota | app |
| **J** | **imp_mensual** | **fórmula** (copiada de `PLANTILLA_GASTOS!J2`) |
| K–M | mi_parte_%, link, notas | app |
| **N–P** | **año, mes, dia** | **fórmulas** (copiadas de `PLANTILLA_GASTOS!N2:P2`) |
| Q | tipo_cambio (ARS por USD usado; vacío en pesos) | app |

- `monto` es siempre el **total**; `imp_mensual` = monto ÷ cuotas (× `tipo_cambio` si es USD).
- Si es USD y falta `tipo_cambio`, `imp_mensual` queda vacío a propósito (para detectarlo).
- Los gastos anteriores a esta migración conservan `imp_mensual` como valor.

## Cómo cambiar un cálculo
Editar las fórmulas de la **fila 2 de `PLANTILLA_GASTOS`** (no mover ni borrar esa fila). La app
las copia a cada gasto nuevo, ajustando las referencias de fila. No hay que tocar código.

Si se agrega una columna nueva que debe llevar fórmula: ponerla en la plantilla y sumar su rango
a las llamadas `copyFormula` de `writeGasto` en `src/sheets/client.ts`. Si es un dato de entrada,
agregarla al `updateCells` correspondiente.

## Escritura atómica
`writeGasto` envía todo en **una sola** `batchUpdate`. No volver a escribir en dos pasos: el
script ordena ante cualquier cambio y, entre dos escrituras, podía mover la fila y dejar datos
en la fila equivocada.

## Orden por fecha
`apps-script/Orden.gs` ordena `GASTOS` por fecha ante cualquier cambio (solo si hace falta).
`/deshacer` ubica el gasto por contenido, no por número de fila, porque las filas se mueven.

## Dólar
`Dolar Tarjeta` y `Dolar Blue` (fecha, precio) las llena `apps-script/Dolar.gs`. La app usa la
última cotización igual o anterior a la fecha del gasto.
