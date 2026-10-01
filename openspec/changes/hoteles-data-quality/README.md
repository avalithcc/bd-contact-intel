# Calidad de datos de la importación de hoteles (`hoteles-2026-10`)

Estado: análisis. No se modificó ningún contacto ni se tocó producción.

Este documento no incluye nombres ni números de teléfono, porque el repositorio no debe guardar datos personales (misma regla que la importación). Cada fila se identifica por su número en la planilla `para_llamar_hoteles.csv` (fila 1 = primer contacto, sin contar el encabezado). Para ver nombres y números, ejecutar el script con `--detalle` (ver el final).

## Resumen para decidir

1. **Hallazgo principal: lo que oculta la lista no es `other`, es `sales_bd`.** La vista por defecto de Contactos oculta los grupos "No priorizar", que son `developers` y `sales_bd`. El grupo `other` NO está oculto (figura en "Revisar"). Por lo tanto los 51 contactos de `other` se ven en la lista de Mariel, pero **51 de sus 147 contactos nuevos, los clasificados `sales_bd`, no aparecen en su vista por defecto**. Son justamente los cargos comerciales y de marketing de los hoteles (Director/a Comercial, Director/a de Ventas, Marketing Manager, Sales & Marketing). Mariel puede verlos con el enlace "mostrar todos" (`?roles=all`) o eligiendo un grupo en el filtro, pero hoy no lo sabe.
2. **Los 15 teléfonos con prefijo distinto al país no son un solo problema.** 6 son números extranjeros plausibles, 4 conviene verificarlos antes de llamar, 1 es un error de tipeo casi seguro, 3 tienen un número sin uso posible y 1 es probablemente erróneo. Ver tabla.
3. **`classifyPosition` tiene una brecha de vocabulario, no de grupos.** Cerca de la mitad de los 51 títulos en `other` son cargos de dirección general ("Director General", "Consejero delegado", "Proprietario") que merecen estar en `c_level_business`. El resto es vocabulario hotelero (Revenue, Reservas, Finanzas) que necesita una decisión suya.

## 1. Teléfonos con prefijo distinto al país

La importación guardó los números tal como venían y marcó las filas. Se verificó que el criterio reproduce exactamente las 15 filas informadas (2, 23, 25, 26, 33, 50, 51, 53, 65, 67, 72, 79, 113, 115, 116).

Criterio usado: ¿el prefijo pertenece a un país con formato válido? ¿el largo es posible para ese país? ¿el mismo número aparece en varios contactos (señal de centralita)? ¿tiene otro número usable el mismo contacto?

| Fila | Empresa | País en la fila | Campo | Prefijo real | Juicio | Qué hacer |
|---|---|---|---|---|---|---|
| 2 | Pueblo Bonito Golf and Spa Resorts | México | Móvil | +55 (Brasil) | **Error de tipeo probable.** Los dígitos que siguen coinciden con un número de Ciudad de México; solo cambia 52 por 55. | Corregir a +52 tras confirmar con la primera llamada. |
| 23 | Sunset Beach Club | España | Móvil | +1 (EE. UU.) | **Extranjero posible, poco fiable.** Un gerente de un hotel español con móvil estadounidense es raro. Tiene además la centralita del hotel (+34, correcta). | Llamar primero a la centralita. No usar el móvil sin verificar. |
| 25 | Zannier Hotels | España | Teléfono y móvil | +855 (Camboya) y +65 (Singapur) | **Extranjero plausible (oficinas del grupo en Asia).** Formato válido, pero no llegan a España y hay 6 a 7 horas de diferencia. | Empezar por email o LinkedIn; llamar solo en horario compatible. |
| 26 | Zannier Hotels | España | Teléfono | +855 (Camboya) | **Inutilizable como teléfono personal.** Es el mismo número que tienen otros dos contactos de Zannier: es la centralita del grupo. Su móvil (+34) sí es válido. | Llamar al móvil. Ignorar el campo Teléfono. |
| 33 | Hotel Crown Paradise Club Cancún | México | Móvil | +57 (Colombia) | **Extranjero posible, a verificar.** El formato es de móvil colombiano; puede ser un directivo colombiano en Cancún o un dato mal asignado. | Llamar y confirmar identidad al inicio. |
| 50 | Jumeirah Mallorca | España | Móvil | +44 (Reino Unido) | **Extranjero plausible.** Móvil británico con formato válido; coherente con un hotel de lujo internacional. | Usable. |
| 51 | Jumeirah Mallorca | España | Móvil | +33 (Francia) | **Extranjero plausible.** Móvil francés con formato válido. | Usable. |
| 53 | Jumeirah Mallorca | España | Móvil | +33 (Francia) | **Extranjero plausible.** Móvil francés con formato válido. | Usable. |
| 65 | Estival Group Hotels & Resorts | España | Móvil | +1 (EE. UU.) | **Probablemente erróneo.** Una directiva corporativa de un grupo de Tarragona con móvil de EE. UU. Su teléfono fijo (+34 977) es coherente con la empresa. | Llamar al fijo. No usar el móvil. |
| 67 | Zannier Hotels | España | Móvil | +44 (Reino Unido) | **Extranjero plausible.** Es un fijo de Londres (oficina), no un móvil. Su teléfono fijo es la centralita de Camboya (compartida). | Llamar a Londres en horario de oficina; confirmar que atiende a este contacto. |
| 72 | Suma Hotels | España | Móvil | +92 (Pakistán) | **Extranjero posible, a verificar.** Formato válido de móvil pakistaní y no hay otro número. No hay forma de saber si es el contacto correcto. | Primero email o LinkedIn; llamar solo si no hay otra vía. |
| 79 | Hostal Empúries | España | Móvil | +376 (Andorra) | **Extranjero plausible.** Andorra limita con Cataluña y el formato es válido. | Usable. |
| 113 | Polis / Università Ca' Foscari | Italia | Móvil | +49 (Alemania) | **Extranjero posible, poco habitual.** Formato de móvil alemán válido. Además la empresa es una universidad, no un hotel. | Verificar la relevancia del contacto antes de llamar. |
| 115 | Borgo Vescine | Italia | Teléfono | +7 (Rusia / Kazajistán) | **Inutilizable.** Un número de +7 necesita 10 dígitos y este tiene 9: está truncado o mal copiado. Su móvil (+39) sí es válido. | Llamar al móvil. Ignorar el campo Teléfono. |
| 116 | Borgo Vescine | Italia | Teléfono | +7 (Rusia / Kazajistán) | **Inutilizable.** Es el mismo número roto de la fila 115. Su móvil (+39) sí es válido. | Llamar al móvil. Ignorar el campo Teléfono. |

Resumen: 6 plausibles (50, 51, 53, 79 usables; 25 y 67 son oficinas con reservas de horario), 4 a verificar (23, 33, 72, 113), 1 error de tipeo (2), 3 con un número inutilizable (26, 115, 116) y 1 probablemente erróneo (65).

En 5 filas (23, 26, 65, 115, 116) el contacto sí tiene otro número bueno; ahí lo que sobra es el número malo, no el contacto.

## 2. Grupos de rol

### Qué pasó con los 51 títulos en `other`

| Qué son | Cantidad | Ejemplos |
|---|---|---|
| Dirección general, propiedad y consejo | 21 | Director General, Consejero delegado, Director de Hotel, Hotel Manager, Direttore, Proprietario, Unternehmensinhaber, Amministratore, Membro del Consiglio di Amministrazione, Vocal |
| Revenue, distribución y reservas | 17 | Revenue Manager (varios), Director of Revenue Management, Revenue - Channel Manager, Reservations Manager |
| Finanzas | 4 | Director financiero, Director of Finance, Controller financiero |
| Operación de hotel, huéspedes y eventos | 5 | Director de Alojamiento, Director de Ocio y Entretenimiento, Guest Relations Specialist, Director of Event |
| Comunicación y digital | 2 | Group Media Relations, Group Digital & Content Manager |
| Tecnología | 1 | Director del departamento de TI (otros cargos de TI sí cayeron en `eng_leadership`) |
| Docencia | 1 | Professor CFGS |

### ¿Falta vocabulario hotelero en `classifyPosition`?

Respuesta: **(b) hay una brecha de vocabulario que vale la pena cerrar, y (c) un grupo hotelero hace falta solo para una parte.** Muy pocos casos son (a) realmente inclasificables.

- **(b) Brecha de vocabulario, ~21 casos.** La función ya reconoce "General Manager" y "gerente general" como `c_level_business`, pero no "Director General", "Consejero delegado", ni sus equivalentes en italiano y alemán (`Direttore`, `Proprietario`, `Unternehmensinhaber`, `Amministratore`). Es el mismo cargo con otra palabra. Consecuencia: hoy "General Manager" (15 contactos) queda visible y prioritario, mientras "Director General" (el mismo cargo en español) queda sin clasificar.
- **(c) Falta de grupo hotelero, ~17 a 25 casos.** Revenue, Reservas, Finanzas y Operación de huéspedes no existen como grupos. Cerrar esta brecha cambia una clasificación que usa toda la aplicación y requiere su decisión (ver riesgos).
- **(a) Realmente inclasificables, ~3 casos.** Vocal, Professor, Guest Relations Specialist.

### Visibilidad (verificada en el código)

La vista por defecto de Contactos ejecuta `resolveRoleVisibility` (`src/lib/contacts/roleVisibility.ts`), que oculta `NOT_WORTH_PRIORITIZING.noPriorizar.keys`, es decir `developers` y `sales_bd`. `other` y `no_position` están en "Revisar" y se muestran.

| Grupo | Contactos de Mariel | ¿Oculto por defecto? |
|---|---|---|
| `sales_bd` | 51 | **Sí** |
| `other` | 51 | No |
| `c_level_business` | 36 | No |
| `operations` | 6 | No |
| `eng_leadership` | 3 | No |
| `developers` | 0 | Sí (sin contactos) |

Efecto: 51 de 147 contactos no aparecen en la lista por defecto. Esa regla de ocultamiento se diseñó para la venta de servicios de desarrollo, donde un comercial no es comprador. En hoteles, un Director Comercial es probablemente el interlocutor correcto.

### Recomendaciones (no implementadas)

1. **Decidir ya cómo trata la lista a los contactos de hoteles.** Opciones: que Mariel use `?roles=all` (sin cambios de código), o hacer que la regla de ocultar no aplique a contactos con origen `hoteles-2026-10`. Es la acción de mayor impacto y la más barata.
2. **Cerrar la brecha de vocabulario (b)** agregando a `c_level_business` los términos "director general", "consejero delegado", "direttore", "proprietario", "inhaber", "amministratore", "hotel manager" y "director de hotel". Cambio pequeño, con pruebas, pero cambia clasificaciones en toda la base, por lo que necesita su aprobación y un recálculo (`scripts/backfill-role-groups.ts`) con simulación previa.
3. **No resolver Revenue enviándolo a `sales_bd`.** Se vería como la solución natural ("revenue" es comercial), pero lo ocultaría de la lista por defecto: pasaríamos de 51 a unos 68 contactos ocultos. Primero hay que decidir (1).
4. **Decidir si hace falta un grupo hotelero** (Revenue, Finanzas, Operación de huéspedes). Recomendación: no crearlo todavía; primero resolver (1) y (2) y revisar qué queda en `other`.

## Qué NO se cambió

- Ningún contacto, teléfono, país ni grupo de rol. No se corrigió el +55 de la fila 2.
- `classifyPosition`, los grupos de rol y la regla de ocultamiento por defecto.
- Solo se agregaron funciones puras de análisis, sus pruebas y el script de lectura. Un único cambio mínimo en la importación: se exportó la tabla de prefijos (`DIAL_CODE`) para reutilizarla.

## Riesgos y límites

- El juicio por fila se basa en el formato del número, no en una llamada real; "plausible" no equivale a "correcto".
- El diagnóstico de "error de tipeo" (fila 2) es una inferencia; confirmar antes de corregir.
- El informe cuenta contactos por origen de importación, no por asignación a Mariel; hoy coinciden.

## Cómo repetir la verificación

Solo lectura, no tiene modo de escritura. Lo ejecuta el dueño contra producción:

```
npx tsx scripts/report-hoteles-data-quality.ts            # solo conteos
npx tsx scripts/report-hoteles-data-quality.ts --detalle   # con nombres, empresas y números
```

Lectura nueva: un `SELECT` sobre `person` (origen `hoteles-2026-10`, sin fusionados), tope 1000 filas, ordenado por id, dentro de una transacción de solo lectura.
