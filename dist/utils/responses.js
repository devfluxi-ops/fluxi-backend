"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
exports.sendError = sendError;
exports.sendUnauthorized = sendUnauthorized;
exports.sendForbidden = sendForbidden;
exports.sendNotFound = sendNotFound;
exports.sendValidationError = sendValidationError;
/**
 * Send a successful response
 */
function sendSuccess(reply, data, message, statusCode = 200) {
    const response = {
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
function sendError(reply, error, statusCode = 400, message) {
    const response = {
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
function sendUnauthorized(reply, message = "Unauthorized") {
    return sendError(reply, "Unauthorized", 401, message);
}
/**
 * Send forbidden error
 */
function sendForbidden(reply, message = "Forbidden") {
    return sendError(reply, "Forbidden", 403, message);
}
/**
 * Send not found error
 */
function sendNotFound(reply, resource = "Resource") {
    return sendError(reply, `${resource} not found`, 404);
}
/**
 * Send validation error
 */
function sendValidationError(reply, message) {
    return sendError(reply, "Validation failed", 422, message);
}
