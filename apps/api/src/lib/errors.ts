import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Authentication required") =>
  new AppError(401, "unauthorized", msg);
export const forbidden = (msg = "You do not have access to this resource") =>
  new AppError(403, "forbidden", msg);
export const notFound = (msg = "Not found") => new AppError(404, "not_found", msg);
export const conflict = (msg: string, details?: unknown) =>
  new AppError(409, "conflict", msg, details);
export const payloadTooLarge = (msg: string) =>
  new AppError(413, "payload_too_large", msg);
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, "unprocessable", msg, details);

export function registerErrorHandler(app: {
  setErrorHandler: (
    fn: (err: FastifyError | AppError | ZodError, req: FastifyRequest, reply: FastifyReply) => void,
  ) => void;
}) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(422).send({
        error: {
          code: "validation_error",
          message: "Request validation failed",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
      return;
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      reply.status(fe.statusCode).send({
        error: { code: fe.code ?? "error", message: fe.message },
      });
      return;
    }
    req.log.error({ err }, "unhandled error");
    reply.status(500).send({
      error: { code: "internal_error", message: "Something went wrong" },
    });
  });
}
