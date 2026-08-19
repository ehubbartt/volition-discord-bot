/**
 * Voice Analytics Test Suite
 *
 * Covers the two writes behind every tick (they must be reported independently) and
 * the standing lookup that tells a member where they sit outside the top-10 cut.
 */

const mockInsert = jest.fn();
const mockRpc = jest.fn();
const mockSelect = jest.fn();

jest.mock('../../db/supabase', () => ({
    supabase: {
        from: jest.fn(() => ({ insert: mockInsert, select: mockSelect })),
        rpc: (...args) => mockRpc(...args)
    }
}));

const voiceAnalytics = require('../../db/voice_analytics');

describe('Voice Analytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => console.error.mockRestore());

    describe('logVoiceTick', () => {
        it('writes the log row and the aggregate, and reports both landing', async () => {
            mockInsert.mockResolvedValue({ error: null });
            mockRpc.mockResolvedValue({ error: null });

            const result = await voiceAnalytics.logVoiceTick('u1', 'baakeer', 'c1', 'General', 3, 5);

            expect(result).toEqual({ logged: true, counted: true });
            expect(mockInsert).toHaveBeenCalledWith(
                expect.objectContaining({ user_id: 'u1', username: 'baakeer', minutes_awarded: 5 })
            );
            expect(mockRpc).toHaveBeenCalledWith('increment_voice_user_stats', {
                p_user_id: 'u1',
                p_username: 'baakeer',
                p_ticks: 1,
                p_minutes: 5
            });
        });

        // THE REGRESSION. The insert commits first and the RPC used to share its
        // try/catch, so a failed RPC produced a log row with no matching stats row and
        // a generic "Error logging voice tick" line that named neither the member nor
        // which half was lost. Every leaderboard reading voice_user_stats undercounts
        // that member from then on, permanently and invisibly.
        it('names the member and the undercount when only the aggregate fails', async () => {
            mockInsert.mockResolvedValue({ error: null });
            mockRpc.mockResolvedValue({ error: { message: 'function does not exist' } });

            const result = await voiceAnalytics.logVoiceTick('u1', 'baakeer', 'c1', 'General', 3, 5);

            expect(result).toEqual({ logged: true, counted: false });
            const logged = console.error.mock.calls.flat().join('\n');
            expect(logged).toContain('u1');
            expect(logged).toContain('undercounts');
        });

        // The old shared try/catch threw out of the insert and never reached the RPC,
        // so a transient log failure also cost the member their aggregate.
        it('still updates the aggregate when the log row fails', async () => {
            mockInsert.mockResolvedValue({ error: { message: 'timeout' } });
            mockRpc.mockResolvedValue({ error: null });

            const result = await voiceAnalytics.logVoiceTick('u1', 'baakeer', 'c1', 'General', 3, 5);

            expect(result).toEqual({ logged: false, counted: true });
            expect(mockRpc).toHaveBeenCalled();
        });

        it('never throws at the caller — the tick loop treats it as fire-and-forget', async () => {
            mockInsert.mockRejectedValue(new Error('network down'));
            mockRpc.mockRejectedValue(new Error('network down'));

            await expect(
                voiceAnalytics.logVoiceTick('u1', 'baakeer', 'c1', 'General', 3, 5)
            ).resolves.toEqual({ logged: false, counted: false });
        });
    });

    describe('getVoiceStanding', () => {
        // select() is awaited directly for the total, and .gt()-ed for the count ahead.
        const standing = ({ ahead, total }) =>
            mockSelect.mockImplementation(() => ({
                gt: jest.fn().mockResolvedValue({ count: ahead, error: null }),
                then: (res, rej) => Promise.resolve({ count: total, error: null }).then(res, rej)
            }));

        it('is one better than the number of members ahead', async () => {
            standing({ ahead: 22, total: 212 });
            await expect(voiceAnalytics.getVoiceStanding(6430)).resolves.toEqual({
                rank: 23,
                tracked: 212
            });
        });

        it('puts the leader at #1', async () => {
            standing({ ahead: 0, total: 212 });
            await expect(voiceAnalytics.getVoiceStanding(55620)).resolves.toEqual({
                rank: 1,
                tracked: 212
            });
        });

        it('surfaces a failed count rather than reporting a wrong rank', async () => {
            mockSelect.mockImplementation(() => ({
                gt: jest.fn().mockResolvedValue({ count: null, error: { message: 'boom' } }),
                then: (res, rej) => Promise.resolve({ count: 212, error: null }).then(res, rej)
            }));

            await expect(voiceAnalytics.getVoiceStanding(6430)).rejects.toMatchObject({
                message: 'boom'
            });
        });
    });
});
