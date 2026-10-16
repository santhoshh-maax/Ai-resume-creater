const { AppError } = require('../utils/errors');

function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message;
  if (err.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON.';
  } else if (!(err instanceof AppError)) {
    console.error('[error]', err.message); // never log stacks/bodies with resume data
    status = 500; code = 'INTERNAL_ERROR'; message = 'An unexpected server error occurred.';
  }
  res.status(status).json({ error: { code, message, details: err.details } });
}
module.exports = { notFound, errorHandler };
