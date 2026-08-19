/**
 * Voice Tracker Job Test Suite
 *
 * The tick loop is the ONLY writer of voice data, and it runs once every 5 minutes.
 * Anything that escapes it costs every member still unprocessed a full tick, silently.
 */

jest.mock('../../db/supabase');
jest.mock('../../db/voice_analytics');
jest.mock('../../utils/hybridConfig');
jest.mock('../../utils/features');
// The job reads config.json directly, not utils/config.
jest.mock('../../config.json', () => ({ guildId: 'guild-1' }));

const { ChannelType } = require('discord.js');
const db = require('../../db/supabase');
const voiceAnalytics = require('../../db/voice_analytics');
const hybridConfig = require('../../utils/hybridConfig');
const features = require('../../utils/features');
const { checkVoiceChannels } = require('../../jobs/voiceTracker');

// A member the tracker would consider eligible: real user, unmuted, undeafened.
const member = (id, username = `user-${id}`) => [
    id,
    { id, user: { bot: false, username }, voice: { selfMute: false, serverMute: false, selfDeaf: false, serverDeaf: false } }
];

function clientWith(members) {
    const channel = {
        type: ChannelType.GuildVoice,
        name: 'General',
        members: new Map(members)
    };
    // The job calls .filter() on the members collection — discord.js Collections have it,
    // plain Maps don't.
    channel.members.filter = function (fn) {
        const out = new Map([...this].filter(([id, m]) => fn(m, id)));
        out.filter = channel.members.filter;
        return out;
    };

    const channels = new Map([['chan-1', channel]]);
    channels.filter = function (fn) {
        return new Map([...this].filter(([id, c]) => fn(c, id)));
    };

    return {
        guilds: { cache: new Map([['guild-1', { afkChannelId: 'afk', channels: { cache: channels } }]]) }
    };
}

describe('Voice Tracker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        features.isEnabled.mockResolvedValue(true);
        hybridConfig.getConfigGroup.mockResolvedValue({ enabled: true, minutesPerTick: 5, minEligibleUsers: 2 });
        voiceAnalytics.logVoiceTick.mockResolvedValue({ logged: true, counted: true });
        voiceAnalytics.logDailyMetrics.mockResolvedValue(undefined);
    });

    afterEach(() => {
        console.error.mockRestore();
        console.log.mockRestore();
    });

    it('awards a tick to every registered member in the channel', async () => {
        db.getPlayerByDiscordId.mockResolvedValue({ rsn: 'somebody' });

        await checkVoiceChannels(clientWith([member('a'), member('b')]));

        expect(voiceAnalytics.logVoiceTick).toHaveBeenCalledTimes(2);
        expect(voiceAnalytics.logDailyMetrics).toHaveBeenCalledWith(
            expect.any(String), 2, 10, 2, 2
        );
    });

    // THE REGRESSION. getPlayerByDiscordId rethrows anything that isn't "no rows" — a
    // duplicate players row for one discord_id makes its .single() error. That throw used
    // to escape the whole job, so everyone after the bad member in iteration order lost
    // the tick, with nothing in the logs naming them.
    it('one member failing does not cost the rest of the channel their tick', async () => {
        db.getPlayerByDiscordId.mockImplementation(async (id) => {
            if (id === 'b') throw new Error('JSON object requested, multiple rows returned');
            return { rsn: `player-${id}` };
        });

        await checkVoiceChannels(clientWith([member('a'), member('b'), member('c')]));

        const ticked = voiceAnalytics.logVoiceTick.mock.calls.map((c) => c[0]);
        expect(ticked).toEqual(['a', 'c']);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Skipped b'));
    });

    it('skips members with no players row without counting them as an error', async () => {
        db.getPlayerByDiscordId.mockImplementation(async (id) => (id === 'b' ? null : { rsn: id }));

        await checkVoiceChannels(clientWith([member('a'), member('b')]));

        expect(voiceAnalytics.logVoiceTick.mock.calls.map((c) => c[0])).toEqual(['a']);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('awards nothing when the channel is below minEligibleUsers', async () => {
        db.getPlayerByDiscordId.mockResolvedValue({ rsn: 'somebody' });

        await checkVoiceChannels(clientWith([member('a')]));

        expect(voiceAnalytics.logVoiceTick).not.toHaveBeenCalled();
        expect(voiceAnalytics.logDailyMetrics).not.toHaveBeenCalled();
    });

    it('does nothing when the feature flag is off', async () => {
        features.isEnabled.mockResolvedValue(false);
        db.getPlayerByDiscordId.mockResolvedValue({ rsn: 'somebody' });

        await checkVoiceChannels(clientWith([member('a'), member('b')]));

        expect(voiceAnalytics.logVoiceTick).not.toHaveBeenCalled();
    });
});
