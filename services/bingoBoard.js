const sharp = require('sharp');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const bingoDb = require('../db/bingo_event');
const bingoTiles = require('../config/bingoTiles.json');

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

const BOARD_IMAGE_PATH = path.join(__dirname, '../Anti-Bingo_Board.png');
const COORDINATES_PATH = path.join(__dirname, '../config/bingoBoardCoordinates.json');
const TEMP_DIR = path.join(__dirname, '../temp');
const OUTPUT_PATH = path.join(TEMP_DIR, 'bingo-board-output.png');

if (!fsSync.existsSync(TEMP_DIR)) {
    fsSync.mkdirSync(TEMP_DIR, { recursive: true });
}

// Team colors for the numbered circles
const TEAM_COLORS = {
    1: '#FF4444', // Red
    2: '#4488FF', // Blue
    3: '#44CC44', // Green
    4: '#FFCC00', // Yellow
    5: '#CC44CC'  // Purple
};

class BingoBoardService {
    constructor() {
        this.coordinates = null;
    }

    async loadCoordinates() {
        if (!this.coordinates) {
            const data = await fs.readFile(COORDINATES_PATH, 'utf-8');
            this.coordinates = JSON.parse(data);
            console.log('[BingoBoard] Loaded coordinates for', Object.keys(this.coordinates).length, 'tiles');
        }
        return this.coordinates;
    }

    async generateBoardImage() {
        try {
            await this.loadCoordinates();

            const teams = await bingoDb.getAllTeams();
            const allProgress = await bingoDb.getAllTeamsProgress();
            console.log('[BingoBoard] Generating board for', teams.length, 'teams');

            // Build a lookup: { teamId: Set of completed tile numbers }
            const completedByTeam = {};
            for (const team of teams) {
                completedByTeam[team.id] = new Set();
            }
            for (const p of allProgress) {
                if (p.is_completed) {
                    if (!completedByTeam[p.team_id]) completedByTeam[p.team_id] = new Set();
                    completedByTeam[p.team_id].add(p.tile_number);
                }
            }

            const compositeOps = [];
            const circleSize = 32;
            const spacing = 36;

            // For each tile, draw completion markers for teams that completed it
            for (const tile of bingoTiles) {
                const coord = this.coordinates[String(tile.tile_number)];
                if (!coord) {
                    console.warn(`[BingoBoard] No coordinates for tile ${tile.tile_number}`);
                    continue;
                }

                // Sort teams by id so markers are always in consistent order
                const sortedTeams = [...teams].sort((a, b) => a.id - b.id);
                const completedTeams = sortedTeams.filter(t => completedByTeam[t.id]?.has(tile.tile_number));

                if (completedTeams.length === 0) continue;

                // Position markers in a row below the tile coordinate
                const totalWidth = completedTeams.length * spacing;
                const startX = coord.x - totalWidth / 2 + spacing / 2;

                for (let i = 0; i < completedTeams.length; i++) {
                    const team = completedTeams[i];
                    const teamIndex = sortedTeams.indexOf(team) + 1;
                    const color = TEAM_COLORS[teamIndex] || '#888888';
                    const x = Math.round(startX + i * spacing);
                    const y = coord.y + 30; // Below the tile coordinate

                    const svg = `
                        <svg width="${circleSize}" height="${circleSize}" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="${circleSize / 2}" cy="${circleSize / 2}" r="${circleSize / 2 - 2}" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>
                            <text x="${circleSize / 2}" y="${circleSize / 2 + 6}" font-size="18" font-weight="bold" font-family="Liberation Sans, sans-serif" fill="#FFFFFF" text-anchor="middle" stroke="#000000" stroke-width="1" paint-order="stroke">${teamIndex}</text>
                        </svg>
                    `;

                    compositeOps.push({
                        input: Buffer.from(svg),
                        left: Math.round(x - circleSize / 2),
                        top: Math.round(y - circleSize / 2)
                    });
                }
            }

            console.log('[BingoBoard] Compositing', compositeOps.length, 'markers onto base image...');

            const sharpInstance = sharp(BOARD_IMAGE_PATH, {
                limitInputPixels: false,
                sequentialRead: true
            });

            if (compositeOps.length > 0) {
                sharpInstance.composite(compositeOps);
            }

            await sharpInstance
                .png({ quality: 90, compressionLevel: 9, adaptiveFiltering: true })
                .toFile(OUTPUT_PATH);

            console.log('[BingoBoard] Board image generated at', OUTPUT_PATH);
            return OUTPUT_PATH;
        } catch (error) {
            console.error('[BingoBoard] Error generating board image:', error);
            throw error;
        }
    }

    async updateDiscordBoard(client, channelId, messageId = null) {
        try {
            console.log('[BingoBoard] Updating Discord board...');

            const imagePath = await this.generateBoardImage();
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                console.error('[BingoBoard] Board channel not found:', channelId);
                return null;
            }

            const attachment = new AttachmentBuilder(imagePath, { name: 'bingo-board.png' });

            // Build standings embed
            const teams = await bingoDb.getAllTeams();
            const sortedTeams = [...teams].sort((a, b) => {
                if (a.completed_tiles_count !== b.completed_tiles_count) {
                    return b.completed_tiles_count - a.completed_tiles_count;
                }
                // Tiebreaker: who completed their most recent tile first
                const aTime = a.completed_at ? new Date(a.completed_at).getTime() : Infinity;
                const bTime = b.completed_at ? new Date(b.completed_at).getTime() : Infinity;
                return aTime - bTime;
            });

            let standingsText = '';
            sortedTeams.forEach((team, index) => {
                const pos = index + 1;
                const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}.`;
                const displayName = team.long_name || team.team_name;
                standingsText += `${medal} **${displayName}** - ${team.completed_tiles_count}/${bingoDb.TOTAL_TILES} tiles\n`;
            });

            const embed = new EmbedBuilder()
                .setTitle('Bingo Event - Standings')
                .setDescription(standingsText || 'No teams yet')
                .setColor('#7289da')
                .setTimestamp();

            if (messageId) {
                try {
                    const message = await channel.messages.fetch(messageId);
                    await message.edit({
                        content: '**Anti-Bingo Event - Live Board**',
                        files: [attachment],
                        embeds: [embed]
                    });
                    console.log('[BingoBoard] Board updated successfully');

                    try { await fs.unlink(imagePath); } catch {}
                    return messageId;
                } catch (error) {
                    console.error('[BingoBoard] Failed to edit message, creating new:', error.message);
                }
            }

            const message = await channel.send({
                content: '**Anti-Bingo Event - Live Board**',
                files: [attachment],
                embeds: [embed]
            });
            console.log('[BingoBoard] New board message created:', message.id);

            try { await fs.unlink(imagePath); } catch {}
            return message.id;
        } catch (error) {
            console.error('[BingoBoard] Error updating Discord board:', error);
            throw error;
        }
    }

    clearCache() {
        this.coordinates = null;
        console.log('[BingoBoard] Cache cleared');
    }
}

module.exports = new BingoBoardService();
