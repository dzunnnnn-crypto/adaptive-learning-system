import express from "express";
import path from "node:path";
import { z } from "zod";
import { API_VERSION, APP_ID } from "../app-identity.js";
import { errorResponse } from "./error-response.js";
import { sendCourseAsset } from "./course-asset-response.js";

const ResizeBody = z.object({ delta: z.union([z.literal(1), z.literal(-1)]) }).strict();
const AnswerBody = z.object({ choice: z.enum(["А", "Б", "В"]) }).strict();
const PracticeReviewBody = z.object({ answer: z.string().trim().min(1).max(5000) }).strict();
const ClarificationBody = z.object({
  question: z.string().trim().min(1).max(5000),
}).strict();
const AiProfileBody = z.object({
  profileId: z.string().min(1).max(80),
}).strict();
const ActivityBody = z.object({
  unitId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  result: z.string().trim().min(1).max(5000),
}).strict();
const VideoQuestionAnswerBody = z.object({
  choice: z.enum(["А", "Б", "В"]),
}).strict();
const VideoProgressBody = z.object({
  positionSeconds: z.number().int().nonnegative(),
}).strict();
const ReadingModeBody = z.object({
  enabled: z.boolean(),
}).strict();
const PlaylistIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const PlaylistOpenBody = z.object({
  lessonCourseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
}).strict();

function parsePlaylistId(value) {
  return PlaylistIdSchema.parse(value);
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response)).catch(next);
  };
}

export function createApp({ manager, publicPath, aiProfileService }) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  const withCourse = (method) => asyncRoute(async (request, response) => {
    const service = await manager.serviceFor(request.params.courseId);
    const view = await method(service, request);
    response.json(await manager.decorateView?.(request.params.courseId, view) ?? view);
  });

  app.get("/api/health", (_request, response) => {
    response.json({ appId: APP_ID, apiVersion: API_VERSION });
  });

  app.get("/api/courses", asyncRoute(async (_request, response) => {
    const [lastCourseId, courses, playlists] = await Promise.all([
      manager.getLastCourseId(),
      manager.listCourses(),
      manager.listPlaylists?.() ?? Promise.resolve([]),
    ]);
    response.json({ lastCourseId, courses, playlists });
  }));

  app.get("/api/playlists/:playlistId/outline", asyncRoute(async (request, response) => {
    response.json(await manager.playlistOutlineFor(parsePlaylistId(request.params.playlistId)));
  }));

  app.post("/api/playlists/:playlistId/open", asyncRoute(async (request, response) => {
    const playlistId = parsePlaylistId(request.params.playlistId);
    const input = PlaylistOpenBody.parse(request.body ?? {});
    response.json(await manager.openPlaylist(playlistId, input));
  }));

  app.post("/api/playlists/:playlistId/archive", asyncRoute(async (request, response) => {
    const playlistId = parsePlaylistId(request.params.playlistId);
    await manager.archivePlaylist(playlistId);
    response.json({ playlists: await manager.listPlaylists() });
  }));

  app.post("/api/playlists/:playlistId/restore", asyncRoute(async (request, response) => {
    const playlistId = parsePlaylistId(request.params.playlistId);
    await manager.restorePlaylist(playlistId);
    response.json({ playlists: await manager.listPlaylists() });
  }));

  app.post("/api/courses/:courseId/archive", asyncRoute(async (request, response) => {
    response.json(await manager.archiveCourse(request.params.courseId));
  }));

  app.post("/api/courses/:courseId/restore", asyncRoute(async (request, response) => {
    response.json(await manager.restoreCourse(request.params.courseId));
  }));

  app.get("/api/ai/profiles", asyncRoute(async (_request, response) => {
    response.json(await aiProfileService.getPublicState());
  }));

  app.put("/api/ai/profile", asyncRoute(async (request, response) => {
    const { profileId } = AiProfileBody.parse(request.body);
    response.json(await aiProfileService.select(profileId));
  }));

  app.get("/api/courses/:courseId/session", asyncRoute(async (request, response) => {
    response.json(await manager.open(request.params.courseId));
  }));

  app.get("/api/courses/:courseId/outline", asyncRoute(async (request, response) => {
    response.json(await manager.outlineFor(request.params.courseId));
  }));

  app.get("/api/courses/:courseId/source", asyncRoute(async (request, response) => {
    const source = await manager.sourceFor(request.params.courseId);
    response.type("application/pdf").sendFile(source.filePath);
  }));

  app.get("/api/courses/:courseId/review/:unitId", asyncRoute(async (request, response) => {
    response.json(await manager.reviewFor(
      request.params.courseId,
      request.params.unitId,
    ));
  }));

  app.post("/api/courses/:courseId/resize", withCourse(async (service, request) => {
    const { delta } = ResizeBody.parse(request.body);
    return service.resize(delta);
  }));

  app.post("/api/courses/:courseId/answer", withCourse(async (service, request) => {
    const { choice } = AnswerBody.parse(request.body);
    return service.answer(choice);
  }));

  app.post("/api/courses/:courseId/skip-questions", withCourse((service) => service.skipQuestions()));

  app.put("/api/courses/:courseId/reading-mode", withCourse(async (service, request) => {
    const { enabled } = ReadingModeBody.parse(request.body);
    return service.setReadingMode(enabled);
  }));

  app.post("/api/courses/:courseId/application", withCourse(async (service, request) => {
    const { choice } = AnswerBody.parse(request.body);
    return service.chooseApplication(choice);
  }));

  app.post("/api/courses/:courseId/next", withCourse((service) => service.next()));

  app.post("/api/courses/:courseId/ai/detail", withCourse((service) => service.generateLayer("detail")));

  app.post("/api/courses/:courseId/ai/rephrase", withCourse((service) => service.generateLayer("rephrase")));

  app.post("/api/courses/:courseId/practice", withCourse((service) => service.startPractice()));

  app.post("/api/courses/:courseId/practice/review", withCourse(async (service, request) => {
    const { answer } = PracticeReviewBody.parse(request.body);
    return service.reviewPractice(answer);
  }));

  app.post("/api/courses/:courseId/clarification", withCourse(async (service, request) => {
    const { question } = ClarificationBody.parse(request.body);
    return service.askClarification(question);
  }));

  app.post("/api/courses/:courseId/activity", withCourse(async (service, request) => {
    const { unitId, result } = ActivityBody.parse(request.body);
    return service.completeActivity(unitId, result);
  }));

  app.post("/api/courses/:courseId/questions/:questionId/answer", withCourse(async (service, request) => {
    const { choice } = VideoQuestionAnswerBody.parse(request.body);
    return service.answerVideoQuestion(request.params.questionId, choice);
  }));

  app.put("/api/courses/:courseId/video-progress/:segmentId", withCourse(async (service, request) => {
    const { positionSeconds } = VideoProgressBody.parse(request.body);
    return service.updateVideoProgress(request.params.segmentId, positionSeconds);
  }));

  app.get("/api/courses/:courseId/assets/:fileName", asyncRoute(async (request, response) => {
    const asset = await manager.assetFor(request.params.courseId, request.params.fileName);
    return sendCourseAsset(request, response, asset);
  }));

  app.use(express.static(publicPath));

  app.get("/course/:courseId", (_request, response) => {
    response.sendFile("index.html", { root: publicPath });
  });

  app.get("/playlist/:playlistId", (request, response) => {
    parsePlaylistId(request.params.playlistId);
    response.sendFile("index.html", { root: publicPath });
  });

  app.use((error, _request, response, _next) => {
    if (error?.category === "asset-range") {
      response.set("Content-Range", `bytes */${error.sizeBytes}`);
    }
    const mapped = errorResponse(error);
    response.status(mapped.status).json({ code: mapped.code, message: mapped.message });
  });

  return app;
}
