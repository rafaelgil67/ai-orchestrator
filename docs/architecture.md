# AI Software Factory — Arquitectura inicial

## Objetivo

Construir un agente orquestador que reciba un único brief inicial y administre un ciclo completo de desarrollo mediante agentes especializados.

## Principio

El Orquestador es el cerebro. Los agentes especializados son ejecutores. Ningún proveedor concreto queda acoplado al núcleo.

## Capas

1. **Project State** — requisitos, decisiones, tareas, artefactos, resultados y estado.
2. **Orchestrator** — planificación, dependencias, delegación, verificación y reintentos.
3. **Agent adapters** — conectores para Devin y futuros agentes/proveedores.
4. **Tool layer** — Git, filesystem, terminal, navegador, testing y deployment.
5. **Policy engine** — permisos, aprobación humana, límites y acciones prohibidas.
6. **Audit log** — registro de cada decisión, herramienta, resultado y error.

## Flujo

Brief → análisis → plan → asignación → ejecución → verificación → corrección → nueva verificación → entrega.

## Devin

Devin se tratará como un `developer agent` a través de un adaptador. El Orquestador no dependerá de la implementación interna de Devin.

## Regla de seguridad inicial

El MVP no ejecuta comandos externos, no modifica repositorios reales y no utiliza credenciales. Primero se construye el motor de planificación y coordinación.

## Próximas fases

- Persistencia del Project State.
- API del Orquestador.
- Interfaz web.
- Adapter de agentes.
- Adapter de Devin.
- Tool runner sandboxed.
- QA automático.
- Approval gates.
- Memoria y aprendizaje del proyecto.
