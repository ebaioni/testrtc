'use strict';

function CamFrameTest(test, mediaStream = null, stopTracks = true, testLengthTime = 5000, thresholdPass = 30) {
    this.test = test;
    this.isShuttingDown = false;
    this.stopTracks = stopTracks;
    this.timeout = testLengthTime;
    this.mediastream = mediaStream;
    this.thresholdPass = thresholdPass;
}

CamFrameTest.prototype = {
    run: function() {
        this.startGetUserMedia();
    },

    startGetUserMedia: function() {
        if (!this.mediastream) {
            const constraints = {
                audio: false,
                video: true
            };
            navigator.mediaDevices.getUserMedia(constraints)
                .then(function(stream) {
                    this.collectAndAnalyzeStats_(stream);
                }.bind(this))
                .catch(function(error) {
                    this.test.reportError('getUserMedia failed with error: ' +
                        error.name);
                    this.test.done();
                }.bind(this));
        } else {
            this.collectAndAnalyzeStats_(this.mediastream);
        }
    },

    collectAndAnalyzeStats_: function(stream) {
        const tracks = stream.getVideoTracks();
        if (tracks.length < 1) {
            this.test.reportError('No video track in returned stream.');
            this.test.done();
            return;
        }

        const videoTrack = tracks[0];
        if (typeof videoTrack.addEventListener === 'function') {
            // Register events.
            videoTrack.addEventListener('ended', function() {
                // Ignore events when shutting down the test.
                if (this.isShuttingDown) {
                    return;
                }
                this.test.reportError('Video track ended, camera stopped working');
            }.bind(this));
        }

        const video = document.createElement('video');
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        video.width = stream.getVideoTracks()[0].getSettings().width;
        video.height = stream.getVideoTracks()[0].getSettings().height;
        console.log('video details', video);
        video.srcObject = stream;
        const frameChecker = new VideoFrameChecker(video);
        setTimeout(() => {
            frameChecker.stop();
            this.analyzeStats_(frameChecker);
            if (this.stopTracks) {
                tracks.map(t => t.stop());
            }
        }, this.timeout)

    },

    analyzeStats_: function(frameChecker) {
        const frameStats = frameChecker.frameStats;
        console.log('frameStats', frameStats);
        if (frameStats.numFrames === 0) {
            this.test.reportError('Could not analyze any video frame.');
            this.test.done();
            return;
        }
        const passNumber = Math.floor(this.thresholdPass *  frameStats.numFrames / 100);
        console.log('passnumber', passNumber);
        if (frameStats.numBlackFrames > passNumber) {
            this.test.reportError('Camera delivering lots of black frames.');
            this.test.done();
            return;
        }
        if (frameStats.numFrozenFrames > frameStats.numFrames / 3) {
            this.test.reportError('Camera delivering lots of frozen frames.');
            this.test.done();
            return;
        }
        this.test.reportSuccess('All good');
        this.test.done();
    },
};
