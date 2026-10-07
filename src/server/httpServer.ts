import { createServer, type Server } from "node:http";
import type { Log } from "../bots/shared/log.js";
import { buildHealthResponse, type HealthInputs } from "./healthReport.js";

export const HEALTH_PATH = "/health";

export type HealthProbe = () => HealthInputs;

export function healthBody(probe: HealthProbe): { status: number; payload: string } {
  const response = buildHealthResponse(probe());
  return { status: response.httpStatus, payload: `${JSON.stringify(response.body, null, 2)}\n` };
}

export function startHealthServer(port: number, probe: HealthProbe, log: Log): Server {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end('{"error":"method not allowed"}\n');
      return;
    }
    if (path !== HEALTH_PATH && path !== "/") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"not found","try":"/health"}\n');
      return;
    }
    const { status, payload } = healthBody(probe);
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(payload);
  });
  server.listen(port, () => log.say("health_server", { port, path: HEALTH_PATH }));
  return server;
}
