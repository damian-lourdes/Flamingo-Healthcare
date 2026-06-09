/* server/middleware/logger.js
 * HTTP request logger.
 * Uses morgan in production, simple console in dev.
 */
const morgan = require('morgan');

module.exports = function logger(app) {
  const fmt = process.env.NODE_ENV === 'production'
    ? ':remote-addr :method :url :status :res[content-length] - :response-time ms'
    : 'dev';
  app.use(morgan(fmt));
};
