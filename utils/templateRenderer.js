const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

/**
 * Template renderer for editable command messages (bot_config → command_messages).
 *
 * Lets admins edit a command's embed text from the site without code changes, while
 * keeping all IDs and ping-safety in code. A template is a plain object:
 *   { color, title, description, thumbnail, image, footer, timestamp, content }
 * Any string field may contain tokens that the bot resolves at send time:
 *
 *   {{channel:KEY}}      → <#id>      (KEY is a *_CHANNEL_ID key in config.json)
 *   {{role:KEY}}         → <@&id>     (KEY is a *_ROLE_ID key in config.json)
 *   {{emoji:NAME}}       → <:NAME:id> (id from config.json `${NAME.toUpperCase()}_EMOJI_ID`)
 *   {{config:KEY}}       → raw config.json value (e.g. CLAN_ICON_URL)
 *   {{user}}             → mention of the invoking user (<@id>)
 *   {{displayName}}      → invoking user's display name (plain text)
 *
 * Optional inline fallback: {{type:KEY|fallback text}} is used when KEY is missing or
 * still set to the placeholder 'NEEDS_ID'.
 *
 * SECURITY: the returned allowedMentions is an explicit allow-list that never includes
 * 'everyone'/'here' and never blanket-allows roles — so admin-authored text can't make
 * the bot ping @everyone or mass-ping a role. Only the specific invoking user may be
 * pinged, and only if {{user}} was used.
 */

const PLACEHOLDER = 'NEEDS_ID';

function resolveToken(type, key, fallback, ctx) {
	const fb = fallback != null ? fallback : '';
	switch (type) {
		case 'channel': {
			const id = config[key];
			return id && id !== PLACEHOLDER ? `<#${id}>` : (fallback != null ? fb : `#${key}`);
		}
		case 'role': {
			const id = config[key];
			return id && id !== PLACEHOLDER ? `<@&${id}>` : (fallback != null ? fb : `@${key}`);
		}
		case 'emoji': {
			const id = config[`${key.toUpperCase()}_EMOJI_ID`];
			return id && id !== PLACEHOLDER ? `<:${key}:${id}>` : fb;
		}
		case 'config': {
			const val = config[key];
			return val != null && val !== PLACEHOLDER ? String(val) : fb;
		}
		case 'user':
			return ctx.user && ctx.user.id ? `<@${ctx.user.id}>` : fb;
		case 'displayName':
			return ctx.user && ctx.user.displayName ? ctx.user.displayName : fb;
		default:
			return fb;
	}
}

function renderTokens(text, ctx) {
	return String(text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, inner) => {
		const colon = inner.indexOf(':');
		let type, rest;
		if (colon === -1) {
			type = inner.trim();
			rest = '';
		} else {
			type = inner.slice(0, colon).trim();
			rest = inner.slice(colon + 1);
		}
		let key = rest;
		let fallback = null;
		const pipe = rest.indexOf('|');
		if (pipe !== -1) {
			key = rest.slice(0, pipe);
			fallback = rest.slice(pipe + 1); // not trimmed — preserve intentional formatting
		}
		return resolveToken(type, key.trim(), fallback, ctx);
	});
}

/**
 * Render a message template to a discord.js-ready payload.
 * @param {object} template - the embed template (see module docs)
 * @param {object} [ctx] - { user: { id, displayName } }
 * @returns {{ embeds: EmbedBuilder[], allowedMentions: object, content?: string }}
 */
function renderMessage(template, ctx = {}) {
	const t = template && typeof template === 'object' ? template : {};
	const embed = new EmbedBuilder();

	try {
		embed.setColor(t.color != null ? t.color : 'Green');
	} catch {
		embed.setColor('Green');
	}
	if (t.title) embed.setTitle(renderTokens(t.title, ctx));
	if (t.description) embed.setDescription(renderTokens(t.description, ctx));
	if (t.thumbnail) {
		const url = renderTokens(t.thumbnail, ctx);
		if (url) embed.setThumbnail(url);
	}
	if (t.image) {
		const url = renderTokens(t.image, ctx);
		if (url) embed.setImage(url);
	}
	if (t.footer) embed.setFooter({ text: renderTokens(t.footer, ctx) });
	if (t.timestamp) embed.setTimestamp();

	// Explicit allow-list: never @everyone/@here, never blanket role pings. Only the
	// invoking user may be pinged (and only if {{user}} placed their mention in content).
	const allowedMentions = {
		parse: [],
		roles: [],
		users: ctx.user && ctx.user.id ? [ctx.user.id] : []
	};

	const out = { embeds: [embed], allowedMentions };
	if (t.content) out.content = renderTokens(t.content, ctx);
	return out;
}

module.exports = { renderMessage, renderTokens };
