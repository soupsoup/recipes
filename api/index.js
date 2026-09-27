// Vercel entry point: every request that isn't a static file in public/ lands here.
const { appFromEnv } = require('../server');

module.exports = appFromEnv();
