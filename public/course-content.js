export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderCoreText(text = "") {
  return String(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`)
    .join("");
}

function inlineRunsMarkup(runs = []) {
  return runs.map((run) => {
    if (run.type === "line-break") return "<br>";
    const text = escapeHtml(run.text);
    if (run.type === "strong") return `<strong>${text}</strong>`;
    if (run.type === "emphasis") return `<em>${text}</em>`;
    return text;
  }).join("");
}

function artifactUrl(courseId, content) {
  const version = content.sha256.slice(0, 12);
  return `/api/courses/${encodeURIComponent(courseId)}/assets/${encodeURIComponent(content.fileName)}?v=${version}`;
}

function artifactIndex(artifacts = []) {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]));
}

function artifactCaption(artifact, element = "figcaption") {
  return `<${element} class="lesson-artifact-caption">${escapeHtml(artifact.caption)}</${element}>`;
}

function formatBytes(value) {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} МБ`;
  return `${(value / 1024 ** 3).toFixed(1)} ГБ`;
}

function fileMarkup(artifact, courseId, id) {
  const content = artifact.content;
  const url = escapeHtml(artifactUrl(courseId, content));
  const label = escapeHtml(content.accessibilityText);
  if (content.presentation === "image") {
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-artifact-frame">
        <img data-artifact-media src="${url}" alt="${label}" loading="lazy" decoding="async">
        <div class="lesson-artifact-fallback" data-artifact-fallback hidden>Иллюстрация временно недоступна</div>
      </div>${artifactCaption(artifact)}</figure>`;
  }
  if (content.presentation === "video") {
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-artifact-frame"><video data-artifact-media controls preload="metadata" playsinline aria-label="${label}" src="${url}"></video>
      <div class="lesson-artifact-fallback" data-artifact-fallback hidden>Видео временно недоступно</div></div>
      ${artifactCaption(artifact)}</figure>`;
  }
  if (content.presentation === "audio") {
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-artifact-frame lesson-audio-frame"><audio data-artifact-media controls preload="metadata" aria-label="${label}" src="${url}"></audio>
      <div class="lesson-artifact-fallback" data-artifact-fallback hidden>Аудио временно недоступно</div></div>
      ${artifactCaption(artifact)}</figure>`;
  }
  if (content.presentation === "pdf") {
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-artifact-frame lesson-pdf-frame"><object data-artifact-media data="${url}" type="application/pdf" aria-label="${label}"></object>
      <div class="lesson-artifact-fallback" data-artifact-fallback hidden>PDF временно недоступен</div></div>
      <a class="lesson-attachment-link" href="${url}" download>Скачать PDF</a>${artifactCaption(artifact)}</figure>`;
  }
  return `<figure class="lesson-artifact lesson-attachment" data-artifact-id="${id}">
    <div><strong>${escapeHtml(content.originalName)}</strong><div class="lesson-attachment-size">${formatBytes(content.sizeBytes)}</div></div>
    <a class="lesson-attachment-link" href="${url}" download>Скачать</a>${artifactCaption(artifact)}</figure>`;
}

function youtubeMarkup(artifact, id) {
  const content = artifact.content;
  const videoId = encodeURIComponent(content.videoId);
  const startSeconds = Math.max(0, Math.floor(content.startSeconds));
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`;
  return `<figure class="lesson-artifact is-youtube" data-artifact-id="${id}">
    <div class="youtube-player-shell" data-youtube-player
      data-youtube-video-id="${escapeHtml(content.videoId)}"
      data-youtube-start="${startSeconds}"
      data-youtube-end="${Math.max(startSeconds, Math.floor(content.endSeconds))}"
      aria-label="${escapeHtml(content.accessibilityText)}"></div>
    <div data-youtube-fallback hidden>
      <p>Видео YouTube временно недоступно. Можно открыть оригинал по ссылке или вернуться к уроку позже.</p>
      <a data-youtube-source-link href="${escapeHtml(sourceUrl)}" rel="noopener noreferrer" target="_blank">Открыть оригинал</a>
    </div>
    ${artifactCaption(artifact)}
  </figure>`;
}

export function artifactMarkup(artifact, courseId) {
  const content = artifact?.content;
  if (!content) return "";
  const id = escapeHtml(artifact.id);
  if (content.type === "file") return fileMarkup(artifact, courseId, id);
  if (content.type === "youtube") return youtubeMarkup(artifact, id);
  if (content.type === "image") {
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-artifact-frame">
        <img data-artifact-image src="${escapeHtml(artifactUrl(courseId, content))}" alt="${escapeHtml(content.alt)}" loading="lazy" decoding="async">
        <div class="lesson-artifact-fallback" data-artifact-fallback hidden>Иллюстрация временно недоступна</div>
      </div>
      ${artifactCaption(artifact)}
    </figure>`;
  }
  if (content.type === "table") {
    const headings = content.columns.map((column, index) => (
      `<th scope="col" class="is-${content.align[index]}">${escapeHtml(column)}</th>`
    )).join("");
    const rows = content.rows.map((row) => `<tr>${row.map((cell, index) => (
      `<td class="is-${content.align[index]}">${escapeHtml(cell)}</td>`
    )).join("")}</tr>`).join("");
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-table-scroll"><table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></div>
      ${artifactCaption(artifact)}
    </figure>`;
  }
  if (content.type === "code") {
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-code-scroll"><pre><code data-language="${escapeHtml(content.language)}">${escapeHtml(content.text)}</code></pre></div>
      ${artifactCaption(artifact)}
    </figure>`;
  }
  if (content.type === "formula") {
    return `<figure class="lesson-artifact" data-artifact-id="${id}">
      <div class="lesson-formula">${escapeHtml(content.text)}</div>
      ${artifactCaption(artifact)}
    </figure>`;
  }
  return "";
}

function unitArtifactsMarkup(unit, artifactsById, courseId) {
  return (unit.artifactRefs ?? [])
    .map((id) => artifactsById.get(id))
    .filter(Boolean)
    .map((artifact) => artifactMarkup(artifact, courseId))
    .join("");
}

function formattedBlockMarkup(block, artifactsById, courseId) {
  if (block.type === "heading") {
    const tag = block.level === 2 ? "h4" : "h5";
    return `<${tag} class="lesson-content-heading is-level-${block.level}">${inlineRunsMarkup(block.runs)}</${tag}>`;
  }
  if (block.type === "paragraph") {
    return `<p>${inlineRunsMarkup(block.runs)}</p>`;
  }
  if (block.type === "list") {
    const tag = block.ordered ? "ol" : "ul";
    return `<${tag} class="lesson-content-list">${block.items.map((item) => `<li>${inlineRunsMarkup(item)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "callout") {
    const label = block.label ? `<p class="lesson-callout-label">${escapeHtml(block.label)}</p>` : "";
    const body = block.blocks.map((nested) => formattedBlockMarkup(nested, artifactsById, courseId)).join("");
    return `<aside class="lesson-callout is-${escapeHtml(block.tone)}">${label}${body}</aside>`;
  }
  if (block.type === "quote") {
    return `<blockquote class="lesson-content-quote">${inlineRunsMarkup(block.runs)}</blockquote>`;
  }
  if (block.type === "artifact") {
    return artifactMarkup(artifactsById.get(block.artifactRef), courseId);
  }
  return "";
}

function unitBodyMarkup(unit, artifactsById, courseId) {
  if (unit.contentBlocks) {
    return unit.contentBlocks
      .map((block) => formattedBlockMarkup(block, artifactsById, courseId))
      .join("");
  }
  return `${renderCoreText(unit.coreText)}${unitArtifactsMarkup(unit, artifactsById, courseId)}`;
}

export function wireArtifactFallbacks(root) {
  root.querySelectorAll("[data-artifact-image], [data-artifact-media]").forEach((media) => {
    media.addEventListener("error", () => {
      media.hidden = true;
      const fallback = media.parentElement?.querySelector("[data-artifact-fallback]");
      if (fallback) fallback.hidden = false;
    }, { once: true });
  });
}

export function sectionGroupsMarkup(groups = [], sourceArtifacts = [], courseId = "", { includeUnitText = true } = {}) {
  const artifactsById = artifactIndex(sourceArtifacts);
  return groups.map((group) => `<section class="lesson-section" data-section-id="${escapeHtml(group.id)}">
    <h2 class="lesson-section-title">${escapeHtml(group.title)}</h2>
    ${group.units.map((unit) => `<article class="lesson-unit">
      <h3>${escapeHtml(unit.title)}</h3>
      ${includeUnitText
        ? `<div class="lesson-copy-text">${unitBodyMarkup(unit, artifactsById, courseId)}</div>`
        : unitArtifactsMarkup(unit, artifactsById, courseId)}
    </article>`).join("")}
  </section>`).join("");
}

export function reviewMarkup(review) {
  const artifacts = review.sourceArtifacts ?? [];
  const artifactsById = artifactIndex(artifacts);
  const body = review.unit.contentBlocks
    ? unitBodyMarkup(review.unit, artifactsById, review.courseId)
    : `${renderCoreText(review.unit.coreText)}${artifacts.map((artifact) => artifactMarkup(artifact, review.courseId)).join("")}`;
  const skipped = review.skippedQuestions ?? [];
  const skippedMarkup = skipped.length
    ? `<div class="review-skipped"><span class="review-skipped-badge">Вопрос пропущен без ответа</span>${skipped.map((entry) => `<p>${escapeHtml(entry.prompt ?? "")}</p>`).join("")}</div>`
    : "";
  return `<article class="review-unit" data-review-unit-id="${escapeHtml(review.unit.id)}">
    <span class="eyebrow">Просмотр пройденного фрагмента</span>
    <p class="review-section-title">${escapeHtml(review.section.title)}</p>
    <h1 id="review-title">${escapeHtml(review.unit.title)}</h1>
    <div class="lesson-copy-text">${body}</div>
    ${skippedMarkup}
  </article>`;
}
