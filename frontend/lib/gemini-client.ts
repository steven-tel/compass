type Handlers = {
  onOpen?: () => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
};

export class GeminiClient {
  private websocket: WebSocket | null = null;
  private handlers: Handlers;

  constructor(handlers: Handlers) {
    this.handlers = handlers;
  }

  connect(url: string) {
    this.websocket = new WebSocket(url);
    this.websocket.binaryType = "arraybuffer";
    this.websocket.onopen = () => this.handlers.onOpen?.();
    this.websocket.onmessage = (event) => this.handlers.onMessage?.(event);
    this.websocket.onclose = (event) => this.handlers.onClose?.(event);
    this.websocket.onerror = (event) => this.handlers.onError?.(event);
  }

  send(data: string | ArrayBuffer) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(data);
    }
  }

  sendText(text: string) {
    this.send(JSON.stringify({ text }));
  }

  cancelSession() {
    this.send(JSON.stringify({ type: "cancel_session" }));
  }

  sendImage(base64Data: string, mimeType = "image/jpeg") {
    this.send(JSON.stringify({ type: "image", mime_type: mimeType, data: base64Data }));
  }

  disconnect() {
    this.websocket?.close();
    this.websocket = null;
  }

  isConnected() {
    return this.websocket?.readyState === WebSocket.OPEN;
  }
}
