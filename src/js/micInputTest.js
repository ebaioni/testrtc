'use strict';

function MicInputTest(test, mediaStream = null, stopTracks = true, sampleNumber = 100, threshold = 10) {
    this.test = test;
    this.stopTracks = stopTracks;
    this.sampleNumber = sampleNumber;
    this.threshold = threshold;
    this.mediastream = mediaStream;

    this.calculateVolume = this.calculateVolume.bind(this);
    this.mediaStream = mediaStream;
}

MicInputTest.prototype = {
    init() {
        this.audioCtx = new (window.webkitAudioContext || window.AudioContext)();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.minDecibels = -90;
        this.analyser.maxDecibels = -10;
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.85;
    },
    run: function() {
        if (this.audioCtx) {
            console.log('closing prev audio');
            this.audioCtx.close();
            this.audioCtx = null;
        }
        this.startGetUserMedia();
    },

    startGetUserMedia: function() {
        if (!this.mediastream) {
            const constraints = {
                audio: true,
                video: false
            };
            navigator.mediaDevices.getUserMedia(constraints)
                .then(function(stream) {
                    this.mediaStream = stream;
                    this.init();
                    this.collectAndAnalyzeStats_(stream);
                }.bind(this))
                .catch(function(error) {
                    this.test.reportError('getUserMedia failed with error: ' +
                        error.name);
                    this.test.done();
                }.bind(this));
        } else {
            this.init();
            console.log('this.audiocontext', this.audioCtx);
            this.collectAndAnalyzeStats_(this.mediastream);
        }
    },

    collectAndAnalyzeStats_: function(stream) {
        if (!stream) {
            console.log('connectAudio - no mediaStream');
            this.test.reportError('connectAudio - no mediaStream');
            this.test.done();
            return;
        }
        const distortion = this.audioCtx.createWaveShaper();
        const gainNode = this.audioCtx.createGain();
        const biquadFilter = this.audioCtx.createBiquadFilter();
        const convolver = this.audioCtx.createConvolver();
        const source = this.audioCtx.createMediaStreamSource(stream);
        source.connect(distortion);
        distortion.connect(biquadFilter);
        biquadFilter.connect(gainNode);
        convolver.connect(gainNode);
        gainNode.connect(this.analyser);
        const bufferLengthAlt = this.analyser.frequencyBinCount;
        const dataArrayAlt = new Uint8Array(bufferLengthAlt);
        this.analyser.getByteFrequencyData(dataArrayAlt);
        this.dataArrayAlt = dataArrayAlt;
        this.bufferLengthAlt = bufferLengthAlt;
        this.averages = [];
        this.calculateVolume();
    },
    calculateVolume() {
        this.requestId = requestAnimationFrame(this.calculateVolume);

        this.analyser.getByteFrequencyData(this.dataArrayAlt);
        let values = 0;

        for (let i = 0; i < this.bufferLengthAlt; i++) {
            values += this.dataArrayAlt[i];
        }
        // console.log('values', values, this.dataArrayAlt);
        const newData = this.dataArrayAlt.filter(v => v > 0);
        const average = Math.round((values / (newData.length || 1)) * 0.75);
        this.averages.push(average);
        this.test.reportInfo(`average: ${average}`);
        if (this.averages.length === this.sampleNumber) {
            if (this.requestId) {
                cancelAnimationFrame(this.requestId);
                this.requestId = null;
            }
            const sum = this.averages.reduce((a, b) => a + b, 0);
            const avg = (sum / this.averages.length) || 0;
            this.audioCtx.close();
            if (this.stopTracks && this.mediaStream) {
                this.mediaStream.getTracks().map(t => t.stop());
            }
            if (avg >= this.threshold) {
                this.test.reportSuccess(`Avg of ${this.sampleNumber} samples: ${avg} above ${this.threshold}`);
            } else {
                this.test.reportError(`Avg of ${this.sampleNumber} samples: ${avg} BELOW ${this.threshold}`);
            }
            console.log('this.averages', avg, 'finalk', this.averages);
            this.test.done();
        }
    },
};
