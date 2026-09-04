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

            // Use looping silent WAV data URI to force mobile OS (Android/iOS) to treat tab as active media player
            const audioEl = document.createElement('audio');
            audioEl.id = 'mf_bg_audio_lock';
            audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
            audioEl.loop = true;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            audioEl.setAttribute('playsinline', '');
            audioEl.setAttribute('webkit-playsinline', '');
            audioEl.volume = 0.001;
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
            }
        } catch (e) {
            console.warn('Background audio session:', e);
        }
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
     */
    updateListenerPose(pos, view) {
        if (!this.ctx) return;
        this.listenerPos = pos;
        this.listenerView = view;

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
        panner.distanceModel = 'inverse';
        panner.refDistance = 2;
        panner.maxDistance = 15;
        panner.rolloffFactor = 1.0;
        panner.coneInnerAngle = 360;

        // Peer Master Gain
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = 1.0;

        // Wire nodes: Source -> Occlusion -> Panner -> Gain -> Destination
        source.connect(occlusion.input);
        occlusion.output.connect(panner);
        panner.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        // Reverb Send
        const reverbSend = this.ctx.createGain();
        reverbSend.gain.value = 0.1;
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
     * Updates peer 3D position, distance model, and wall occlusion
     */
    updatePeerAudio(peerId, peerData) {
        const chain = this.peerChains.get(peerId);
        if (!chain || !this.ctx) return;

        const now = this.ctx.currentTime;
        const { pos, maxDistance, refDistance, occlusions } = peerData;

        // Dynamic voice mode distance (whisper 4m, normal 15m, shout 35m)
        if (maxDistance && chain.panner.maxDistance !== maxDistance) {
            chain.panner.maxDistance = maxDistance;
        }
        if (refDistance && chain.panner.refDistance !== refDistance) {
            chain.panner.refDistance = refDistance;
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
                // Find occlusion relative to local player if specified, or first entry
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
