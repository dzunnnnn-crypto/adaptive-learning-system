export function makeUniversalCourse({ contentVersion = 1, sourceStatus = "verified", withActivity = false, withCoreText = false, schemaVersion = 3, withArtifacts = false, withRenderableArtifacts = false, withFileArtifacts = false } = {}) {
  const sections = [
    { id: "foundation", title: "Основа", order: 1, sourceHeading: "Foundation" },
    { id: "practice", title: "Практика", order: 2, sourceHeading: "Practice" },
  ];
  const unitIds = [
    "foundation-goal",
    "foundation-context",
    "foundation-constraints",
    "practice-plan",
    "practice-test",
    "practice-review",
    "practice-apply",
  ];
  const units = unitIds.map((id, index) => ({
    id,
    sectionId: index < 3 ? "foundation" : "practice",
    order: index + 1,
    title: `Фрагмент ${index + 1}`,
    coreText: `Самостоятельная учебная мысль номер ${index + 1}, изложенная достаточно подробно для проверки универсального движка.`,
    sourceRefs: [index < 3 ? "source-foundation" : "source-practice"],
    estimatedMinutes: 3,
    check: {
      prompt: `Как применить мысль номер ${index + 1} в реальной ситуации?`,
      choices: { "А": "Первый вариант", "Б": "Второй вариант", "В": "Третий вариант" },
      correct: ["А", "Б", "В"][index % 3],
      explanations: {
        "А": "Разбор первого варианта.",
        "Б": "Разбор второго варианта.",
        "В": "Разбор третьего варианта.",
      },
    },
  }));
  if (withActivity) {
    units[0].activity = {
      title: "Проверь идею на живом примере",
      instructions: ["Открой тестовый проект.", "Выполни одно безопасное действие."],
      expectedResult: "Появился наблюдаемый результат без изменения секретов.",
      confirmationPrompt: "Коротко напиши, что получилось после выполнения действия.",
      projectHint: "Внешний тестовый проект",
    };
  }
  if (withCoreText) {
    units[0].coreText = "Первый абзац раскрывает **ключевую мысль** блока.\n\nВторой абзац добавляет деталь и держит разметку вроде <script>alert(1)</script> обычным текстом.";
  }
  if (withArtifacts) {
    units[0].artifactRefs = ["table-foundation-summary"];
  }
  if (withRenderableArtifacts) {
    units[0].artifactRefs = ["figure-foundation-map"];
    units[1].artifactRefs = ["table-foundation-summary"];
    units[2].artifactRefs = ["listing-foundation-loop"];
    units[3].artifactRefs = ["formula-foundation-result"];
  }
  const fileArtifactSpecs = [
    ["figure-animated-demo", "figure", "foundation-goal", "animated-demo.gif", "Animated demo.gif", "image/gif", "image"],
    ["video-demo", "video", "foundation-context", "demo.webm", "Demo.webm", "video/webm", "video"],
    ["audio-demo", "audio", "foundation-constraints", "demo.ogg", "Demo.ogg", "audio/ogg", "audio"],
    ["document-demo", "document", "practice-plan", "guide.pdf", "Guide.pdf", "application/pdf", "pdf"],
    ["attachment-demo", "attachment", "practice-test", "examples.zip", "Examples.zip", "application/zip", "download"],
  ];
  if (withFileArtifacts) {
    fileArtifactSpecs.forEach(([id, , unitId]) => {
      const unit = units.find((candidate) => candidate.id === unitId);
      unit.artifactRefs = [id];
    });
  }
  const source = {
    title: "Sample source",
    url: "https://example.com/sample-source",
    checkedAt: "2026-07-19",
    language: "en",
    status: sourceStatus,
    ...(withRenderableArtifacts || withFileArtifacts ? {
      artifactAudit: { status: "verified", artifactCount: withFileArtifacts ? fileArtifactSpecs.length : 4 },
    } : {}),
  };
  return {
    schemaVersion: withFileArtifacts ? 6 : withRenderableArtifacts ? 5 : schemaVersion,
    contentVersion,
    id: "sample-article",
    title: "Универсальная тестовая статья",
    source,
    sections,
    units,
    coverage: [
      { id: "source-foundation", sourceHeading: "Foundation", unitIds: unitIds.slice(0, 3) },
      { id: "source-practice", sourceHeading: "Practice", unitIds: unitIds.slice(3) },
    ],
    application: {
      prompt: "Какой приём будет применён в реальном проекте?",
      choices: { "А": "Первый", "Б": "Второй", "В": "Третий" },
    },
    ...(withFileArtifacts ? {
      sourceArtifacts: fileArtifactSpecs.map(([id, kind, unitId, fileName, originalName, mimeType, presentation]) => ({
        id,
        kind,
        sourceHeading: `Source asset: ${originalName}`,
        caption: `Проверяемый файл ${originalName}.`,
        coverage: "covered",
        unitIds: [unitId],
        exclusionReason: null,
        content: {
          type: "file",
          fileName,
          originalName,
          mimeType,
          sizeBytes: 32,
          sha256: "0".repeat(64),
          presentation,
          accessibilityText: `Учебный артефакт ${originalName}`,
        },
      })),
    } : withRenderableArtifacts ? {
      sourceArtifacts: [
        {
          id: "figure-foundation-map",
          kind: "figure",
          sourceHeading: "Figure: Foundation map",
          caption: "Карта основы курса.",
          coverage: "covered",
          unitIds: ["foundation-goal"],
          exclusionReason: null,
          content: {
            type: "image",
            fileName: "foundation-map.png",
            alt: "Схема основы курса",
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
        {
          id: "table-foundation-summary",
          kind: "table",
          sourceHeading: "Table: Foundation summary",
          caption: "Сводная таблица основы.",
          coverage: "covered",
          unitIds: ["foundation-context"],
          exclusionReason: null,
          content: {
            type: "table",
            columns: ["Часть", "Назначение"],
            rows: [["Цель", "Определяет результат"]],
            align: ["left", "left"],
          },
        },
        {
          id: "listing-foundation-loop",
          kind: "listing",
          sourceHeading: "Listing: Foundation loop",
          caption: "Минимальный цикл проверки.",
          coverage: "covered",
          unitIds: ["foundation-constraints"],
          exclusionReason: null,
          content: { type: "code", language: "text", text: "observe\nact\nverify" },
        },
        {
          id: "formula-foundation-result",
          kind: "formula",
          sourceHeading: "Formula: Foundation result",
          caption: "Формула результата.",
          coverage: "covered",
          unitIds: ["practice-plan"],
          exclusionReason: null,
          content: { type: "formula", text: "Result = Goal + Evidence" },
        },
      ],
    } : withArtifacts ? {
      sourceArtifacts: [{
        id: "table-foundation-summary",
        kind: "table",
        sourceHeading: "Table 1: Foundation summary",
        caption: "Сводная таблица ключевых идей первого раздела источника.",
        coverage: "covered",
        unitIds: ["foundation-goal"],
        exclusionReason: null,
      }],
  } : {}),
  };
}

export function makeFormattedCourse() {
  const course = makeUniversalCourse({ withRenderableArtifacts: true });
  course.schemaVersion = 8;
  course.source.formatAudit = {
    status: "verified",
    entries: [
      { id: "format-paragraph", sourceHeading: "Foundation", kind: "paragraph", unitId: "foundation-goal", exclusionReason: null },
      { id: "format-heading", sourceHeading: "Foundation", kind: "heading", unitId: "foundation-goal", exclusionReason: null },
      { id: "format-strong", sourceHeading: "Foundation", kind: "strong", unitId: "foundation-goal", exclusionReason: null },
      { id: "format-emphasis", sourceHeading: "Foundation", kind: "emphasis", unitId: "foundation-goal", exclusionReason: null },
      { id: "format-list", sourceHeading: "Foundation", kind: "list", unitId: "foundation-goal", exclusionReason: null },
      { id: "format-callout", sourceHeading: "Foundation", kind: "callout", unitId: "foundation-goal", exclusionReason: null },
      { id: "format-artifact", sourceHeading: "Foundation figure", kind: "artifact", unitId: "foundation-goal", exclusionReason: null },
    ],
  };
  course.units.forEach((unit) => {
    delete unit.coreText;
    unit.contentBlocks = [
      {
        type: "paragraph",
        runs: [{ type: "text", text: `Форматированный текст фрагмента ${unit.order}.` }],
      },
      ...(unit.artifactRefs ?? []).map((artifactRef) => ({ type: "artifact", artifactRef })),
    ];
  });
  course.units[0].contentBlocks = [
    {
      type: "heading",
      level: 2,
      runs: [{ type: "text", text: "Смысловой подзаголовок" }],
    },
    {
      type: "paragraph",
      runs: [
        { type: "strong", text: "Главная мысль." },
        { type: "text", text: " Она остаётся отдельным абзацем." },
      ],
    },
    {
      type: "artifact",
      artifactRef: "figure-foundation-map",
    },
    {
      type: "callout",
      tone: "tip",
      label: "Практический вывод",
      blocks: [{
        type: "list",
        ordered: true,
        items: [
          [{ type: "text", text: "Первое действие." }],
          [{ type: "emphasis", text: "Второе действие." }],
        ],
      }],
    },
  ];
  return course;
}
