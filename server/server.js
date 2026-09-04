/**
 * ====================================================================
 *         REALISTIC ROLEPLAY PROXIMITY VOICE SERVER (NODE.JS)
 *      Signaling, Telemetry Relay & Web Client Static Server
 *                      Author: ZirconX
 *               100% Free / Zero-Cost Architecture
 * ====================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const WEB_CLIENT_DIR = path.join(__dirname, '..', 'web_client');

// Active connected voice peers
// Key: peerId (socket id or player name) -> Peer Data
const peers = new Map();

// Active online players reported from Bedrock server
// Key: playerName -> { lastSeen, pos, dim, voiceMode, maxDistance }
const bedrockPlayers = new Map();

// MIME Types for static web server
const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg'
};

// Create HTTP Server (Serves Web Client + API endpoints)
const server = http.createServer((req, res) => {
    // API endpoint for health check
    if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            status: 'online',
            connectedPeers: peers.size,
            uptime: process.uptime()
        }));
    }

    // API endpoint to get list of online Bedrock players for web dropdown
    if (req.url === '/api/players') {
        const now = Date.now();
        const activeList = [];
        for (const [name, p] of bedrockPlayers.entries()) {
            if (now - p.lastSeen < 15000) { // Active within 15 seconds
                activeList.push({
                    name,
                    dim: p.dim,
                    voiceMode: p.voiceMode || 'normal'
                });
            }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ players: activeList }));
    }

    // API endpoint for Minecraft BDS / Script API telemetry upload
    if (req.url === '/api/telemetry' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                handleBedrockTelemetry(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Static file serving
    let safeUrl = req.url.split('?')[0];
    if (safeUrl === '/' || safeUrl === '') safeUrl = '/index.html';

    const filePath = path.join(WEB_CLIENT_DIR, safeUrl);

    // Prevent directory traversal
    if (!filePath.startsWith(WEB_CLIENT_DIR)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + err.code);
            }
        } else {
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, {
                'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(content);
        }
    });
});

// Create WebSocket Server
const wss = new WebSocketServer({ server });

let nextPeerId = 1000;

wss.on('connection', (ws, req) => {
    const peerId = 'peer_' + (++nextPeerId);
    ws.peerId = peerId;

    const peerInfo = {
        id: peerId,
        playerName: 'Player_' + peerId.slice(-4),
        ws,
        pos: { x: 0, y: 64, z: 0 },
        view: { x: 0, y: 0, z: 1 },
        dim: 'minecraft:overworld',
        voiceMode: 'normal',
        maxDistance: 15,
        refDistance: 2,
        radioChannel: 0,
        radioPtt: false,
        occlusions: {}
    };

    peers.set(peerId, peerInfo);
    console.log(`[+] Peer connected: ${peerId} (Total: ${peers.size})`);

    // Send welcome packet with assigned ID
    ws.send(JSON.stringify({
        type: 'welcome',
        peerId,
        existingPeers: Array.from(peers.values())
            .filter(p => p.id !== peerId)
            .map(p => sanitizePeer(p))
    }));

    // Broadcast new peer to others
    broadcast({
        type: 'peer_joined',
        peer: sanitizePeer(peerInfo)
    }, peerId);

    // Message handler
    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(peerInfo, data);
        } catch (e) {
            console.error('Error handling message:', e);
        }
    });

    ws.on('close', () => {
        peers.delete(peerId);
        console.log(`[-] Peer disconnected: ${peerId} (Remaining: ${peers.size})`);
        broadcast({
            type: 'peer_left',
            peerId
        });
    });

    ws.on('error', err => {
        console.error(`Socket error (${peerId}):`, err.message);
    });
});

// Periodic heartbeat to prevent cloud hosting proxies (like Render) from cutting idle sockets
setInterval(() => {
    for (const [id, p] of peers.entries()) {
        if (p.ws && p.ws.readyState === 1) {
            try {
                p.ws.ping();
            } catch {}
        }
    }
}, 25000);

/**
 * Handle incoming client messages
 */
function handleClientMessage(peer, data) {
    switch (data.type) {
        case 'join':
            if (data.playerName) peer.playerName = data.playerName;
            broadcast({
                type: 'peer_updated',
                peer: sanitizePeer(peer)
            });
            break;

        case 'update_telemetry':
            if (data.pos) peer.pos = data.pos;
            if (data.view) peer.view = data.view;
            if (data.dim) peer.dim = data.dim;
            if (data.voiceMode) peer.voiceMode = data.voiceMode;
            if (data.maxDistance) peer.maxDistance = data.maxDistance;
            if (data.refDistance) peer.refDistance = data.refDistance;
            if (data.radioChannel !== undefined) peer.radioChannel = data.radioChannel;
            if (data.radioPtt !== undefined) peer.radioPtt = data.radioPtt;
            if (data.occlusions) peer.occlusions = data.occlusions;

            // Broadcast positional update to all peers
            broadcast({
                type: 'telemetry_sync',
                peerId: peer.id,
                telemetry: {
                    pos: peer.pos,
                    view: peer.view,
                    dim: peer.dim,
                    voiceMode: peer.voiceMode,
                    maxDistance: peer.maxDistance,
                    refDistance: peer.refDistance,
                    radioChannel: peer.radioChannel,
                    radioPtt: peer.radioPtt,
                    occlusions: peer.occlusions
                }
            }, peer.id);
            break;

        // Keep-Alive Ping / Pong
        case 'ping':
            try {
                ws.send(JSON.stringify({ type: 'pong' }));
            } catch {}
            break;

        // WebRTC P2P Signaling Relay
        case 'webrtc_offer':
        case 'webrtc_answer':
        case 'webrtc_ice':
            forwardToTarget(data.to, {
                type: data.type,
                from: peer.id,
                payload: data.payload
            });
            break;

        case 'radio_ptt':
            peer.radioPtt = !!data.ptt;
            broadcast({
                type: 'radio_ptt_sync',
                peerId: peer.id,
                radioPtt: peer.radioPtt,
                radioChannel: peer.radioChannel
            });
            break;

        case 'radio_channel':
            peer.radioChannel = data.channel;
            broadcast({
                type: 'radio_channel_sync',
                peerId: peer.id,
                radioChannel: peer.radioChannel
            });
            break;
    }
}

/**
 * Handle telemetry push from Bedrock server
 */
function handleBedrockTelemetry(telemetry) {
    if (!telemetry || !telemetry.playerName) return;

    // Record or update online Bedrock player
    bedrockPlayers.set(telemetry.playerName, {
        lastSeen: Date.now(),
        pos: telemetry.pos,
        view: telemetry.view,
        dim: telemetry.dimension,
        voiceMode: telemetry.voiceMode,
        maxDistance: telemetry.maxDistance
    });

    for (const peer of peers.values()) {
        if (peer.playerName.toLowerCase() === telemetry.playerName.toLowerCase()) {
            peer.pos = telemetry.pos || peer.pos;
            peer.view = telemetry.view || peer.view;
            peer.dim = telemetry.dimension || peer.dim;
            peer.voiceMode = telemetry.voiceMode || peer.voiceMode;
            peer.maxDistance = telemetry.maxDistance || peer.maxDistance;
            peer.refDistance = telemetry.refDistance || peer.refDistance;
            peer.radioChannel = telemetry.radioChannel ?? peer.radioChannel;
            peer.radioPtt = telemetry.radioPtt ?? peer.radioPtt;
            peer.occlusions = telemetry.occlusions || peer.occlusions;

            broadcast({
                type: 'telemetry_sync',
                peerId: peer.id,
                telemetry: {
                    pos: peer.pos,
                    view: peer.view,
                    dim: peer.dim,
                    voiceMode: peer.voiceMode,
                    maxDistance: peer.maxDistance,
                    refDistance: peer.refDistance,
                    radioChannel: peer.radioChannel,
                    radioPtt: peer.radioPtt,
                    occlusions: peer.occlusions
                }
            });
            break;
        }
    }
}

/**
 * Broadcast message to all connected peers
 */
function broadcast(msg, excludeId = null) {
    const json = JSON.stringify(msg);
    for (const peer of peers.values()) {
        if (peer.id === excludeId) continue;
        if (peer.ws.readyState === peer.ws.OPEN) {
            peer.ws.send(json);
        }
    }
}

/**
 * Forward message to specific target peer
 */
function forwardToTarget(targetId, msg) {
    const target = peers.get(targetId);
    if (target && target.ws.readyState === target.ws.OPEN) {
        target.ws.send(JSON.stringify(msg));
    }
}

/**
 * Sanitize peer object for serialization (strip raw socket)
 */
function sanitizePeer(p) {
    return {
        id: p.id,
        playerName: p.playerName,
        pos: p.pos,
        view: p.view,
        dim: p.dim,
        voiceMode: p.voiceMode,
        maxDistance: p.maxDistance,
        refDistance: p.refDistance,
        radioChannel: p.radioChannel,
        radioPtt: p.radioPtt,
        occlusions: p.occlusions
    };
}

// Start Server
server.listen(PORT, () => {
    console.log(`
============================================================
🎙️  REALISTIC ROLEPLAY VOICE CHAT SERVER IS RUNNING!
- Web Client & UI: http://localhost:${PORT}
- WebSocket Relay: ws://localhost:${PORT}
- Architecture: 100% Free / WebRTC P2P + Google Free STUN
- Ready for Minecraft Bedrock Roleplay
============================================================
`);
});
