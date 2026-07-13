// Join-funnel analysis over the ticket archive, cross-referenced with Supabase.
//
// Reads every transcript in the join-ticket archive channel (the embed + .txt pairs
// the transcript/close handlers post), detects how far each applicant got using ONLY
// message evidence (no admin summaries — those are unreliable):
//
//   ticket opened → saw verify prompt → verified RSN → posted introduction
//   (guest-flow tickets are classified separately — they aren't clan-join attempts)
//
// …then cross-references each ticket's opener against the shared Supabase DB:
//   players       (row present  → they joined and are STILL in the clan)
//   clan_leavers  (row present  → they joined and LEFT; left_at + rejoined flag)
//
// giving the full funnel: opened → verified → intro → actually joined → still here / left.
//
// Usage (reads TOKEN + SUPABASE_* from .env; read-only everywhere):
//   node scripts/analyzeJoinFunnel.js                     # default archive channel
//   node scripts/analyzeJoinFunnel.js --channel <id>      # another archive
//   node scripts/analyzeJoinFunnel.js --since 2026-01-01  # only tickets archived after
//   node scripts/analyzeJoinFunnel.js --dump              # also write per-ticket JSON/CSV
//
// The STAGES/GUEST regexes are the funnel definition, matched against transcript lines
// (bot embeds appear as "[Embed: <title> <description>]"). The report lists transcripts
// that matched nothing so wording drift is visible instead of silent.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const { supabase } = require('../db/supabase');

const DEFAULT_ARCHIVE_ID = '1240751449281921054'; // #join-ticket-archive

// ── Funnel stages (message evidence only) ────────────────────────────────────
// Matched against every transcript line, INCLUDING continuation lines (multi-line
// content and "[Embed: …]" lines sit below their "[timestamp] user:" line).
// Markers are the messages that post PUBLICLY in the ticket channel:
//  - the auto-opened ticket's welcome embed (🔰) carries the verify button,
//  - handleVerifySubmit replies publicly: "✅|⚠️ Verification Results" (✅ = met reqs),
//  - the intro submit's ephemeral confirm never shows, but the admin ping
//    "📝 **Introduction Posted!**" does.
const STAGES = [
	{ key: 'verify_prompt', label: 'Got welcome + verify prompt', re: /\[Embed: 🔰 Welcome to Volition!|\[Embed: 🎮 Verify Your RuneScape Account/i },
	{ key: 'verify_attempted', label: 'Attempted verification', re: /\[Embed: (✅|⚠️) Verification Results|\[Embed: ✅ User Force Verified|\[Embed: 🔄 Former Member Returning!/i },
	{ key: 'verified', label: 'Verified (met requirements)', re: /\[Embed: ✅ Verification Results|\[Embed: ✅ User Force Verified|\[Embed: 🔄 Former Member Returning!/i },
	{ key: 'intro', label: 'Posted introduction', re: /Introduction Posted!|Your introduction has been posted/i }
];

// Guest-flow markers: these tickets chose the guest path, not the clan-join path.
const GUEST_RE = /\[Embed: 👋 Join as Guest|\[Embed: 🔍 Guest Request - Manual Review Needed|\[Embed: ✅ Guest Force Verified|\[Embed: 👋 Welcome to Volition!/i;

function parseArgs() {
	const args = process.argv.slice(2);
	const out = { channel: DEFAULT_ARCHIVE_ID, since: null, dump: false };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--channel') out.channel = args[++i];
		else if (args[i] === '--since') out.since = new Date(args[++i]);
		else if (args[i] === '--dump') out.dump = true;
	}
	return out;
}

// Transcript lines look like: [07/12/2026, 18:03:41] username: content
const LINE_RE = /^\[(\d{2}\/\d{2}\/\d{4}), (\d{2}:\d{2}:\d{2})\] ([^:]+): (.*)$/;

function parseLineTs(mmddyyyy, hms) {
	const [m, d, y] = mmddyyyy.split('/').map(Number);
	const [hh, mm, ss] = hms.split(':').map(Number);
	return new Date(y, m - 1, d, hh, mm, ss);
}

function parseTranscript(text) {
	const t = {
		channelName: null,
		totalMessages: 0,
		autoClosed: /<Auto-Closed>/.test(text),
		users: [], // [{ name, id, count }] from <User-Info>, message-count desc
		openedAt: null,
		lastMessageAt: null,
		isGuest: false,
		stages: {} // key -> Date
	};

	const chan = text.match(/Channel: (\S+)/);
	if (chan) t.channelName = chan[1];
	const msgs = text.match(/Messages: (\d+)/);
	if (msgs) t.totalMessages = Number(msgs[1]);

	const userBlock = text.match(/<User-Info>\n([\s\S]*?)\n\n/);
	if (userBlock) {
		for (const line of userBlock[1].split('\n')) {
			const m = line.match(/^\s*(\d+) - (.+) \((\d+)\)$/);
			if (m) t.users.push({ name: m[2], id: m[3], count: Number(m[1]) });
		}
	}

	// Message content spans multiple lines: embeds and attachments are appended as
	// "[Embed: …]" / "[Attachment: …]" lines BELOW the "[timestamp] user:" line, and
	// multi-line text continues the same way. Track the current message's timestamp
	// and run the matchers over continuation lines too — that's where the embeds live.
	let curTs = null;
	for (const raw of text.split('\n')) {
		const m = raw.match(LINE_RE);
		let hay;
		if (m) {
			curTs = parseLineTs(m[1], m[2]);
			if (!t.openedAt) t.openedAt = curTs;
			t.lastMessageAt = curTs;
			hay = m[4];
		} else if (curTs) {
			hay = raw; // continuation line of the current message
		} else {
			continue; // still in the header blocks
		}
		if (!t.isGuest && GUEST_RE.test(hay)) t.isGuest = true;
		for (const s of STAGES) {
			if (!t.stages[s.key] && s.re.test(hay)) t.stages[s.key] = curTs;
		}
	}
	return t;
}

// Resolve the ticket opener's Discord id, most reliable source first:
// 1. the archive embed's "Opened By" field (<@id> from the close handler's state),
// 2. the join-<displayname> channel name matched against <User-Info> entries,
// 3. the most-active participant who isn't the bot or a claiming admin.
function resolveOpener(t, embedOpenerId, claimerIds, botId) {
	if (embedOpenerId) return { id: embedOpenerId, how: 'embed' };

	const nameMatch = t.channelName?.match(/join-(.+?)(?:・|$)/);
	if (nameMatch) {
		const needle = nameMatch[1].toLowerCase();
		const hit = t.users.find(
			(u) => u.id !== botId && u.name.toLowerCase().includes(needle)
		);
		if (hit) return { id: hit.id, how: 'channel-name' };
	}

	const candidate = t.users.find((u) => u.id !== botId && !claimerIds.has(u.id));
	if (candidate) return { id: candidate.id, how: 'most-active' };
	return { id: null, how: 'unresolved' };
}

// Page through a whole table (PostgREST caps a plain select at 1000 rows).
async function selectAll(table, columns) {
	const rows = [];
	const page = 1000;
	for (let fromIdx = 0; ; fromIdx += page) {
		const { data, error } = await supabase
			.from(table)
			.select(columns)
			.range(fromIdx, fromIdx + page - 1);
		if (error) throw new Error(`${table}: ${error.message}`);
		rows.push(...(data ?? []));
		if (!data || data.length < page) break;
	}
	return rows;
}

function median(nums) {
	if (!nums.length) return null;
	const s = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtDur(ms) {
	if (ms == null) return '—';
	const mins = Math.round(ms / 60000);
	if (mins < 60) return `${mins}m`;
	if (mins < 60 * 48) return `${(mins / 60).toFixed(1)}h`;
	return `${(mins / 1440).toFixed(1)}d`;
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

async function fetchAllArchiveMessages(channel) {
	const all = [];
	let before;
	for (;;) {
		const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
		if (batch.size === 0) break;
		all.push(...batch.values());
		before = batch.last().id;
		if (batch.size < 100) break;
	}
	return all;
}

async function main() {
	const opts = parseArgs();

	// ── Supabase membership state ──
	console.log('Loading players + clan_leavers from Supabase…');
	const [players, leavers] = await Promise.all([
		selectAll('players', 'discord_id, rsn'),
		selectAll('clan_leavers', 'discord_id, rsn, left_at, rejoined')
	]);
	const inClan = new Set(players.map((p) => p.discord_id).filter(Boolean));
	// Latest leaver row per discord id.
	const leftBy = new Map();
	for (const l of leavers) {
		if (!l.discord_id) continue;
		const prev = leftBy.get(l.discord_id);
		if (!prev || (l.left_at ?? '') > (prev.left_at ?? '')) leftBy.set(l.discord_id, l);
	}
	console.log(`  ${players.length} current players · ${leavers.length} leaver records (${leftBy.size} unique).`);

	// ── Discord archive ──
	const client = new Client({ intents: [GatewayIntentBits.Guilds] });
	await client.login(process.env.TOKEN);
	try {
		const channel = await client.channels.fetch(opts.channel);
		if (!channel?.isTextBased()) throw new Error(`Channel ${opts.channel} is not a text channel`);
		console.log(`Reading archive #${channel.name} (${channel.id})…`);
		const messages = await fetchAllArchiveMessages(channel);
		console.log(`Fetched ${messages.length} archive messages.`);
		const botId = client.user.id;

		const tickets = [];
		for (const msg of messages) {
			const txt = [...msg.attachments.values()].find((a) => a.name?.endsWith('.txt'));
			if (!txt) continue;
			if (opts.since && msg.createdAt < opts.since) continue;

			// Opener + claimers from the archive embed (when the close handler had state).
			let embedOpenerId = null;
			const claimerIds = new Set();
			for (const embed of msg.embeds) {
				for (const f of embed.fields ?? []) {
					if (f.name === 'Opened By') embedOpenerId = f.value.match(/<@!?(\d+)>/)?.[1] ?? null;
					if (f.name.startsWith('Claimed By')) {
						for (const m of f.value.matchAll(/<@!?(\d+)>/g)) claimerIds.add(m[1]);
					}
				}
			}

			let body;
			try {
				const res = await fetch(txt.url);
				body = await res.text();
			} catch (e) {
				console.warn(`  ! failed to download ${txt.name}: ${e.message}`);
				continue;
			}
			const t = parseTranscript(body);
			t.closedAt = msg.createdAt;
			t.file = txt.name;
			const opener = resolveOpener(t, embedOpenerId, claimerIds, botId);
			t.openerId = opener.id;
			t.openerHow = opener.how;
			t.openerMsgCount = opener.id ? (t.users.find((u) => u.id === opener.id)?.count ?? 0) : 0;

			// Membership status from the DB — the ground truth for "actually joined".
			if (!t.openerId) t.status = 'unknown';
			else if (inClan.has(t.openerId)) t.status = 'in_clan';
			else if (leftBy.has(t.openerId)) t.status = 'left';
			else t.status = 'never_joined';
			const lv = t.openerId ? leftBy.get(t.openerId) : null;
			t.leftAt = t.status === 'left' ? (lv?.left_at ?? null) : null;
			t.rejoinedLater = !!(t.status === 'in_clan' && lv); // has a leaver record but is back

			tickets.push(t);
		}
		tickets.sort((a, b) => a.closedAt - b.closedAt);

		const guests = tickets.filter((t) => t.isGuest);
		const joins = tickets.filter((t) => !t.isGuest);
		const total = joins.length;
		console.log(`\nParsed ${tickets.length} transcripts → ${total} join tickets, ${guests.length} guest-path tickets.\n`);
		if (!total) return;

		// ── The funnel ──
		const n = (pred) => joins.filter(pred).length;
		const verified = n((t) => t.stages.verified);
		const intro = n((t) => t.stages.intro);
		const joined = n((t) => t.status === 'in_clan' || t.status === 'left');
		const still = n((t) => t.status === 'in_clan');
		const left = n((t) => t.status === 'left');

		const attempted = n((t) => t.stages.verify_attempted);
		console.log('════ JOIN FUNNEL (message evidence + database) ════');
		console.log(`${String(total).padStart(5)}  Join tickets opened          100%`);
		console.log(`${String(n((t) => t.stages.verify_prompt)).padStart(5)}  Got welcome + verify prompt ${pct(n((t) => t.stages.verify_prompt), total).padStart(6)}`);
		console.log(`${String(attempted).padStart(5)}  Attempted verification     ${pct(attempted, total).padStart(6)}`);
		console.log(`${String(verified).padStart(5)}  Verified (met reqs)        ${pct(verified, total).padStart(6)}  (${pct(verified, attempted)} of attempts)`);
		console.log(`${String(intro).padStart(5)}  Posted introduction        ${pct(intro, total).padStart(6)}  (${pct(intro, verified)} of verified)`);
		console.log(`${String(joined).padStart(5)}  Actually joined (in DB)    ${pct(joined, total).padStart(6)}  (${pct(joined, verified)} of verified)`);
		console.log(`${String(still).padStart(5)}  … still in the clan        ${pct(still, total).padStart(6)}  (${pct(still, joined)} of joiners)`);
		console.log(`${String(left).padStart(5)}  … joined but later left    ${pct(left, total).padStart(6)}  (${pct(left, joined)} of joiners)`);
		const rejoined = n((t) => t.rejoinedLater);
		if (rejoined) console.log(`${String(rejoined).padStart(5)}  … left at some point but are back now`);

		// ── Where the drop-off happens ──
		console.log('\n════ DROP-OFF DETAIL ════');
		const neverVerified = joins.filter((t) => !t.stages.verified && t.status === 'never_joined');
		const silent = neverVerified.filter((t) => t.openerMsgCount === 0).length;
		console.log(`${String(neverVerified.length).padStart(5)}  never verified AND never joined (true funnel loss)`);
		console.log(`${String(silent).padStart(5)}    … of those, opener never sent a single message`);
		console.log(`${String(joins.filter((t) => t.autoClosed).length).padStart(5)}  tickets auto-closed after going quiet (soft-close)`);
		const verifiedNotJoined = joins.filter((t) => t.stages.verified && t.status === 'never_joined').length;
		console.log(`${String(verifiedNotJoined).padStart(5)}  verified but never appear in players/leavers (lost after verify)`);

		// ── Timing ──
		console.log('\n════ TIMING (medians) ════');
		const stageDur = (key) =>
			median(joins.filter((t) => t.openedAt && t.stages[key]).map((t) => t.stages[key] - t.openedAt));
		console.log(`Open → verified:      ${fmtDur(stageDur('verified'))}`);
		console.log(`Open → introduction:  ${fmtDur(stageDur('intro'))}`);
		console.log(`Open → last message:  ${fmtDur(median(joins.filter((t) => t.openedAt && t.lastMessageAt).map((t) => t.lastMessageAt - t.openedAt)))}`);

		// ── Monthly trend ──
		console.log('\n════ BY MONTH (archived) ════');
		const months = {};
		for (const t of joins) {
			const k = `${t.closedAt.getFullYear()}-${String(t.closedAt.getMonth() + 1).padStart(2, '0')}`;
			months[k] = months[k] || { n: 0, verified: 0, joined: 0, still: 0 };
			months[k].n++;
			if (t.stages.verified) months[k].verified++;
			if (t.status === 'in_clan' || t.status === 'left') months[k].joined++;
			if (t.status === 'in_clan') months[k].still++;
		}
		console.log('month     tickets  verified   joined    still-in-clan');
		for (const [k, v] of Object.entries(months)) {
			console.log(`${k}   ${String(v.n).padStart(5)}   ${String(v.verified).padStart(5)}    ${String(v.joined).padStart(5)}    ${String(v.still).padStart(5)} (${pct(v.still, v.n)})`);
		}

		// ── Data-quality notes ──
		const unresolved = joins.filter((t) => !t.openerId).length;
		const byHow = {};
		for (const t of joins) byHow[t.openerHow] = (byHow[t.openerHow] || 0) + 1;
		console.log(`\nOpener resolution: ${Object.entries(byHow).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
		if (unresolved) console.log(`⚠ ${unresolved} tickets have no resolvable opener (counted as status=unknown).`);
		const noStage = joins.filter((t) => Object.keys(t.stages).length === 0 && t.totalMessages > 2);
		if (noStage.length) {
			console.log(`⚠ ${noStage.length} join transcripts matched NO stage despite having messages (older flow wording?). Samples:`);
			for (const t of noStage.slice(0, 5)) console.log(`   - ${t.file} (${t.totalMessages} msgs)`);
		}

		// ── Dump ──
		if (opts.dump) {
			const outDir = path.join(__dirname, 'out');
			fs.mkdirSync(outDir, { recursive: true });
			fs.writeFileSync(path.join(outDir, 'join-funnel.json'), JSON.stringify(tickets, null, '\t'));
			const csv = [
				'channel,archived_at,opened_at,messages,is_guest,opener_id,opener_how,opener_msgs,status,left_at,auto_closed,' +
					STAGES.map((s) => s.key).join(','),
				...tickets.map((t) =>
					[
						t.channelName,
						t.closedAt.toISOString(),
						t.openedAt?.toISOString() ?? '',
						t.totalMessages,
						t.isGuest,
						t.openerId ?? '',
						t.openerHow,
						t.openerMsgCount,
						t.status,
						t.leftAt ?? '',
						t.autoClosed,
						...STAGES.map((s) => (t.stages[s.key] ? t.stages[s.key].toISOString() : ''))
					].join(',')
				)
			].join('\n');
			fs.writeFileSync(path.join(outDir, 'join-funnel.csv'), csv);
			console.log(`\nWrote scripts/out/join-funnel.json + join-funnel.csv (${tickets.length} rows).`);
		}
	} finally {
		client.destroy();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
