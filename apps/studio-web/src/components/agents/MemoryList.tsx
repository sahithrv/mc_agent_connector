import { useMemo, useState } from "react";
import { Badge, Button } from "@mantine/core";
import { ChevronDown, ChevronUp, DatabaseZap } from "lucide-react";

import type { UiAgentMemory } from "../../lib/agents/types";

interface MemoryListProps {
  memories?: UiAgentMemory[];
}

export function MemoryList({ memories = [] }: MemoryListProps): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const sorted = useMemo(() => sortMemories(memories), [memories]);

  return (
    <section className="agent-drawer-section" aria-labelledby="agent-memories">
      <h3 id="agent-memories">
        <DatabaseZap size={14} aria-hidden="true" />
        Memories
      </h3>
      {sorted.length === 0 ? (
        <p className="agent-drawer-muted">No memories recorded for this agent.</p>
      ) : (
        <div className="memory-list" aria-label="Agent memories">
          {sorted.map((memory) => {
            const isExpanded = expanded.has(memory.id);
            const isLong = memory.summary.length > 150;

            return (
              <article className="memory-item" key={memory.id}>
                <div className="memory-item-head">
                  <Badge className="memory-importance" data-importance={memory.importance}>
                    I{memory.importance}
                  </Badge>
                  <strong>{memory.kind}</strong>
                  <time dateTime={memory.createdAt}>{formatMemoryTime(memory.createdAt)}</time>
                </div>
                <p className="memory-summary" data-expanded={isExpanded}>
                  {memory.summary}
                </p>
                {isLong ? (
                  <Button
                    aria-expanded={isExpanded}
                    disabled={false}
                    leftSection={
                      isExpanded ? (
                        <ChevronUp size={13} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={13} aria-hidden="true" />
                      )
                    }
                    onClick={() => setExpanded(toggleSet(expanded, memory.id))}
                    size="compact-xs"
                    variant="subtle"
                  >
                    {isExpanded ? "Collapse" : "Expand"}
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function sortMemories(memories: UiAgentMemory[]): UiAgentMemory[] {
  return [...memories].sort((left, right) => {
    if (right.importance !== left.importance) return right.importance - left.importance;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

function toggleSet(source: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(source);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function formatMemoryTime(createdAt: string): string {
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return "bad time";
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}
