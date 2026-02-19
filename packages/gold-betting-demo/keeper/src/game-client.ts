import { io, Socket } from "socket.io-client";

export class GameClient {
  private socket: Socket;
  private connected = false;

  constructor(url: string) {
    this.socket = io(url, {
      transports: ["websocket"],
      autoConnect: false,
    });

    this.socket.on("connect", () => {
      console.log(`[GameClient] Connected to ${url}`);
      this.connected = true;
    });

    this.socket.on("disconnect", () => {
      console.log("[GameClient] Disconnected");
      this.connected = false;
    });
  }

  public connect() {
    this.socket.connect();
  }

  public onDuelStart(callback: (data: any) => void) {
    this.socket.on("duel:start", callback);
  }

  public onDuelEnd(callback: (data: any) => void) {
    this.socket.on("duel:end", callback);
  }

  public disconnect() {
    this.socket.disconnect();
  }
}
