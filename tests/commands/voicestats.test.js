/**
 * /voicestats Test Suite
 *
 * This is the only surface where a member can see their OWN voice standing — the
 * leaderboards are top-10 cuts, so everyone below the cut sees nothing of themselves.
 */

jest.mock('../../db/voice_analytics');
jest.mock('../../utils/displayNames');

const voiceAnalytics = require('../../db/voice_analytics');
const { resolveDisplayNames } = require('../../utils/displayNames');
const voicestats = require('../../commands/utility/voicestats');

const fieldsOf = (interaction) => {
    const [{ embeds }] = interaction.editReply.mock.calls.at(-1);
    return Object.fromEntries(embeds[0].data.fields.map((f) => [f.name, f.value]));
};
const descriptionOf = (interaction) => {
    const [{ embeds }] = interaction.editReply.mock.calls.at(-1);
    return embeds[0].data.description;
};

describe('/voicestats', () => {
    let interaction;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        resolveDisplayNames.mockResolvedValue(new Map());

        interaction = {
            client: {},
            user: { id: 'u1' },
            options: { getString: jest.fn(() => null), getUser: jest.fn(() => null) },
            deferReply: jest.fn().mockResolvedValue({}),
            editReply: jest.fn().mockResolvedValue({})
        };
    });

    afterEach(() => console.error.mockRestore());

    describe('my stats', () => {
        beforeEach(() => {
            voiceAnalytics.getUserVoiceStats.mockResolvedValue({
                user_id: 'u1',
                username: 'baakeer',
                total_minutes: 6430,
                total_ticks: 1286,
                last_active_at: '2026-07-27T14:32:22Z'
            });
        });

        // The whole point: #23 of 212 is the difference between "below the top 10" and
        // "my voice time isn't being tracked", which is how it read before.
        it('shows where the member stands even though they are far below the top 10', async () => {
            voiceAnalytics.getVoiceStanding.mockResolvedValue({ rank: 23, tracked: 212 });

            await voicestats.execute(interaction);

            const fields = fieldsOf(interaction);
            expect(fields.Rank).toBe('#23 of 212');
            expect(fields['Total Time']).toBe('107h 10m');
            expect(voiceAnalytics.getVoiceStanding).toHaveBeenCalledWith(6430);
        });

        // A tick is one 5-minute poll sample, so 1,286 of them is ~107 hours. Calling
        // them "sessions" claimed the member joined voice 1,286 separate times.
        it('does not call 5-minute poll samples sessions', async () => {
            voiceAnalytics.getVoiceStanding.mockResolvedValue({ rank: 23, tracked: 212 });

            await voicestats.execute(interaction);

            const fields = fieldsOf(interaction);
            expect(fields['Check-ins']).toBe('1286');
            expect(Object.keys(fields)).not.toContain('Sessions');
        });

        it('still reports the stats when the standing lookup fails', async () => {
            voiceAnalytics.getVoiceStanding.mockRejectedValue(new Error('count failed'));

            await voicestats.execute(interaction);

            const fields = fieldsOf(interaction);
            expect(fields.Rank).toBe('Unavailable');
            expect(fields['Total Time']).toBe('107h 10m');
        });

        it('says so plainly when the member has never been tracked', async () => {
            voiceAnalytics.getUserVoiceStats.mockResolvedValue(null);

            await voicestats.execute(interaction);

            expect(interaction.editReply).toHaveBeenCalledWith({
                content: expect.stringContaining('No voice activity recorded')
            });
        });
    });

    describe('leaderboard', () => {
        beforeEach(() => {
            interaction.options.getString = jest.fn(() => 'leaderboard');
            voiceAnalytics.getVoiceLeaderboard.mockResolvedValue([
                { user_id: 'a', username: 'old-handle', total_minutes: 55620, total_ticks: 11124 },
                { user_id: 'b', username: 'captain.ace', total_minutes: 53990, total_ticks: 10798 }
            ]);
        });

        // voice_user_stats.username is whatever the member was called at tick time, so
        // after a rename this board named someone nobody in the clan recognises.
        it('resolves live display names instead of the handle stored at tick time', async () => {
            resolveDisplayNames.mockResolvedValue(new Map([['a', 'diodeex']]));

            await voicestats.execute(interaction);

            const description = descriptionOf(interaction);
            expect(description).toContain('diodeex');
            expect(description).not.toContain('old-handle');
            expect(resolveDisplayNames).toHaveBeenCalledWith(interaction.client, ['a', 'b']);
        });

        it('falls back to the stored handle for anyone who cannot be resolved', async () => {
            resolveDisplayNames.mockResolvedValue(new Map());

            await voicestats.execute(interaction);

            expect(descriptionOf(interaction)).toContain('captain.ace');
        });

        it('points members at the personal view for their own position', async () => {
            await voicestats.execute(interaction);

            const [{ embeds }] = interaction.editReply.mock.calls.at(-1);
            expect(embeds[0].data.footer.text).toMatch(/your own position/i);
        });

        it('handles an empty board', async () => {
            voiceAnalytics.getVoiceLeaderboard.mockResolvedValue([]);

            await voicestats.execute(interaction);

            expect(descriptionOf(interaction)).toMatch(/no voice activity/i);
        });
    });
});
