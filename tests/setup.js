/**
 * Jest test setup file
 * Runs before all tests
 */

require('dotenv').config();

// Verify environment variables are loaded
beforeAll(() => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase credentials in .env file');
  }
});

// Global test timeout
jest.setTimeout(10000);
