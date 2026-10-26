// Synthetic large roadmap. No personal or third-party course content.
export function largeRoadmapDocument() {
  let n = 0;
  const sections = Array.from({ length: 13 }, (_, i) => ({
    id: `module-${i + 1}`, title: `Модуль ${i + 1}`, order: i + 1,
    items: Array.from({ length: i < 8 ? 4 : 3 }, (_, j) => {
      const index = n++;
      return { id: `item-${index + 1}`, title: `Учебная тема ${index + 1}`, order: j + 1,
        ...(index < 10 ? { courseId: index === 0 ? "agenty-i-vajbkoding-introduction-pilot" : `agenty-i-vajbkoding-chapter-${index}` } : {}) };
    }),
  }));
  return { schemaVersion: 1, roadmaps: [{ id: "agenty-i-vajbkoding", title: "Большой учебный маршрут", sections }] };
}
