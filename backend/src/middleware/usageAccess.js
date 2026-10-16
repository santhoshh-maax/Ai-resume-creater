const { AppError } = require('../utils/errors');
const config = require('../config');

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
}

function usageAccess(req, res, next) {
  if (config.usage.localhostOnly && !isLocal(req)) {
    return next(new AppError(403, 'USAGE_LOCALHOST_ONLY',
      'Usage endpoints are restricted to localhost (USAGE_LOCALHOST_ONLY=true).'));
  }
  next();
}
module.exports = { usageAccess };
