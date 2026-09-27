// Query grammar is not evidence of relevance. Keep short technical names (C++,
// C#, R, Go, IDs) and match Latin identifiers as complete tokens, not substrings.
const stopwords = new Set(
  `a an the and or but if as at by for from in into of on to with without
   i me my we us our you your he she it its they them their this that these those
   is are am was were be been being do does did can could will would should
   have has had how what which where when why who whom
   이 그 저 것 수 등 및 또는 그리고 어떤 어느 어떻게 무엇 왜 언제 어디
   나 내 우리 해줘 알려줘 알려주세요 하나 하나요 되나 되나요 돼
   있어 있나 있나요 해야 하려면 위해 대한 대해 경우 방법 은 는 이다`.split(/\s+/),
);
const normalize = (text) => text.normalize('NFKC').toLowerCase();
function term(word) {
  // A small particle rule, not a Korean morphological analyser. Do not strip
  // verb endings or split compounds; the semantic path handles paraphrases.
  if (/^[가-힣]+$/.test(word))
    word = word.replace(
      /(?<=[가-힣]{2})(?:으로부터|에서는|에서도|에게서|으로|에서|에게|까지|부터|처럼|보다|에는|에도|은|는|이|가|을|를|의|와|과|로|도)$/u,
      '',
    );
  return stopwords.has(word) ? null : word;
}
export function queryTerms(query) {
  return [
    ...new Set(
      (normalize(query).match(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*(?:\+\+|#)?/gu) || [])
        .map(term)
        .filter(Boolean),
    ),
  ];
}
function documentTerms(text) {
  const terms = [
    ...queryTerms(text),
    ...queryTerms(text.replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')),
  ];
  // Preserve dotted/hyphenated identifiers as well as their word components.
  return new Set(terms.flatMap((word) => [word, ...word.split(/[._-]/).map(term).filter(Boolean)]));
}

export function rankKnowledge(records, query, semanticScores = new Map()) {
  if (!query.trim()) return records;
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const documents = records.map((record) => ({
    record,
    words: documentTerms(`${record.title} ${record.content} ${record.scope}`),
    title: documentTerms(record.title),
  }));
  const weights = new Map(
    terms.map((word) => {
      const count = documents.filter((doc) => doc.words.has(word)).length;
      return [word, 1 + Math.log((records.length + 1) / (count + 1))];
    }),
  );
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const bestSemantic = records.reduce((best, record) => {
    const score = semanticScores.get(record.id);
    return Number.isFinite(score) ? Math.max(best, Math.min(1, score)) : best;
  }, 0);
  // Abstain when the whole semantic result is weak. Once a plausible match
  // exists, retain nearby candidates rather than cutting every score at 0.4.
  const semanticFloor = Math.max(0.35, bestSemantic * 0.7);
  const coverage = (words) =>
    terms.reduce((sum, word) => sum + (words.has(word) ? weights.get(word) : 0), 0) / total;
  return documents
    .map(({ record, words, title }) => {
      const covered = coverage(words);
      // Long questions need meaningful coverage; short keyword queries retain OR
      // matching. An unknown word still contributes to the denominator.
      const lexical =
        covered > 0 && (terms.length <= 2 || covered >= 0.2)
          ? 0.9 * covered + 0.1 * coverage(title)
          : 0;
      const cosine = semanticScores.get(record.id) || 0;
      const semantic =
        bestSemantic >= 0.4 && Number.isFinite(cosine) && cosine >= semanticFloor
          ? Math.min(1, cosine)
          : 0;
      // Preserve the strongest signal. Agreement adds only a bounded bonus, so a
      // weak hit in both lists cannot double its weight past a strong single hit.
      return { record, score: Math.max(lexical, semantic) + 0.2 * Math.min(lexical, semantic) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ record }) => record);
}
