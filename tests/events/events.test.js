/**
 * Events Test Suite
 * Tests for messageReactionAdd and interactionCreate event handlers
 */

const messageReactionAddEvent = require('../../events/messageReactionAdd');
const interactionCreateEvent = require('../../events/interactionCreate');

// Mock dependencies
jest.mock('../../db/supabase');
jest.mock('../../utils/permissions');
jest.mock('../../utils/features');
jest.mock('../../config.json', () => ({
  WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID: 'weekly-channel-123',
  DAILY_CHALLENGE_SUBMISSION_CHANNEL_ID: 'daily-channel-123',
  PAYOUT_LOG_CHANNEL_ID: 'payout-log-123',
  POINTS_FOR_CHALLENGE: 5,
  ADMIN_ROLE_IDS: ['admin-role-123']
}));

const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');
const features = require('../../utils/features');

describe('Event Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('messageReactionAdd Event', () => {
    let mockReaction;
    let mockUser;
    let mockMessage;
    let mockChannel;
    let mockGuild;
    let mockMember;
    let mockLogChannel;

    beforeEach(() => {
      mockLogChannel = {
        send: jest.fn().mockResolvedValue({})
      };

      mockChannel = {
        id: 'weekly-channel-123',
        send: jest.fn().mockResolvedValue({})
      };

      mockMessage = {
        author: {
          id: '987654321',
          tag: 'MessageAuthor#1234',
          bot: false
        },
        channel: mockChannel,
        guild: null,
        partial: false
      };

      mockMember = {
        roles: {
          cache: new Map()
        }
      };

      mockGuild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMember)
        },
        channels: {
          cache: {
            get: jest.fn((id) => {
              if (id === 'payout-log-123') return mockLogChannel;
              return null;
            })
          }
        }
      };

      mockMessage.guild = mockGuild;

      mockUser = {
        id: '123456789',
        tag: 'ReactingUser#1234',
        bot: false
      };

      mockReaction = {
        emoji: {
          name: '✅'
        },
        message: mockMessage,
        partial: false,
        fetch: jest.fn().mockResolvedValue(mockReaction),
        users: {
          partial: false,
          fetch: jest.fn().mockResolvedValue({})
        }
      };
    });

    describe('Basic Filtering', () => {
      test('should ignore reactions from bots', async () => {
        const botUser = { ...mockUser, bot: true };

        await messageReactionAddEvent.execute(mockReaction, botUser);

        expect(db.getPlayerByDiscordId).not.toHaveBeenCalled();
      });

      test('should ignore reactions when feature is disabled', async () => {
        features.isEventEnabled.mockResolvedValue(false);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.getPlayerByDiscordId).not.toHaveBeenCalled();
      });

      test('should process reactions when feature is enabled', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(features.isEventEnabled).toHaveBeenCalledWith('reactionAwardPoints');
      });
    });

    describe('Partial Reactions', () => {
      test('should fetch partial reactions', async () => {
        mockReaction.partial = true;
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(mockReaction.fetch).toHaveBeenCalled();
      });

      test('should handle fetch errors gracefully', async () => {
        mockReaction.partial = true;
        mockReaction.fetch.mockRejectedValue(new Error('Fetch error'));
        features.isEventEnabled.mockResolvedValue(true);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.getPlayerByDiscordId).not.toHaveBeenCalled();
      });
    });

    describe('Channel Filtering', () => {
      test('should award 5 points for weekly challenge channel', async () => {
        mockChannel.id = 'weekly-channel-123';
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', 5);
      });

      test('should award 1 point for daily wordle channel', async () => {
        mockChannel.id = 'daily-channel-123';
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(51);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', 1);
      });

      test('should ignore reactions in other channels', async () => {
        mockChannel.id = 'random-channel-456';
        features.isEventEnabled.mockResolvedValue(true);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.getPlayerByDiscordId).not.toHaveBeenCalled();
      });
    });

    describe('Emoji Filtering', () => {
      test('should only process ✅ emoji', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).toHaveBeenCalled();
      });

      test('should ignore other emojis', async () => {
        mockReaction.emoji.name = '❌';
        features.isEventEnabled.mockResolvedValue(true);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.getPlayerByDiscordId).not.toHaveBeenCalled();
      });
    });

    describe('Permission Checks', () => {
      test('should only allow admins to award points', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(isAdmin).toHaveBeenCalledWith(mockMember);
        expect(db.addPoints).toHaveBeenCalled();
      });

      test('should not award points if user is not admin', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(false);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).not.toHaveBeenCalled();
      });
    });

    describe('Player Lookup', () => {
      test('should look up player by message author Discord ID', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.getPlayerByDiscordId).toHaveBeenCalledWith('987654321');
      });

      test('should not award points if player not found', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue(null);
        isAdmin.mockReturnValue(true);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).not.toHaveBeenCalled();
      });
    });

    describe('Points Calculation', () => {
      test('should correctly calculate new total points', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', 5);
        expect(mockLogChannel.send).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  description: expect.stringContaining('55')
                })
              })
            ])
          })
        );
      });

      test('should handle player with 0 points', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 0 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(5);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', 5);
      });

      test('should handle player with null player_points', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: null
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(5);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(db.addPoints).toHaveBeenCalledWith('TestPlayer', 5);
      });
    });

    describe('Logging', () => {
      test('should log to payout channel on success', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        expect(mockLogChannel.send).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: 'Volition Points Awarded'
                })
              })
            ])
          })
        );
      });

      test('should not crash if log channel not found', async () => {
        mockGuild.channels.cache.get.mockReturnValue(null);
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockResolvedValue(55);

        await expect(
          messageReactionAddEvent.execute(mockReaction, mockUser)
        ).resolves.not.toThrow();
      });
    });

    describe('Error Handling', () => {
      test('should handle database errors gracefully', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockRejectedValue(new Error('Database error'));

        await expect(
          messageReactionAddEvent.execute(mockReaction, mockUser)
        ).resolves.not.toThrow();
      });

      test('should handle addPoints errors', async () => {
        features.isEventEnabled.mockResolvedValue(true);
        db.getPlayerByDiscordId.mockResolvedValue({
          rsn: 'TestPlayer',
          player_points: { points: 50 }
        });
        isAdmin.mockReturnValue(true);
        db.addPoints.mockRejectedValue(new Error('Update failed'));

        await expect(
          messageReactionAddEvent.execute(mockReaction, mockUser)
        ).resolves.not.toThrow();
      });
    });
  });

  describe('interactionCreate Event', () => {
    let mockInteraction;
    let mockCommand;

    beforeEach(() => {
      mockCommand = {
        execute: jest.fn().mockResolvedValue({})
      };

      mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(false),
        isStringSelectMenu: jest.fn().mockReturnValue(false),
        isUserSelectMenu: jest.fn().mockReturnValue(false),
        isButton: jest.fn().mockReturnValue(false),
        isModalSubmit: jest.fn().mockReturnValue(false),
        commandName: 'testcommand',
        customId: '',
        reply: jest.fn().mockResolvedValue({}),
        followUp: jest.fn().mockResolvedValue({}),
        replied: false,
        deferred: false,
        client: {
          commands: new Map([['testcommand', mockCommand]])
        }
      };
    });

    describe('Chat Input Commands', () => {
      beforeEach(() => {
        mockInteraction.isChatInputCommand.mockReturnValue(true);
      });

      test('should execute enabled commands', async () => {
        features.isCommandEnabled.mockReturnValue(true);

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockCommand.execute).toHaveBeenCalledWith(mockInteraction);
      });

      test('should reject disabled commands', async () => {
        features.isCommandEnabled.mockReturnValue(false);

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining('disabled'),
          ephemeral: true
        });
        expect(mockCommand.execute).not.toHaveBeenCalled();
      });

      test('should handle command not found', async () => {
        mockInteraction.client.commands.clear();

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockCommand.execute).not.toHaveBeenCalled();
      });

      test('should handle command execution errors with reply', async () => {
        features.isCommandEnabled.mockReturnValue(true);
        mockCommand.execute.mockRejectedValue(new Error('Command error'));

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('error'),
            ephemeral: true
          })
        );
      });

      test('should handle command execution errors with followUp when already replied', async () => {
        features.isCommandEnabled.mockReturnValue(true);
        mockCommand.execute.mockRejectedValue(new Error('Command error'));
        mockInteraction.replied = true;

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.followUp).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('error'),
            ephemeral: true
          })
        );
      });

      test('should handle command execution errors with followUp when deferred', async () => {
        features.isCommandEnabled.mockReturnValue(true);
        mockCommand.execute.mockRejectedValue(new Error('Command error'));
        mockInteraction.deferred = true;

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.followUp).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('error'),
            ephemeral: true
          })
        );
      });
    });

    describe('String Select Menus', () => {
      beforeEach(() => {
        mockInteraction.isStringSelectMenu.mockReturnValue(true);
      });

      test('should handle ticket creation dropdown when enabled', async () => {
        mockInteraction.customId = 'ticket_create';
        mockInteraction.values = ['join'];
        mockInteraction.deferReply = jest.fn().mockResolvedValue({});
        mockInteraction.editReply = jest.fn().mockResolvedValue({});

        const mockTicketChannel = {
          id: 'new-ticket-channel',
          name: 'join-ticket-testuser',
          send: jest.fn().mockResolvedValue({}),
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true)
          })
        };

        mockInteraction.guild = {
          id: 'guild-123',
          channels: {
            cache: {
              find: jest.fn().mockReturnValue(null)
            },
            create: jest.fn().mockResolvedValue(mockTicketChannel)
          }
        };
        mockInteraction.user = {
          id: '123456789',
          username: 'testuser'
        };
        mockInteraction.member = {
          roles: {
            cache: new Map()
          }
        };

        // Mock the config for ticket category
        const originalConfig = require('../../config.json');
        originalConfig.TICKET_JOIN_CATEGORY_ID = 'join-category-123';
        originalConfig.ADMIN_ROLE_IDS = ['admin-role-123'];

        features.isEnabled.mockImplementation((key) => {
          if (key === 'ticketSystem.enabled') return true;
          if (key === 'ticketSystem.allowJoinTickets') return true;
          return false;
        });

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      });

      test('should reject ticket creation when system is disabled', async () => {
        mockInteraction.customId = 'ticket_create';
        features.isEnabled.mockReturnValue(false);

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining('disabled'),
          ephemeral: true
        });
      });
    });

    describe('Button Interactions', () => {
      beforeEach(() => {
        mockInteraction.isButton.mockReturnValue(true);
        mockInteraction.deferReply = jest.fn().mockResolvedValue({});
        mockInteraction.editReply = jest.fn().mockResolvedValue({});
        mockInteraction.deferUpdate = jest.fn().mockResolvedValue({});
        mockInteraction.update = jest.fn().mockResolvedValue({});
        mockInteraction.message = {
          createdTimestamp: Date.now()
        };
      });

      test('should reject lootcrate when disabled', async () => {
        mockInteraction.customId = 'lootcrate_claim_free';
        features.isEnabled.mockReturnValue(false);

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining('disabled'),
          ephemeral: true
        });
      });
    });

    describe('Modal Submits', () => {
      beforeEach(() => {
        mockInteraction.isModalSubmit.mockReturnValue(true);
      });

      test('should handle modal submits without errors', async () => {
        mockInteraction.customId = 'verification_modal';

        await expect(
          interactionCreateEvent.execute(mockInteraction)
        ).resolves.not.toThrow();
      });
    });
  });
});
