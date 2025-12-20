const sharp = require('sharp');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../db/tile_event');

// Configure sharp for low memory usage
sharp.cache(false); // Disable caching to save memory
sharp.concurrency(1); // Process one image at a time
sharp.simd(false); // Disable SIMD to reduce memory overhead

const BOARD_IMAGE_PATH = path.join(__dirname, '../tile-board.png');
const COORDINATES_PATH = path.join(__dirname, '../tile-board-coordinates.json');
const TEMP_DIR = path.join(__dirname, '../temp');
const OUTPUT_PATH = path.join(TEMP_DIR, 'board-output.png');

// Ensure temp directory exists
if (!fsSync.existsSync(TEMP_DIR)) {
    fsSync.mkdirSync(TEMP_DIR, { recursive: true });
    console.log('[TileBoard] Created temp directory at', TEMP_DIR);
}

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
            await this.loadCoordinates();

            // Get all teams and their positions
            const teams = await tileEventDb.getAllTeams();
            console.log('[TileBoard] Generating board for', teams.length, 'teams');

            // Process image from file path directly to save memory
            console.log('[TileBoard] Loading base image metadata...');
            const metadata = await sharp(BOARD_IMAGE_PATH).metadata();

            // Aggressive scaling for 512MB with limited available memory
            const SCALE = 0.5; // 50% scale - reduces memory by 75%
            const scaledWidth = Math.round(metadata.width * SCALE);
            const scaledHeight = Math.round(metadata.height * SCALE);

            console.log(`[TileBoard] Scaling from ${metadata.width}x${metadata.height} to ${scaledWidth}x${scaledHeight}`);

            // Create SVG overlay with team markers (using scaled dimensions)
            const svgOverlay = this.createSVGOverlay(teams, scaledWidth, scaledHeight);

            // Composite the overlay onto the base image
            console.log('[TileBoard] Compositing SVG overlay onto base image...');
            await sharp(BOARD_IMAGE_PATH, {
                limitInputPixels: false,
                sequentialRead: true // Memory optimization
            })
                .resize(scaledWidth, scaledHeight, {
                    kernel: 'lanczos3' // Good quality downscaling
                })
                .composite([{
                    input: Buffer.from(svgOverlay),
                    top: 0,
                    left: 0
                }])
                .png({
                    quality: 90,
                    compressionLevel: 9,
                    adaptiveFiltering: true
                })
                .toFile(OUTPUT_PATH);

            console.log('[TileBoard] ✅ Board image generated at', OUTPUT_PATH);

            return OUTPUT_PATH;
        } catch (error) {
            console.error('[TileBoard] Error generating board image:', error);
            throw error;
        }
    }

    createSVGOverlay(teams, width, height) {
        let markers = '';

        // Calculate scale factor based on original coordinates (2246x2439)
        const ORIGINAL_WIDTH = 2246;
        const ORIGINAL_HEIGHT = 2439;
        const scaleX = width / ORIGINAL_WIDTH;
        const scaleY = height / ORIGINAL_HEIGHT;

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
            const spacing = 70 * scaleX; // Horizontal spacing between markers (scaled)

            teamsOnTile.forEach((team, index) => {
                // Center the markers if multiple teams
                const offsetX = teamCount > 1
                    ? (index - (teamCount - 1) / 2) * spacing
                    : 0;

                // Scale coordinates to match resized image
                const x = coord.x * scaleX + offsetX;
                const y = coord.y * scaleY;

                const color = this.getTeamColor(team.team_name);
                const initial = this.getTeamInitial(team.team_name);

                // Escape special characters in team name for SVG
                const escapedTeamName = team.team_name
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&apos;');

                // Scale all marker elements proportionally
                const markerRadius = 30 * scaleX;
                const shadowOffset = 4 * scaleY;
                const highlightOffset = 10 * scaleX;
                const fontSize = 32 * scaleX;
                const strokeWidth = 4 * scaleX;
                const labelFontSize = 16 * scaleX;
                const labelStrokeWidth = 1 * scaleX;

                // Draw shadow for depth (scaled)
                markers += `<circle cx="${x}" cy="${y + shadowOffset}" r="${markerRadius + 5 * scaleX}" fill="#000000" opacity="0.4"/>`;

                // Draw outer glow (scaled)
                markers += `<circle cx="${x}" cy="${y}" r="${markerRadius + 8 * scaleX}" fill="${color}" opacity="0.5"/>`;

                // Draw middle glow ring (scaled)
                markers += `<circle cx="${x}" cy="${y}" r="${markerRadius + 4 * scaleX}" fill="${color}" opacity="0.7"/>`;

                // Draw main circle (scaled)
                markers += `<circle cx="${x}" cy="${y}" r="${markerRadius}" fill="${color}" stroke="#FFFFFF" stroke-width="${strokeWidth}"/>`;

                // Draw inner highlight (scaled)
                markers += `<circle cx="${x - highlightOffset}" cy="${y - highlightOffset}" r="${8 * scaleX}" fill="#FFFFFF" opacity="0.6"/>`;

                // Draw team initial (scaled) - using dominant-baseline for better positioning
                markers += `<text x="${x}" y="${y}" font-size="${fontSize}" font-weight="bold" font-family="Arial, sans-serif" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central" stroke="#000000" stroke-width="${strokeWidth * 0.5}" paint-order="stroke">${initial}</text>`;

                // Draw team name label above (scaled)
                const labelY = y - 55 * scaleY;
                const teamNameWidth = Math.max(team.team_name.length * 10 * scaleX, 80 * scaleX);
                const labelHeight = 28 * scaleY;

                // Team name background (scaled)
                markers += `<rect x="${x - teamNameWidth/2}" y="${labelY - labelHeight/2}" width="${teamNameWidth}" height="${labelHeight}" rx="${6 * scaleX}" fill="${color}" opacity="0.95" stroke="#FFFFFF" stroke-width="${strokeWidth * 0.5}"/>`;

                // Team name text (scaled) - better baseline and no stroke issues
                markers += `<text x="${x}" y="${labelY}" font-size="${labelFontSize}" font-weight="bold" font-family="Arial, Helvetica, sans-serif" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${escapedTeamName}</text>`;
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
            console.log('[TileBoard] Channel ID:', channelId);
            console.log('[TileBoard] Message ID:', messageId);

            // Generate the board image
            const imagePath = await this.generateBoardImage();
            console.log('[TileBoard] Image generated successfully, fetching channel...');

            // Get the channel
            const channel = await client.channels.fetch(channelId);
            console.log('[TileBoard] Channel fetched:', channel?.name);
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

                    // Clean up temp file after successful upload
                    try {
                        await fs.unlink(imagePath);
                        console.log('[TileBoard] Temp file cleaned up');
                    } catch (cleanupError) {
                        console.warn('[TileBoard] Failed to cleanup temp file:', cleanupError.message);
                    }

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

            // Clean up temp file after successful upload
            try {
                await fs.unlink(imagePath);
                console.log('[TileBoard] Temp file cleaned up');
            } catch (cleanupError) {
                console.warn('[TileBoard] Failed to cleanup temp file:', cleanupError.message);
            }

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
