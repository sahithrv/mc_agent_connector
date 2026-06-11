import type { FastifyInstance } from "fastify";

import { objectBody, validationResponse } from "../http/validation";
import type { AiChatService } from "./service";
import type { ViewerRole } from "./types";

const viewerRoles = new Set<ViewerRole>([
  "recorder",
  "ai-team-human",
  "human-team",
  "unaffiliated",
]);

export function registerChatRoutes(app: FastifyInstance, chat: AiChatService): void {
  app.get("/chat/messages", async (request, reply) => {
    try {
      const query = objectBody(request.query, "query");
      const viewerRole = query.viewerRole;
      if (typeof viewerRole !== "string" || !viewerRoles.has(viewerRole as ViewerRole)) {
        return reply.status(400).send({ error: "viewerRole must be a valid viewer role" });
      }

      const messages = await chat.listForViewer(viewerRole as ViewerRole);
      return { messages };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });
}
