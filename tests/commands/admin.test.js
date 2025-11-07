/**
 * Admin Commands Test Suite
 * Tests for /syncconfig, /updateconfig, /sendweeklytask, /senddailywordle
 */

const syncConfig = require('../../commands/admin/syncconfig');
const updateConfig = require('../../commands/admin/updateconfig');
const sendWeeklyTask = require('../../commands/admin/sendWeeklyTask');
const sendDailyWordle = require('../../commands/admin/sendDailyWordle');

// Mock dependencies
jest.mock('../../utils/permissions');
jest.mock('../../utils/hybridConfig');
jest.mock('../../commands/fun/weeklyTask');
jest.mock('../../commands/fun/dailyWordle');
jest.mock('../../utils/config');

const { isAdmin } = require('../../utils/permissions');
const hybridConfig = require('../../utils/hybridConfig');
const { getWeeklyTaskAndMove } = require('../../commands/fun/weeklyTask');
const { getDailyWordleAndMove } = require('../../commands/fun/dailyWordle');
const config = require('../../utils/config');

describe('Admin Commands', () => {
  let mockInteraction;
  let mockMember;
  let mockChannel;
  let mockTestChannel;

  beforeEach(() => {
    jest.clearAllMocks();

    mockChannel = {
      send: jest.fn().mockResolvedValue({}),
      id: 'weekly-channel-123'
    };

    mockTestChannel = {
      send: jest.fn().mockResolvedValue({}),
      id: 'test-channel-123'
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
      options: {
        getString: jest.fn(),
        getInteger: jest.fn(),
        getUser: jest.fn()
      },
      client: {
        channels: {
          cache: {
            get: jest.fn((id) => {
              if (id === config.WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID) return mockChannel;
              if (id === config.DAILY_CHALLENGE_SUBMISSION_CHANNEL_ID) return mockChannel;
              if (id === config.TEST_CHANNEL_ID) return mockTestChannel;
              return null;
            })
          }
        }
      }
    };

    // Default config values
    config.WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID = 'weekly-channel-123';
    config.DAILY_CHALLENGE_SUBMISSION_CHANNEL_ID = 'daily-channel-123';
    config.TEST_CHANNEL_ID = 'test-channel-123';
    config.weeklyTaskRoleID = 'weekly-role-123';
  });

  describe('/syncconfig', () => {
    describe('Permission Checks', () => {
      test('should deny access to non-admin users', async () => {
        isAdmin.mockReturnValue(false);

        await syncConfig.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: '❌ Admin only command.',
          ephemeral: true
        });
        expect(mockInteraction.deferReply).not.toHaveBeenCalled();
      });

      test('should allow access to admin users', async () => {
        isAdmin.mockReturnValue(true);
        hybridConfig.getConfigSource.mockReturnValue('local (features.json)');
        hybridConfig.syncLocalToRemote.mockResolvedValue({ success: true });

        await syncConfig.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
        expect(hybridConfig.syncLocalToRemote).toHaveBeenCalled();
      });
    });

    describe('Success Cases', () => {
      test('should sync local config to remote successfully', async () => {
        isAdmin.mockReturnValue(true);
        hybridConfig.getConfigSource.mockReturnValue('local (features.json)');
        hybridConfig.syncLocalToRemote.mockResolvedValue({ success: true });

        await syncConfig.execute(mockInteraction);

        expect(hybridConfig.syncLocalToRemote).toHaveBeenCalled();
        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: '✅ Configuration Synced'
                })
              })
            ])
          })
        );
      });
    });

    describe('Error Handling', () => {
      test('should handle sync failure gracefully', async () => {
        isAdmin.mockReturnValue(true);
        hybridConfig.getConfigSource.mockReturnValue('local (features.json)');
        hybridConfig.syncLocalToRemote.mockResolvedValue({
          success: false,
          error: 'Database migration not run'
        });

        await syncConfig.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: '❌ Sync Failed'
                })
              })
            ])
          })
        );
      });

      test('should handle unexpected errors', async () => {
        isAdmin.mockReturnValue(true);
        hybridConfig.getConfigSource.mockReturnValue('local (features.json)');
        hybridConfig.syncLocalToRemote.mockRejectedValue(new Error('Network error'));

        await syncConfig.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: '❌ Sync Error'
                })
              })
            ])
          })
        );
      });
    });
  });

  describe('/updateconfig', () => {
    describe('Permission Checks', () => {
      test('should deny access to non-admin users', async () => {
        isAdmin.mockReturnValue(false);

        await updateConfig.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: '❌ Admin only command.',
          ephemeral: true
        });
      });

      test('should allow access to admin users', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'events.autoJoinTickets';
          if (key === 'value') return 'true';
          if (key === 'reason') return 'Enabling auto-join';
          return null;
        });
        hybridConfig.get.mockResolvedValue(false);
        hybridConfig.updateConfig.mockResolvedValue({
          success: true,
          location: 'remote'
        });
        hybridConfig.getConfigSource.mockReturnValue('remote (Supabase)');

        await updateConfig.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        expect(hybridConfig.updateConfig).toHaveBeenCalled();
      });
    });

    describe('Input Validation', () => {
      test('should parse boolean "true" correctly', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'events.enabled';
          if (key === 'value') return 'true';
          if (key === 'reason') return 'Test';
          return null;
        });
        hybridConfig.get.mockResolvedValue(false);
        hybridConfig.updateConfig.mockResolvedValue({
          success: true,
          location: 'remote'
        });
        hybridConfig.getConfigSource.mockReturnValue('remote (Supabase)');

        await updateConfig.execute(mockInteraction);

        expect(hybridConfig.updateConfig).toHaveBeenCalledWith(
          'events.enabled',
          true,
          'Test'
        );
      });

      test('should parse boolean "false" correctly', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'events.enabled';
          if (key === 'value') return 'false';
          if (key === 'reason') return 'Test';
          return null;
        });
        hybridConfig.get.mockResolvedValue(true);
        hybridConfig.updateConfig.mockResolvedValue({
          success: true,
          location: 'remote'
        });
        hybridConfig.getConfigSource.mockReturnValue('remote (Supabase)');

        await updateConfig.execute(mockInteraction);

        expect(hybridConfig.updateConfig).toHaveBeenCalledWith(
          'events.enabled',
          false,
          'Test'
        );
      });

      test('should parse numbers correctly', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'points.weeklyTask';
          if (key === 'value') return '10';
          if (key === 'reason') return 'Test';
          return null;
        });
        hybridConfig.get.mockResolvedValue(5);
        hybridConfig.updateConfig.mockResolvedValue({
          success: true,
          location: 'remote'
        });
        hybridConfig.getConfigSource.mockReturnValue('remote (Supabase)');

        await updateConfig.execute(mockInteraction);

        expect(hybridConfig.updateConfig).toHaveBeenCalledWith(
          'points.weeklyTask',
          10,
          'Test'
        );
      });

      test('should handle string values', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'bot.name';
          if (key === 'value') return 'TestBot';
          if (key === 'reason') return 'Test';
          return null;
        });
        hybridConfig.get.mockResolvedValue('OldBot');
        hybridConfig.updateConfig.mockResolvedValue({
          success: true,
          location: 'remote'
        });
        hybridConfig.getConfigSource.mockReturnValue('remote (Supabase)');

        await updateConfig.execute(mockInteraction);

        expect(hybridConfig.updateConfig).toHaveBeenCalledWith(
          'bot.name',
          'TestBot',
          'Test'
        );
      });
    });

    describe('Success Cases', () => {
      test('should update config successfully', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'events.enabled';
          if (key === 'value') return 'true';
          if (key === 'reason') return 'Enabling events';
          return null;
        });
        hybridConfig.get.mockResolvedValue(false);
        hybridConfig.updateConfig.mockResolvedValue({
          success: true,
          location: 'remote'
        });
        hybridConfig.getConfigSource.mockReturnValue('remote (Supabase)');

        await updateConfig.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: '✅ Configuration Updated'
                })
              })
            ])
          })
        );
      });
    });

    describe('Error Handling', () => {
      test('should handle update failure', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'invalid.path';
          if (key === 'value') return 'true';
          if (key === 'reason') return 'Test';
          return null;
        });
        hybridConfig.get.mockResolvedValue(false);
        hybridConfig.updateConfig.mockResolvedValue({
          success: false,
          error: 'Invalid feature path'
        });

        await updateConfig.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('❌ Failed to update configuration')
        });
      });

      test('should handle database errors', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation((key) => {
          if (key === 'feature') return 'events.enabled';
          if (key === 'value') return 'true';
          if (key === 'reason') return 'Test';
          return null;
        });
        hybridConfig.get.mockRejectedValue(new Error('Database connection failed'));

        await updateConfig.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: '❌ Configuration Update Failed'
                })
              })
            ])
          })
        );
      });
    });
  });

  describe('/sendweeklytask', () => {
    describe('Permission Checks', () => {
      test('should deny access to non-admin users', async () => {
        isAdmin.mockReturnValue(false);

        await sendWeeklyTask.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: 'You do not have permission to use this command.',
          ephemeral: true
        });
      });

      test('should allow access to admin users', async () => {
        isAdmin.mockReturnValue(true);
        getWeeklyTaskAndMove.mockResolvedValue('Complete 50 Barrows runs');

        await sendWeeklyTask.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      });
    });

    describe('Success Cases', () => {
      test('should send weekly task successfully', async () => {
        isAdmin.mockReturnValue(true);
        const taskText = 'Complete 50 Barrows runs';
        getWeeklyTaskAndMove.mockResolvedValue(taskText);

        await sendWeeklyTask.execute(mockInteraction);

        expect(getWeeklyTaskAndMove).toHaveBeenCalled();
        expect(mockChannel.send).toHaveBeenCalledWith(
          expect.stringContaining(taskText)
        );
        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('✅ Weekly task posted successfully!')
        });
      });

      test('should log to test channel', async () => {
        isAdmin.mockReturnValue(true);
        const taskText = 'Complete 50 Barrows runs';
        getWeeklyTaskAndMove.mockResolvedValue(taskText);

        await sendWeeklyTask.execute(mockInteraction);

        expect(mockTestChannel.send).toHaveBeenCalledWith(
          expect.stringContaining('[Manual Trigger]')
        );
      });
    });

    describe('Error Handling', () => {
      test('should handle missing channel', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.client.channels.cache.get.mockReturnValue(null);

        await sendWeeklyTask.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: '❌ Weekly challenge channel not found!'
        });
      });

      test('should handle database errors', async () => {
        isAdmin.mockReturnValue(true);
        getWeeklyTaskAndMove.mockRejectedValue(new Error('Database error'));

        await sendWeeklyTask.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('❌ Error sending weekly task')
        });
      });
    });
  });

  describe('/senddailywordle', () => {
    describe('Permission Checks', () => {
      test('should deny access to non-admin users', async () => {
        isAdmin.mockReturnValue(false);

        await sendDailyWordle.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: 'You do not have permission to use this command.',
          ephemeral: true
        });
      });

      test('should allow access to admin users', async () => {
        isAdmin.mockReturnValue(true);
        getDailyWordleAndMove.mockResolvedValue('https://wordle.com/12345');

        await sendDailyWordle.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      });
    });

    describe('Success Cases', () => {
      test('should send daily wordle successfully', async () => {
        isAdmin.mockReturnValue(true);
        const wordleUrl = 'https://wordle.com/12345';
        getDailyWordleAndMove.mockResolvedValue(wordleUrl);

        await sendDailyWordle.execute(mockInteraction);

        expect(getDailyWordleAndMove).toHaveBeenCalled();
        expect(mockChannel.send).toHaveBeenCalledWith(
          expect.stringContaining(wordleUrl)
        );
        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('✅ Daily Wordle posted successfully!')
        });
      });

      test('should log to test channel', async () => {
        isAdmin.mockReturnValue(true);
        const wordleUrl = 'https://wordle.com/12345';
        getDailyWordleAndMove.mockResolvedValue(wordleUrl);

        await sendDailyWordle.execute(mockInteraction);

        expect(mockTestChannel.send).toHaveBeenCalledWith(
          expect.stringContaining('[Manual Trigger]')
        );
      });
    });

    describe('Error Handling', () => {
      test('should handle missing channel', async () => {
        isAdmin.mockReturnValue(true);
        mockInteraction.client.channels.cache.get.mockReturnValue(null);

        await sendDailyWordle.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: '❌ Daily challenge channel not found!'
        });
      });

      test('should handle no wordle URL', async () => {
        isAdmin.mockReturnValue(true);
        getDailyWordleAndMove.mockResolvedValue(null);

        await sendDailyWordle.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: '❌ No Wordle URL found in database!'
        });
      });

      test('should handle database errors', async () => {
        isAdmin.mockReturnValue(true);
        getDailyWordleAndMove.mockRejectedValue(new Error('Database error'));

        await sendDailyWordle.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('❌ Error sending daily wordle')
        });
      });
    });
  });
});
