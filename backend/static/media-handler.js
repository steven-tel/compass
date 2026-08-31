/**
 * MediaHandler: Manages Audio/Video capture and playback
 */
class MediaHandler {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.audioWorkletNode = null;
    this.videoStream = null;
    this.videoInterval = null;
    this.nextStartTime = 0;
    this.scheduledSources = [];
    this.isRecording = false;
    this.videoCanvas = document.createElement("canvas");
    this.canvasCtx = this.videoCanvas.getContext("2d");
  }

  static describeError(error, kind) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!window.isSecureContext) {
        return `${kind} requires HTTPS or http://localhost. Open http://localhost:8000 in Chrome or Safari (not a LAN IP over HTTP).`;
      }
      return `${kind} is not available in this browser or in-app preview. Open this page in Chrome or Safari.`;
    }
    const name = error && error.name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return `${kind} permission was blocked. Click the camera/mic icon in the address bar, allow access, then retry.`;
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return `No ${kind.toLowerCase()} device was found.`;
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return `${kind} is already in use by another app. Close it and retry.`;
    }
    if (name === "SecurityError") {
      return error.message || `${kind} is blocked in this context.`;
    }
    return `Could not access ${kind.toLowerCase()}: ${name || error.message || error}`;
  }

  async _getUserMedia(constraints) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error(
        window.isSecureContext
          ? "Camera/microphone APIs are unavailable in this browser or preview. Open http://localhost:8000 in Chrome or Safari."
          : "Camera/microphone require a secure context. Use https:// or http://localhost:8000."
      );
      err.name = "SecurityError";
      throw err;
    }
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  async initializeAudio() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      await this.audioContext.audioWorklet.addModule(
        "/static/pcm-processor.js"
      );
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async startAudio(onAudioData) {
    try {
      // Request the mic first so the click still counts as a user gesture.
      this.mediaStream = await this._getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      await this.initializeAudio();
      const source = this.audioContext.createMediaStreamSource(
        this.mediaStream
      );
      this.audioWorkletNode = new AudioWorkletNode(
        this.audioContext,
        "pcm-processor"
      );

      this.audioWorkletNode.port.onmessage = (event) => {
        if (this.isRecording) {
          const downsampled = this.downsampleBuffer(
            event.data,
            this.audioContext.sampleRate,
            16000
          );
          const pcm16 = this.convertFloat32ToInt16(downsampled);
          onAudioData(pcm16);
        }
      };

      source.connect(this.audioWorkletNode);
      // Mute local feedback
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      this.audioWorkletNode.connect(muteGain);
      muteGain.connect(this.audioContext.destination);

      this.isRecording = true;
    } catch (e) {
      this.stopAudio();
      console.error("Error starting audio:", e);
      throw e;
    }
  }

  stopAudio() {
    this.isRecording = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
  }

  async startVideo(videoElement, onFrame) {
    try {
      try {
        this.videoStream = await this._getUserMedia({
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
      } catch (constraintErr) {
        if (constraintErr && constraintErr.name !== "OverconstrainedError") {
          throw constraintErr;
        }
        this.videoStream = await this._getUserMedia({ video: true });
      }
      await this._attachVideo(videoElement);

      this.videoInterval = setInterval(() => {
        this.captureFrame(videoElement, onFrame);
      }, 1000); // 1 FPS
    } catch (e) {
      this.stopVideo(videoElement);
      console.error("Error starting video:", e);
      throw e;
    }
  }

  async _attachVideo(videoElement) {
    videoElement.srcObject = this.videoStream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.setAttribute("playsinline", "");
    try {
      await videoElement.play();
    } catch (playErr) {
      console.warn("video.play() failed:", playErr);
    }
  }

  async startScreen(videoElement, onFrame, onEnded) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        const err = new Error(
          "Screen sharing is not available in this browser or preview."
        );
        err.name = "SecurityError";
        throw err;
      }
      this.videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      await this._attachVideo(videoElement);

      // Handle stream ending (e.g. user clicks "Stop sharing" in browser UI)
      this.videoStream.getVideoTracks()[0].onended = () => {
        this.stopVideo(videoElement);
        if (onEnded) onEnded();
      };

      this.videoInterval = setInterval(() => {
        this.captureFrame(videoElement, onFrame);
      }, 1000); // 1 FPS
    } catch (e) {
      this.stopVideo(videoElement);
      console.error("Error starting screen share:", e);
      throw e;
    }
  }

  stopVideo(videoElement) {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((t) => t.stop());
      this.videoStream = null;
    }
    if (this.videoInterval) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
  }

  captureFrame(videoElement, onFrame) {
    if (!this.videoStream || videoElement.readyState < 2) return;
    const width = videoElement.videoWidth || 640;
    const height = videoElement.videoHeight || 480;
    this.videoCanvas.width = width;
    this.videoCanvas.height = height;
    this.canvasCtx.drawImage(videoElement, 0, 0, width, height);
    const base64 = this.videoCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];
    onFrame(base64);
  }

  playAudio(arrayBuffer) {
    if (!this.audioContext) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    const pcmData = new Int16Array(arrayBuffer);
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      float32Data[i] = pcmData[i] / 32768.0;
    }

    const buffer = this.audioContext.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    this.nextStartTime = Math.max(now, this.nextStartTime);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.scheduledSources.push(source);
    source.onended = () => {
      const idx = this.scheduledSources.indexOf(source);
      if (idx > -1) this.scheduledSources.splice(idx, 1);
    };
  }

    stopAudioPlayback() {
    this.scheduledSources.forEach((s) => {
      try {
        s.stop();
      } catch (e) {}
    });
    this.scheduledSources = [];
    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  playbackRemainingMs() {
    if (!this.audioContext) return 0;
    const remaining = this.nextStartTime - this.audioContext.currentTime;
    return Math.max(0, remaining * 1000);
  }

  waitUntilPlaybackIdle(timeoutMs = 4000) {
    const remaining = this.playbackRemainingMs();
    const wait = Math.min(timeoutMs, remaining + 150);
    return new Promise((resolve) => setTimeout(resolve, wait));
  }

  // Utils
  downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate === sampleRate) return buffer;
    const ratio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0,
        count = 0;
      for (
        let i = offsetBuffer;
        i < nextOffsetBuffer && i < buffer.length;
        i++
      ) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  convertFloat32ToInt16(buffer) {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7fff;
    }
    return buf.buffer;
  }
}
