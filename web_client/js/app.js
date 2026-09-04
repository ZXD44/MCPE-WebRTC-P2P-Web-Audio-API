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
    const playerChips = document.getElementById('playerChips');
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
    const btnFloatingGuide = document.getElementById('btnFloatingGuide');
    const btnTryPip = document.getElementById('btnTryPip');
    const pipVideo = document.getElementById('pipVideo');
    const pipCanvas = document.getElementById('pipCanvas');
    const btnToggleTip = document.getElementById('btnToggleTip');
    const tipContent = document.getElementById('tipContent');

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
        playerNameInput.value = savedName.replace(/\s*\(ในเกม\)/g, '').trim();
    }

    // Sanitization & auto-sync event listeners on input
    if (playerNameInput) {
        const cleanAndSync = () => {
            const clean = playerNameInput.value.replace(/\s*\(ในเกม\)/g, '').trim();
            if (clean !== playerNameInput.value) {
                playerNameInput.value = clean;
            }
            if (clean) {
                localStorage.setItem('voice_mc_gamertag', clean);
                updateSpeakersList();
            }
        };

        playerNameInput.addEventListener('input', cleanAndSync);
        playerNameInput.addEventListener('change', () => {
            cleanAndSync();
            const val = playerNameInput.value.trim();
            if (val && isConnected && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'join', playerName: val }));
            }
        });
    }

    // -------------------------------------------------------------
    // Auto-fetch Bedrock Players from Server
    // -------------------------------------------------------------
    let serverPlayers = [];

    async function fetchOnlineBedrockPlayers() {
        try {
            const res = await fetch('/api/players');
            if (!res.ok) return;
            const data = await res.json();
            serverPlayers = data.players || [];

            // Update Datalist (Pure value ONLY - prevent browser auto-fill bugs)
            if (onlinePlayersList) {
                onlinePlayersList.innerHTML = '';
                serverPlayers.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    onlinePlayersList.appendChild(opt);
                });
            }

            // Auto-fill player name if input is empty
            if (serverPlayers.length > 0) {
                const curVal = playerNameInput ? playerNameInput.value.trim() : '';
                if (playerNameInput && (!curVal || curVal.startsWith('Player_'))) {
                    const saved = (localStorage.getItem('voice_mc_gamertag') || '').trim();
                    const matched = serverPlayers.find(p => p.name.toLowerCase() === saved.toLowerCase());
                    playerNameInput.value = matched ? matched.name : serverPlayers[0].name;
                    localStorage.setItem('voice_mc_gamertag', playerNameInput.value);
                }
            }

            updateSpeakersList();
        } catch (e) {
            console.warn('Cannot fetch online players:', e);
        }
    }

    fetchOnlineBedrockPlayers();
    setInterval(fetchOnlineBedrockPlayers, 4000);
    if (btnRefreshPlayers) {
        btnRefreshPlayers.addEventListener('click', fetchOnlineBedrockPlayers);
    }

    let heartbeatInterval = null;
    let userRequestedDisconnect = false;

    // Visibility change recovery (When returning from Minecraft or background)
    document.addEventListener('visibilitychange', () => {
        if (audioEngine) {
            if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
                audioEngine.ctx.resume().catch(() => {});
            }
            if (audioEngine.bgAudio && audioEngine.bgAudio.paused) {
                audioEngine.bgAudio.play().catch(() => {});
            }
        }
        if (pipVideo && pipVideo.paused && isConnected) {
            pipVideo.play().catch(() => {});
        }
        if (document.visibilityState === 'visible') {
            if (!isConnected && !userRequestedDisconnect && localStorage.getItem('voice_mc_gamertag')) {
                console.log('Resumed from background, verifying connection...');
                connectVoice();
            }
        }
    });

    window.addEventListener('focus', () => {
        if (audioEngine) {
            if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
                audioEngine.ctx.resume().catch(() => {});
            }
            if (audioEngine.bgAudio && audioEngine.bgAudio.paused) {
                audioEngine.bgAudio.play().catch(() => {});
            }
        }
    });

    // -------------------------------------------------------------
    // Connect to Voice Server
    // -------------------------------------------------------------
    async function connectVoice() {
        if (isConnected) return;
        userRequestedDisconnect = false;

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
                if (btnFloatingGuide) btnFloatingGuide.style.display = 'inline-flex';
                if (meterStrip) meterStrip.style.display = 'flex';

                // Start Web Worker background timer to prevent mobile OS throttling
                startKeepAliveWorker();

                // Keep looping keep-alive video active to prevent browser suspension
                if (pipVideo) {
                    pipVideo.muted = true;
                    pipVideo.play().catch(() => {});
                }

                // Keep-alive heartbeat every 20s to prevent Render & mobile sleep
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                heartbeatInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
                    }
                }, 20000);

                // Prevent mobile screen sleep if supported
                if ('wakeLock' in navigator) {
                    navigator.wakeLock.request('screen').catch(() => {});
                }

                ws.send(JSON.stringify({
                    type: 'join',
                    playerName
                }));

                sendMyTelemetry();

                // Auto-show Bubble Window guide on mobile devices
                if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 640) {
                    if (!localStorage.getItem('seen_bubble_guide_v2')) {
                        setTimeout(() => {
                            if (isConnected) showFloatingModal();
                        }, 800);
                    }
                }
            };

            ws.onmessage = event => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'pong') return; // Heartbeat ack
                    handleServerMessage(data);
                } catch (e) {
                    console.error('WS Parse Error:', e);
                }
            };

            ws.onclose = () => {
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                stopKeepAliveWorker();
                handleDisconnectUI();

                // Auto-reconnect if dropped while in background
                if (!userRequestedDisconnect) {
                    console.log('Connection dropped, reconnecting in 3s...');
                    setTimeout(() => {
                        if (!isConnected && !userRequestedDisconnect) {
                            connectVoice();
                        }
                    }, 3000);
                }
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
        userRequestedDisconnect = true;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        stopKeepAliveWorker();
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
        hideFloatingModal();
        if (meterStrip) meterStrip.style.display = 'none';
        stopKeepAliveWorker();
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
        }
        peersData.clear();
        updateSpeakersList();
    }

    // -------------------------------------------------------------
    // Web Worker Background Keep-Alive
    // Keeps WebSocket and AudioContext alive when mobile tab is backgrounded
    // -------------------------------------------------------------
    let keepAliveWorker = null;
    function startKeepAliveWorker() {
        try {
            if (keepAliveWorker) return;
            const blobCode = `
                let timer = null;
                self.onmessage = function(e) {
                    if (e.data === 'start') {
                        if (timer) clearInterval(timer);
                        timer = setInterval(() => {
                            self.postMessage('heartbeat');
                        }, 1000);
                    } else if (e.data === 'stop') {
                        if (timer) clearInterval(timer);
                        timer = null;
                    }
                };
            `;
            const blob = new Blob([blobCode], { type: 'application/javascript' });
            keepAliveWorker = new Worker(URL.createObjectURL(blob));
            keepAliveWorker.onmessage = function() {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
                }
                if (audioEngine) {
                    if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
                        audioEngine.ctx.resume().catch(() => {});
                    }
                    if (audioEngine.bgAudio && audioEngine.bgAudio.paused) {
                        audioEngine.bgAudio.play().catch(() => {});
                    }
                }
                if (pipVideo && pipVideo.paused && isConnected) {
                    pipVideo.play().catch(() => {});
                }
            };
            keepAliveWorker.postMessage('start');
        } catch (e) {
            console.warn('Worker fallback:', e);
        }
    }

    function stopKeepAliveWorker() {
        if (keepAliveWorker) {
            keepAliveWorker.postMessage('stop');
            keepAliveWorker.terminate();
            keepAliveWorker = null;
        }
    }

    // -------------------------------------------------------------
    // Picture-in-Picture (PiP) Floating HUD Controller
    // Keeps Mobile Browser Foreground / Active over Minecraft
    // -------------------------------------------------------------
    let isPipActive = false;
    let pipAnimId = null;

    function renderPipHUD() {
        if (!pipCanvas) return;
        const ctx = pipCanvas.getContext('2d');
        const w = pipCanvas.width;
        const h = pipCanvas.height;

        // Dark Titanium Obsidian Background
        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, w, h);

        // Border Glow
        ctx.strokeStyle = '#222734';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, w - 2, h - 2);

        // Header Status Pill
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(24, 28, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const pName = (playerNameInput ? playerNameInput.value.trim() : '') || 'Gamer';
        ctx.fillText(`Online · ${pName}`, 38, 33);

        // Nearby players count tag
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px monospace';
        ctx.fillText(`🎧 อยู่ในระยะไมค์: ${peersData.size} คน`, 20, 70);

        // Mic VU Meter Bar
        const micLvl = audioEngine ? audioEngine.getMicLevel() : 0;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(20, 90, w - 40, 18);

        const barW = Math.max(0, Math.min(w - 40, (w - 40) * (micLvl * 1.6)));
        const grad = ctx.createLinearGradient(20, 0, w - 20, 0);
        grad.addColorStop(0, '#30d158');
        grad.addColorStop(0.7, '#06b6d4');
        grad.addColorStop(1, '#ff453a');
        ctx.fillStyle = grad;
        ctx.fillRect(20, 90, barW, 18);

        // Bottom label
        ctx.fillStyle = '#64748b';
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillText('MetalForge Roleplay · ลอยหน้าต่างคุยในเกม', 20, 140);
        ctx.fillText('แตะที่นี่เพื่อขยาย หรือสลับไปเล่นเกมได้เลย', 20, 165);

        if (isPipActive) {
            pipAnimId = requestAnimationFrame(renderPipHUD);
        }
    }

    const floatingGuideModal = document.getElementById('floatingGuideModal');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnAckModal = document.getElementById('btnAckModal');

    function showFloatingModal() {
        if (floatingGuideModal) floatingGuideModal.classList.add('active');
    }
    function hideFloatingModal() {
        if (floatingGuideModal) floatingGuideModal.classList.remove('active');
    }

    if (btnCloseModal) btnCloseModal.addEventListener('click', hideFloatingModal);
    if (btnAckModal) {
        btnAckModal.addEventListener('click', () => {
            localStorage.setItem('seen_bubble_guide_v2', '1');
            hideFloatingModal();
        });
    }
    if (floatingGuideModal) {
        floatingGuideModal.addEventListener('click', (e) => {
            if (e.target === floatingGuideModal) hideFloatingModal();
        });
    }

    if (btnFloatingGuide) {
        btnFloatingGuide.addEventListener('click', showFloatingModal);
    }

    // Mobile Tips Toggle
    if (btnToggleTip && tipContent) {
        btnToggleTip.addEventListener('click', () => {
            const isHidden = tipContent.classList.toggle('hidden');
            btnToggleTip.textContent = isHidden ? 'ดูวิธีตั้งค่า ▼' : 'ซ่อนวิธีตั้งค่า ▲';
        });
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

            case 'peer_updated':
                if (peersData.has(data.peer.id)) {
                    Object.assign(peersData.get(data.peer.id), data.peer);
                } else {
                    peersData.set(data.peer.id, data.peer);
                }
                updateSpeakersList();
                break;

            case 'peer_left':
                peersData.delete(data.peerId);
                rtcManager.closePeer(data.peerId);
                updateSpeakersList();
                break;

            case 'telemetry_sync':
                if (data.peerId === localPeerId) {
                    // Update local player listener (ears orientation, position, and dimension)
                    if (audioEngine && data.telemetry.pos && data.telemetry.view) {
                        audioEngine.updateListenerPose(data.telemetry.pos, data.telemetry.view, data.telemetry.dim);
                        // Re-evaluate audio distance & attenuation for all active peers
                        peersData.forEach((p, id) => {
                            audioEngine.updatePeerAudio(id, p);
                        });
                        updateSpeakersList();
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
    // Active Players List (Unified: In-Game & Voice)
    // -------------------------------------------------------------
    function updateSpeakersList() {
        if (!speakersList) return;

        const myName = (playerNameInput ? playerNameInput.value.trim() : '') || localStorage.getItem('voice_mc_gamertag') || '';
        const myLower = myName.toLowerCase();

        // Build unified map: Minecraft Bedrock online players + WebRTC Voice peers
        const allPlayersMap = new Map();

        serverPlayers.forEach(sp => {
            allPlayersMap.set(sp.name.toLowerCase(), {
                name: sp.name,
                inServer: true,
                inVoice: false,
                peerData: null,
                pos: (sp.x !== undefined) ? { x: sp.x, y: sp.y, z: sp.z } : null
            });
        });

        peersData.forEach(p => {
            const pName = (p.playerName || p.id || '').trim();
            if (!pName) return;
            const key = pName.toLowerCase();
            if (allPlayersMap.has(key)) {
                const entry = allPlayersMap.get(key);
                entry.inVoice = true;
                entry.peerData = p;
                if (p.pos) entry.pos = p.pos;
            } else {
                allPlayersMap.set(key, {
                    name: pName,
                    inServer: false,
                    inVoice: true,
                    peerData: p,
                    pos: p.pos || null
                });
            }
        });

        if (myName) {
            const key = myLower;
            if (allPlayersMap.has(key)) {
                const entry = allPlayersMap.get(key);
                if (isConnected) entry.inVoice = true;
                entry.isSelf = true;
            } else {
                allPlayersMap.set(key, {
                    name: myName,
                    inServer: true,
                    inVoice: isConnected,
                    isSelf: true,
                    pos: null
                });
            }
        }

        const totalCount = allPlayersMap.size;
        if (nearbyCountBadge) {
            nearbyCountBadge.textContent = `${totalCount} คน`;
        }

        if (totalCount === 0) {
            speakersList.innerHTML = `
                <div class="mf-empty">
                    <div class="mf-empty-icon">🎮</div>
                    <div class="mf-empty-text">ยังไม่มีผู้เล่นในเซิร์ฟเวอร์</div>
                    <div class="mf-empty-sub">เมื่อมีคนเข้าเล่นเกมมายคราฟ รายชื่อจะแสดงที่นี่อัตโนมัติ</div>
                </div>
            `;
            return;
        }

        speakersList.innerHTML = '';

        const myX = isSimMode && simPosX ? parseFloat(simPosX.value) || 0 : (audioEngine?.listenerPos?.x || 0);
        const myZ = isSimMode && simPosZ ? parseFloat(simPosZ.value) || 0 : (audioEngine?.listenerPos?.z || 0);

        allPlayersMap.forEach((entry) => {
            const isMe = entry.isSelf || (entry.name.toLowerCase() === myLower);
            const div = document.createElement('div');
            div.className = 'speaker-item' + (isMe ? ' me-item' : '');

            let distStr = '';
            if (entry.pos && myX !== undefined && myZ !== undefined && !isMe) {
                const dist = Math.hypot(entry.pos.x - myX, entry.pos.z - myZ);
                distStr = ` · ${dist.toFixed(1)}m`;
            }

            let statusHtml = '';
            if (isMe) {
                statusHtml = `<span class="speaker-status me">👤 คุณ (${isConnected ? 'เปิดไมค์แล้ว' : 'ยังไม่เปิดไมค์'})</span>`;
            } else if (entry.inVoice) {
                statusHtml = `<span class="speaker-status voice">🔊 เปิดไมค์แล้ว${distStr}</span>`;
            } else {
                statusHtml = `<span class="speaker-status game">🎮 อยู่ในเกม</span>`;
            }

            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.15rem;">👤</span>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span class="speaker-name">${entry.name}</span>
                        <small style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.72rem;">
                            ${entry.inVoice ? 'ระบบไมค์ 3D กำลังทำงาน' : 'กำลังเล่นในมายคราฟ'}
                        </small>
                    </div>
                </div>
                ${statusHtml}
            `;

            // If user hasn't connected yet, tapping any player card fills their name
            if (!isConnected && !isMe) {
                div.style.cursor = 'pointer';
                div.title = `แตะเพื่อเลือกชื่อ ${entry.name}`;
                div.addEventListener('click', () => {
                    if (playerNameInput) {
                        playerNameInput.value = entry.name;
                        localStorage.setItem('voice_mc_gamertag', entry.name);
                        updateSpeakersList();
                    }
                });
            }

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
                    peersData.forEach((p, id) => {
                        audioEngine.updatePeerAudio(id, p);
                    });
                    updateSpeakersList();
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
