import type { Conversation, ConversationId, Project, ProjectId } from "./domain.js";

export interface ConversationSnapshot {
  fetchedAt: string;
  conversations: Conversation[];
  projects: Project[];
}

interface ConversationCacheV1 extends ConversationSnapshot {
  version: 1;
}

// Interface mínima compatível com chrome.storage.local, substituível nos testes.
export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const STORAGE_KEY = "conversation-cache";
const CACHE_VERSION = 1;

export class ConversationStore {
  constructor(private readonly storage: KeyValueStorage) {}

  async read(): Promise<ConversationSnapshot | null> {
    const stored = await this.storage.get(STORAGE_KEY);
    const cache = parseCache(stored[STORAGE_KEY]);
    if (cache === null && stored[STORAGE_KEY] !== undefined) {
      await this.storage.remove(STORAGE_KEY);
    }
    return cache;
  }

  async write(snapshot: ConversationSnapshot): Promise<void> {
    const cache: ConversationCacheV1 = {
      version: CACHE_VERSION,
      fetchedAt: snapshot.fetchedAt,
      conversations: snapshot.conversations.map((conversation) => ({ ...conversation })),
      projects: snapshot.projects.map((project) => ({ ...project })),
    };
    await this.storage.set({ [STORAGE_KEY]: cache });
  }

  async removeConversations(conversationIds: ReadonlySet<ConversationId>): Promise<void> {
    if (conversationIds.size === 0) {
      return;
    }

    const cache = await this.read();
    if (cache === null) {
      return;
    }

    await this.write({
      ...cache,
      conversations: cache.conversations.filter(
        (conversation) => !conversationIds.has(conversation.id),
      ),
    });
  }

  async assignProject(
    conversationIds: ReadonlySet<ConversationId>,
    projectId: ProjectId,
  ): Promise<void> {
    if (conversationIds.size === 0) {
      return;
    }

    const cache = await this.read();
    if (cache === null) {
      return;
    }

    await this.write({
      ...cache,
      conversations: cache.conversations.map((conversation) =>
        conversationIds.has(conversation.id) ? { ...conversation, projectId } : conversation,
      ),
    });
  }

  async clear(): Promise<void> {
    await this.storage.remove(STORAGE_KEY);
  }
}

function parseCache(value: unknown): ConversationSnapshot | null {
  if (!isObject(value) || value.version !== CACHE_VERSION) {
    return null;
  }

  if (typeof value.fetchedAt !== "string" || value.fetchedAt.length === 0) {
    return null;
  }

  if (!Array.isArray(value.conversations) || !Array.isArray(value.projects)) {
    return null;
  }

  const conversations: Conversation[] = [];
  for (const item of value.conversations) {
    const conversation = parseConversation(item);
    if (conversation === null) {
      return null;
    }
    conversations.push(conversation);
  }

  const projects: Project[] = [];
  for (const item of value.projects) {
    const project = parseProject(item);
    if (project === null) {
      return null;
    }
    projects.push(project);
  }

  return { fetchedAt: value.fetchedAt, conversations, projects };
}

function parseConversation(value: unknown): Conversation | null {
  if (!isObject(value)) {
    return null;
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }

  if (typeof value.title !== "string" || typeof value.preview !== "string") {
    return null;
  }

  if (value.projectId !== null && typeof value.projectId !== "string") {
    return null;
  }

  if (value.updatedAt !== null && typeof value.updatedAt !== "string") {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    preview: value.preview,
    projectId: value.projectId,
    updatedAt: value.updatedAt,
  };
}

function parseProject(value: unknown): Project | null {
  if (!isObject(value)) {
    return null;
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    return null;
  }

  return { id: value.id, name: value.name };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
