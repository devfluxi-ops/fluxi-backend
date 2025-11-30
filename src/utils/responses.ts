import { FastifyReply } from "fastify";

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

/**
 * Send a successful response
 */
export function sendSuccess<T>(
  reply: FastifyReply,
  data?: T,
  message?: string,
  statusCode: number = 200
): FastifyReply {
  const response: ApiResponse<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString()
  };

  return reply.status(statusCode).send(response);
}

/**
 * Send an error response
 */
export function sendError(
  reply: FastifyReply,
  error: string,
  statusCode: number = 400,
  message?: string
): FastifyReply {
  const response: ApiResponse = {
    success: false,
    error,
    message,
    timestamp: new Date().toISOString()
  };

  return reply.status(statusCode).send(response);
}

/**
 * Send unauthorized error
 */
export function sendUnauthorized(
  reply: FastifyReply,
  message: string = "Unauthorized"
): FastifyReply {
  return sendError(reply, "Unauthorized", 401, message);
}

/**
 * Send forbidden error
 */
export function sendForbidden(
  reply: FastifyReply,
  message: string = "Forbidden"
): FastifyReply {
  return sendError(reply, "Forbidden", 403, message);
}

/**
 * Send not found error
 */
export function sendNotFound(
  reply: FastifyReply,
  resource: string = "Resource"
): FastifyReply {
  return sendError(reply, `${resource} not found`, 404);
}

/**
 * Send validation error
 */
export function sendValidationError(
  reply: FastifyReply,
  message: string
): FastifyReply {
  return sendError(reply, "Validation failed", 422, message);
}