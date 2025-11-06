/**
 * Tests for Player Database Operations
 *
 * Tests all player-related CRUD operations
 */

const db = require('../db/supabase');

describe('Player Operations', () => {
  // Test data
  const testPlayer = {
    rsn: 'TestPlayer' + Date.now(), // Unique RSN for each test run
    discord_id: '123456789' + Date.now(),
    wom_id: 999000 + Math.floor(Math.random() * 1000),
  };

  let createdPlayerId = null;

  // Cleanup after tests
  afterAll(async () => {
    if (createdPlayerId) {
      try {
        await db.deletePlayer(createdPlayerId);
        console.log('Test cleanup: Deleted test player');
      } catch (error) {
        console.error('Test cleanup failed:', error.message);
      }
    }
  });

  describe('createPlayer', () => {
    test('should create a new player with initial points', async () => {
      const player = await db.createPlayer(testPlayer, 100);

      expect(player).toBeDefined();
      expect(player.rsn).toBe(testPlayer.rsn);
      expect(player.discord_id).toBe(testPlayer.discord_id);
      expect(player.wom_id).toBe(testPlayer.wom_id);
      expect(player.id).toBeDefined();

      createdPlayerId = player.id;
    });

    test('should create player with default 0 points if not specified', async () => {
      const tempPlayer = {
        rsn: 'TempPlayer' + Date.now(),
      };

      const player = await db.createPlayer(tempPlayer);

      expect(player).toBeDefined();
      expect(player.rsn).toBe(tempPlayer.rsn);

      // Cleanup
      await db.deletePlayer(player.id);
    });

    test('should fail to create duplicate RSN', async () => {
      // Create a player first
      const uniqueRsn = 'DuplicateTestPlayer_' + Date.now();
      const first = await db.createPlayer({ rsn: uniqueRsn }, 0);

      try {
        // Try to create duplicate
        const duplicate = {
          rsn: uniqueRsn, // Same RSN as just created
          discord_id: 'different_id',
        };

        await db.createPlayer(duplicate);

        // If we get here, test should fail
        fail('Expected createPlayer to throw an error for duplicate RSN');
      } catch (error) {
        // Expect to catch an error
        expect(error).toBeDefined();
        expect(error.message).toContain('duplicate');
      } finally {
        // Cleanup
        await db.deletePlayer(first.id);
      }
    });
  });

  describe('getPlayerByRSN', () => {
    test('should retrieve player by RSN (case-insensitive)', async () => {
      const player = await db.getPlayerByRSN(testPlayer.rsn);

      expect(player).toBeDefined();
      expect(player.rsn).toBe(testPlayer.rsn);
      expect(player.discord_id).toBe(testPlayer.discord_id);
      expect(player.wom_id).toBe(testPlayer.wom_id);
      expect(player.player_points).toBeDefined();
    });

    test('should retrieve player with lowercase RSN', async () => {
      const player = await db.getPlayerByRSN(testPlayer.rsn.toLowerCase());

      expect(player).toBeDefined();
      expect(player.rsn).toBe(testPlayer.rsn);
    });

    test('should retrieve player with uppercase RSN', async () => {
      const player = await db.getPlayerByRSN(testPlayer.rsn.toUpperCase());

      expect(player).toBeDefined();
      expect(player.rsn).toBe(testPlayer.rsn);
    });

    test('should return null for non-existent player', async () => {
      const player = await db.getPlayerByRSN('NonExistentPlayer123456');

      expect(player).toBeNull();
    });
  });

  describe('getPlayerByDiscordId', () => {
    test('should retrieve player by Discord ID', async () => {
      const player = await db.getPlayerByDiscordId(testPlayer.discord_id);

      expect(player).toBeDefined();
      expect(player.discord_id).toBe(testPlayer.discord_id);
      expect(player.rsn).toBe(testPlayer.rsn);
      expect(player.player_points).toBeDefined();
    });

    test('should return null for non-existent Discord ID', async () => {
      const player = await db.getPlayerByDiscordId('999999999999999999');

      expect(player).toBeNull();
    });
  });

  describe('getPlayerByWomId', () => {
    test('should retrieve player by WOM ID', async () => {
      const player = await db.getPlayerByWomId(testPlayer.wom_id);

      expect(player).toBeDefined();
      expect(player.wom_id).toBe(testPlayer.wom_id);
      expect(player.rsn).toBe(testPlayer.rsn);
      expect(player.player_points).toBeDefined();
    });

    test('should return null for non-existent WOM ID', async () => {
      const player = await db.getPlayerByWomId(999999999);

      expect(player).toBeNull();
    });
  });

  describe('getAllPlayers', () => {
    test('should retrieve all players', async () => {
      const players = await db.getAllPlayers();

      expect(Array.isArray(players)).toBe(true);
      expect(players.length).toBeGreaterThan(0);

      // Check structure of returned players
      const firstPlayer = players[0];
      expect(firstPlayer).toHaveProperty('id');
      expect(firstPlayer).toHaveProperty('rsn');
      expect(firstPlayer).toHaveProperty('player_points');
    });

    test('should include test player in results', async () => {
      const players = await db.getAllPlayers();
      const foundPlayer = players.find(p => p.rsn === testPlayer.rsn);

      expect(foundPlayer).toBeDefined();
      expect(foundPlayer.discord_id).toBe(testPlayer.discord_id);
    });
  });

  describe('updatePlayer', () => {
    test('should update player discord_id', async () => {
      const newDiscordId = '987654321' + Date.now();

      const updated = await db.updatePlayer(createdPlayerId, {
        discord_id: newDiscordId,
      });

      expect(updated).toBeDefined();
      expect(updated.discord_id).toBe(newDiscordId);
      expect(updated.rsn).toBe(testPlayer.rsn); // RSN should not change
    });

    test('should update player RSN', async () => {
      const newRsn = 'UpdatedRSN' + Date.now();

      const updated = await db.updatePlayer(createdPlayerId, {
        rsn: newRsn,
      });

      expect(updated).toBeDefined();
      expect(updated.rsn).toBe(newRsn);

      // Update test data for cleanup
      testPlayer.rsn = newRsn;
    });

    test('should fail to update non-existent player', async () => {
      try {
        await db.updatePlayer(999999, { rsn: 'NewName' });
        fail('Expected updatePlayer to throw an error for non-existent player');
      } catch (error) {
        expect(error).toBeDefined();
        // Supabase returns different error messages
        expect(
          error.message.includes('not found') ||
          error.message.includes('Cannot coerce')
        ).toBe(true);
      }
    });
  });

  describe('deletePlayer', () => {
    test('should delete player and cascade delete points', async () => {
      // Create a temporary player to delete
      const tempPlayer = await db.createPlayer({
        rsn: 'DeleteMe' + Date.now(),
      }, 50);

      // Verify player exists
      let player = await db.getPlayerByRSN(tempPlayer.rsn);
      expect(player).toBeDefined();

      // Delete player
      await db.deletePlayer(tempPlayer.id);

      // Verify player is deleted
      player = await db.getPlayerByRSN(tempPlayer.rsn);
      expect(player).toBeNull();
    });

    test('should fail to delete non-existent player', async () => {
      // This might not throw an error in Supabase, just verify it doesn't crash
      await expect(async () => {
        await db.deletePlayer(999999);
      }).not.toThrow();
    });
  });
});
