export interface PromptSection {
  title: string;
  body: string;
  required?: boolean;
}

const TRUNCATION_MARKER = "\n[truncated]";

export function joinBudgetedSections(
  sections: PromptSection[],
  maxChars: number,
): { text: string; truncated: boolean } {
  const budget = Math.max(200, Math.floor(maxChars));
  const included: string[] = [];
  let truncated = false;

  for (const section of sections) {
    const rendered = renderSection(section);
    const next = included.length === 0 ? rendered : `${included.join("\n\n")}\n\n${rendered}`;
    if (next.length <= budget) {
      included.push(rendered);
      continue;
    }

    truncated = true;
    if (section.required || included.length === 0) {
      const remaining = Math.max(0, budget - (included.join("\n\n").length + (included.length ? 2 : 0)));
      if (remaining > TRUNCATION_MARKER.length) {
        included.push(truncate(rendered, remaining));
      }
    }
    break;
  }

  const text = included.join("\n\n");
  return {
    text: text.length > budget ? truncate(text, budget) : text,
    truncated,
  };
}

function renderSection(section: PromptSection): string {
  return `${section.title}\n${section.body.trim()}`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const keep = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  return `${value.slice(0, keep).trimEnd()}${TRUNCATION_MARKER}`;
}
