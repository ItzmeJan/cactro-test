import type { MiddlewareHandler } from "hono";
import type { ZodType } from "zod";

export function validateJson<T extends ZodType>(schema: T): MiddlewareHandler {
  return async (c, next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json(
        {
          error: "Validation failed",
          details: result.error.issues.map((i) => i.message).join("; "),
        },
        400,
      );
    }

    c.set("body", result.data);
    await next();
  };
}

export function parsePagination(query: Record<string, string | undefined>): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const rawLimit = Number(query.limit ?? 20) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  return { page, limit, offset: (page - 1) * limit };
}
