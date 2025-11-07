/**
 * Fun Commands Test Suite
 * Tests for /lootcrate, /duel, /leaderboard, /checkpoints
 */

const lootCrate = require('../../commands/fun/lootCrate');
const duel = require('../../commands/fun/duel');

// Mock dependencies
jest.mock('../../db/supabase');
jest.mock('../../utils/config');

const db = require('../../db/supabase');
const config = require('../../utils/config');

describe('Fun Commands', () => {
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
        tag: 'TestUser#1234',
        bot: false
      },
      reply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      options: {
        getUser: jest.fn(),
        getInteger: jest.fn()
      },
      guild: {
        channels: {
          cache: {
            get: jest.fn((id) => {
              if (id === config.PAYOUT_LOG_CHANNEL_ID) return mockChannel;
              return null;
            })
          }
        }
      },
      client: {
        channels: {
          cache: {
            get: jest.fn((id) => {
              if (id === config.PAYOUT_LOG_CHANNEL_ID) return mockChannel;
              return null;
            })
          }
        }
      }
    };

    // Default config values
    config.PAYOUT_LOG_CHANNEL_ID = 'payout-log-123';
  });

  describe('/lootcrate', () => {
    describe('Success Cases', () => {
      test('should display loot crate with buttons', async () => {
        await lootCrate.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Volition Loot Crate 🎁'
                })
              })
            ]),
            components: expect.arrayContaining([
              expect.objectContaining({
                components: expect.arrayContaining([
                  expect.objectContaining({
                    data: expect.objectContaining({
                      custom_id: 'lootcrate_claim_free'
                    })
                  }),
                  expect.objectContaining({
                    data: expect.objectContaining({
                      custom_id: 'lootcrate_spin_paid'
                    })
                  })
                ])
              })
            ])
          })
        );
      });

      test('should create free claim button with correct label', async () => {
        await lootCrate.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            components: expect.arrayContaining([
              expect.objectContaining({
                components: expect.arrayContaining([
                  expect.objectContaining({
                    data: expect.objectContaining({
                      label: 'Free Daily Claim'
                    })
                  })
                ])
              })
            ])
          })
        );
      });

      test('should create paid spin button with correct label', async () => {
        await lootCrate.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            components: expect.arrayContaining([
              expect.objectContaining({
                components: expect.arrayContaining([
                  expect.objectContaining({
                    data: expect.objectContaining({
                      label: 'Open for 5 VP'
                    })
                  })
                ])
              })
            ])
          })
        );
      });
    });
  });

  describe('/duel', () => {
    let mockOpponent;
    let mockResponse;

    beforeEach(() => {
      mockOpponent = {
        id: '987654321',
        username: 'OpponentUser',
        tag: 'OpponentUser#4321',
        bot: false
      };

      mockResponse = {
        createMessageComponentCollector: jest.fn().mockReturnValue({
          on: jest.fn(),
          stop: jest.fn()
        })
      };

      mockInteraction.editReply.mockResolvedValue(mockResponse);
    });

    describe('Input Validation', () => {
      test('should reject duel with bot', async () => {
        const botUser = { ...mockOpponent, bot: true };
        mockInteraction.options.getUser.mockReturnValue(botUser);
        mockInteraction.options.getInteger.mockReturnValue(10);

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'You cannot duel a bot!'
        });
      });

      test('should reject duel with self', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockInteraction.user);
        mockInteraction.options.getInteger.mockReturnValue(10);

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'You cannot duel yourself!'
        });
      });

      test('should reject if challenger not registered', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByDiscordId.mockResolvedValueOnce(null); // Challenger not found

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'You are not registered in the system. Please contact an admin.'
        });
      });

      test('should reject if opponent not registered', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 50 } })
          .mockResolvedValueOnce(null); // Opponent not found

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'OpponentUser is not registered in the system.'
        });
      });

      test('should reject if challenger has insufficient points', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(100);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 50 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 200 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining("You don't have enough points!")
        });
      });

      test('should reject if opponent has insufficient points', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(100);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 200 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 50 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining("OpponentUser doesn't have enough points!")
        });
      });
    });

    describe('Success Cases', () => {
      test('should create duel challenge with valid inputs', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(50);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 100 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 100 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Duel Challenge!'
                })
              })
            ]),
            components: expect.arrayContaining([
              expect.objectContaining({
                components: expect.arrayContaining([
                  expect.objectContaining({
                    data: expect.objectContaining({
                      custom_id: 'duel_accept'
                    })
                  }),
                  expect.objectContaining({
                    data: expect.objectContaining({
                      custom_id: 'duel_decline'
                    })
                  })
                ])
              })
            ])
          })
        );
      });

      test('should display correct wager amount', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(75);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 100 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 100 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  description: expect.stringContaining('75 VP')
                })
              })
            ])
          })
        );
      });

      test('should create message component collector', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(50);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 100 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 100 } });

        await duel.execute(mockInteraction);

        expect(mockResponse.createMessageComponentCollector).toHaveBeenCalledWith({
          time: 60000
        });
      });
    });

    describe('Collector Handling', () => {
      let mockCollector;

      beforeEach(() => {
        mockCollector = {
          on: jest.fn(),
          stop: jest.fn()
        };
        mockResponse.createMessageComponentCollector.mockReturnValue(mockCollector);
      });

      test('should set up collect and end event handlers', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(50);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 100 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 100 } });

        await duel.execute(mockInteraction);

        expect(mockCollector.on).toHaveBeenCalledWith('collect', expect.any(Function));
        expect(mockCollector.on).toHaveBeenCalledWith('end', expect.any(Function));
      });
    });

    describe('Error Handling', () => {
      test('should handle database errors', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(50);
        db.getPlayerByDiscordId.mockRejectedValue(new Error('Database error'));

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: 'An error occurred while processing the duel. Please try again.',
          components: []
        });
      });
    });

    describe('Edge Cases', () => {
      test('should handle player with zero points', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 0 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 100 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining("You don't have enough points!")
        });
      });

      test('should handle player with null player_points', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(10);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: null })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 100 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining("You don't have enough points!")
        });
      });

      test('should handle minimum wager of 1', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(1);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 10 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 10 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  description: expect.stringContaining('1 VP')
                })
              })
            ])
          })
        );
      });

      test('should handle large wager amounts', async () => {
        mockInteraction.options.getUser.mockReturnValue(mockOpponent);
        mockInteraction.options.getInteger.mockReturnValue(10000);
        db.getPlayerByDiscordId
          .mockResolvedValueOnce({ rsn: 'Challenger', player_points: { points: 15000 } })
          .mockResolvedValueOnce({ rsn: 'Opponent', player_points: { points: 15000 } });

        await duel.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  description: expect.stringContaining('10000 VP')
                })
              })
            ])
          })
        );
      });
    });
  });
});
