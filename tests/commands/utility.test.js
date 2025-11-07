/**
 * Utility Commands Test Suite
 * Tests for /adjustpoints, /syncuser, /checkpoints, /leaderboard, and other utility commands
 */

const adjustPoints = require('../../commands/utility/adjustPoints');
const checkPoints = require('../../commands/utility/checkPoints');
const leaderboard = require('../../commands/utility/leaderboard');

// Mock dependencies
jest.mock('../../db/supabase');
jest.mock('../../utils/permissions');
jest.mock('../../utils/config');

const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');

describe('Utility Commands', () => {
  let mockInteraction;
  let mockMember;
  let mockChannel;

  beforeEach(() => {
    jest.clearAllMocks();

    mockChannel = {
      send: jest.fn().mockResolvedValue({}),
      id: 'payout-log-123'
    };

    mockMember = {
      roles: {
        cache: new Map()
      }
    };

    mockInteraction = {
      member: mockMember,
      user: {
        id: '123456789',
        tag: 'TestUser#1234'
      },
      reply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({}),
      options: {
        getString: jest.fn(),
        getInteger: jest.fn(),
        getUser: jest.fn()
      },
      client: {
        channels: {
          cache: {
            get: jest.fn((id) => {
              if (id === config.PAYOUT_LOG_CHANNEL_ID) return mockChannel;
              return null;
            })
          }
        },
        users: {
          fetch: jest.fn().mockResolvedValue({
            id: '123456789',
            tag: 'TestUser#1234'
          })
        }
      }
    };

    // Default config values
    config.PAYOUT_LOG_CHANNEL_ID = 'payout-log-123';
  });

  describe('/adjustpoints', () => {
    describe('Permission Checks', () => {
      test('should deny access to non-admin users', async () => {
        isAdmin.mockReturnValue(false);

        await adjustPoints.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: 'You do not have permission to use this command.',
          ephemeral: true
        });
        expect(mockInteraction.deferReply).not.toHaveBeenCalled();
      });

      test('should allow access to admin users', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        db.addPoints.mockResolvedValue(60);

        await adjustPoints.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      });
    });

    describe('Input Validation', () => {
      test('should handle single player by RSN', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        db.addPoints.mockResolvedValue(60);

        await adjustPoints.execute(mockInteraction);

        expect(db.getPlayerByRSN).toHaveBeenCalledWith('TestPlayer');
        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', 10);
      });

      test('should handle single player by Discord mention', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('<@123456789>');
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        db.addPoints.mockResolvedValue(60);

        await adjustPoints.execute(mockInteraction);

        expect(db.getPlayerByDiscordId).toHaveBeenCalledWith('123456789');
        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', 10);
      });

      test('should handle multiple players comma-separated', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('Player1, Player2');
        mockInteraction.options.getInteger.mockReturnValue(10);

        db.getPlayerByRSN
          .mockResolvedValueOnce({
            rsn: 'Player1',
            player_points: { points: 50 }
          })
          .mockResolvedValueOnce({
            rsn: 'Player2',
            player_points: { points: 30 }
          });

        db.addPoints.mockResolvedValue(60);

        await adjustPoints.execute(mockInteraction);

        expect(db.getPlayerByRSN).toHaveBeenCalledWith('Player1');
        expect(db.getPlayerByRSN).toHaveBeenCalledWith('Player2');
        expect(db.addPoints).toHaveBeenCalledTimes(2);
      });

      test('should handle negative point adjustments', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        mockInteraction.options.getInteger.mockReturnValue(-10);
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        db.addPoints.mockResolvedValue(40);

        await adjustPoints.execute(mockInteraction);

        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', -10);
      });
    });

    describe('Success Cases', () => {
      test('should add points successfully', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        db.addPoints.mockResolvedValue(60);

        await adjustPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Volition Points Adjusted'
                })
              })
            ])
          })
        );
      });

      test('should remove points successfully', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        mockInteraction.options.getInteger.mockReturnValue(-10);
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        db.addPoints.mockResolvedValue(40);

        await adjustPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Volition Points Adjusted'
                })
              })
            ])
          })
        );
      });

      test('should log to payout channel', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        db.addPoints.mockResolvedValue(60);

        await adjustPoints.execute(mockInteraction);

        expect(mockChannel.send).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Points Added'
                })
              })
            ])
          })
        );
      });
    });

    describe('Error Handling', () => {
      test('should handle player not found', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('UnknownPlayer');
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByRSN.mockResolvedValue(null);

        await adjustPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  description: expect.stringContaining('UnknownPlayer')
                })
              })
            ])
          })
        );
      });

      test('should handle database errors gracefully', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByRSN.mockRejectedValue(new Error('Database error'));

        await adjustPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'Error adjusting points. Check console for help with debugging.'
        });
      });
    });
  });

  describe('/checkpoints', () => {
    describe('Success Cases - No Player Specified', () => {
      test('should check own points when no player specified', async () => {
        mockInteraction.options.getString.mockReturnValue(null);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          discord_id: '123456789',
          player_points: { points: 50 }
        });

        await checkPoints.execute(mockInteraction);

        expect(db.getPlayerByDiscordId).toHaveBeenCalledWith('123456789');
        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Volition Points'
                })
              })
            ])
          })
        );
      });

      test('should handle user not found when checking own points', async () => {
        mockInteraction.options.getString.mockReturnValue(null);
        db.getPlayerByDiscordId.mockResolvedValue(null);

        await checkPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('No player found linked to your Discord account')
        });
      });
    });

    describe('Success Cases - Player by RSN', () => {
      test('should check points for player by RSN', async () => {
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 100 }
        });

        await checkPoints.execute(mockInteraction);

        expect(db.getPlayerByRSN).toHaveBeenCalledWith('TestPlayer');
        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  fields: expect.arrayContaining([
                    expect.objectContaining({
                      name: 'VP Points',
                      value: '100'
                    })
                  ])
                })
              })
            ])
          })
        );
      });

      test('should handle player not found by RSN', async () => {
        mockInteraction.options.getString.mockReturnValue('UnknownPlayer');
        db.getPlayerByRSN.mockResolvedValue(null);

        await checkPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: '**UnknownPlayer** not found in the clan database.'
        });
      });
    });

    describe('Success Cases - Player by Discord Mention', () => {
      test('should check points for player by Discord mention', async () => {
        mockInteraction.options.getString.mockReturnValue('<@987654321>');
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'OtherPlayer',
          discord_id: '987654321',
          player_points: { points: 75 }
        });

        await checkPoints.execute(mockInteraction);

        expect(db.getPlayerByDiscordId).toHaveBeenCalledWith('987654321');
        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  fields: expect.arrayContaining([
                    expect.objectContaining({
                      name: 'VP Points',
                      value: '75'
                    })
                  ])
                })
              })
            ])
          })
        );
      });

      test('should handle player not found by Discord mention', async () => {
        mockInteraction.options.getString.mockReturnValue('<@987654321>');
        db.getPlayerByDiscordId.mockResolvedValue(null);

        await checkPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('No player found linked to <@987654321>')
        });
      });
    });

    describe('Success Cases - Zero Points', () => {
      test('should display 0 points when player has no points', async () => {
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        db.getPlayerByRSN.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: null
        });

        await checkPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  fields: expect.arrayContaining([
                    expect.objectContaining({
                      name: 'VP Points',
                      value: '0'
                    })
                  ])
                })
              })
            ])
          })
        );
      });
    });

    describe('Error Handling', () => {
      test('should handle database errors', async () => {
        mockInteraction.options.getString.mockReturnValue('TestPlayer');
        db.getPlayerByRSN.mockRejectedValue(new Error('Database error'));

        await checkPoints.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'Error checking points. Please try again.'
        });
      });
    });
  });

  describe('/leaderboard', () => {
    describe('Success Cases', () => {
      test('should display top 10 leaderboard', async () => {
        const mockLeaderboard = [
          { rsn: 'Player1', points: 1000 },
          { rsn: 'Player2', points: 900 },
          { rsn: 'Player3', points: 800 },
          { rsn: 'Player4', points: 700 },
          { rsn: 'Player5', points: 600 },
          { rsn: 'Player6', points: 500 },
          { rsn: 'Player7', points: 400 },
          { rsn: 'Player8', points: 300 },
          { rsn: 'Player9', points: 200 },
          { rsn: 'Player10', points: 100 }
        ];

        db.getLeaderboard.mockResolvedValue(mockLeaderboard);

        await leaderboard.execute(mockInteraction);

        expect(db.getLeaderboard).toHaveBeenCalledWith(10);
        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Volition Point Leaderboard',
                  description: expect.stringContaining('Player1')
                })
              })
            ])
          })
        );
      });

      test('should display leaderboard with less than 10 players', async () => {
        const mockLeaderboard = [
          { rsn: 'Player1', points: 1000 },
          { rsn: 'Player2', points: 900 }
        ];

        db.getLeaderboard.mockResolvedValue(mockLeaderboard);

        await leaderboard.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Volition Point Leaderboard'
                })
              })
            ])
          })
        );
      });

      test('should auto-delete reply after 20 seconds', async () => {
        jest.useFakeTimers();

        const mockLeaderboard = [
          { rsn: 'Player1', points: 1000 }
        ];

        db.getLeaderboard.mockResolvedValue(mockLeaderboard);

        await leaderboard.execute(mockInteraction);

        expect(mockInteraction.deleteReply).not.toHaveBeenCalled();

        jest.advanceTimersByTime(20000);

        await Promise.resolve(); // Flush promises

        expect(mockInteraction.deleteReply).toHaveBeenCalled();

        jest.useRealTimers();
      });
    });

    describe('Error Handling', () => {
      test('should handle database errors', async () => {
        db.getLeaderboard.mockRejectedValue(new Error('Database error'));

        await leaderboard.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'There was an error. Check console for help with debugging.'
        });
      });
    });
  });
});
