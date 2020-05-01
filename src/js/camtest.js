/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

function CamTest(test, stopTracks = true) {
    this.test = test;
    this.isMuted = false;
    this.isShuttingDown = false;
    this.stopTracks = stopTracks;
}

CamTest.prototype = {
    run: function() {
        this.startGetUserMedia();
    },

    startGetUserMedia: function(resolution) {
        var constraints = {
            audio: false,
            video: true
        };
        console.log('resolutions-constraints', constraints);
        navigator.mediaDevices.getUserMedia(constraints)
            .then(function(stream) {

                this.collectAndAnalyzeStats_(stream, resolution);
            }.bind(this))
            .catch(function(error) {
                console.log('ERRROR', error);

                this.test.reportError('getUserMedia failed with error: ' +
                    error.name);
            }.bind(this));
    },

    maybeContinueGetUserMedia: function() {
        this.test.done();
    },

    collectAndAnalyzeStats_: function(stream, resolution) {
        var tracks = stream.getVideoTracks();
        if (tracks.length < 1) {
            this.test.reportError('No video track in returned stream.');
            this.maybeContinueGetUserMedia();
            return;
        }

        // Firefox does not support event handlers on mediaStreamTrack yet.
        // https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack
        // TODO: remove if (...) when event handlers are supported by Firefox.
        var videoTrack = tracks[0];
        if (typeof videoTrack.addEventListener === 'function') {
            // Register events.
            videoTrack.addEventListener('ended', function() {
                // Ignore events when shutting down the test.
                if (this.isShuttingDown) {
                    return;
                }
                this.test.reportError('Video track ended, camera stopped working');
            }.bind(this));
            videoTrack.addEventListener('mute', function() {
                // Ignore events when shutting down the test.
                if (this.isShuttingDown) {
                    return;
                }
                this.test.reportWarning('Your camera reported itself as muted.');
                // MediaStreamTrack.muted property is not wired up in Chrome yet,
                // checking isMuted local state.
                this.isMuted = true;
            }.bind(this));
            videoTrack.addEventListener('unmute', function() {
                // Ignore events when shutting down the test.
                if (this.isShuttingDown) {
                    return;
                }
                this.test.reportInfo('Your camera reported itself as unmuted.');
                this.isMuted = false;
            }.bind(this));
        }

        var video = document.createElement('video');
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        video.width = 200;
        video.height = 200;
        video.srcObject = stream;
        var frameChecker = new VideoFrameChecker(video);
        var call = new Call(null, this.test);
        call.pc1.addStream(stream);
        call.establishConnection();
        call.gatherStats(call.pc1, null, stream,
            this.onCallEnded_.bind(this, resolution, video,
                stream, frameChecker),
            100);

        setTimeoutWithProgressBar(this.endCall_.bind(this, call, stream), 8000);
    },

    onCallEnded_: function(resolution, videoElement, stream, frameChecker,
                           stats, statsTime) {
        this.analyzeStats_(resolution, videoElement, stream, frameChecker,
            stats, statsTime);

        frameChecker.stop();
        if (this.stopTracks) {
            stream.getTracks().forEach(function (track) { track.stop(); });
        }
        this.test.done();
    },

    analyzeStats_: function(resolution, videoElement, stream,
                            frameChecker, stats, statsTime) {
        console.log('analyzeStats_');
        var googAvgEncodeTime = [];
        var googAvgFrameRateInput = [];
        var googAvgFrameRateSent = [];
        var statsReport = {};
        var frameStats = frameChecker.frameStats;

        for (var index in stats) {
            if (stats[index].type === 'ssrc') {
                // Make sure to only capture stats after the encoder is setup.
                if (parseInt(stats[index].googFrameRateInput) > 0) {
                    googAvgEncodeTime.push(
                        parseInt(stats[index].googAvgEncodeMs));
                    googAvgFrameRateInput.push(
                        parseInt(stats[index].googFrameRateInput));
                    googAvgFrameRateSent.push(
                        parseInt(stats[index].googFrameRateSent));
                }
            }
        }

        statsReport.cameraName = stream.getVideoTracks()[0].label || NaN;
        statsReport.actualVideoWidth = videoElement.videoWidth;
        statsReport.actualVideoHeight = videoElement.videoHeight;
        statsReport.mandatoryWidth = 200;// resolution[0];
        statsReport.mandatoryHeight = 200;//resolution[1];
        statsReport.encodeSetupTimeMs =
            this.extractEncoderSetupTime_(stats, statsTime);
        statsReport.avgEncodeTimeMs = arrayAverage(googAvgEncodeTime);
        statsReport.minEncodeTimeMs = arrayMin(googAvgEncodeTime);
        statsReport.maxEncodeTimeMs = arrayMax(googAvgEncodeTime);
        statsReport.avgInputFps = arrayAverage(googAvgFrameRateInput);
        statsReport.minInputFps = arrayMin(googAvgFrameRateInput);
        statsReport.maxInputFps = arrayMax(googAvgFrameRateInput);
        statsReport.avgSentFps = arrayAverage(googAvgFrameRateSent);
        statsReport.minSentFps = arrayMin(googAvgFrameRateSent);
        statsReport.maxSentFps = arrayMax(googAvgFrameRateSent);
        statsReport.isMuted = this.isMuted;
        statsReport.testedFrames = frameStats.numFrames;
        statsReport.blackFrames = frameStats.numBlackFrames;
        statsReport.frozenFrames = frameStats.numFrozenFrames;
        console.log('statsReport');
        // TODO: Add a reportInfo() function with a table format to display
        // values clearer.
        report.traceEventInstant('video-stats', statsReport);

        this.testExpectations_(statsReport);
    },

    endCall_: function(callObject, stream) {
        this.isShuttingDown = true;
        if (this.stopTracks) {
            stream.getTracks().forEach(function(track) {
                track.stop();
            });
        }

        callObject.close();
    },

    extractEncoderSetupTime_: function(stats, statsTime) {
        for (var index = 0; index !== stats.length; index++) {
            if (stats[index].type === 'ssrc') {
                if (parseInt(stats[index].googFrameRateInput) > 0) {
                    return JSON.stringify(statsTime[index] - statsTime[0]);
                }
            }
        }
        return NaN;
    },

    resolutionMatchesIndependentOfRotationOrCrop_: function(aWidth, aHeight,
                                                            bWidth, bHeight) {
        var minRes = Math.min(bWidth, bHeight);
        return (aWidth === bWidth && aHeight === bHeight) ||
            (aWidth === bHeight && aHeight === bWidth) ||
            (aWidth === minRes && bHeight === minRes);
    },

    testExpectations_: function(info) {
        console.log('testExpectations_');
        var notAvailableStats = [];
        for (var key in info) {
            if (info.hasOwnProperty(key)) {
                if (typeof info[key] === 'number' && isNaN(info[key])) {
                    notAvailableStats.push(key);
                } else {
                    this.test.reportInfo(key + ': ' + info[key]);
                }
            }
        }
        if (notAvailableStats.length !== 0) {
            this.test.reportInfo('Not available: ' + notAvailableStats.join(', '));
        }

        if (isNaN(info.avgSentFps)) {
            this.test.reportInfo('Cannot verify sent FPS.');
        } else if (info.avgSentFps < 5) {
            this.test.reportError('Low average sent FPS: ' + info.avgSentFps);
        } else {
            this.test.reportSuccess('Average FPS above threshold');
        }
        this.test.reportSuccess('Captured video correclty');
        if (info.testedFrames === 0) {
            this.test.reportError('Could not analyze any video frame.');
        } else {
            if (info.blackFrames > info.testedFrames / 3) {
                this.test.reportError('Camera delivering lots of black frames.');
            }
            if (info.frozenFrames > info.testedFrames / 3) {
                this.test.reportError('Camera delivering lots of frozen frames.');
            }
        }
    }
};
