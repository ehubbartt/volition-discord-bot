// Join-funnel analysis over the ticket archive.
//
// Reads every transcript in the join-ticket archive channel (the embed + .txt
// attachment pairs that handlers/transcript.js and utils/ticketHandlers.js post),
// detects the milestones of the current join flow inside each transcript, and
// prints a funnel report: how many tickets reached each stage, conversion between
// stages, timing medians, and outcome classification from the admin close summary.
//
// Usage (reads TOKEN from .env, read-only against Discord):
//   node scripts/analyzeJoinFunnel.js                     # default archive channel
//   node scripts/analyzeJoinFunnel.js --channel <id>      # another archive
//   node scripts/analyzeJoinFunnel.js --since 2026-01-01  # only tickets closed after
//   node scripts/analyzeJoinFunnel.js --dump              # also write per-ticket JSON/CSV
//
// Output files (with --dump): scripts/out/join-funnel.json, scripts/out/join-funnel.csv
//
// The STAGES table below is the funnel definition. Each stage is detected by a
// regex over the transcript's message lines (bot embeds appear as
// "[Embed: <title> <description>]"). If the flow's wording changes, update the
// regexes here — the report prints a sample of unmatched tickets so drift is
// visible instead of silent.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const DEFAULT_ARCHIVE_ID = '1240751449281921054'; // #join-ticket-archive

// ── Funnel definition ────────────────────────────────────────────────────────
// Ordered stages; a ticket "reaches" a stage when any line matches. `at` is the
// first matching line's timestamp.
const STAGES = [
	// The bot's verification prompt / results inside the ticket.
	{ key: 'verify_prompt', label: 'Saw verify prompt', re: /\[Embed: 🎮 Verify Your RuneScape Account/i },
	{ key: 'verified', label: 'Verified RSN', re: /\[Embed: ✅ Verification Results|\[Embed: ✅ User Force Verified|\[Embed: 🔄 Former Member Returning!/i },
	// "Introduce Yourself" modal posted → confirmation line from the bot.
	{ key: 'intro', label: 'Posted introduction', re: /Your introduction has been posted/i },
	// In-game / final instructions step.
	{ key: 'how_to_join', label: 'Got how-to-join info', re: /\[Embed: How to join\./i }
];

// Outcome classification from the admin's close summary (first match wins).
const OUTCOMES = [
	{ key: 'joined', re: /join|accept|welcom|verified and (ranked|added)|in.?game|invited/i },
	{ key: 'no_response', re: /no (response|answer|reply)|inactive|abandon|never|ghost|didn.?t (respond|reply|answer)|timed? ?out/i },
	{ key: 'declined', re: /den(y|ied)|reject|not (a )?fit|decline|troll|ban/i },
	{ key: 'left', re: /left|changed (their )?mind|withdrew|not interested/i }
];

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
		adminSummary: '',
		autoClosed: /<Auto-Closed>/.test(text),
		userCounts: {},
		openedAt: null,
		lastMessageAt: null,
		stages: {} // key -> Date
	};

	const chan = text.match(/Channel: ([^\s(]+)/);
	if (chan) t.channelName = chan[1];
	const msgs = text.match(/Messages: (\d+)/);
	if (msgs) t.totalMessages = Number(msgs[1]);
	const summary = text.match(/<Admin-Summary>\n\s*([\s\S]*?)(?:\n\n|\n\[|$)/);
	if (summary) t.adminSummary = summary[1].trim();

	// User-Info block: "    12 - name (id)"
	const userBlock = text.match(/<User-Info>\n([\s\S]*?)\n\n/);
	if (userBlock) {
		for (const line of userBlock[1].split('\n')) {
			const m = line.match(/^\s*(\d+) - (.+) \((\d+)\)/);
			if (m) t.userCounts[m[2]] = Number(m[1]);
		}
	}

	for (const raw of text.split('\n')) {
		const m = raw.match(LINE_RE);
		if (!m) continue;
		const ts = parseLineTs(m[1], m[2]);
		if (!t.openedAt) t.openedAt = ts;
		t.lastMessageAt = ts;
		for (const s of STAGES) {
			if (!t.stages[s.key] && s.re.test(m[4])) t.stages[s.key] = ts;
		}
	}
	return t;
}

function classifyOutcome(t) {
	if (t.autoClosed) return 'auto_closed';
	for (const o of OUTCOMES) if (o.re.test(t.adminSummary)) return o.key;
	return 'unclassified';
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
	const client = new Client({ intents: [GatewayIntentBits.Guilds] });
	await client.login(process.env.TOKEN);
	try {
		const channel = await client.channels.fetch(opts.channel);
		if (!channel?.isTextBased()) throw new Error(`Channel ${opts.channel} is not a text channel`);
		console.log(`Reading archive #${channel.name} (${channel.id})…`);

		const messages = await fetchAllArchiveMessages(channel);
		console.log(`Fetched ${messages.length} archive messages.`);

		const tickets = [];
		for (const msg of messages) {
			const txt = [...msg.attachments.values()].find((a) => a.name?.endsWith('.txt'));
			if (!txt) continue;
			const closedAt = msg.createdAt;
			if (opts.since && closedAt < opts.since) continue;
			let body;
			try {
				const res = await fetch(txt.url);
				body = await res.text();
			} catch (e) {
				console.warn(`  ! failed to download ${txt.name}: ${e.message}`);
				continue;
			}
			const t = parseTranscript(body);
			t.closedAt = closedAt;
			t.file = txt.name;
			t.outcome = classifyOutcome(t);
			tickets.push(t);
		}

		// Oldest first for readable monthly grouping.
		tickets.sort((a, b) => a.closedAt - b.closedAt);
		const total = tickets.length;
		console.log(`Parsed ${total} ticket transcripts.\n`);
		if (!total) return;

		// ── Funnel ──
		console.log('════ JOIN FUNNEL ════');
		console.log(`${String(total).padStart(5)}  Tickets archived            100%`);
		let prev = total;
		for (const s of STAGES) {
			const n = tickets.filter((t) => t.stages[s.key]).length;
			console.log(
				`${String(n).padStart(5)}  ${s.label.padEnd(26)} ${pct(n, total).padStart(6)}  (step: ${pct(n, prev)})`
			);
			prev = n || prev;
		}

		// ── Outcomes ──
		console.log('\n════ OUTCOMES (from close summaries) ════');
		const byOutcome = {};
		for (const t of tickets) byOutcome[t.outcome] = (byOutcome[t.outcome] || 0) + 1;
		for (const [k, n] of Object.entries(byOutcome).sort((a, b) => b[1] - a[1])) {
			console.log(`${String(n).padStart(5)}  ${k.padEnd(14)} ${pct(n, total)}`);
		}

		// ── Timing ──
		console.log('\n════ TIMING (medians) ════');
		const dur = (from, to) =>
			median(tickets.filter((t) => t[from] && t[to]).map((t) => t[to] - t[from]));
		const stageDur = (key) =>
			median(tickets.filter((t) => t.openedAt && t.stages[key]).map((t) => t.stages[key] - t.openedAt));
		console.log(`Open → verified:      ${fmtDur(stageDur('verified'))}`);
		console.log(`Open → introduction:  ${fmtDur(stageDur('intro'))}`);
		console.log(`Open → last message:  ${fmtDur(dur('openedAt', 'lastMessageAt'))}`);
		console.log(`Open → archived:      ${fmtDur(dur('openedAt', 'closedAt'))}`);

		// ── Monthly trend ──
		console.log('\n════ BY MONTH (closed) ════');
		const months = {};
		for (const t of tickets) {
			const k = `${t.closedAt.getFullYear()}-${String(t.closedAt.getMonth() + 1).padStart(2, '0')}`;
			months[k] = months[k] || { n: 0, joined: 0, auto: 0 };
			months[k].n++;
			if (t.outcome === 'joined') months[k].joined++;
			if (t.outcome === 'auto_closed') months[k].auto++;
		}
		for (const [k, v] of Object.entries(months)) {
			console.log(`${k}  ${String(v.n).padStart(4)} tickets   ${String(v.joined).padStart(4)} joined (${pct(v.joined, v.n)})   ${v.auto} auto-closed`);
		}

		// ── Drift check: unclassified samples ──
		const un = tickets.filter((t) => t.outcome === 'unclassified');
		if (un.length) {
			console.log(`\n${un.length} tickets had close summaries the classifier didn't recognise. Samples:`);
			for (const t of un.slice(0, 8)) console.log(`  - "${t.adminSummary.slice(0, 90)}" (${t.file})`);
			console.log('Tune the OUTCOMES regexes at the top of this script and re-run.');
		}
		const noStage = tickets.filter((t) => Object.keys(t.stages).length === 0);
		if (noStage.length) {
			console.log(`\n${noStage.length} transcripts matched NO funnel stage (older flow wording?). Samples:`);
			for (const t of noStage.slice(0, 5)) console.log(`  - ${t.file} (${t.totalMessages} msgs)`);
		}

		// ── Dump ──
		if (opts.dump) {
			const outDir = path.join(__dirname, 'out');
			fs.mkdirSync(outDir, { recursive: true });
			fs.writeFileSync(path.join(outDir, 'join-funnel.json'), JSON.stringify(tickets, null, '\t'));
			const csv = [
				'channel,closed_at,opened_at,messages,outcome,auto_closed,' + STAGES.map((s) => s.key).join(','),
				...tickets.map((t) =>
					[
						t.channelName,
						t.closedAt.toISOString(),
						t.openedAt?.toISOString() ?? '',
						t.totalMessages,
						t.outcome,
						t.autoClosed,
						...STAGES.map((s) => (t.stages[s.key] ? t.stages[s.key].toISOString() : ''))
					].join(',')
				)
			].join('\n');
			fs.writeFileSync(path.join(outDir, 'join-funnel.csv'), csv);
			console.log(`\nWrote scripts/out/join-funnel.json + join-funnel.csv (${total} rows).`);
		}
	} finally {
		client.destroy();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
