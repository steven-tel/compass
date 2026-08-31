export class MediaHandler {
  audioContext: AudioContext | null = null;
  mediaStream: MediaStream | null = null;
  audioWorkletNode: AudioWorkletNode | null = null;
  videoStream: MediaStream | null = null;
  videoInterval: number | null = null;
  nextStartTime = 0;
  scheduledSources: AudioBufferSourceNode[] = [];
  isRecording = false;
  private videoCanvas = document.createElement("canvas");
  private canvasCtx = this.videoCanvas.getContext("2d");

  static async primeAccess() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        for (const track of stream.getTracks()) track.stop();
      } catch {
        // TutorClient will surface camera/mic errors after connect.
      }
    }
  }

  static describeError(error: unknown, kind: string): string {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!window.isSecureContext) {
        return `${kind} requires HTTPS or localhost.`;
      }
      return `${kind} is not available in this browser.`;
    }
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return `${kind} permission was blocked. Allow access and retry.`;
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return `No ${kind.toLowerCase()} device was found.`;
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return `${kind} is already in use by another app.`;
    }
    if (error instanceof Error) return error.message || `${kind} failed.`;
    return `Could not access ${kind.toLowerCase()}.`;
  }

  private async getUserMedia(constraints: MediaStreamConstraints) {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error("Camera/microphone APIs are unavailable.");
      err.name = "SecurityError";
      throw err;
    }
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  async initializeAudio() {
    if (!this.audioContext) {
      const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new Ctx();
      await this.audioContext.audioWorklet.addModule("/pcm-processor.js");
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async startAudio(onAudioData: (data: ArrayBuffer) => void) {
    try {
      this.mediaStream = await this.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      await this.initializeAudio();
      if (!this.audioContext) return;
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
      this.audioWorkletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.isRecording || !this.audioContext) return;
        const downsampled = this.downsampleBuffer(event.data, this.audioContext.sampleRate, 16000);
        onAudioData(this.convertFloat32ToInt16(downsampled));
      };
      source.connect(this.audioWorkletNode);
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      this.audioWorkletNode.connect(muteGain);
      muteGain.connect(this.audioContext.destination);
      this.isRecording = true;
    } catch (error) {
      this.stopAudio();
      throw error;
    }
  }

  stopAudio() {
    this.isRecording = false;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    this.audioWorkletNode?.disconnect();
    this.audioWorkletNode = null;
  }

  async startVideo(videoElement: HTMLVideoElement, onFrame: (data: string) => void) {
    try {
      try {
        this.videoStream = await this.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name !== "OverconstrainedError") throw error;
        this.videoStream = await this.getUserMedia({ video: true });
      }
      await this.attachVideo(videoElement);
      this.captureFrame(videoElement, onFrame);
      this.videoInterval = window.setInterval(() => this.captureFrame(videoElement, onFrame), 1000);
    } catch (error) {
      this.stopVideo(videoElement);
      throw error;
    }
  }

  private async attachVideo(videoElement: HTMLVideoElement) {
    videoElement.srcObject = this.videoStream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    try {
      await videoElement.play();
    } catch {
      // Safari sometimes needs a second gesture.
    }
  }

  stopVideo(videoElement?: HTMLVideoElement | null) {
    this.videoStream?.getTracks().forEach((track) => track.stop());
    this.videoStream = null;
    if (this.videoInterval) {
      window.clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
    if (videoElement) videoElement.srcObject = null;
  }

  captureFrame(videoElement: HTMLVideoElement, onFrame: (data: string) => void) {
    if (!this.videoStream || !this.canvasCtx || videoElement.readyState < 2) return;
    const width = videoElement.videoWidth || 640;
    const height = videoElement.videoHeight || 480;
    this.videoCanvas.width = width;
    this.videoCanvas.height = height;
    this.canvasCtx.drawImage(videoElement, 0, 0, width, height);
    onFrame(this.videoCanvas.toDataURL("image/jpeg", 0.7).split(",")[1]);
  }

  playAudio(arrayBuffer: ArrayBuffer) {
    if (!this.audioContext) return;
    if (this.audioContext.state === "suspended") this.audioContext.resume();
    const pcmData = new Int16Array(arrayBuffer);
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i += 1) {
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
      this.scheduledSources = this.scheduledSources.filter((item) => item !== source);
    };
  }

  stopAudioPlayback() {
    this.scheduledSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    });
    this.scheduledSources = [];
    if (this.audioContext) this.nextStartTime = this.audioContext.currentTime;
  }

  waitUntilPlaybackIdle(timeoutMs = 4000) {
    if (!this.audioContext) return Promise.resolve();
    const remaining = Math.max(0, (this.nextStartTime - this.audioContext.currentTime) * 1000);
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, Math.min(timeoutMs, remaining + 150));
    });
  }

  downsampleBuffer(buffer: Float32Array, sampleRate: number, outSampleRate: number) {
    if (outSampleRate === sampleRate) return buffer;
    const ratio = sampleRate / outSampleRate;
    const result = new Float32Array(Math.round(buffer.length / ratio));
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
        accum += buffer[i];
        count += 1;
      }
      result[offsetResult] = accum / count;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  convertFloat32ToInt16(buffer: Float32Array) {
    const buf = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 1) {
      buf[i] = Math.min(1, Math.max(-1, buffer[i])) * 0x7fff;
    }
    return buf.buffer;
  }
}
