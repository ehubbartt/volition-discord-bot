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

        // Sort teams by current_tile (descending) so leading teams are drawn last (on top)
        const sortedTeams = [...teams].sort((a, b) => b.current_tile - a.current_tile);

        for (const team of sortedTeams) {
            const tile = team.current_tile;
            const coord = this.coordinates[tile];

            if (!coord) {
                console.warn(`[TileBoard] No coordinates found for tile ${tile}`);
                continue;
            }

            const color = this.getTeamColor(team.team_name);
            const initial = this.getTeamInitial(team.team_name);

            // Draw shadow for depth
            markers += `<circle cx="${coord.x}" cy="${coord.y + 3}" r="28" fill="#00000040" opacity="0.5"/>`;

            // Draw outer ring (glow effect)
            markers += `<circle cx="${coord.x}" cy="${coord.y}" r="32" fill="${color}" opacity="0.3"/>`;

            // Draw main circle
            markers += `<circle cx="${coord.x}" cy="${coord.y}" r="26" fill="${color}" stroke="#FFFFFF" stroke-width="3"/>`;

            // Draw inner highlight
            markers += `<circle cx="${coord.x - 8}" cy="${coord.y - 8}" r="6" fill="#FFFFFF" opacity="0.4"/>`;

            // Draw team initial
            markers += `<text x="${coord.x}" y="${coord.y + 10}" font-size="28" font-weight="bold" font-family="Arial, sans-serif" fill="#FFFFFF" text-anchor="middle" stroke="#000000" stroke-width="1" paint-order="stroke">${initial}</text>`;

            // Draw tile number label above
            const labelY = coord.y - 45;
            const labelWidth = 60;
            const labelHeight = 24;

            // Label background
            markers += `<rect x="${coord.x - labelWidth/2}" y="${labelY - labelHeight/2}" width="${labelWidth}" height="${labelHeight}" rx="4" fill="#000000" opacity="0.8"/>`;

            // Label text
            markers += `<text x="${coord.x}" y="${labelY + 6}" font-size="14" font-weight="bold" font-family="Arial, sans-serif" fill="${color}" text-anchor="middle">Tile ${tile}</text>`;
        }

        return `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <filter id="shadow">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
                        <feOffset dx="0" dy="2" result="offsetblur"/>
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

            // Create attachment and embed
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
                const color = this.getTeamColor(team.team_name);
                standingsText += `${medal} **${team.team_name}** - Tile ${team.current_tile}/40\n`;
            });

            const embed = new EmbedBuilder()
                .setTitle('🏁 Tile Event - Live Board')
                .setDescription('Team positions update automatically when teams move')
                .setImage('attachment://tile-board.png')
                .addFields({
                    name: '📊 Current Standings',
                    value: standingsText || 'No teams yet',
                    inline: false
                })
                .setColor('#7289da')
                .setTimestamp()
                .setFooter({ text: 'Last updated' });

            if (messageId) {
                // Update existing message
                try {
                    const message = await channel.messages.fetch(messageId);
                    await message.edit({ embeds: [embed], files: [attachment] });
                    console.log('[TileBoard] Board updated successfully');
                    return messageId;
                } catch (error) {
                    console.error('[TileBoard] Failed to fetch/edit message, creating new one:', error.message);
                    // Fall through to create new message
                }
            }

            // Send new message
            const message = await channel.send({ embeds: [embed], files: [attachment] });
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
