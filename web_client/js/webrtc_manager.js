/**
 * ====================================================================
 *                 WEBRTC P2P MANAGER (100% FREE STUN)
 *           Zero-Cost Audio Streaming via Google Public STUN
 *                      Author: ZirconX
 * ====================================================================
 */

class WebRTCManager {
    constructor(wsSignaler, audioEngine) {
        this.ws = wsSignaler;
        this.audioEngine = audioEngine;
        this.peers = new Map(); // peerId -> RTCPeerConnection

        // 100% Free Google STUN Servers
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
    }

    /**
     * Initiates WebRTC call to a new peer
     */
    async callPeer(targetPeerId) {
        if (this.peers.has(targetPeerId)) return;

        const pc = this.createPeerConnection(targetPeerId);
        this.peers.set(targetPeerId, pc);

        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            await pc.setLocalDescription(offer);

            this.ws.send(JSON.stringify({
                type: 'webrtc_offer',
                to: targetPeerId,
                payload: offer
            }));
        } catch (err) {
            console.error(`Failed to create offer for ${targetPeerId}:`, err);
        }
    }

    /**
     * Handles incoming WebRTC Offer
     */
    async handleOffer(fromPeerId, offer) {
        let pc = this.peers.get(fromPeerId);
        if (!pc) {
            pc = this.createPeerConnection(fromPeerId);
            this.peers.set(fromPeerId, pc);
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.ws.send(JSON.stringify({
                type: 'webrtc_answer',
                to: fromPeerId,
                payload: answer
            }));
        } catch (err) {
            console.error(`Failed to handle offer from ${fromPeerId}:`, err);
        }
    }

    /**
     * Handles incoming WebRTC Answer
     */
    async handleAnswer(fromPeerId, answer) {
        const pc = this.peers.get(fromPeerId);
        if (!pc) return;

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
            console.error(`Failed to set remote answer from ${fromPeerId}:`, err);
        }
    }

    /**
     * Handles incoming ICE Candidate
     */
    async handleIceCandidate(fromPeerId, candidate) {
        const pc = this.peers.get(fromPeerId);
        if (!pc || !candidate) return;

        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error(`Failed to add ICE candidate from ${fromPeerId}:`, err);
        }
    }

    /**
     * Creates and configures an RTCPeerConnection instance
     */
    createPeerConnection(targetPeerId) {
        const pc = new RTCPeerConnection(this.rtcConfig);

        // Add local mic audio tracks
        if (this.audioEngine.localStream) {
            this.audioEngine.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.audioEngine.localStream);
            });
        }

        // Send ICE candidate to peer
        pc.onicecandidate = event => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'webrtc_ice',
                    to: targetPeerId,
                    payload: event.candidate
                }));
            }
        };

        // When remote audio track is received
        pc.ontrack = event => {
            console.log(`[WebRTC] Received audio stream from ${targetPeerId}`);
            const remoteStream = event.streams[0] || new MediaStream([event.track]);
            this.audioEngine.getOrCreatePeerChain(targetPeerId, remoteStream);
        };

        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] ${targetPeerId} state: ${pc.connectionState}`);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closePeer(targetPeerId);
            }
        };

        return pc;
    }

    /**
     * Closes connection with a peer
     */
    closePeer(peerId) {
        const pc = this.peers.get(peerId);
        if (pc) {
            pc.close();
            this.peers.delete(peerId);
        }
        this.audioEngine.removePeerChain(peerId);
    }
}

window.WebRTCManager = WebRTCManager;
