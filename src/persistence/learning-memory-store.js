import fs from "node:fs/promises";
import path from "node:path";

const START = "<!-- adaptive-learning-state:start";
const END = "adaptive-learning-state:end -->";

function parseMachineBlock(markdown) {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  if (start < 0 || end < 0 || end <= start) return null;
  const json = markdown.slice(start + START.length, end).trim();
  return JSON.parse(json);
}

function inferLegacyState(markdown) {
  const match = markdown.match(/Блок\s+(\d+):/u);
  const blockNumber = match ? Number(match[1]) : 1;
  return {
    version: 0,
    cursor: Math.max(0, blockNumber - 1),
    targetSize: 1,
  };
}

function upsertMachineBlock(markdown, state) {
  const block = `${START}\n${JSON.stringify(state, null, 2)}\n${END}`;
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  if (start >= 0 && end > start) {
    return `${markdown.slice(0, start)}${block}${markdown.slice(end + END.length)}`;
  }
  return `${markdown.trimEnd()}\n\n${block}\n`;
}

export class LearningMemoryStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    const markdown = await fs.readFile(this.filePath, "utf8");
    return parseMachineBlock(markdown) ?? inferLegacyState(markdown);
  }

  async create(state, { humanText = "# Learning Memory" } = {}) {
    const directory = path.dirname(this.filePath);
    const tempPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`,
    );
    const next = upsertMachineBlock(humanText, state);
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(tempPath, next, { encoding: "utf8", flag: "wx" });
      try {
        await fs.link(tempPath, this.filePath);
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new Error("Learning memory already exists");
        }
        throw error;
      }
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }

  async save(state) {
    const markdown = await fs.readFile(this.filePath, "utf8");
    const next = upsertMachineBlock(markdown, state);
    const tempPath = path.join(path.dirname(this.filePath), `${path.basename(this.filePath)}.tmp`);
    await fs.writeFile(tempPath, next, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}
