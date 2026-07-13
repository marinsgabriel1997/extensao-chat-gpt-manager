import type { Conversation } from "./domain.js";

export interface CachedSearchResult {
  conversations: Conversation[];
  filteredCount: number;
}

export class SearchSessionCache {
  private readonly entries = new Map<string, CachedSearchResult>();

  get(query: string): CachedSearchResult | null {
    const cached = this.entries.get(normalizeQuery(query));
    return cached === undefined ? null : cloneResult(cached);
  }

  set(query: string, result: CachedSearchResult): void {
    this.entries.set(normalizeQuery(query), cloneResult(result));
  }

  removeConversations(conversationIds: ReadonlySet<string>): void {
    if (conversationIds.size === 0) {
      return;
    }

    for (const [query, result] of this.entries) {
      const remaining = result.conversations.filter(
        (conversation) => !conversationIds.has(conversation.id),
      );
      this.entries.set(query, { ...result, conversations: remaining });
    }
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase("pt-BR");
}

function cloneResult(result: CachedSearchResult): CachedSearchResult {
  return {
    conversations: result.conversations.map((conversation) => ({ ...conversation })),
    filteredCount: result.filteredCount,
  };
}

