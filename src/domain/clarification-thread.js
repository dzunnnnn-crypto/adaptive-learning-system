export function createClarificationThread(courseId, cursor) {
  return { courseId, cursor, messages: [] };
}

export function appendExchange(thread, { question, result, unitIds, createdAt }) {
  const activeUnitIds = [...unitIds];
  return {
    ...thread,
    messages: [
      ...thread.messages,
      { role: "user", text: question, activeUnitIds, createdAt },
      {
        role: "assistant",
        text: result.answer,
        basis: result.basis,
        activeUnitIds,
        createdAt,
        ...(result.generatedBy ? { generatedBy: structuredClone(result.generatedBy) } : {}),
      },
    ],
  };
}

function sameUnitIds(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compactContextChanges(thread) {
  const messages = [];
  for (const message of thread.messages ?? []) {
    const previous = messages.at(-1);
    if (message.role !== "context-change" || previous?.role !== "context-change") {
      messages.push(message);
      continue;
    }

    messages.pop();
    const merged = {
      ...message,
      fromUnitIds: [...previous.fromUnitIds],
      toUnitIds: [...message.toUnitIds],
    };
    if (!sameUnitIds(merged.fromUnitIds, merged.toUnitIds)) messages.push(merged);
  }
  return { ...thread, messages };
}

export function appendContextChange(thread, { fromUnitIds, toUnitIds, createdAt }) {
  const compacted = compactContextChanges(thread);
  if (compacted.messages.length === 0) return compacted;
  if (sameUnitIds(fromUnitIds, toUnitIds)) return compacted;
  return compactContextChanges({
    ...compacted,
    messages: [
      ...compacted.messages,
      {
        role: "context-change",
        fromUnitIds: [...fromUnitIds],
        toUnitIds: [...toUnitIds],
        createdAt,
      },
    ],
  });
}

export function archiveAndResetClarification(
  state,
  { finalUnitIds, nextCursor, completedAt },
) {
  const thread = state.clarificationThread;
  const history = thread.messages.length === 0
    ? state.clarificationHistory
    : [
        ...state.clarificationHistory,
        {
          courseId: thread.courseId,
          cursor: thread.cursor,
          finalUnitIds: [...finalUnitIds],
          messages: thread.messages,
          completedAt,
        },
      ];
  return {
    ...state,
    clarificationHistory: history,
    clarificationThread: createClarificationThread(state.courseId, nextCursor),
  };
}
