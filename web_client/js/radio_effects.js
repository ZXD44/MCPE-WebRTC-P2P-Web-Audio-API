/**
 * ====================================================================
 *                 RADIO EFFECTS & MIC CLICKS SYNTHESIZER
 *       Analog Walkie-Talkie Filter + PTT Mic Clicks (100% Free)
 *                      Author: ZirconX
 * ====================================================================
 */

class RadioEffectsEngine {
    constructor(audioCtx) {
        this.ctx = audioCtx;
        this.noiseBuffer = this.generateWhiteNoiseBuffer(0.5);
    }

    /**
     * Creates an analog radio bandpass filter chain (300Hz - 3400Hz)
     * @returns {{ input: AudioNode, output: AudioNode, setEnabled: (bool) => void }}
     */
    createRadioFilterChain() {
        const input = this.ctx.createGain();
        const output = this.ctx.createGain();

        // Highpass (cut everything below 300Hz)
        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 300;
        highpass.Q.value = 0.7;

        // Lowpass (cut everything above 3400Hz)
        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 3400;
        lowpass.Q.value = 0.7;

        // Subtle distortion wave shaper for walkie-talkie grit
        const dist = this.ctx.createWaveShaper();
        dist.curve = this.makeDistortionCurve(12);
        dist.oversample = 'none';

        // Bypass / Wet crossfade
        const dryGain = this.ctx.createGain();
        const wetGain = this.ctx.createGain();
        wetGain.gain.value = 0; // default off
        dryGain.gain.value = 1;

        // Routing
        input.connect(dryGain);
        dryGain.connect(output);

        input.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(dist);
        dist.connect(wetGain);
        wetGain.connect(output);

        const setEnabled = (enabled) => {
            const now = this.ctx.currentTime;
            if (enabled) {
                dryGain.gain.setTargetAtTime(0, now, 0.02);
                wetGain.gain.setTargetAtTime(1.0, now, 0.02);
            } else {
                dryGain.gain.setTargetAtTime(1.0, now, 0.02);
                wetGain.gain.setTargetAtTime(0, now, 0.02);
            }
        };

        return { input, output, setEnabled };
    }

    /**
     * Synthesizes Walkie-Talkie PTT Press Click sound
     */
    playPTTClickOn() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        // 1. High frequency click burst
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.025);

        oscGain.gain.setValueAtTime(0.25, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

        osc.connect(oscGain);
        oscGain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.025);

        // 2. Short noise burst (keying mic)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 2200;
        noiseFilter.Q.value = 2;

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.12, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        noise.start(now);
        noise.stop(now + 0.035);
    }

    /**
     * Synthesizes Walkie-Talkie PTT Release Squelch Tail sound
     */
    playPTTClickOff() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        // 1. White noise squelch burst (radio gate closing)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 1800;
        noiseFilter.Q.value = 1.2;

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.2, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        noise.start(now);
        noise.stop(now + 0.06);

        // 2. Trailing low click
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, now + 0.01);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.05);

        oscGain.gain.setValueAtTime(0.15, now + 0.01);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(oscGain);
        oscGain.connect(this.ctx.destination);
        osc.start(now + 0.01);
        osc.stop(now + 0.05);
    }

    /**
     * Distortion curve generator
     */
    makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    /**
     * Pre-generates white noise buffer
     */
    generateWhiteNoiseBuffer(durationSeconds) {
        if (!this.ctx) return null;
        const bufferSize = this.ctx.sampleRate * durationSeconds;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }
}

window.RadioEffectsEngine = RadioEffectsEngine;
