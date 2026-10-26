import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  artifactMarkup,
  reviewMarkup,
  sectionGroupsMarkup,
  wireArtifactFallbacks,
} from "../public/course-content.js";

const review = {
  courseId: "sample-article",
  section: { id: "foundation", title: "Основа" },
  unit: {
    id: "foundation-goal",
    title: "Первый <script>",
    coreText: "Текст **жирный**.\n\n<script>alert(1)</script>",
  },
  sourceArtifacts: [{
    id: "figure-one",
    kind: "figure",
    caption: "Рисунок",
    content: {
      type: "image",
      fileName: "one.png",
      alt: "Схема",
      sha256: "a".repeat(64),
    },
  }],
};

describe("shared course content renderer", () => {
  it("renders one review unit and escapes source text", () => {
    const dom = new JSDOM("<main></main>");
    dom.window.document.querySelector("main").innerHTML = reviewMarkup(review);

    expect(dom.window.document.querySelector("h1").textContent)
      .toBe("Первый <script>");
    expect(dom.window.document.querySelectorAll("script")).toHaveLength(0);
    expect(dom.window.document.querySelector("strong").textContent).toBe("жирный");
    expect(dom.window.document.querySelectorAll(".lesson-artifact")).toHaveLength(1);
  });

  it("shows the local fallback after an image error", () => {
    const dom = new JSDOM("<main></main>");
    const root = dom.window.document;
    root.querySelector("main").innerHTML = reviewMarkup(review);
    wireArtifactFallbacks(root);
    const image = root.querySelector("[data-artifact-image]");
    image.dispatchEvent(new dom.window.Event("error"));

    expect(image.hidden).toBe(true);
    expect(root.querySelector("[data-artifact-fallback]").hidden).toBe(false);
  });

  it("renders v6 media and download presentations safely", () => {
    const dom = new JSDOM("<main></main>");
    const root = dom.window.document;
    const mediaReview = {
      ...review,
      sourceArtifacts: [
        {
          id: "gif-demo",
          kind: "figure",
          caption: "GIF",
          content: {
            type: "file",
            fileName: "animated-demo.gif",
            originalName: "Animated demo.gif",
            mimeType: "image/gif",
            sizeBytes: 32,
            sha256: "b".repeat(64),
            presentation: "image",
            accessibilityText: "Анимированная демонстрация",
          },
        },
        {
          id: "video-demo",
          kind: "video",
          caption: "Видео",
          content: {
            type: "file",
            fileName: "demo.webm",
            originalName: "Demo.webm",
            mimeType: "video/webm",
            sizeBytes: 32,
            sha256: "c".repeat(64),
            presentation: "video",
            accessibilityText: "Демонстрация видео",
          },
        },
        {
          id: "audio-demo",
          kind: "audio",
          caption: "Аудио",
          content: {
            type: "file",
            fileName: "demo.ogg",
            originalName: "Demo.ogg",
            mimeType: "audio/ogg",
            sizeBytes: 32,
            sha256: "d".repeat(64),
            presentation: "audio",
            accessibilityText: "Демонстрация аудио",
          },
        },
        {
          id: "pdf-demo",
          kind: "document",
          caption: "PDF",
          content: {
            type: "file",
            fileName: "guide.pdf",
            originalName: "Guide.pdf",
            mimeType: "application/pdf",
            sizeBytes: 32,
            sha256: "e".repeat(64),
            presentation: "pdf",
            accessibilityText: "Учебный PDF",
          },
        },
        {
          id: "download-demo",
          kind: "attachment",
          caption: "Архив",
          content: {
            type: "file",
            fileName: "examples.zip",
            originalName: "Examples.zip",
            mimeType: "application/zip",
            sizeBytes: 32,
            sha256: "f".repeat(64),
            presentation: "download",
            accessibilityText: "Архив примеров",
          },
        },
      ],
    };
    root.querySelector("main").innerHTML = reviewMarkup(mediaReview);

    expect(root.querySelector("img[src*='animated-demo.gif']")).not.toBeNull();
    expect(root.querySelector("video[controls][preload='metadata']").autoplay).toBe(false);
    expect(root.querySelector("audio[controls][preload='metadata']").autoplay).toBe(false);
    expect(root.querySelector("object[type='application/pdf']")).not.toBeNull();
    expect(root.querySelector("a[download][href*='examples.zip']").textContent).toContain("Скачать");
    expect(root.querySelectorAll(".lesson-attachment-size")[0].textContent).toBe("32 Б");
  });

  it("shows a fallback after a video error", () => {
    const dom = new JSDOM("<main></main>");
    const root = dom.window.document;
    root.querySelector("main").innerHTML = reviewMarkup({
      ...review,
      sourceArtifacts: [{
        id: "video-demo",
        kind: "video",
        caption: "Видео",
        content: {
          type: "file",
          fileName: "demo.webm",
          originalName: "Demo.webm",
          mimeType: "video/webm",
          sizeBytes: 32,
          sha256: "c".repeat(64),
          presentation: "video",
          accessibilityText: "Демонстрация видео",
        },
      }],
    });
    wireArtifactFallbacks(root);
    const video = root.querySelector("video[data-artifact-media]");
    video.dispatchEvent(new dom.window.Event("error"));

    expect(video.hidden).toBe(true);
    expect(root.querySelector("[data-artifact-fallback]").hidden).toBe(false);
  });

  it("renders a YouTube mount without executable source HTML", () => {
    const html = artifactMarkup({
      id: "video-introduction",
      kind: "video",
      caption: "Первая глава",
      content: {
        type: "youtube",
        videoId: "ocbtH4-FttI",
        startSeconds: 0,
        endSeconds: 353,
        accessibilityText: "Введение",
      },
    }, "video-course");
    expect(html).toContain('data-youtube-video-id="ocbtH4-FttI"');
    expect(html).toContain('data-youtube-start="0"');
    expect(html).toContain('data-youtube-end="353"');
    expect(html).not.toContain("<script");
  });

  it("renders schemaVersion 8 content blocks in source order without raw HTML", () => {
    const dom = new JSDOM("<main></main>");
    const root = dom.window.document;
    root.querySelector("main").innerHTML = sectionGroupsMarkup([{
      id: "formatted",
      title: "Форматированный раздел",
      units: [{
        id: "formatted-unit",
        title: "Структура страницы",
        contentBlocks: [
          { type: "heading", level: 2, runs: [{ type: "text", text: "Подзаголовок" }] },
          {
            type: "paragraph",
            runs: [
              { type: "strong", text: "Акцент." },
              { type: "text", text: " Обычный текст." },
            ],
          },
          {
            type: "callout",
            tone: "tip",
            label: "Вывод",
            blocks: [{
              type: "list",
              ordered: true,
              items: [[{ type: "emphasis", text: "Первый шаг" }]],
            }],
          },
          { type: "artifact", artifactRef: "figure-one" },
          { type: "quote", runs: [{ type: "text", text: "Цитата <script>." }] },
        ],
        artifactRefs: ["figure-one"],
      }],
    }], review.sourceArtifacts, "sample-article");

    expect(root.querySelector(".lesson-content-heading").textContent).toBe("Подзаголовок");
    expect(root.querySelector(".lesson-copy-text strong").textContent).toBe("Акцент.");
    expect(root.querySelector(".lesson-callout.is-tip ol li em").textContent).toBe("Первый шаг");
    expect(root.querySelectorAll(".lesson-artifact")).toHaveLength(1);
    expect(root.querySelector(".lesson-artifact").compareDocumentPosition(root.querySelector("blockquote")))
      .toBe(dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    expect(root.querySelectorAll("script")).toHaveLength(0);
  });
});
