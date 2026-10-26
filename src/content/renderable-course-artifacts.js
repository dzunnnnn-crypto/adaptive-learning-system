function publicArtifact(artifact) {
  return {
    id: artifact.id,
    kind: artifact.kind,
    caption: artifact.caption,
    content: structuredClone(artifact.content),
  };
}

export function selectRenderableCourseArtifacts(course, units) {
  if (![5, 6, 7, 8].includes(course.schemaVersion)) return [];
  const artifactsById = new Map(
    (course.sourceArtifacts ?? []).map((artifact) => [artifact.id, artifact]),
  );
  const seen = new Set();
  const result = [];

  for (const unit of units) {
    for (const artifactId of unit.artifactRefs ?? []) {
      if (seen.has(artifactId)) continue;
      const artifact = artifactsById.get(artifactId);
      if (artifact?.coverage !== "covered" || !artifact.content) continue;
      seen.add(artifactId);
      result.push(publicArtifact(artifact));
    }
  }
  return result;
}
