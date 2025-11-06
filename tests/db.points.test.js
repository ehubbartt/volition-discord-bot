/**
 * Tests for Points Database Operations
 *
 * Tests all points-related operations including:
 * - Getting points
 * - Adding points
 * - Setting points
 * - Updating last loot date
 * - Leaderboard
 */

const db = require('../db/supabase');

describe('Points Operations', () => {
  let testPlayer;
  const testRsn = 'PointsTest' + Date.now();

  // Create test player before all tests
  beforeAll(async () => {
    testPlayer = await db.createPlayer({
      rsn: testRsn,
      discord_id: 'points_test_' + Date.now(),
    }, 100); // Start with 100 points
  });

  // Cleanup after all tests
  afterAll(async () => {
    if (testPlayer) {
      try {
        await db.deletePlayer(testPlayer.id);
        console.log('Test cleanup: Deleted points test player');
      } catch (error) {
        console.error('Points test cleanup failed:', error.message);
      }
    }
  });

  describe('getPoints', () => {
    test('should get current points for player', async () => {
      const points = await db.getPoints(testRsn);

      expect(typeof points).toBe('number');
      expect(points).toBe(100);
    });

    test('should return 0 for player with no points record', async () => {
      const tempPlayer = await db.createPlayer({
        rsn: 'NoPointsPlayer' + Date.now(),
      });

      const points = await db.getPoints(tempPlayer.rsn);
      expect(points).toBe(0);

      // Cleanup
      await db.deletePlayer(tempPlayer.id);
    });

    test('should return 0 for non-existent player', async () => {
      const points = await db.getPoints('NonExistentPlayer999');
      expect(points).toBe(0);
    });
  });

  describe('addPoints', () => {
    test('should add positive points', async () => {
      const newPoints = await db.addPoints(testRsn, 50);

      expect(newPoints).toBe(150); // 100 + 50

      // Verify by getting points
      const currentPoints = await db.getPoints(testRsn);
      expect(currentPoints).toBe(150);
    });

    test('should subtract points (negative add)', async () => {
      const newPoints = await db.addPoints(testRsn, -30);

      expect(newPoints).toBe(120); // 150 - 30

      // Verify
      const currentPoints = await db.getPoints(testRsn);
      expect(currentPoints).toBe(120);
    });

    test('should handle adding 0 points', async () => {
      const currentPoints = await db.getPoints(testRsn);
      const newPoints = await db.addPoints(testRsn, 0);

      expect(newPoints).toBe(currentPoints);
    });

    test('should fail for non-existent player', async () => {
      await expect(
        db.addPoints('NonExistentPlayer999', 50)
      ).rejects.toThrow('Player not found');
    });

    test('should allow negative balance (no floor)', async () => {
      const currentPoints = await db.getPoints(testRsn);
      const newPoints = await db.addPoints(testRsn, -currentPoints - 50);

      expect(newPoints).toBeLessThan(0);

      // Reset to positive
      await db.setPoints(testRsn, 100);
    });
  });

  describe('setPoints', () => {
    test('should set points to specific value', async () => {
      const newPoints = await db.setPoints(testRsn, 250);

      expect(newPoints).toBe(250);

      // Verify
      const currentPoints = await db.getPoints(testRsn);
      expect(currentPoints).toBe(250);
    });

    test('should set points to 0', async () => {
      const newPoints = await db.setPoints(testRsn, 0);

      expect(newPoints).toBe(0);

      // Verify
      const currentPoints = await db.getPoints(testRsn);
      expect(currentPoints).toBe(0);
    });

    test('should set points to negative value', async () => {
      const newPoints = await db.setPoints(testRsn, -50);

      expect(newPoints).toBe(-50);

      // Reset for other tests
      await db.setPoints(testRsn, 100);
    });

    test('should fail for non-existent player', async () => {
      await expect(
        db.setPoints('NonExistentPlayer999', 100)
      ).rejects.toThrow('Player not found');
    });
  });

  describe('updateLastLootDate', () => {
    test('should update last loot date', async () => {
      const today = new Date().toISOString().slice(0, 10);

      await db.updateLastLootDate(testRsn, today);

      // Verify by getting player
      const player = await db.getPlayerByRSN(testRsn);
      expect(player.player_points.last_loot_date).toBe(today);
    });

    test('should update to different date', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      await db.updateLastLootDate(testRsn, yesterday);

      // Verify
      const player = await db.getPlayerByRSN(testRsn);
      expect(player.player_points.last_loot_date).toBe(yesterday);
    });

    test('should fail for non-existent player', async () => {
      const today = new Date().toISOString().slice(0, 10);

      await expect(
        db.updateLastLootDate('NonExistentPlayer999', today)
      ).rejects.toThrow('Player not found');
    });
  });

  describe('getLeaderboard', () => {
    let leaderboardTestPlayers = [];

    beforeAll(async () => {
      // Create multiple players with different point values
      const playersData = [
        { rsn: 'Leader1_' + Date.now(), points: 1000 },
        { rsn: 'Leader2_' + Date.now(), points: 500 },
        { rsn: 'Leader3_' + Date.now(), points: 750 },
        { rsn: 'Leader4_' + Date.now(), points: 250 },
        { rsn: 'Leader5_' + Date.now(), points: 900 },
      ];

      for (const data of playersData) {
        const player = await db.createPlayer({ rsn: data.rsn }, data.points);
        leaderboardTestPlayers.push(player);
      }
    });

    afterAll(async () => {
      // Cleanup leaderboard test players
      for (const player of leaderboardTestPlayers) {
        try {
          await db.deletePlayer(player.id);
        } catch (error) {
          console.error('Failed to cleanup leaderboard player:', error.message);
        }
      }
    });

    test('should return top 10 players by default', async () => {
      const leaderboard = await db.getLeaderboard(10);

      expect(Array.isArray(leaderboard)).toBe(true);
      expect(leaderboard.length).toBeGreaterThan(0);
      expect(leaderboard.length).toBeLessThanOrEqual(10);

      // Check structure
      const firstPlayer = leaderboard[0];
      expect(firstPlayer).toHaveProperty('rsn');
      expect(firstPlayer).toHaveProperty('points');
    });

    test('should return players in descending order by points', async () => {
      const leaderboard = await db.getLeaderboard(10);

      for (let i = 1; i < leaderboard.length; i++) {
        expect(leaderboard[i - 1].points).toBeGreaterThanOrEqual(
          leaderboard[i].points
        );
      }
    });

    test('should respect custom limit', async () => {
      const leaderboard = await db.getLeaderboard(3);

      expect(leaderboard.length).toBeLessThanOrEqual(3);
    });

    test('should include test players in correct order', async () => {
      const leaderboard = await db.getLeaderboard(100); // Get all

      // Find our test players
      const leader1 = leaderboard.find(p => p.rsn.startsWith('Leader1_'));
      const leader2 = leaderboard.find(p => p.rsn.startsWith('Leader2_'));

      expect(leader1).toBeDefined();
      expect(leader2).toBeDefined();

      // Leader1 (1000 points) should be ranked higher than Leader2 (500 points)
      const leader1Index = leaderboard.indexOf(leader1);
      const leader2Index = leaderboard.indexOf(leader2);

      expect(leader1Index).toBeLessThan(leader2Index);
    });

    test('should handle empty results gracefully', async () => {
      // This test assumes there's always some data, but tests the return structure
      const leaderboard = await db.getLeaderboard(0);

      expect(Array.isArray(leaderboard)).toBe(true);
    });
  });

  describe('Points Integration Tests', () => {
    test('should handle rapid point changes correctly', async () => {
      const tempPlayer = await db.createPlayer({
        rsn: 'RapidTest_' + Date.now(),
      }, 100);

      // Simulate rapid transactions
      await db.addPoints(tempPlayer.rsn, 10);
      await db.addPoints(tempPlayer.rsn, -5);
      await db.addPoints(tempPlayer.rsn, 20);
      await db.setPoints(tempPlayer.rsn, 50);
      await db.addPoints(tempPlayer.rsn, 30);

      const finalPoints = await db.getPoints(tempPlayer.rsn);
      expect(finalPoints).toBe(80); // 50 + 30

      // Cleanup
      await db.deletePlayer(tempPlayer.id);
    });

    test('should maintain point accuracy across operations', async () => {
      const tempPlayer = await db.createPlayer({
        rsn: 'AccuracyTest_' + Date.now(),
      }, 0);

      // Add points
      await db.addPoints(tempPlayer.rsn, 100);
      let points = await db.getPoints(tempPlayer.rsn);
      expect(points).toBe(100);

      // Subtract points
      await db.addPoints(tempPlayer.rsn, -30);
      points = await db.getPoints(tempPlayer.rsn);
      expect(points).toBe(70);

      // Set points
      await db.setPoints(tempPlayer.rsn, 500);
      points = await db.getPoints(tempPlayer.rsn);
      expect(points).toBe(500);

      // Cleanup
      await db.deletePlayer(tempPlayer.id);
    });
  });
});
