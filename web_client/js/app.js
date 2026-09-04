/**
 * ====================================================================
 *                 REALISTIC ROLEPLAY VOICE CLIENT - APP
 *              UI Controller, Hotkeys, Radar & Telemetry
 *                      Author: ZirconX
 * ====================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const connectionBadge = document.getElementById('connectionBadge');
    const connectionText = document.getElementById('connectionText');
    const playerNameInput = document.getElementById('playerNameInput');
    const onlinePlayersList = document.getElementById('onlinePlayersList');
    const playerSelectHint = document.getElementById('playerSelectHint');
    const btnRefreshPlayers = document.getElementById('btnRefreshPlayers');
    const btnConnect = document.getElementById('btnConnect');
    const connectBtnIcon = document.getElementById('connectBtnIcon');
    const connectBtnText = document.getElementById('connectBtnText');

    const micDbText = document.getElementById('micDbText');
    const micMeterFill = document.getElementById('micMeterFill');
    const btnToggleMute = document.getElementById('btnToggleMute');
    const muteIcon = document.getElementById('muteIcon');
    const muteText = document.getElementById('muteText');

    const meterStrip = document.getElementById('meterStrip');
    const nearbyCountBadge = document.getElementById('nearbyCountBadge');
    const speakersList = document.getElementById('speakersList');

    const radarCanvas = document.getElementById('radarCanvas');
    const btnToggleSim = document.getElementById('btnToggleSim');
    const simPanel = document.getElementById('simPanel');
    const simPosX = document.getElementById('simPosX');
    const simPosZ = document.getElementById('simPosZ');
    const btnAddBot = document.getElementById('btnAddBot');
    const btnToggleWall = document.getElementById('btnToggleWall');

    // State
    let isConnected = false;
    let ws = null;
    let audioEngine = null;
    let rtcManager = null;
    let localPeerId = null;

    let peersData = new Map(); // peerId -> Telemetry

    // Simulation State
    let isSimMode = false;
    let botPeer = null;
    let botHasWall = false;

    // Restore saved Gamertag if available
    const savedName = localStorage.getItem('voice_mc_gamertag');
    if (savedName && playerNameInput) {
        playerNameInput.value = savedName;
    }

    // -------------------------------------------------------------
    // Auto-fetch Bedrock Players from Server
    // -------------------------------------------------------------
    async function fetchOnlineBedrockPlayers() {
        try {
            const res = await fetch('/api/players');
            if (!res.ok) return;
            const data = await res.json();
            const players = data.players || [];

            if (onlinePlayersList) {
                onlinePlayersList.innerHTML = '';
                players.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    opt.textContent = `${p.name} (ในเกม)`;
                    onlinePlayersList.appendChild(opt);
                });
            }

            if (players.length > 0) {
                if (playerSelectHint) {
                    playerSelectHint.textContent = `ตรวจพบ ${players.length} คนในเกม (พร้อมเชื่อมต่อ)`;
                }
                if (playerNameInput && !playerNameInput.value) {
                    playerNameInput.value = players[0].name;
                }
            } else {
                if (playerSelectHint) {
                    playerSelectHint.textContent = 'ตรวจจับคนใกล้เคียงอัตโนมัติ';
                }
            }
        } catch (e) {
            console.warn('Cannot fetch online players:', e);
        }
    }

    fetchOnlineBedrockPlayers();
    setInterval(fetchOnlineBedrockPlayers, 5000);
    if (btnRefreshPlayers) {
        btnRefreshPlayers.addEventListener('click', fetchOnlineBedrockPlayers);
    }

    // -------------------------------------------------------------
    // Connect to Voice Server
    // -------------------------------------------------------------
    async function connectVoice() {
        if (isConnected) return;

        const playerName = (playerNameInput ? playerNameInput.value.trim() : '') || localStorage.getItem('voice_mc_gamertag') || 'Player_' + Math.floor(Math.random() * 1000);
        localStorage.setItem('voice_mc_gamertag', playerName);

        if (connectBtnText) connectBtnText.textContent = 'กำลังขอสิทธิ์ไมค์...';

        try {
            audioEngine = new window.AudioEngine();
            await audioEngine.init();

            if (connectBtnText) connectBtnText.textContent = 'กำลังเชื่อมต่อเซิร์ฟเวอร์...';

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host || 'localhost:3000';
            const wsUrl = `${protocol}//${host}`;

            ws = new WebSocket(wsUrl);
            rtcManager = new window.WebRTCManager(ws, audioEngine);

            ws.onopen = () => {
                isConnected = true;
                if (connectionBadge) connectionBadge.className = 'mf-status-pill online';
                if (connectionText) connectionText.textContent = `Online (${playerName})`;

                if (connectBtnIcon) connectBtnIcon.textContent = '🔴';
                if (connectBtnText) connectBtnText.textContent = 'ตัดการเชื่อมต่อ';
                if (btnConnect) {
                    btnConnect.classList.remove('mf-btn-primary');
                    btnConnect.classList.add('mf-btn-secondary');
                }
                if (btnToggleMute) btnToggleMute.style.display = 'inline-flex';
                if (meterStrip) meterStrip.style.display = 'flex';

                ws.send(JSON.stringify({
                    type: 'join',
                    playerName
                }));

                sendMyTelemetry();
            };

            ws.onmessage = event => {
                try {
                    const data = JSON.parse(event.data);
                    handleServerMessage(data);
                } catch (e) {
                    console.error('WS Parse Error:', e);
                }
            };

            ws.onclose = () => {
                handleDisconnectUI();
            };

            ws.onerror = (err) => {
                console.error('WS Error:', err);
                if (connectionBadge) connectionBadge.className = 'mf-status-pill offline';
                if (connectionText) connectionText.textContent = 'Failed';
                handleDisconnectUI();
            };

            // Start VU meter loop
            startVUMeter();

        } catch (err) {
            console.error('Init Error:', err);
            alert('ไม่สามารถเข้าถึงไมโครโฟนได้: ' + (err.message || 'กรุณาอนุญาตให้เว็บใช้ไมค์บนเบราว์เซอร์'));
            handleDisconnectUI();
        }
    }

    function disconnect() {
        if (ws) ws.close();
        handleDisconnectUI();
    }

    function handleDisconnectUI() {
        isConnected = false;
        if (connectionBadge) connectionBadge.className = 'mf-status-pill standby';
        if (connectionText) connectionText.textContent = 'พร้อมเปิดไมค์';
        if (connectBtnIcon) connectBtnIcon.textContent = '🎙️';
        if (connectBtnText) connectBtnText.textContent = 'เปิดไมค์ (Connect)';
        if (btnConnect) {
            btnConnect.classList.add('mf-btn-primary');
            btnConnect.classList.remove('mf-btn-secondary');
        }
        if (btnToggleMute) btnToggleMute.style.display = 'none';
        if (meterStrip) meterStrip.style.display = 'none';
        peersData.clear();
        updateSpeakersList();
    }

    if (btnConnect) {
        btnConnect.addEventListener('click', () => {
            if (isConnected) {
                disconnect();
            } else {
                connectVoice();
            }
        });
    }

    // -------------------------------------------------------------
    // Incoming Server Messages
    // -------------------------------------------------------------
    function handleServerMessage(data) {
        switch (data.type) {
            case 'welcome':
                localPeerId = data.peerId;
                if (data.existingPeers) {
                    for (const p of data.existingPeers) {
                        peersData.set(p.id, p);
                        rtcManager.callPeer(p.id);
                    }
                }
                updateSpeakersList();
                break;

            case 'peer_joined':
                peersData.set(data.peer.id, data.peer);
                updateSpeakersList();
                break;

            case 'peer_left':
                peersData.delete(data.peerId);
                rtcManager.closePeer(data.peerId);
                updateSpeakersList();
                break;

            case 'telemetry_sync':
                if (data.peerId === localPeerId) {
                    // Update local player listener (ears orientation & position)
                    if (audioEngine && data.telemetry.pos && data.telemetry.view) {
                        audioEngine.updateListenerPose(data.telemetry.pos, data.telemetry.view);
                    }
                } else if (peersData.has(data.peerId)) {
                    const p = peersData.get(data.peerId);
                    Object.assign(p, data.telemetry);
                    audioEngine.updatePeerAudio(data.peerId, p);
                    updateSpeakersList();
                }
                break;

            case 'webrtc_offer':
                rtcManager.handleOffer(data.from, data.payload);
                break;

            case 'webrtc_answer':
                rtcManager.handleAnswer(data.from, data.payload);
                break;

            case 'webrtc_ice':
                rtcManager.handleIceCandidate(data.from, data.payload);
                break;
        }
    }

    // -------------------------------------------------------------
    // Hotkeys (M = Toggle Mute)
    // -------------------------------------------------------------
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        if (e.code === 'KeyM' && !e.repeat) {
            toggleMute();
        }
    });

    function toggleMute() {
        if (!audioEngine) return;
        const muted = audioEngine.toggleMute();
        if (muteIcon) muteIcon.textContent = muted ? '🔇' : '🔊';
        if (muteText) muteText.textContent = muted ? 'เปิดเสียงไมค์' : 'ปิดเสียงไมค์';
        if (btnToggleMute) {
            btnToggleMute.classList.toggle('mf-btn-primary', !muted);
            btnToggleMute.classList.toggle('mf-btn-outline', muted);
        }
    }

    btnToggleMute.addEventListener('click', toggleMute);

    // -------------------------------------------------------------
    // VU Meter Loop
    // -------------------------------------------------------------
    function startVUMeter() {
        function update() {
            if (audioEngine) {
                const level = audioEngine.getMicLevel();
                const pct = Math.round(level * 100);
                micMeterFill.style.width = `${pct}%`;
                micDbText.textContent = `${pct}%`;
            }
            requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    // -------------------------------------------------------------
    // Telemetry Sync
    // -------------------------------------------------------------
    function sendMyTelemetry() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const posX = isSimMode ? parseFloat(simPosX.value) || 0 : 0;
        const posZ = isSimMode ? parseFloat(simPosZ.value) || 0 : 0;

        ws.send(JSON.stringify({
            type: 'update_telemetry',
            pos: { x: posX, y: 64, z: posZ },
            view: { x: 0, y: 0, z: 1 },
            voiceMode: 'normal',
            maxDistance: 15,
            refDistance: 2
        }));
    }

    // -------------------------------------------------------------
    // Radar Display (Optional if canvas present)
    // -------------------------------------------------------------
    if (radarCanvas) {
        const ctx = radarCanvas.getContext('2d');
        let sweepAngle = 0;

        function drawRadar() {
            const w = radarCanvas.width;
            const h = radarCanvas.height;
            const cx = w / 2;
            const cy = h / 2;
            const maxRadius = cx - 10;

            ctx.clearRect(0, 0, w, h);

            // Distance rings (5m, 15m)
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
            ctx.lineWidth = 1;

            const rings = [5, 15];
            rings.forEach(r => {
                const rad = (r / 15) * maxRadius;
                ctx.beginPath();
                ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
                ctx.font = '10px Chakra Petch';
                ctx.fillText(`${r}m`, cx + rad - 20, cy - 4);
            });

            // Crosshairs
            ctx.beginPath();
            ctx.moveTo(cx, 10); ctx.lineTo(cx, h - 10);
            ctx.moveTo(10, cy); ctx.lineTo(w - 10, cy);
            ctx.stroke();

            // Radar Sweep Line
            sweepAngle += 0.03;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(sweepAngle);
            const grad = ctx.createLinearGradient(0, 0, maxRadius, 0);
            grad.addColorStop(0, 'rgba(6, 182, 212, 0.3)');
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, maxRadius, 0, Math.PI / 4);
            ctx.fill();
            ctx.restore();

            // Self Marker (Center)
            ctx.fillStyle = '#06b6d4';
            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, Math.PI * 2);
            ctx.fill();

            // Draw Peers
            const myX = isSimMode && simPosX ? parseFloat(simPosX.value) || 0 : 0;
            const myZ = isSimMode && simPosZ ? parseFloat(simPosZ.value) || 0 : 0;

            peersData.forEach((peer) => {
                if (!peer.pos) return;
                const dx = peer.pos.x - myX;
                const dz = peer.pos.z - myZ;

                const px = cx + (dx / 15) * maxRadius;
                const py = cy + (dz / 15) * maxRadius;

                let color = '#10b981'; // clear
                const occ = peer.occlusions ? Object.values(peer.occlusions)[0]?.occlusion : 0;
                if (occ > 0.3) color = '#f59e0b'; // muffled

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(px, py, 6, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#f3f4f6';
                ctx.font = '11px Inter';
                ctx.fillText(peer.playerName || peer.id, px + 8, py + 4);
            });

            requestAnimationFrame(drawRadar);
        }
        requestAnimationFrame(drawRadar);
    }

    // -------------------------------------------------------------
    // Active Speakers List
    // -------------------------------------------------------------
    function updateSpeakersList() {
        if (!nearbyCountBadge || !speakersList) return;
        nearbyCountBadge.textContent = `${peersData.size} online`;

        if (peersData.size === 0) {
            speakersList.innerHTML = `
                <div class="mf-empty">
                    <div class="mf-empty-icon">🎧</div>
                    <div class="mf-empty-text">No nearby players within audio range</div>
                    <div class="mf-empty-sub">เมื่อมีผู้เล่นอยู่ใกล้ในเกม รายชื่อและระยะห่างจะแสดงที่นี่</div>
                </div>
            `;
            return;
        }

        speakersList.innerHTML = '';
        const myX = isSimMode && simPosX ? parseFloat(simPosX.value) || 0 : (audioEngine?.listenerPos?.x || 0);
        const myZ = isSimMode && simPosZ ? parseFloat(simPosZ.value) || 0 : (audioEngine?.listenerPos?.z || 0);

        peersData.forEach((peer) => {
            const div = document.createElement('div');
            div.className = 'speaker-item';

            const occ = peer.occlusions ? Object.values(peer.occlusions)[0]?.occlusion : 0;
            const isMuffled = occ > 0.3;

            let distStr = '';
            if (peer.pos) {
                const dist = Math.hypot(peer.pos.x - myX, peer.pos.z - myZ);
                distStr = ` · ${dist.toFixed(1)}m`;
            }

            const modeMap = {
                whisper: 'Whisper (4m)',
                normal: 'Normal (15m)',
                shout: 'Shout (35m)'
            };
            const modeText = modeMap[peer.voiceMode] || 'Normal (15m)';

            let statusText = 'Clear';
            if (isMuffled) statusText = `Muffled · ${Math.round(occ * 100)}%`;

            div.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 3px;">
                    <span class="speaker-name">${peer.playerName || peer.id} <small style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.75rem;">${distStr}</small></span>
                    <small style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.72rem;">${modeText}</small>
                </div>
                <span class="speaker-status ${isMuffled ? 'muffled' : ''}">${statusText}</span>
            `;
            speakersList.appendChild(div);
        });
    }

    // -------------------------------------------------------------
    // Simulation / Bot Controls (Optional)
    // -------------------------------------------------------------
    if (btnToggleSim && simPanel) {
        btnToggleSim.addEventListener('click', () => {
            isSimMode = !isSimMode;
            simPanel.classList.toggle('hidden', !isSimMode);
            btnToggleSim.textContent = isSimMode ? '🛠️ ซ่อนโหมดทดสอบจำลอง' : '🛠️ เปิด/ปิด โหมดทดสอบจำลอง (Simulation Mode)';
        });
    }

    if (simPosX && simPosZ) {
        [simPosX, simPosZ].forEach(inp => {
            inp.addEventListener('input', () => {
                sendMyTelemetry();
                if (audioEngine) {
                    audioEngine.updateListenerPose(
                        { x: parseFloat(simPosX.value) || 0, y: 64, z: parseFloat(simPosZ.value) || 0 },
                        { x: 0, y: 0, z: 1 }
                    );
                }
            });
        });
    }

    if (btnAddBot) {
        btnAddBot.addEventListener('click', () => {
            if (!audioEngine) {
                alert('กรุณากดเชื่อมต่อระบบไมค์ก่อนเริ่มทดสอบ');
                return;
            }

            if (botPeer) {
                peersData.delete('sim_bot');
                audioEngine.removePeerChain('sim_bot');
                botPeer = null;
                btnAddBot.textContent = '🤖 จำลองบอทพูดเสียง';
                updateSpeakersList();
                return;
            }

            const osc = audioEngine.ctx.createOscillator();
            const oscGain = audioEngine.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = 220;
            oscGain.gain.value = 0.15;

            const lfo = audioEngine.ctx.createOscillator();
            lfo.frequency.value = 4;
            const lfoGain = audioEngine.ctx.createGain();
            lfoGain.gain.value = 30;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);

            const dest = audioEngine.ctx.createMediaStreamDestination();
            osc.connect(oscGain);
            oscGain.connect(dest);
            osc.start();
            lfo.start();

            botPeer = {
                id: 'sim_bot',
                playerName: '🤖 บอททดสอบ (Bot_Officer)',
                pos: { x: 5, y: 64, z: 5 },
                view: { x: 0, y: 0, z: 1 },
                voiceMode: 'normal',
                maxDistance: 15,
                refDistance: 2,
                occlusions: { self: { distance: 7.07, occlusion: 0.0, cutoffHz: 20000 } }
            };

            peersData.set('sim_bot', botPeer);
            audioEngine.getOrCreatePeerChain('sim_bot', dest.stream);
            audioEngine.updatePeerAudio('sim_bot', botPeer);

            btnAddBot.textContent = '❌ ลบบอททดสอบ';
            updateSpeakersList();
        });
    }

    if (btnToggleWall) {
        btnToggleWall.addEventListener('click', () => {
            if (!botPeer || !audioEngine) {
                alert('กรุณาเพิ่มบอทจำลองก่อน');
                return;
            }

            botHasWall = !botHasWall;
            const occ = botHasWall ? 0.95 : 0.0;
            const cutoff = botHasWall ? 500 : 20000;

            botPeer.occlusions = {
                self: { distance: 7.07, occlusion: occ, cutoffHz: cutoff }
            };

            audioEngine.updatePeerAudio('sim_bot', botPeer);
            btnToggleWall.textContent = botHasWall ? '🧱 กำแพงกั้นอยู่ (เสียงอู้อี้) - คลิกเพื่อเปิดประตู' : '🧱 สลับกำแพงกั้นบอท (ทดสอบเสียงอู้อี้)';
            updateSpeakersList();
        });
    }
});
