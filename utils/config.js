/**
 * Config Loader
 *
 * Loads static Discord IDs, channels, roles, and emojis from config.json.
 * Feature flags and game settings are managed remotely via Supabase (see hybridConfig.js).
 */

const config = require('../config.json');

module.exports = config;
