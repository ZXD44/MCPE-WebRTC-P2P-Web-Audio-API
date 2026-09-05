/**
 * ====================================================================
 *   MINECRAFT BEDROCK PROXIMITY VOICE CHAT SERVER (v2.0 PRODUCTION)
 *   - Single Port Upgrade Multiplexing (HTTP + /connect WS + Socket.io)
 *   - Vanilla Bedrock /connect WebSocket Telemetry Ingestion
 *   - Bedrock Script API HTTP Telemetry Relay (/api/telemetry)
 *   - WebRTC Signaling Relay & Spatial Culling Broadcast (20Hz)
 *   - Cross-Platform: Android (Capacitor/Web), iOS (Safari/App), PC
 *   Author: ZirconX
 * ====================================================================
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// Directories
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const WEB_CLIENT_DIR = path.join(__dirname, '..', 'web_client');

const app = express();
app.use(express.json());

// CORS headers for all REST requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Serve Static Web Client (check public/ first, fallback to web_client/)
if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
}
if (fs.existsSync(WEB_CLIENT_DIR)) {
    app.use(express.static(WEB_CLIENT_DIR));
}

// -------------------------------------------------------------
// State Management
// -------------------------------------------------------------

// Active Web/Mobile Clients connected via Socket.io
// socketId -> { socketId, gamertag, platform, voiceMode, maxDistance, radioChannel, radioPtt }
const voiceClients = new Map();

// Online Bedrock Players Spatial Telemetry
// lowercase(gamertag) -> { name, pos: {x,y,z}, yaw, dimension, voiceMode, maxDistance, lastSeen, source }
const playerTelemetry = new Map();

// Active Bedrock /connect WebSocket Sockets
// ws -> { subscribed, gamertags: Set<string> }
const bedrockSockets = new Set();

// -------------------------------------------------------------
// REST Endpoints
// -------------------------------------------------------------

// Health check & Server Status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        serverVersion: '2.0.0',
        activeVoiceClients: voiceClients.size,
        activeBedrockPlayers: playerTelemetry.size,
        bedrockSocketsConnected: bedrockSockets.size,
        uptimeSeconds: Math.floor(process.uptime())
    });
});

// Active online players list for frontend chips / auto-complete
app.get('/api/players', (req, res) => {
    const now = Date.now();
    const active = [];
    for (const [key, p] of playerTelemetry.entries()) {
        if (now - p.lastSeen < 20000) { // Active within 20s
            active.push({
                name: p.name,
                dimension: p.dimension,
                voiceMode: p.voiceMode || 'normal',
                pos: p.pos
            });
        }
    }
    res.json({ players: active });
});

// Backwards compatibility: BDS Script API Telemetry Upload
app.post('/api/telemetry', (req, res) => {
    const body = req.body;
    if (!body || !body.playerName) {
        return res.status(400).json({ error: 'Missing playerName' });
    }

    const gamertag = body.playerName.trim();
    const key = gamertag.toLowerCase();

    // Map dimension name to numeric (0: Overworld, 1: Nether, 2: The End)
    let dimNum = 0;
    if (typeof body.dimension === 'string') {
        if (body.dimension.includes('nether')) dimNum = 1;
        else if (body.dimension.includes('the_end')) dimNum = 2;
    } else if (typeof body.dimension === 'number') {
        dimNum = body.dimension;
    }

    playerTelemetry.set(key, {
        name: gamertag,
        pos: body.pos || { x: 0, y: 64, z: 0 },
        yaw: body.view ? Math.atan2(body.view.x, body.view.z) * (180 / Math.PI) : 0,
        dimension: dimNum,
        voiceMode: body.voiceMode || 'normal',
        maxDistance: body.maxDistance || 25,
        lastSeen: Date.now(),
        source: 'script_api',
        occlusions: body.occlusions || {}
    });

    res.json({ success: true });
});

// -------------------------------------------------------------
// Create HTTP Server & Multiplex Upgrades
// -------------------------------------------------------------
const server = http.createServer(app);

// Socket.io for Web & Mobile Clients (on /socket.io/)
const io = new SocketIOServer(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
});

// Native WebSocket Server for Minecraft Bedrock /connect command
const bedrockWss = new WebSocketServer({ noServer: true });

// Multiplex HTTP Upgrade Requests
server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? request.url.split('?')[0] : '/';

    // Socket.io handles its own requests under /socket.io/
    if (pathname.startsWith('/socket.io')) {
        return; // Handled automatically by socket.io
    }

    // All other WebSocket upgrades routed to Minecraft Bedrock /connect handler
    bedrockWss.handleUpgrade(request, socket, head, (ws) => {
        bedrockWss.emit('connection', ws, request);
    });
});

// -------------------------------------------------------------
// Minecraft Bedrock /connect Protocol Implementation
// -------------------------------------------------------------
bedrockWss.on('connection', (ws, req) => {
    console.log(`[Bedrock /connect] Client connected from ${req.socket.remoteAddress}`);
    bedrockSockets.add(ws);

    // Subscribe to PlayerTravelled event
    const subscribePacket = {
        header: {
            version: 1,
            requestId: crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}`,
            messagePurpose: 'subscribe',
            messageType: 'commandRequest'
        },
        body: {
            eventName: 'PlayerTravelled'
        }
    };

    try {
        ws.send(JSON.stringify(subscribePacket));
    } catch (err) {
        console.error('[Bedrock /connect] Failed to send subscribe packet:', err.message);
    }

    // Send friendly welcome message into in-game chat
    sendBedrockCommand(ws, `tellraw @s {"rawtext":[{"text":"§a[Proximity Voice] §eเชื่อมต่อเซิร์ฟเวอร์สำเร็จ! §bระบบจำลองเสียง 3D เปิดทำงานแล้ว"}]}`);

    ws.on('message', (message) => {
        try {
            const raw = message.toString();
            const data = JSON.parse(raw);

            // Handle incoming event
            if (data.header && data.header.eventName === 'PlayerTravelled') {
                const body = data.body || {};
                const player = body.player || body;
                const gamertag = player.name || body.name;

                if (gamertag) {
                    const pos = player.position || body.position || { x: 0, y: 64, z: 0 };
                    const yaw = player.yRot ?? body.yRot ?? 0;
                    const dim = player.dimension ?? body.dimension ?? 0;

                    const key = gamertag.toLowerCase();
                    const existing = playerTelemetry.get(key);

                    playerTelemetry.set(key, {
                        name: gamertag,
                        pos: {
                            x: Number(pos.x.toFixed(2)),
                            y: Number(pos.y.toFixed(2)),
                            z: Number(pos.z.toFixed(2))
                        },
                        yaw: Number(yaw.toFixed(2)),
                        dimension: dim,
                        voiceMode: existing?.voiceMode || 'normal',
                        maxDistance: existing?.maxDistance || 25,
                        lastSeen: Date.now(),
                        source: 'bedrock_connect',
                        occlusions: existing?.occlusions || {}
                    });
                }
            }
        } catch (err) {
            // Ignore malformed packets from game engine
        }
    });

    ws.on('close', () => {
        console.log('[Bedrock /connect] Client disconnected');
        bedrockSockets.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('[Bedrock /connect] Socket error:', err.message);
        bedrockSockets.delete(ws);
    });
});

function sendBedrockCommand(ws, commandLine) {
    if (ws.readyState !== 1) return;
    try {
        const cmdPacket = {
            header: {
                version: 1,
                requestId: crypto.randomUUID ? crypto.randomUUID() : `cmd_${Date.now()}`,
                messagePurpose: 'commandRequest',
                messageType: 'commandRequest'
            },
            body: {
                version: 1,
                commandLine: commandLine,
                origin: { type: 'player' }
            }
        };
        ws.send(JSON.stringify(cmdPacket));
    } catch {}
}

// -------------------------------------------------------------
// Socket.io (Web & Mobile Voice Clients Signaling)
// -------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`[Voice Client] Connected: ${socket.id}`);

    // Player joins voice session
    socket.on('join', ({ gamertag, platform }) => {
        const cleanName = (gamertag || '').trim();
        if (!cleanName) {
            return socket.emit('join_error', { message: 'กรุณาระบุชื่อ Gamertag' });
        }

        // Clean up duplicate session for the same gamertag
        for (const [id, client] of voiceClients.entries()) {
            if (id !== socket.id && client.gamertag.toLowerCase() === cleanName.toLowerCase()) {
                console.log(`[Voice Client] Replacing duplicate session for ${cleanName} (${id})`);
                io.to(id).emit('kicked', { reason: 'มีผู้เล่นเข้าสู่ระบบด้วยชื่อเดียวกันจากอุปกรณ์อื่น' });
                voiceClients.delete(id);
            }
        }

        const clientData = {
            socketId: socket.id,
            gamertag: cleanName,
            platform: platform || 'web',
            voiceMode: 'normal',
            maxDistance: 25,
            radioChannel: 0,
            radioPtt: false
        };

        voiceClients.set(socket.id, clientData);

        // Send confirmation & existing peer list to the joining client
        const peerList = [];
        for (const [id, c] of voiceClients.entries()) {
            if (id !== socket.id) {
                peerList.push({
                    socketId: c.socketId,
                    gamertag: c.gamertag,
                    platform: c.platform,
                    voiceMode: c.voiceMode,
                    maxDistance: c.maxDistance,
                    radioChannel: c.radioChannel,
                    radioPtt: c.radioPtt
                });
            }
        }

        socket.emit('joined_success', {
            self: clientData,
            peers: peerList
        });

        // Notify other clients
        socket.broadcast.emit('user_joined', {
            socketId: socket.id,
            gamertag: cleanName,
            platform: clientData.platform,
            voiceMode: clientData.voiceMode,
            maxDistance: clientData.maxDistance
        });

        console.log(`[Voice Client] ${cleanName} joined (Platform: ${clientData.platform}). Total: ${voiceClients.size}`);
    });

    // WebRTC Signaling: Offer
    socket.on('signal_offer', ({ to, offer }) => {
        if (to && offer) {
            io.to(to).emit('signal_offer', {
                from: socket.id,
                offer
            });
        }
    });

    // WebRTC Signaling: Answer
    socket.on('signal_answer', ({ to, answer }) => {
        if (to && answer) {
            io.to(to).emit('signal_answer', {
                from: socket.id,
                answer
            });
        }
    });

    // WebRTC Signaling: ICE Candidate
    socket.on('signal_ice', ({ to, candidate }) => {
        if (to && candidate) {
            io.to(to).emit('signal_ice', {
                from: socket.id,
                candidate
            });
        }
    });

    // Voice Mode Change (Whisper: 4m, Normal: 15m, Shout: 25m)
    socket.on('set_voice_mode', ({ mode, maxDistance }) => {
        const client = voiceClients.get(socket.id);
        if (client) {
            client.voiceMode = mode || client.voiceMode;
            client.maxDistance = maxDistance || client.maxDistance;
            socket.broadcast.emit('user_mode_updated', {
                socketId: socket.id,
                voiceMode: client.voiceMode,
                maxDistance: client.maxDistance
            });
        }
    });

    // Radio Walkie-Talkie Channel & PTT
    socket.on('radio_channel', ({ channel }) => {
        const client = voiceClients.get(socket.id);
        if (client) {
            client.radioChannel = Number(channel) || 0;
            io.emit('radio_channel_sync', {
                socketId: socket.id,
                gamertag: client.gamertag,
                channel: client.radioChannel
            });
        }
    });

    socket.on('radio_ptt', ({ active }) => {
        const client = voiceClients.get(socket.id);
        if (client) {
            client.radioPtt = !!active;
            io.emit('radio_ptt_sync', {
                socketId: socket.id,
                gamertag: client.gamertag,
                active: client.radioPtt,
                channel: client.radioChannel
            });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        const client = voiceClients.get(socket.id);
        if (client) {
            console.log(`[Voice Client] ${client.gamertag} disconnected (${socket.id})`);
            voiceClients.delete(socket.id);
            socket.broadcast.emit('user_left', {
                socketId: socket.id,
                gamertag: client.gamertag
            });
        }
    });
});

// -------------------------------------------------------------
// Spatial Telemetry & Culling Broadcast Loop (20Hz = 50ms)
// -------------------------------------------------------------
const SPATIAL_TICK_RATE_MS = 50; // 20 Hz
const MAX_HEARING_DISTANCE = 30; // Max distance before peer connection is culled

setInterval(() => {
    if (voiceClients.size === 0) return;

    // Collect coordinates of all active voice clients
    const spatialPayload = [];
    const clientList = Array.from(voiceClients.values());

    for (const client of clientList) {
        const telemetry = playerTelemetry.get(client.gamertag.toLowerCase());
        spatialPayload.push({
            socketId: client.socketId,
            name: client.gamertag,
            dimension: telemetry?.dimension ?? 0,
            pos: telemetry?.pos || { x: 0, y: 64, z: 0 },
            yaw: telemetry?.yaw ?? 0,
            voiceMode: client.voiceMode,
            maxDistance: client.maxDistance,
            radioChannel: client.radioChannel,
            radioPtt: client.radioPtt,
            hasTelemetry: !!telemetry
        });
    }

    // Broadcast spatial positions to all connected web clients
    io.emit('spatial_broadcast', {
        timestamp: Date.now(),
        players: spatialPayload
    });
}, SPATIAL_TICK_RATE_MS);

// Periodic cleanup of stale telemetry data (older than 60s)
setInterval(() => {
    const now = Date.now();
    for (const [key, p] of playerTelemetry.entries()) {
        if (now - p.lastSeen > 60000) {
            playerTelemetry.delete(key);
        }
    }
}, 30000);

// -------------------------------------------------------------
// Start Server
// -------------------------------------------------------------
server.listen(PORT, () => {
    console.log(`
============================================================
🎙️  MINECRAFT BEDROCK PROXIMITY VOICE SERVER v2.0 READY!
------------------------------------------------------------
- HTTP / Web Client:  http://localhost:${PORT}
- Minecraft /connect: ws://localhost:${PORT}
- WebRTC Signaling:   Socket.io on /socket.io/
- Telemetry Relay:    POST /api/telemetry (BDS Script API)
- Health Check:       GET  /api/status
============================================================
`);
});
