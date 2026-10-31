import { DurableObject } from "cloudflare:workers";

interface Env {
  BOARD: DurableObjectNamespace<PixelBoard>;
}

const W = 48;
const H = 32;
const PALETTE = 16; // colors are stored as one hex char per pixel
const COOLDOWN_MS = 250;

type ClientMsg = { t: "set"; x: number; y: number; c: number };
type Attachment = { last: number };

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      // One global board. Use idFromName(roomName) for per-room boards later.
      const stub = env.BOARD.get(env.BOARD.idFromName("main"));
      return stub.fetch(req);
    }

    if (pathname === "/api/board") {
      const stub = env.BOARD.get(env.BOARD.idFromName("main"));
      return Response.json(await stub.snapshot());
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export class PixelBoard extends DurableObject<Env> {
  private board: string | null = null;

  private async load(): Promise<string> {
    if (this.board === null) {
      this.board = (await this.ctx.storage.get<string>("board")) ?? "0".repeat(W * H);
    }
    return this.board;
  }

  async snapshot() {
    return { w: W, h: H, board: await this.load() };
  }

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API: the DO can sleep between messages while sockets stay open.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ last: 0 } satisfies Attachment);

    server.send(JSON.stringify({ t: "init", w: W, h: H, board: await this.load() }));
    this.broadcastCount();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 100) return;

    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const { x, y, c } = msg;
    if (
      msg.t !== "set" ||
      !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(c) ||
      x < 0 || x >= W || y < 0 || y >= H || c < 0 || c >= PALETTE
    ) return;

    // Per-socket rate limit
    const att = (ws.deserializeAttachment() as Attachment | null) ?? { last: 0 };
    const now = Date.now();
    if (now - att.last < COOLDOWN_MS) {
      ws.send(JSON.stringify({ t: "slow" }));
      return;
    }
    ws.serializeAttachment({ last: now } satisfies Attachment);

    const board = await this.load();
    const i = y * W + x;
    this.board = board.slice(0, i) + c.toString(16) + board.slice(i + 1);
    await this.ctx.storage.put("board", this.board);

    this.broadcast({ t: "px", x, y, c });
  }

  webSocketClose(ws: WebSocket) {
    ws.close();
    this.broadcastCount(-1);
  }

  webSocketError(ws: WebSocket) {
    ws.close();
    this.broadcastCount(-1);
  }

  private broadcastCount(delta = 0) {
    this.broadcast({ t: "online", n: Math.max(0, this.ctx.getWebSockets().length + delta) });
  }

  private broadcast(data: unknown) {
    const s = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch { /* socket already gone */ }
    }
  }
}
