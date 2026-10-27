export const EMBEDDING_DIMENSIONS = 1024;
export const SEARCH_TYPES = ["task", "meeting", "vault", "lecture"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export type SearchSource = {
  sourceType: SearchType;
  sourceId: string;
  title: string;
  content: string;
};
export type SearchResult = SearchSource & { score: number };
export type SearchResponse = {
  results: SearchResult[];
  pending: number;
  mode: "semantic" | "text";
};
export const isSearchType = (value: unknown): value is SearchType =>
  SEARCH_TYPES.includes(value as SearchType);
export function searchQuery(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value.trim()).length > 500
  )
    throw new Error("Enter a search of 1–500 characters.");
  return value.trim();
}
export function sourcePath(
  source: Pick<SearchSource, "sourceType" | "sourceId">,
) {
  return `/search?type=${encodeURIComponent(source.sourceType)}&id=${encodeURIComponent(source.sourceId)}`;
}
export function readSearchSource(value: any): SearchSource {
  if (
    !isSearchType(value?.sourceType) ||
    typeof value.sourceId !== "string" ||
    !/^[\w:-]{1,80}$/.test(value.sourceId) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    Array.from(value.title).length > 250 ||
    typeof value.content !== "string" ||
    !value.content.trim() ||
    value.content.length > 500000
  )
    throw new Error("Invalid search source.");
  return {
    sourceType: value.sourceType,
    sourceId: value.sourceId,
    title: value.title,
    content: value.content,
  };
}
export function readSearchResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value) || value.length > 10)
    throw new Error("Invalid search results.");
  return value.map((item) => {
    const source = readSearchSource(item);
    if (
      !Number.isFinite(item.score) ||
      item.score < -1.001 ||
      item.score > 1.001
    )
      throw new Error("Invalid search score.");
    return { ...source, score: item.score };
  });
}
/** Plain local fallback; no provider requests and no invented semantic scores. */
export function textSearch(
  sources: SearchSource[],
  query: string,
): SearchResult[] {
  const words =
    searchQuery(query)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return [];
  const useful = words.filter(
    (word) =>
      ![
        "what",
        "did",
        "say",
        "about",
        "the",
        "and",
        "with",
        "does",
        "have",
        "that",
        "this",
        "said",
        "was",
        "for",
      ].includes(word),
  );
  const terms = useful.length ? useful : words;
  return sources
    .map((source) => {
      const text = source.content.toLocaleLowerCase();
      return {
        ...source,
        score:
          terms.filter((term) => text.includes(term)).length / terms.length,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
