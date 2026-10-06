import {
  ProjectBlueprint,
  StrategicAnalysisRequest,
  StrategicBrain
} from "../contracts.js";

export class MockStrategicBrain implements StrategicBrain {
  async analyze(
    request: StrategicAnalysisRequest
  ): Promise<ProjectBlueprint> {
    const projectName =
      request.projectName?.trim() ||
      "Proyecto sin nombre";

    return {
      projectName,

      executiveSummary:
        `Análisis inicial del proyecto "${projectName}".`,

      originalPrompt: request.prompt,

      interpretedObjective:
        "Convertir el objetivo descrito por el usuario en una solución de software profesional, segura, mantenible y verificable.",

      requirements: [
        {
          id: "REQ-001",
          title: "Cumplir el objetivo principal",
          description: request.prompt,
          priority: "must",
          source: "explicit",
          acceptanceCriteria: [
            "La solución debe cumplir el objetivo principal definido por el usuario."
          ]
        }
      ],

      ambiguities: [],

      risks: [
        {
          id: "RISK-001",
          description:
            "Los requisitos pueden necesitar refinamiento durante el análisis detallado.",
          level: "medium",
          mitigation:
            "Mantener el blueprint como fuente de verdad y actualizarlo mediante decisiones registradas."
        }
      ],

      recommendations: [
        {
          id: "REC-001",
          title: "Arquitectura modular",
          description:
            "Separar dominio, infraestructura, agentes, seguridad y presentación.",
          rationale:
            "Permite evolución independiente y reduce el acoplamiento.",
          impact: "high"
        }
      ],

      architecture: {
        summary:
          "Arquitectura modular orientada a componentes y agentes desacoplados.",
        frontend:
          "Determinar según los requisitos del proyecto.",
        backend:
          "Determinar según los requisitos del proyecto.",
        database:
          "Determinar según las necesidades de persistencia.",
        infrastructure:
          "Determinar según requisitos de disponibilidad y escala.",
        integrations: [],
        security: [
          "Gestión segura de credenciales.",
          "Principio de mínimo privilegio.",
          "Validación de entradas y salidas."
        ],
        scalability: [
          "Componentes desacoplados.",
          "Interfaces estables entre agentes."
        ]
      },

      masterPlan: [
        {
          id: "PHASE-001",
          name: "Discovery",
          objective:
            "Comprender y especificar el proyecto.",
          deliverables: [
            "Requisitos",
            "Arquitectura",
            "Definition of Done"
          ],
          dependencies: []
        },
        {
          id: "PHASE-002",
          name: "Implementation",
          objective:
            "Construir la solución.",
          deliverables: [
            "Aplicación funcional",
            "Pruebas"
          ],
          dependencies: [
            "PHASE-001"
          ]
        },
        {
          id: "PHASE-003",
          name: "Verification",
          objective:
            "Validar calidad, seguridad y funcionamiento.",
          deliverables: [
            "QA",
            "Auditoría de seguridad",
            "Validación final"
          ],
          dependencies: [
            "PHASE-002"
          ]
        }
      ],

      definitionOfDone: [
        "La solución cumple los requisitos obligatorios.",
        "Las pruebas críticas pasan.",
        "No existen vulnerabilidades críticas conocidas.",
        "La documentación necesaria está disponible."
      ],

      assumptions: [],

      requiresApproval: true,

      generatedAt: new Date().toISOString()
    };
  }
}
