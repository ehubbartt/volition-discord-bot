/**
 * Jest test setup file
 * Runs before all tests
 *
 * IMPORTANT: This setup mocks the Supabase client to prevent tests from hitting
 * the production database. All database operations in tests will use mocked data.
 */

require('dotenv').config();

// Mock the entire Supabase module BEFORE any tests import it
jest.mock('../db/supabase', () => {
  // Create a mock Supabase client
  const mockSupabaseClient = {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }))
  };

  return {
    supabase: mockSupabaseClient,
    getPlayerByRSN: jest.fn(),
    getPlayerByDiscordId: jest.fn(),
    getPlayerByWomId: jest.fn(),
    getAllPlayers: jest.fn(),
    createPlayer: jest.fn(),
    updatePlayer: jest.fn(),
    deletePlayer: jest.fn(),
    getPoints: jest.fn(),
    addPoints: jest.fn(),
    setPoints: jest.fn(),
    updateLastLootDate: jest.fn(),
    getLeaderboard: jest.fn(),
    getRandomTask: jest.fn(),
    moveTaskToCompleted: jest.fn(),
    getWeeklyTaskAndMove: jest.fn(),
    getRandomWordle: jest.fn(),
    moveWordleToCompleted: jest.fn(),
    getDailyWordleAndMove: jest.fn(),
    batchCreatePlayers: jest.fn(),
    updatePlayerRsnByWomId: jest.fn(),
    deletePlayerByWomId: jest.fn(),
  };
});

// Verify environment variables are loaded
beforeAll(() => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('⚠️  Missing Supabase credentials - tests will use mocked database');
  } else {
    console.log('✅ Tests are using MOCKED database - production data is safe');
  }
});

// Global test timeout
jest.setTimeout(10000);
