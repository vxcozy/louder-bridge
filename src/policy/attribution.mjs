const ATTRIBUTION_PATTERNS = [
  {
    label: "authorship trailer",
    pattern: new RegExp(`^\\s*co-${"authored"}-by\\s*:`, "im"),
  },
  {
    label: "automated authorship attribution",
    pattern:
      /\b(?:generated|written|authored|created)\s+(?:by|with|using)\s+(?:claude|chatgpt|codex|copilot|openai|anthropic|an?\s+(?:ai|llm))\b/i,
  },
  {
    label: "automated authorship attribution",
    pattern:
      /\b(?:claude|chatgpt|codex|copilot)\s+(?:generated|authored|co-authored)\b/i,
  },
];

export function findAttribution(text) {
  for (const entry of ATTRIBUTION_PATTERNS) {
    if (entry.pattern.test(text)) return entry.label;
  }
  return null;
}
