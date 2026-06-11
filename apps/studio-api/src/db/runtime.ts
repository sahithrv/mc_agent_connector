import { AiChatMessagesRepository } from "./ai-chat-messages";
import { ClipMarkersRepository } from "./clip-markers";
import { openStudioDatabase, type StudioDb } from "./client";
import { EventsRepository } from "./events";
import { runMigrations } from "./migrations";
import { SessionsRepository } from "./sessions";
import type { SessionRecord } from "./types";

export interface StudioPersistence {
  db: StudioDb;
  session: SessionRecord;
  sessions: SessionsRepository;
  events: EventsRepository;
  chatMessages: AiChatMessagesRepository;
  clipMarkers: ClipMarkersRepository;
}

export function createStudioPersistence(databasePath: string): StudioPersistence {
  const db = openStudioDatabase(databasePath);
  runMigrations(db);

  const sessions = new SessionsRepository(db);
  const session = sessions.getCurrent() ?? sessions.create({
    title: "V1 local session",
    makeCurrent: true,
  });

  return {
    db,
    session,
    sessions,
    events: new EventsRepository(db),
    chatMessages: new AiChatMessagesRepository(db),
    clipMarkers: new ClipMarkersRepository(db),
  };
}
