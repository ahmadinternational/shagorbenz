// Keyword → category rules (see category-rules.json). First matching rule wins; no match → null (importer uses "Other").
export function compileRules(json) {
    return json.rules.map((r) => ({ category: r.category, re: new RegExp(r.match, 'i') }));
}
export const categorize = (title, rules) => rules.find((r) => r.re.test(title))?.category ?? null;
