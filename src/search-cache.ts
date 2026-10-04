import type { ConversationSearchHit } from "./domain.js";

export interface CachedSearchResult {
  hits: ConversationSearchHit[];
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

  // Conversas excluídas deixam de existir; conversas movidas continuam nos
  // resultados, pois o Projeto de cada uma vem da listagem completa.
  removeConversations(conversationIds: ReadonlySet<string>): void {
    if (conversationIds.size === 0) {
      return;
    }

    for (const [query, result] of this.entries) {
      this.entries.set(query, {
        hits: result.hits.filter((hit) => !conversationIds.has(hit.id)),
      });
    }
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase("pt-BR");
}

function cloneResult(result: CachedSearchResult): CachedSearchResult {
  return { hits: result.hits.map((hit) => ({ ...hit })) };
}
