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
const IMG_DIR = path.join(__dirname, '../img');

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

            // Process image at full resolution (1GB memory allows this)
            console.log('[TileBoard] Loading base image metadata...');
            const metadata = await sharp(BOARD_IMAGE_PATH).metadata();
            console.log(`[TileBoard] Processing at full resolution: ${metadata.width}x${metadata.height}`);

            // Group teams by tile to handle multiple teams on same tile
            const teamsByTile = {};
            for (const team of teams) {
                const tile = team.current_tile;
                if (!teamsByTile[tile]) {
                    teamsByTile[tile] = [];
                }
                teamsByTile[tile].push(team);
            }

            // Build composite operations for team images
            const compositeOps = [];
            const markerSize = 70; // Size of team marker images
            const spacing = 40; // Horizontal spacing - teams will overlap slightly

            // Sort tiles by ascending order so leading teams are drawn last (on top)
            const sortedTiles = Object.keys(teamsByTile).sort((a, b) => a - b);

            for (const tile of sortedTiles) {
                const teamsOnTile = teamsByTile[tile];
                const coord = this.coordinates[tile];

                if (!coord) {
                    console.warn(`[TileBoard] No coordinates found for tile ${tile}`);
                    continue;
                }

                const teamCount = teamsOnTile.length;

                for (let index = 0; index < teamsOnTile.length; index++) {
                    const team = teamsOnTile[index];

                    // Calculate horizontal offset for multiple teams on same tile
                    // Teams will overlap slightly with smaller spacing
                    const offsetX = teamCount > 1
                        ? (index - (teamCount - 1) / 2) * spacing
                        : 0;

                    const x = Math.round(coord.x + offsetX - markerSize / 2);
                    const y = Math.round(coord.y - markerSize / 2);

                    // Check if team has a custom image
                    // Convert to lowercase since Linux is case-sensitive and DB might have mixed case
                    const teamImage = team.team_image ? team.team_image.toLowerCase() : null;
                    console.log(`[TileBoard] Team ${team.team_name} team_image value: "${teamImage}"`);
                    if (teamImage) {
                        const imagePath = path.join(IMG_DIR, teamImage);
                        console.log(`[TileBoard] Looking for image at: ${imagePath}`);
                        if (fsSync.existsSync(imagePath)) {
                            // Resize team image to marker size
                            const resizedImage = await sharp(imagePath)
                                .resize(markerSize, markerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                                .toBuffer();

                            compositeOps.push({
                                input: resizedImage,
                                left: x,
                                top: y
                            });
                            console.log(`[TileBoard] Added image marker for ${team.team_name} at tile ${tile}`);
                        } else {
                            console.warn(`[TileBoard] Image not found for ${team.team_name}: ${imagePath}`);
                            // Fall back to SVG marker
                            compositeOps.push(this.createFallbackMarker(team, coord.x + offsetX, coord.y, markerSize));
                        }
                    } else {
                        // Use SVG fallback marker if no image configured
                        compositeOps.push(this.createFallbackMarker(team, coord.x + offsetX, coord.y, markerSize));
                    }

                    // Add team name label (positioned above the marker)
                    const labelOp = this.createTeamLabel(team, coord.x + offsetX, coord.y - markerSize / 2 - 15);
                    compositeOps.push(labelOp);
                }
            }

            // Composite all team markers onto the base image
            console.log('[TileBoard] Compositing', compositeOps.length, 'elements onto base image...');
            await sharp(BOARD_IMAGE_PATH, {
                limitInputPixels: false,
                sequentialRead: true
            })
                .composite(compositeOps)
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

    createFallbackMarker(team, x, y, size) {
        const color = this.getTeamColor(team.team_name);
        const initial = this.getTeamInitial(team.short_name || team.team_name);
        const radius = size / 2;

        const svg = `
            <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
                <circle cx="${radius}" cy="${radius}" r="${radius - 2}" fill="${color}" stroke="#FFFFFF" stroke-width="3"/>
                <text x="${radius}" y="${radius + 10}" font-size="32" font-weight="bold" font-family="Liberation Sans, sans-serif" fill="#FFFFFF" text-anchor="middle" stroke="#000000" stroke-width="1.5" paint-order="stroke">${initial}</text>
            </svg>
        `;

        return {
            input: Buffer.from(svg),
            left: Math.round(x - radius),
            top: Math.round(y - radius)
        };
    }

    createTeamLabel(team, x, y) {
        const displayName = team.short_name || team.team_name;
        const color = this.getTeamColor(team.team_name);
        const escapedName = displayName
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const labelWidth = Math.max(displayName.length * 12, 80);
        const labelHeight = 28;

        // Create a compact SVG with the label centered in its own coordinate space
        const svg = `
            <svg width="${labelWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="${labelWidth}" height="${labelHeight}" rx="6" fill="${color}" opacity="0.95" stroke="#FFFFFF" stroke-width="2"/>
                <text x="${labelWidth / 2}" y="${labelHeight / 2 + 6}" font-size="16" font-weight="bold" font-family="Liberation Sans, sans-serif" fill="#FFFFFF" text-anchor="middle">${escapedName}</text>
            </svg>
        `;

        return {
            input: Buffer.from(svg),
            left: Math.round(x - labelWidth / 2),
            top: Math.round(y - labelHeight / 2)
        };
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

            // Create standings text (use long_name for display, fallback to team_name)
            let standingsText = '';
            sortedTeams.forEach((team, index) => {
                const position = index + 1;
                const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `${position}.`;
                const displayName = team.long_name || team.team_name;
                standingsText += `${medal} **${displayName}** - Tile ${team.current_tile}/40\n`;
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
