/* server/middleware/errorHandler.js
 * Centralised error handler — catches anything passed to next(err).
 * Strips stack traces in production.
 */
module.exports = function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const isProd  = process.env.NODE_ENV === 'production';

  console.error(`[error] ${req.method} ${req.path} →`, err.message);
  if (!isProd) console.error(err.stack);

  res.status(status).json({
    error:   err.message || 'Internal server error',
    ...(isProd ? {} : { stack: err.stack }),
  });
};
