import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { FastifyInstance } from "fastify";

import type { StudioEventBus } from "../events/bus";
import type { StudioEventEnvelope } from "../events/types";

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface DashboardWsOptions {
  events: StudioEventBus;
  path?: string;
}

export function registerDashboardWs(app: FastifyInstance, options: DashboardWsOptions): void {
  const path = options.path ?? "/ws/dashboard";
  const clients = new Set<Duplex>();

  const unsubscribe = options.events.subscribeAll((event) => {
    // Event fanout keeps the dashboard stream transport-only; permission filtering
    // happens before events are emitted or in the HTTP chat read path.
    broadcast(clients, event);
  });

  app.server.on("upgrade", (request, socket) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!isValidUpgrade(request)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"] as string;
    const accept = createHash("sha1").update(`${key}${websocketGuid}`).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );

    clients.add(socket);
    socket.on("data", (chunk: Buffer) => {
      if ((chunk[0] & 0x0f) === 8) {
        socket.end();
      }
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  app.addHook("onClose", (_instance, done) => {
    unsubscribe();
    for (const client of clients) {
      client.destroy();
    }
    clients.clear();
    done();
  });
}

function isValidUpgrade(request: IncomingMessage): boolean {
  return (
    request.headers.upgrade?.toLowerCase() === "websocket" &&
    typeof request.headers["sec-websocket-key"] === "string"
  );
}

function broadcast(clients: Set<Duplex>, event: StudioEventEnvelope): void {
  const frame = encodeTextFrame(JSON.stringify(event));
  for (const client of clients) {
    if (client.writable) {
      client.write(frame);
    }
  }
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 65_535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}
