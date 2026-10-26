const formats = {
  detail: '{"kind":"detail","explanation":"Раскрой материал своими словами","example":"Приведи один рабочий пример","caveat":"Назови одно важное ограничение"}',
  rephrase: '{"kind":"rephrase","explanation":"Объясни материал другим способом","analogy":"Дай понятную бытовую аналогию","suggestSmaller":true}',
  practice: '{"kind":"practice","task":"Сформулируй одну короткую практическую задачу","expectedMinutes":3,"evaluationGuide":"Опиши наблюдаемые критерии проверки"}',
  "practice-review": '{"kind":"practice-review","correct":true,"feedback":"Объясни результат проверки простыми словами","nextHint":"Предложи один следующий шаг"}',
  clarification: '{"kind":"clarification","answer":"Дай короткий понятный ответ на русском языке","basis":"course"}',
};

const webRules = [
  "Живой веб-поиск разрешён. Сам решай, нужен ли он для качественного ответа.",
  "Для актуальных или изменяемых сведений обязательно используй живой веб-поиск, а не память модели.",
  "Если использовал веб-поиск, добавь названия источников и прямые URL в главное текстовое поле ответа.",
  "Не используй файловые или командные инструменты и не меняй файлы или учебный прогресс.",
];

function runsToText(runs = []) {
  return runs.map((run) => run.type === "line-break" ? "\n" : run.text).join("");
}

function formattedBlocksToText(blocks = []) {
  return blocks.map((block) => {
    if (["heading", "paragraph", "quote"].includes(block.type)) return runsToText(block.runs);
    if (block.type === "list") return block.items.map((item, index) => (
      `${block.ordered ? `${index + 1}.` : "-"} ${runsToText(item)}`
    )).join("\n");
    if (block.type === "callout") {
      return [block.label, formattedBlocksToText(block.blocks)].filter(Boolean).join("\n");
    }
    return "";
  }).filter(Boolean).join("\n\n");
}

function unitSource(unit) {
  return `${unit.title}\n${unit.contentBlocks
    ? formattedBlocksToText(unit.contentBlocks)
    : unit.coreText}`;
}

export function buildPrompt({
  operation,
  units,
  userAnswer = "",
  practice = null,
  clarificationQuestion = "",
  clarificationMessages = [],
}) {
  if (!formats[operation]) throw new Error(`Unsupported AI operation: ${operation}`);
  if (operation === "practice-review" && !practice) {
    throw new Error("Practice context is required for review");
  }
  if (operation === "clarification") {
    const source = units.map(unitSource).join("\n\n");
    const history = clarificationMessages.map((message) => {
      if (message.role === "context-change") {
        return `[Состав блока изменён: ${message.fromUnitIds.join(", ")} -> ${message.toUnitIds.join(", ")}]`;
      }
      return `${message.role === "user" ? "Пользователь" : "Помощник"}: ${message.text}`;
    }).join("\n");
    return [
      "Ты отвечаешь на уточняющий вопрос в локальной учебной системе пользователя.",
      "Сначала опирайся на материал курса. Если его недостаточно, можешь использовать общие знания модели.",
      "Если ответ содержит знания за пределами курса, выбери basis general или mixed.",
      ...webRules,
      `Верни только JSON без Markdown в формате ${formats.clarification}`,
      `Текущий материал:\n${source}`,
      history ? `Предыдущая беседа:\n${history}` : "",
      `Новый вопрос пользователя:\n${clarificationQuestion}`,
    ].filter(Boolean).join("\n\n");
  }
  const source = units.map(unitSource).join("\n\n");
  const operationRules = {
    detail: "Добавь подробность, один пример и одно важное ограничение.",
    rephrase: "Объясни принципиально иначе, используй аналогию и не повторяй исходную формулировку.",
    practice: "Создай одну задачу на 3-5 минут только по переданному материалу.",
    "practice-review": `Проверь ответ по материалу и руководству. Ответ ученика: ${userAnswer}`,
  };
  const practiceContext = practice
    ? `Задание: ${practice.task}\nРуководство проверки: ${practice.evaluationGuide}`
    : "";

  return [
    "Ты помогаешь в локальном учебном приложении.",
    "Материал курса является основной опорой. Внешние сведения используй только как явное дополнение.",
    ...webRules,
    operationRules[operation],
    `Верни только JSON без Markdown в формате ${formats[operation]}`,
    "Проверенный материал:",
    source,
    practiceContext,
  ].filter(Boolean).join("\n\n");
}
