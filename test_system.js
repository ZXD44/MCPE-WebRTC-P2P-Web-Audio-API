/**
 * ====================================================================
 *         BEDROCK PROXIMITY VOICE CHAT - SYSTEM TEST SUITE
 *   Validates:
 *   1. REST API (/api/status, /api/players, /api/telemetry)
 *   2. Minecraft Vanilla Bedrock /connect WebSocket Protocol
 *   3. WebRTC Signaling Relay (Offer, Answer, ICE)
 *   4. Spatial Telemetry Broadcast & Culling Sync (20Hz)
 *   5. Duplicate Gamertag Session Pruning
 *   6. Static Web Client & Socket.io Library Delivery
 * ====================================================================
 */

const http = require('http');
const { WebSocket } = require('ws');
const { io } = require('socket.io-client');

const TEST_PORT = 3456;
process.env.PORT = TEST_PORT;

// Start server instance
require('./server/server.js');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(path) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${TEST_PORT}${path}`, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        }).on('error', reject);
    });
}

function httpPost(path, payload) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(payload);
        const req = http.request(`http://localhost:${TEST_PORT}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

function connectAndJoin(gamertag, platform) {
    return new Promise((resolve, reject) => {
        const client = io(`http://localhost:${TEST_PORT}`, {
            transports: ['websocket'],
            forceNew: true
        });

        const doJoin = () => {
            client.emit('join', { gamertag, platform });
        };

        if (client.connected) {
            doJoin();
        } else {
            client.once('connect', doJoin);
        }

        client.once('joined_success', data => {
            resolve({ client, data });
        });

        client.once('connect_error', reject);
    });
}

async function runTests() {
    console.log('\n========================================');
    console.log('🚀 RUNNING PROXIMITY VOICE CHAT TEST SUITE');
    console.log('========================================\n');

    await delay(1000); // Allow server to boot
    let passedTests = 0;
    let totalTests = 0;

    function assert(condition, message) {
        totalTests++;
        if (condition) {
            passedTests++;
            console.log(`  ✅ [PASS] ${message}`);
        } else {
            console.error(`  ❌ [FAIL] ${message}`);
            process.exitCode = 1;
        }
    }

    // -------------------------------------------------------------
    // Test 1: REST API - Status & Health Check
    // -------------------------------------------------------------
    console.log('--- TEST 1: REST API Endpoints ---');
    try {
        const statusRes = await httpGet('/api/status');
        assert(statusRes.statusCode === 200, 'GET /api/status returns HTTP 200');
        assert(statusRes.body.status === 'online', 'Server reports status: online');
        assert(statusRes.body.serverVersion === '2.0.0', 'Server reports version: 2.0.0');

        const clientRes = await httpGet('/index.html');
        assert(clientRes.statusCode === 200, 'GET /index.html serves public/index.html');
        assert(typeof clientRes.body === 'string' && clientRes.body.includes('Bedrock Voice'), 'index.html contains app title');
    } catch (err) {
        assert(false, `REST API error: ${err.message}`);
    }

    // -------------------------------------------------------------
    // Test 2: Script API HTTP Telemetry Relay (/api/telemetry)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Script API Telemetry Relay ---');
    try {
        const telemetryPayload = {
            playerName: 'Steve',
            dimension: 'minecraft:overworld',
            pos: { x: 100.0, y: 64.0, z: 200.0 },
            view: { x: 0.0, y: 0.0, z: 1.0 },
            voiceMode: 'normal',
            maxDistance: 15
        };

        const postRes = await httpPost('/api/telemetry', telemetryPayload);
        assert(postRes.statusCode === 200, 'POST /api/telemetry returns HTTP 200');
        assert(postRes.body.success === true, 'Telemetry saved successfully');

        const playersRes = await httpGet('/api/players');
        assert(playersRes.body.players.some(p => p.name === 'Steve'), 'Steve appears in GET /api/players list');
    } catch (err) {
        assert(false, `Telemetry Relay error: ${err.message}`);
    }

    // -------------------------------------------------------------
    // Test 3: Minecraft Bedrock /connect WebSocket Ingestion
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Vanilla Bedrock /connect Protocol ---');
    try {
        const bedrockWs = new WebSocket(`ws://localhost:${TEST_PORT}`);
        let receivedSubscribe = false;
        let receivedTellraw = false;

        await new Promise((resolve, reject) => {
            bedrockWs.on('open', () => {
                console.log('    [Mock Bedrock] Connected to ws://localhost:' + TEST_PORT);
            });

            bedrockWs.on('message', data => {
                try {
                    const packet = JSON.parse(data.toString());
                    if (packet.header && packet.header.messagePurpose === 'subscribe' && packet.body.eventName === 'PlayerTravelled') {
                        receivedSubscribe = true;
                    }
                    if (packet.body && packet.body.commandLine && packet.body.commandLine.includes('tellraw')) {
                        receivedTellraw = true;
                    }

                    if (receivedSubscribe && receivedTellraw) {
                        resolve();
                    }
                } catch {}
            });

            bedrockWs.on('error', reject);
            setTimeout(resolve, 1500); // Timeout fallback
        });

        assert(receivedSubscribe, 'Server sent subscribe packet for PlayerTravelled');
        assert(receivedTellraw, 'Server sent tellraw command packet to game');

        // Simulate Bedrock sending PlayerTravelled event packet
        const travelEvent = {
            header: {
                eventName: 'PlayerTravelled',
                messagePurpose: 'event',
                version: 1
            },
            body: {
                player: {
                    name: 'Alex',
                    position: { x: 105.5, y: 64.0, z: 202.0 },
                    yRot: 45.0,
                    dimension: 0
                }
            }
        };

        bedrockWs.send(JSON.stringify(travelEvent));
        await delay(500);

        const playersAfterConnect = await httpGet('/api/players');
        assert(playersAfterConnect.body.players.some(p => p.name === 'Alex'), 'Alex (from /connect) appears in GET /api/players list');

        bedrockWs.close();
    } catch (err) {
        assert(false, `Bedrock /connect error: ${err.message}`);
    }

    // -------------------------------------------------------------
    // Test 4: WebRTC Signaling & Socket.io Voice Engine
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Socket.io Client Signaling & Mesh ---');
    try {
        // Connect Client 1 (Steve)
        const { client: client1, data: client1Data } = await connectAndJoin('Steve', 'web');
        assert(client1Data.self.gamertag === 'Steve', 'Client 1 confirmed join as Steve');

        // Prepare listener on client 1 for client 2 joining
        let client1SawClient2 = false;
        client1.on('user_joined', user => {
            if (user.gamertag === 'Alex') {
                client1SawClient2 = true;
            }
        });

        // Connect Client 2 (Alex)
        const { client: client2, data: client2Data } = await connectAndJoin('Alex', 'android');
        assert(client2Data.self.gamertag === 'Alex', 'Client 2 confirmed join as Alex');

        await delay(300);
        assert(client1SawClient2, 'Client 1 received user_joined notification for Alex');

        // Test WebRTC Signaling Relay (Offer & Answer)
        let signalingOfferPassed = false;
        let signalingAnswerPassed = false;

        await new Promise(resolve => {
            client2.on('signal_offer', data => {
                if (data.offer && data.offer.sdp === 'mock_sdp_offer') {
                    signalingOfferPassed = true;
                    // Reply with answer
                    client2.emit('signal_answer', {
                        to: data.from,
                        answer: { type: 'answer', sdp: 'mock_sdp_answer' }
                    });
                }
            });

            client1.on('signal_answer', data => {
                if (data.answer && data.answer.sdp === 'mock_sdp_answer') {
                    signalingAnswerPassed = true;
                    resolve();
                }
            });

            // Send offer from client 1 to client 2
            client1.emit('signal_offer', {
                to: client2.id,
                offer: { type: 'offer', sdp: 'mock_sdp_offer' }
            });

            setTimeout(resolve, 1500);
        });

        assert(signalingOfferPassed, 'WebRTC signal_offer relayed successfully to target peer');
        assert(signalingAnswerPassed, 'WebRTC signal_answer relayed successfully back to caller');

        // Test 20Hz Spatial Broadcast
        let spatialReceived = false;
        await new Promise(resolve => {
            client1.on('spatial_broadcast', payload => {
                if (payload.players && payload.players.length >= 2) {
                    const hasSteve = payload.players.some(p => p.name === 'Steve');
                    const hasAlex = payload.players.some(p => p.name === 'Alex');
                    if (hasSteve && hasAlex) {
                        spatialReceived = true;
                        resolve();
                    }
                }
            });
            setTimeout(resolve, 1500);
        });

        assert(spatialReceived, 'Spatial broadcast loop (20Hz) delivers 3D coordinates for all active peers');

        // -------------------------------------------------------------
        // Test 5: Duplicate Session Pruning
        // -------------------------------------------------------------
        console.log('\n--- TEST 5: Ghost Session & Duplicate Pruning ---');
        let client1Kicked = false;
        client1.on('kicked', () => {
            client1Kicked = true;
        });

        // Open a new socket also claiming to be "Steve"
        const { client: client1Duplicate } = await connectAndJoin('Steve', 'ios');
        await delay(500);

        assert(client1Kicked, 'Old session kicked/pruned when duplicate gamertag joins');

        // Clean up sockets
        client1.disconnect();
        client2.disconnect();
        client1Duplicate.disconnect();
    } catch (err) {
        assert(false, `Socket.io testing error: ${err.message}`);
    }

    console.log('\n========================================');
    console.log(`TEST SUMMARY: ${passedTests}/${totalTests} Tests Passed (${Math.round((passedTests/totalTests)*100)}%)`);
    console.log('========================================\n');

    process.exit(passedTests === totalTests ? 0 : 1);
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
