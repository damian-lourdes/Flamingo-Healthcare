/* server/config/index.js
 * Single source of truth for all configuration.
 * Validates required env vars at startup — fails fast in production
 * rather than silently sending to wrong endpoints.
 */
require('dotenv').config();

const required = [
  'WHATSAPP_TOKEN', 'PHONE_NUMBER_ID',
  'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
];

const missing = required.filter(k => !process.env[k]);
if (missing.length && process.env.NODE_ENV === 'production') {
  console.error('[config] Missing required env vars:', missing.join(', '));
  process.exit(1);
}

module.exports = {
  env:  process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 3000,

  whatsapp: {
    token:         process.env.WHATSAPP_TOKEN  || '',
    phoneNumberId: process.env.PHONE_NUMBER_ID || '',
    appSecret:     process.env.APP_SECRET      || '',
    verifyToken:   process.env.VERIFY_TOKEN    || 'flamingo_verify_token_123',
    apiVersion:    'v21.0',
  },

  mocdoc: {
    entityKey: process.env.MOCDOC_ENTITY_KEY || '',
    accessKey: process.env.MOCDOC_ACCESS_KEY || '',
    secret:    process.env.MOCDOC_SECRET     || '',
    location:  process.env.MOCDOC_LOCATION   || '',
    baseUrl:   'https://mocdoc.com/api',
    pollMs:    60_000,
  },

  db: {
    host:              process.env.DB_HOST     || 'localhost',
    port:              parseInt(process.env.DB_PORT) || 5432,
    database:          process.env.DB_NAME     || 'flamingo',
    user:              process.env.DB_USER     || 'postgres',
    password:          process.env.DB_PASSWORD || '',
    max:               10,
    idleTimeoutMillis: 30_000,
  },

  onCallNumber: process.env.ON_CALL_NUMBER || null,

  hospital: {
    name:       'Flamingo Healthcare, Ambattur, Chennai',
    phone:      '044-2658 2424',
    mobile:     '+91 9150565888',
    mapLink:    'https://maps.app.goo.gl/TH7ZP6BkVHa3K6qeA',
    reviewLink: 'https://g.page/r/flamingo-review',
    bookingUrl: 'https://flamingohealthcare.in/book-an-appointment/',
    hours:      'Mon–Sat 8:00 AM – 7:00 PM | Emergency: 24/7',
  },
};
