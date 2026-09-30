# Prueba de uso real — antes de que el equipo arranque

Preparado 2026-09-30. Cada acción de esta lista **funciona en el código pero
nunca se usó de verdad** en producción: hay 0 reuniones y 1 solo descarte
registrados. Esta prueba existe para que los problemas aparezcan con nosotros
mirando, no con un prospecto del otro lado.

Toma unos 15 minutos. El orden va de lo más barato y más probable de romperse
hacia lo más caro.

> **Usá un contacto de prueba de baja prioridad** para los pasos 3 a 6 y el 9.
> Esos pasos cambian el estado del contacto de forma permanente.

## Los pasos

| # | Qué hacer | Qué tiene que pasar |
| --- | --- | --- |
| 1 | **Nota.** Abrí una ficha de contacto, escribí algo en el cuadro de nota y guardá. | Aparece un aviso de confirmación y la nota se ve en la cronología con tu nombre. Escribí algo reconocible: desde la pantalla no se puede borrar. |
| 2 | **Tarea.** En la misma ficha, botón "Tarea", poné un título y creá. Después "Marcar como hecha" y "Reabrir". | La tarea aparece en la cronología y en `/tasks`. Al completarla y reabrirla queda registrado quién lo hizo. |
| 3 | **Llamada.** Botón "Registrar llamada", elegí un resultado y guardá. | Se ve en la cronología. Si el contacto estaba en "Nuevo", el estado pasa a "Contactado" o "Respondió". |
| 4 | **Reunión.** Botón "Registrar reunión", poné una fecha y guardá. | El estado pasa a "Reunión", que es el más alto y no baja solo. |
| 5 | **Descartar.** Elegí el motivo "Otro" **sin escribir nota**. | Tiene que **rechazarlo** y pedirte la nota. Si te deja guardar, es un bug: avisá. Después guardá con un motivo válido. |
| 6 | **Correo.** Botón "Correo", mandate un mail **a vos mismo**, nunca a un contacto real. | Te llega el correo y queda como "Correo enviado" en la cronología. |
| 7 | **Tarea en bloque.** En `/contacts`, tildá 2 o 3 contactos y usá "Crear tarea" de la barra de acciones. | Dice cuántas tareas creó y aparecen en `/tasks`. |
| 8 | **Seguimientos.** Entrá a `/follow-ups` y usá "Posponer → Omitir hoy" en el **último** ítem de la lista. | El ítem desaparece de los pendientes de hoy. Ojo: **no se puede deshacer el mismo día**. |
| 9 | **Etapa de empresa.** Abrí una empresa, cambiá la etapa y volvé a dejarla como estaba. | Las dos veces queda registrado en la cronología de la empresa. |
| 10 | **Responsable.** Cambiá el responsable de una empresa y volvé a dejarlo. | Se actualiza. En un contacto que ya tiene conversación registrada, es **esperado** que no deje reasignar: es una regla, no un error. |

## Cómo deshacer cada cosa

- **Nota, llamada, reunión, descarte:** quedan en la cronología. El descarte se
  revierte solo con registrar cualquier actividad posterior.
- **Tarea:** dejala completada o abierta, da igual.
- **Correo:** te lo mandaste a vos mismo, no hay nada que deshacer.
- **Omitir hoy:** no se deshace en el día. Por eso el paso dice "el último ítem".
- **Etapa y responsable:** los volvés a dejar como estaban en el mismo paso.

## Casos conocidos, no los reportes como bugs

- **Mariel y el correo (paso 6):** hoy le va a fallar. Google rechaza su cuenta
  con `Error 403: org_internal` porque no está en la misma organización de
  Google Workspace que la app. Está registrado en el backlog.
- **Seguimientos vacío (paso 8):** si no hay pendientes del día, el aviso
  "estás al día" es lo correcto.
- **Entre las 21:00 y las 24:00:** si trabajás un contacto de la cola en ese
  horario y sigue apareciendo como pendiente, es un bug de zona horaria que ya
  está identificado y en curso, no un error de uso.

## Qué reportar

Cualquier pantalla en blanco, un error genérico sin explicación, o algo que
guardes y después no aparezca donde lo buscás. Eso último es lo más importante:
una acción que escribe pero que nadie puede ver es una acción rota.
