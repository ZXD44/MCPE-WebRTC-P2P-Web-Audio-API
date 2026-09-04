/**
 * ====================================================================
 *                 WALL OCCLUSION & MUFFLING FILTER
 *      Low-pass Biquad Filter for Realistic Sound Obstacles
 *                      Author: ZirconX
 * ====================================================================
 */

class OcclusionFilter {
    /**
     * @param {AudioContext} audioCtx 
     */
    constructor(audioCtx) {
        this.ctx = audioCtx;
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 20000;
        this.filter.Q.value = 0.707;

        this.attenuationGain = this.ctx.createGain();
        this.attenuationGain.gain.value = 1.0;

        // Connect filter -> attenuation
        this.filter.connect(this.attenuationGain);

        this.currentOcclusion = 0.0;
    }

    get input() {
        return this.filter;
    }

    get output() {
        return this.attenuationGain;
    }

    /**
     * Updates the muffling filter based on occlusion ratio (0.0 to 1.0)
     * @param {number} occlusion 0.0 = clear air, 1.0 = solid wall
     * @param {number} [transitionSec=0.08]
     */
    setOcclusion(occlusion, transitionSec = 0.08) {
        const clamped = Math.max(0.0, Math.min(1.0, occlusion));
        this.currentOcclusion = clamped;
        const now = this.ctx.currentTime;

        if (clamped <= 0.02) {
            // Completely open air
            this.filter.frequency.setTargetAtTime(20000, now, transitionSec);
            this.filter.Q.setTargetAtTime(0.707, now, transitionSec);
            this.attenuationGain.gain.setTargetAtTime(1.0, now, transitionSec);
        } else {
            // Exponential frequency drop from 20000Hz down to 450Hz
            const minHz = 450;
            const maxHz = 20000;
            const targetFreq = maxHz * Math.pow(minHz / maxHz, clamped);

            // Resonant Q increases when muffled (creates classic "behind a wall" acoustic boxiness)
            const targetQ = 0.707 + (clamped * 1.8);

            // Slight volume reduction
            const targetGain = 1.0 - (clamped * 0.45);

            this.filter.frequency.setTargetAtTime(Math.max(minHz, targetFreq), now, transitionSec);
            this.filter.Q.setTargetAtTime(targetQ, now, transitionSec);
            this.attenuationGain.gain.setTargetAtTime(Math.max(0.2, targetGain), now, transitionSec);
        }
    }
}

window.OcclusionFilter = OcclusionFilter;
