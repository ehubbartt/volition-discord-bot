const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../db/tile_event');

const BOARD_IMAGE_PATH = path.join(__dirname, '../tile-board.png');
const COORDINATES_PATH = path.join(__dirname, '../tile-board-coordinates.json');
const OUTPUT_PATH = path.join(__dirname, '../temp/board-output.png');

class TileBoardService {
    constructor() {
        this.coordinates = null;
        this.baseImageBuffer = null;
        this.teamColors = {
            'Red Team': '#FF0000',
            'Blue Team': '#0000FF',
            'Green Team': '#00FF00',
            'Yellow Team': '#FFFF00',
            'Purple Team': '#800080',
            'Orange Team': '#FFA500',
            'Pink Team': '#FFC0CB',
            'Cyan Team': '#00FFFF'
        };
    }

    async loadCoordinates() {
        if (!this.coordinates) {
            const data = await fs.readFile(COORDINATES_PATH, 'utf-8');
            this.coordinates = JSON.parse(data);
            console.log('[TileBoard] Loaded coordinates for', Object.keys(this.coordinates).length, 'tiles');
        }
        return this.coordinates;
    }

    async getBaseImage() {
        if (!this.baseImageBuffer) {
            this.baseImageBuffer = await fs.readFile(BOARD_IMAGE_PATH);
            console.log('[TileBoard] Base image loaded');
        }
        return this.baseImageBuffer;
    }

    getTeamColor(teamName) {
        return this.teamColors[teamName] || '#808080';
    }

    getTeamInitial(teamName) {
        return teamName.charAt(0).toUpperCase();
    }

    async generateBoardImage() {
        try {
            // Load base image and coordinates
            const baseImage = await this.getBaseImage();
            await this.loadCoordinates();

            // Get all teams and their positions
            const teams = await tileEventDb.getAllTeams();
            console.log('[TileBoard] Generating board for', teams.length, 'teams');

            // Get base image metadata
            const metadata = await sharp(baseImage).metadata();

            // Create SVG overlay with team markers
            const svgOverlay = this.createSVGOverlay(teams, metadata.width, metadata.height);

            // Composite the overlay onto the base image
            const outputBuffer = await sharp(baseImage)
                .composite([{
                    input: Buffer.from(svgOverlay),
                    top: 0,
                    left: 0
                }])
                .png()
                .toBuffer();

            // Save to temp file
            await fs.writeFile(OUTPUT_PATH, outputBuffer);
            console.log('[TileBoard] Board image generated at', OUTPUT_PATH);

            return OUTPUT_PATH;
        } catch (error) {
            console.error('[TileBoard] Error generating board image:', error);
            throw error;
        }
    }

    createSVGOverlay(teams, width, height) {
        let markers = '';

        // Group teams by tile to handle multiple teams on same tile
        const teamsByTile = {};
        for (const team of teams) {
            const tile = team.current_tile;
            if (!teamsByTile[tile]) {
                teamsByTile[tile] = [];
            }
            teamsByTile[tile].push(team);
        }

        // Sort tiles by descending order so leading teams are drawn last (on top)
        const sortedTiles = Object.keys(teamsByTile).sort((a, b) => b - a);

        for (const tile of sortedTiles) {
            const teamsOnTile = teamsByTile[tile];
            const coord = this.coordinates[tile];

            if (!coord) {
                console.warn(`[TileBoard] No coordinates found for tile ${tile}`);
                continue;
            }

            // Calculate horizontal offset for multiple teams on same tile
            const teamCount = teamsOnTile.length;
            const spacing = 70; // Horizontal spacing between markers

            teamsOnTile.forEach((team, index) => {
                // Center the markers if multiple teams
                const offsetX = teamCount > 1
                    ? (index - (teamCount - 1) / 2) * spacing
                    : 0;

                const x = coord.x + offsetX;
                const y = coord.y;

                const color = this.getTeamColor(team.team_name);
                const initial = this.getTeamInitial(team.team_name);

                // Draw shadow for depth (larger and more visible)
                markers += `<circle cx="${x}" cy="${y + 4}" r="35" fill="#000000" opacity="0.4"/>`;

                // Draw outer glow (brighter and larger)
                markers += `<circle cx="${x}" cy="${y}" r="38" fill="${color}" opacity="0.5"/>`;

                // Draw middle glow ring
                markers += `<circle cx="${x}" cy="${y}" r="34" fill="${color}" opacity="0.7"/>`;

                // Draw main circle (brighter, larger)
                markers += `<circle cx="${x}" cy="${y}" r="30" fill="${color}" stroke="#FFFFFF" stroke-width="4"/>`;

                // Draw inner highlight (more prominent)
                markers += `<circle cx="${x - 10}" cy="${y - 10}" r="8" fill="#FFFFFF" opacity="0.6"/>`;

                // Draw team initial (larger, bolder)
                markers += `<text x="${x}" y="${y + 12}" font-size="32" font-weight="bold" font-family="Arial, sans-serif" fill="#FFFFFF" text-anchor="middle" stroke="#000000" stroke-width="2" paint-order="stroke">${initial}</text>`;

                // Draw team name label above (instead of tile number)
                const labelY = y - 55;
                const teamNameWidth = Math.max(team.team_name.length * 10, 80);
                const labelHeight = 28;

                // Team name background (brighter)
                markers += `<rect x="${x - teamNameWidth/2}" y="${labelY - labelHeight/2}" width="${teamNameWidth}" height="${labelHeight}" rx="6" fill="${color}" opacity="0.95" stroke="#FFFFFF" stroke-width="2"/>`;

                // Team name text (white for contrast)
                markers += `<text x="${x}" y="${labelY + 8}" font-size="16" font-weight="bold" font-family="Arial, sans-serif" fill="#FFFFFF" text-anchor="middle" stroke="#000000" stroke-width="1" paint-order="stroke">${team.team_name}</text>`;
            });
        }

        return `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <filter id="glow">
                        <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    <filter id="shadow">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
                        <feOffset dx="0" dy="3" result="offsetblur"/>
                        <feMerge>
                            <feMergeNode/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                ${markers}
            </svg>
        `;
    }

    async updateDiscordBoard(client, channelId, messageId = null) {
        try {
            console.log('[TileBoard] Updating Discord board...');

            // Generate the board image
            const imagePath = await this.generateBoardImage();

            // Get the channel
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                console.error('[TileBoard] Board channel not found:', channelId);
                return null;
            }

            // Create attachment for the large board image
            const attachment = new AttachmentBuilder(imagePath, { name: 'tile-board.png' });

            // Get team standings for embed
            const teams = await tileEventDb.getAllTeams();
            const sortedTeams = [...teams].sort((a, b) => {
                if (a.current_tile !== b.current_tile) {
                    return b.current_tile - a.current_tile;
                }
                return 0;
            });

            // Create standings text
            let standingsText = '';
            sortedTeams.forEach((team, index) => {
                const position = index + 1;
                const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `${position}.`;
                standingsText += `${medal} **${team.team_name}** - Tile ${team.current_tile}/40\n`;
            });

            // Create leaderboard embed (separate from image)
            const leaderboardEmbed = new EmbedBuilder()
                .setTitle('📊 Current Standings')
                .setDescription(standingsText || 'No teams yet')
                .setColor('#7289da')
                .setTimestamp();

            if (messageId) {
                // Update existing message
                try {
                    console.log('[TileBoard] Fetching existing message:', messageId);
                    const message = await channel.messages.fetch(messageId);
                    console.log('[TileBoard] Message fetched, editing...');
                    // Send image standalone (larger display), then embed below
                    await message.edit({
                        content: '🏁 **Tile Event - Live Board**',
                        files: [attachment],
                        embeds: [leaderboardEmbed]
                    });
                    console.log('[TileBoard] ✅ Board updated successfully');
                    return messageId;
                } catch (error) {
                    console.error('[TileBoard] Failed to fetch/edit message:', error.message);
                    console.error('[TileBoard] Error details:', error);
                    console.error('[TileBoard] Creating new message instead...');
                    // Fall through to create new message
                }
            }

            // Send new message with image and leaderboard separate
            const message = await channel.send({
                content: '🏁 **Tile Event - Live Board**',
                files: [attachment],
                embeds: [leaderboardEmbed]
            });
            console.log('[TileBoard] New board message created:', message.id);
            return message.id;

        } catch (error) {
            console.error('[TileBoard] Error updating Discord board:', error);
            throw error;
        }
    }

    // Clear cached data (useful for development/testing)
    clearCache() {
        this.coordinates = null;
        this.baseImageBuffer = null;
        console.log('[TileBoard] Cache cleared');
    }
}

module.exports = new TileBoardService();
