/**
 * ====================================================================
 *                 ROLEPLAY SPATIAL AUDIO ENGINE
 *       Web Audio API Master Pipeline (HRTF 3D + Wall Occlusion)
 *                      Author: ZirconX
 * ====================================================================
 */

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.localStream = null;
        this.localSource = null;
        this.analyser = null;

        // Peer audio pipelines: peerId -> PeerAudioChain
        this.peerChains = new Map();

        this.isMuted = false;
        this.listenerPos = { x: 0, y: 0, z: 0 };
        this.listenerView = { x: 0, y: 0, z: 1 };
    }

    /**
     * Initializes AudioContext and Mic Stream
     */
    async init() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        // Get microphone with browser-level noise suppression & AEC
        this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        // Setup analyser for VU Meter
        this.localSource = this.ctx.createMediaStreamSource(this.localStream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.5;
        this.localSource.connect(this.analyser);

        // Setup Cave Reverb Bus
        this.reverbNode = this.ctx.createConvolver();
        this.reverbNode.buffer = this.createCaveImpulseResponse(1.8, 2.5);
        this.reverbMasterGain = this.ctx.createGain();
        this.reverbMasterGain.gain.value = 0.15;
        this.reverbNode.connect(this.reverbMasterGain);
        this.reverbMasterGain.connect(this.ctx.destination);

        // Keep-alive silent loop to prevent mobile browsers (iOS/Android) from sleeping in background
        this.enableBackgroundAudioSession();

        return this.localStream;
    }

    /**
     * Prevents iOS Safari & Android Chrome from cutting audio/mic when tab is in background (e.g. entering Minecraft)
     */
    enableBackgroundAudioSession() {
        try {
            if (this.bgAudio) return;

            // Auto-resume AudioContext on state change
            if (this.ctx) {
                this.ctx.onstatechange = () => {
                    if (this.ctx && this.ctx.state === 'suspended') {
                        this.ctx.resume().catch(() => {});
                    }
                };
            }

            // Create a live endless silent MediaStream from AudioContext
            let silentStream = null;
            try {
                const silentDest = this.ctx.createMediaStreamDestination();
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = 20; // Inaudible 20Hz infrasound
                gain.gain.value = 0.0001; // Non-zero live PCM frames keep Android Audio HAL active
                osc.connect(gain);
                gain.connect(silentDest);
                osc.start();
                silentStream = silentDest.stream;
            } catch (e) {
                console.warn('Silent stream destination error:', e);
            }

            const audioEl = document.createElement('audio');
            audioEl.id = 'mf_bg_audio_lock';
            if (silentStream) {
                audioEl.srcObject = silentStream;
            } else {
                // Fallback: valid 16-sample PCM WAV
                audioEl.src = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
                audioEl.loop = true;
            }
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            audioEl.setAttribute('playsinline', '');
            audioEl.setAttribute('webkit-playsinline', '');
            audioEl.volume = 0.01;
            audioEl.muted = false; // Must NOT be muted for Android OS to treat as foreground audio
            audioEl.style.position = 'fixed';
            audioEl.style.width = '1px';
            audioEl.style.height = '1px';
            audioEl.style.opacity = '0.01';
            audioEl.style.pointerEvents = 'none';
            document.body.appendChild(audioEl);

            audioEl.play().catch(() => {});
            this.bgAudio = audioEl;

            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: 'Minecraft Voice (Proximity)',
                    artist: 'Voice Server Active',
                    album: 'Background Voice Chat'
                });
                navigator.mediaSession.playbackState = 'playing';
                try {
                    navigator.mediaSession.setActionHandler('play', () => {
                        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
                        if (audioEl.paused) audioEl.play().catch(() => {});
                    });
                    navigator.mediaSession.setActionHandler('pause', () => {});
                } catch {}
            }
        } catch (e) {
            console.warn('Background audio session lock error:', e);
        }
    }

    /**
     * Explicitly activates background audio output with elevated volume to lock Android/iOS audio session
     */
    activateBackgroundAudio() {
        if (!this.bgAudio) {
            this.enableBackgroundAudioSession();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        if (this.bgAudio) {
            this.bgAudio.volume = 0.05;
            this.bgAudio.muted = false;
            return this.bgAudio.play();
        }
        return Promise.resolve();
    }

    /**
     * Reads current mic volume level (0.0 to 1.0)
     */
    getMicLevel() {
        if (!this.analyser || this.isMuted) return 0;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i];
        }
        const avg = sum / data.length;
        return Math.min(1.0, avg / 128);
    }

    /**
     * Toggles microphone mute
     */
    toggleMute() {
        if (!this.localStream) return true;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });
        return this.isMuted;
    }

    /**
     * Updates AudioContext Listener pose (Player's ears)
    /**
     * Updates listener 3D position, orientation, and dimension
     */
    updateListenerPose(pos, view, dim) {
        if (!this.ctx || !pos || !view) return;
        this.listenerPos = pos;
        this.listenerView = view;
        if (dim) this.listenerDim = dim;

        const listener = this.ctx.listener;
        const now = this.ctx.currentTime;

        if (listener.positionX) {
            listener.positionX.setTargetAtTime(pos.x, now, 0.05);
            listener.positionY.setTargetAtTime(pos.y, now, 0.05);
            listener.positionZ.setTargetAtTime(pos.z, now, 0.05);

            listener.forwardX.setTargetAtTime(view.x, now, 0.05);
            listener.forwardY.setTargetAtTime(view.y, now, 0.05);
            listener.forwardZ.setTargetAtTime(view.z, now, 0.05);
            listener.upX.setTargetAtTime(0, now, 0.05);
            listener.upY.setTargetAtTime(1, now, 0.05);
            listener.upZ.setTargetAtTime(0, now, 0.05);
        } else {
            listener.setPosition(pos.x, pos.y, pos.z);
            listener.setOrientation(view.x, view.y, view.z, 0, 1, 0);
        }
    }

    /**
     * Creates or gets the audio processing chain for a remote peer
     */
    getOrCreatePeerChain(peerId, remoteStream) {
        let chain = this.peerChains.get(peerId);
        if (chain) {
            if (remoteStream && chain.stream !== remoteStream) {
                this.removePeerChain(peerId);
            } else {
                return chain;
            }
        }

        const source = this.ctx.createMediaStreamSource(remoteStream);
        const occlusion = new window.OcclusionFilter(this.ctx);

        // 3D HRTF Panner
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'linear';
        panner.refDistance = 2;
        panner.maxDistance = 15;
        panner.rolloffFactor = 1.0;
        panner.coneInnerAngle = 360;

        // Peer Master Gain (starts at 0 until telemetry position is verified)
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = 0.0;

        // Wire nodes: Source -> Occlusion -> Panner -> Gain -> Destination
        source.connect(occlusion.input);
        occlusion.output.connect(panner);
        panner.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        // Reverb Send
        const reverbSend = this.ctx.createGain();
        reverbSend.gain.value = 0.0;
        panner.connect(reverbSend);
        reverbSend.connect(this.reverbNode);

        chain = {
            peerId,
            stream: remoteStream,
            source,
            occlusion,
            panner,
            gainNode,
            reverbSend
        };

        this.peerChains.set(peerId, chain);
        return chain;
    }

    /**
     * Updates peer 3D position, distance model, strict cutoff, and wall occlusion
     */
    updatePeerAudio(peerId, peerData) {
        const chain = this.peerChains.get(peerId);
        if (!chain || !this.ctx) return;

        const now = this.ctx.currentTime;
        const { pos, maxDistance, refDistance, occlusions, dim, radioChannel, radioPtt } = peerData;

        // Dynamic voice mode max distance (Whisper 4m, Normal 15m, Shout 35m)
        const effectiveMax = typeof maxDistance === 'number' && maxDistance > 0 ? maxDistance : 15;
        const effectiveRef = typeof refDistance === 'number' && refDistance > 0 ? refDistance : 2;

        if (chain.panner.maxDistance !== effectiveMax) {
            chain.panner.maxDistance = effectiveMax;
        }
        if (chain.panner.refDistance !== effectiveRef) {
            chain.panner.refDistance = effectiveRef;
        }

        let targetGain = 0.0;

        // Check dimension mismatch (e.g. Overworld vs Nether vs The End)
        const isDifferentDim = Boolean(dim && this.listenerDim && dim !== this.listenerDim);

        // Check Walkie-Talkie Radio
        const isRadioActive = Boolean(radioChannel && radioPtt && this.localRadioChannel && radioChannel === this.localRadioChannel);

        if (isRadioActive) {
            // Radio ignores distance falloff
            targetGain = 1.0;
        } else if (isDifferentDim || !pos || !this.listenerPos) {
            // In another dimension or coordinates unknown -> 100% Silence
            targetGain = 0.0;
        } else {
            // 3D Euclidean distance in Minecraft blocks / meters
            const dx = (pos.x || 0) - (this.listenerPos.x || 0);
            const dy = (pos.y || 0) - (this.listenerPos.y || 0);
            const dz = (pos.z || 0) - (this.listenerPos.z || 0);
            const distance = Math.hypot(dx, dy, dz);

            if (distance >= effectiveMax) {
                // Out of hearing distance -> 0.0 SILENCE!
                targetGain = 0.0;
            } else if (distance <= effectiveRef) {
                // Close range -> 100% full volume
                targetGain = 1.0;
            } else {
                // Natural smooth cosine falloff (1.0 down to 0.0 at effectiveMax)
                const norm = (distance - effectiveRef) / (effectiveMax - effectiveRef);
                targetGain = Math.cos(norm * (Math.PI / 2));
            }
        }

        // Apply strict gain with smooth ramp (prevent popping / clicking artifacts)
        chain.gainNode.gain.setTargetAtTime(targetGain, now, 0.05);
        if (chain.reverbSend) {
            chain.reverbSend.gain.setTargetAtTime(0.1 * targetGain, now, 0.05);
        }

        if (pos) {
            // Smooth 3D Panner Position Interpolation
            if (chain.panner.positionX) {
                chain.panner.positionX.setTargetAtTime(pos.x, now, 0.05);
                chain.panner.positionY.setTargetAtTime(pos.y, now, 0.05);
                chain.panner.positionZ.setTargetAtTime(pos.z, now, 0.05);
            } else {
                chain.panner.setPosition(pos.x, pos.y, pos.z);
            }

            // Update Wall Occlusion (Lowpass Muffling)
            let occlusionRatio = 0.0;
            if (occlusions) {
                const occValues = Object.values(occlusions);
                if (occValues.length > 0 && typeof occValues[0]?.occlusion === 'number') {
                    occlusionRatio = occValues[0].occlusion;
                }
            }
            chain.occlusion.setOcclusion(occlusionRatio);
        }
    }

    /**
     * Removes peer audio nodes on disconnect
     */
    removePeerChain(peerId) {
        const chain = this.peerChains.get(peerId);
        if (!chain) return;

        try {
            chain.source.disconnect();
            chain.occlusion.output.disconnect();
            chain.panner.disconnect();
            chain.gainNode.disconnect();
        } catch {}

        this.peerChains.delete(peerId);
    }

    /**
     * Algorithmic Cave Impulse Response
     */
    createCaveImpulseResponse(duration, decay) {
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.ctx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const envelope = Math.exp(-t * decay);
            const noiseL = (Math.random() * 2 - 1) * envelope;
            const noiseR = (Math.random() * 2 - 1) * envelope;
            left[i] = noiseL;
            right[i] = noiseR;
        }

        return impulse;
    }
}

window.AudioEngine = AudioEngine;
