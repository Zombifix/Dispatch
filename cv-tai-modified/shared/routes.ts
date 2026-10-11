import { z } from "zod";
import { 
  insertExperienceSchema, 
  insertBulletSchema, 
  insertSkillSchema,
  type Experience,
  type Bullet,
  type Skill,
  type Run,
  type RunResponse
} from "./schema";

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  experiences: {
    list: {
      method: "GET" as const,
      path: "/api/experiences" as const,
      responses: {
        200: z.array(z.custom<Experience>()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/experiences/:id" as const,
      responses: {
        200: z.custom<Experience>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/experiences" as const,
      input: insertExperienceSchema,
      responses: {
        201: z.custom<Experience>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: "PUT" as const,
      path: "/api/experiences/:id" as const,
      input: insertExperienceSchema.partial(),
      responses: {
        200: z.custom<Experience>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: "DELETE" as const,
      path: "/api/experiences/:id" as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  bullets: {
    listByExperience: {
      method: "GET" as const,
      path: "/api/experiences/:experienceId/bullets" as const,
      responses: {
        200: z.array(z.custom<Bullet>()),
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/experiences/:experienceId/bullets" as const,
      input: insertBulletSchema.omit({ experienceId: true }),
      responses: {
        201: z.custom<Bullet>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: "PUT" as const,
      path: "/api/bullets/:id" as const,
      input: insertBulletSchema.partial(),
      responses: {
        200: z.custom<Bullet>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: "DELETE" as const,
      path: "/api/bullets/:id" as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  skills: {
    list: {
      method: "GET" as const,
      path: "/api/skills" as const,
      responses: {
        200: z.array(z.custom<Skill>()),
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/skills" as const,
      input: insertSkillSchema,
      responses: {
        201: z.custom<Skill>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: "PUT" as const,
      path: "/api/skills/:id" as const,
      input: insertSkillSchema.partial(),
      responses: {
        200: z.custom<Skill>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: "DELETE" as const,
      path: "/api/skills/:id" as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  runs: {
    list: {
      method: "GET" as const,
      path: "/api/runs" as const,
      responses: {
        200: z.array(z.custom<RunResponse>()),
      },
    },
  },
  tailor: {
    generate: {
      method: "POST" as const,
      path: "/api/tailor" as const,
      input: z.object({
        url: z.string().optional(),
        text: z.string().optional(),
        mode: z.enum(["original", "polished", "adaptive"]),
        outputLength: z.enum(["compact", "balanced", "detailed"]).optional(),
        customMaxChars: z.number().int().min(500).max(10000).optional(),
        introMaxChars: z.number().int().min(50).max(2000).optional(),
        bodyMaxChars: z.number().int().min(500).max(10000).optional(),
        extraContext: z.string().max(1000).optional(),
      }),
      responses: {
        201: z.custom<Run>(),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    getRun: {
      method: "GET" as const,
      path: "/api/runs/:id" as const,
      responses: {
        200: z.custom<RunResponse>(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
