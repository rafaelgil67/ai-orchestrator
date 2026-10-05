# AI Software Factory

MVP inicial de un **Agente Orquestador autónomo de desarrollo de software**.

## Concepto

El usuario entrega un único brief. El Orquestador convierte ese brief en un plan de trabajo, coordina agentes especializados y verifica los resultados.

## Arquitectura inicial

`Usuario → Orquestador → Agentes → Herramientas → Verificación → Entrega`

Devin será integrado como agente de desarrollo mediante un adaptador, sin acoplar el núcleo a un proveedor concreto.

## Estado

**Fase 0 — núcleo de planificación (read-only): completada.**

El código actual solamente crea un plan en memoria. No toca repositorios, servidores, bases de datos ni credenciales.

## Ejecución

```bash
npm install
npm run dev
```
