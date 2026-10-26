import {
  advanceBlock,
  answerQuestion,
  completePreparedActivity,
  initializeActiveBlock,
  resizeBlock,
  selectApplication,
  setReadingMode,
  skipBlockQuestions,
} from "../domain/lesson-engine.js";
import {
  answerVideoQuestion as answerVideoQuestionEngine,
  advanceVideoQuestion,
  currentVideoQuestion,
  setVideoReadingMode,
  skipVideoQuestions,
  updateVideoProgress as updateVideoProgressEngine,
} from "../domain/video-lesson-engine.js";
import {
  appendContextChange,
  appendExchange,
  archiveAndResetClarification,
} from "../domain/clarification-thread.js";
import { buildCompletedUnitReview } from "../domain/completed-unit-review.js";
import { buildCourseOutline } from "../domain/course-outline.js";
import { normalizeLearningState } from "../domain/lesson-state.js";
import {
  selectRenderableCourseArtifacts,
} from "../content/renderable-course-artifacts.js";
import { API_VERSION, APP_ID } from "../app-identity.js";
import { createOperationLock } from "./operation-lock.js";

export class LearningService {
  constructor({
    course,
    store,
    provider,
    promptBuilder,
    clock = () => new Date(),
    operationLock = createOperationLock(),
    onLifecycleChange = null,
    assertCurrentCourse = async () => {},
  }) {
    this.course = course;
    this.store = store;
    this.provider = provider;
    this.promptBuilder = promptBuilder;
    this.clock = clock;
    this.operationLock = operationLock;
    this.onLifecycleChange = onLifecycleChange;
    this.assertCurrentCourse = assertCurrentCourse;
  }

  async loadState() {
    return normalizeLearningState(await this.store.load(), this.course);
  }

  mutate(operation) {
    return this.operationLock.run(operation);
  }

  async getView() {
    const state = initializeActiveBlock(this.course, await this.loadState());
    return this.toView(state);
  }

  async getSummary() {
    const state = initializeActiveBlock(this.course, await this.loadState());
    const completedUnits = state.completedUnitIds.length;
    return {
      lifecycleStatus: state.lifecycleStatus,
      completedUnits,
      totalUnits: this.course.units.length,
      progress: completedUnits / this.course.units.length,
      currentTitle: this.course.units[state.cursor]?.title ?? null,
      updatedAt: state.updatedAt,
    };
  }

  async getPlaylistLessonSnapshot() {
    if (this.course.schemaVersion !== 7 || !this.course.videoSource) {
      throw Object.assign(new Error("Playlist lessons require a YouTube course"), {
        category: "playlist-course-unavailable",
      });
    }
    const storedState = await this.loadState();
    const state = initializeActiveBlock(this.course, storedState);
    const completedUnitIds = [...storedState.completedUnitIds];
    const activeUnitIds = [...state.activeUnitIds];
    const completed = new Set(completedUnitIds);
    const active = new Set(activeUnitIds);
    const hasLearningActivity = storedState.lifecycleStatus !== "new"
      || completedUnitIds.length > 0
      || storedState.answerHistory.length > 0
      || Object.keys(storedState.videoProgress ?? {}).length > 0
      || Object.values(storedState.questionProgress ?? {}).some(({ answers = [] }) => answers.length > 0)
      || storedState.practiceHistory.length > 0
      || storedState.activityHistory.length > 0;

    return {
      availability: "available",
      courseId: this.course.id,
      title: this.course.title,
      contentVersion: this.course.contentVersion,
      videoId: this.course.videoSource.videoId,
      chapters: this.course.videoSource.chapters.map((chapter) => ({
        id: chapter.id,
        ...(chapter.unitId ? { unitId: chapter.unitId } : {}),
        title: chapter.title,
        order: chapter.order,
        status: chapter.status === "planned"
          ? "planned"
          : completed.has(chapter.unitId)
            ? "completed"
            : active.has(chapter.unitId)
              ? "current"
              : "locked",
      })),
      completedUnitIds,
      activeUnitIds,
      cursor: state.cursor,
      status: state.status,
      lifecycleStatus: storedState.lifecycleStatus,
      updatedAt: storedState.updatedAt,
      hasLearningActivity,
    };
  }

  async getOutline() {
    const state = initializeActiveBlock(this.course, await this.loadState());
    return buildCourseOutline(this.course, state);
  }

  async getReview(unitId) {
    const state = initializeActiveBlock(this.course, await this.loadState());
    return buildCompletedUnitReview(this.course, state, unitId);
  }

  async resize(delta) {
    return this.mutate(async () => {
      const state = initializeActiveBlock(this.course, await this.loadState());
      const fromUnitIds = [...state.activeUnitIds];
      const resized = resizeBlock(this.course, state, delta);
      return this.persistAndView({
        ...resized,
        clarificationThread: appendContextChange(state.clarificationThread, {
          fromUnitIds,
          toUnitIds: resized.activeUnitIds,
          createdAt: this.clock().toISOString(),
        }),
      });
    });
  }

  async answer(choice) {
    return this.mutate(async () => {
      const loaded = initializeActiveBlock(this.course, await this.loadState());
      return this.persistAndView(answerQuestion(this.course, loaded, choice));
    });
  }

  async skipQuestions() {
    return this.mutate(async () => {
      const loaded = initializeActiveBlock(this.course, await this.loadState());
      const skipped = this.course.schemaVersion === 7
        ? skipVideoQuestions(this.course, loaded, { timestamp: this.clock().toISOString() })
        : skipBlockQuestions(this.course, loaded);
      const view = await this.persistAndView(skipped);
      return { ...view, skipNotice: "Вопросы блока пропущены" };
    });
  }

  async setReadingMode(enabled) {
    return this.mutate(async () => {
      const loaded = initializeActiveBlock(this.course, await this.loadState());
      const options = { timestamp: this.clock().toISOString() };
      const next = this.course.schemaVersion === 7
        ? setVideoReadingMode(this.course, loaded, enabled, options)
        : setReadingMode(this.course, loaded, enabled, options);
      return this.persistAndView(next);
    });
  }

  async answerVideoQuestion(questionId, choice) {
    return this.mutate(async () => {
      const state = initializeActiveBlock(this.course, await this.loadState());
      return this.persistAndView(
        answerVideoQuestionEngine(this.course, state, questionId, choice, this.clock().toISOString()),
      );
    });
  }

  async updateVideoProgress(segmentId, positionSeconds) {
    return this.mutate(async () => {
      const state = initializeActiveBlock(this.course, await this.loadState());
      return this.persistAndView(
        updateVideoProgressEngine(this.course, state, segmentId, positionSeconds, this.clock().toISOString()),
      );
    });
  }

  async completeActivity(unitId, result) {
    return this.mutate(async () => {
      const state = initializeActiveBlock(this.course, await this.loadState());
      const completed = completePreparedActivity(this.course, state, {
        unitId,
        result,
        completedAt: this.clock().toISOString(),
      });
      return this.persistAndView(completed);
    });
  }

  async next() {
    return this.mutate(async () => {
      const state = initializeActiveBlock(this.course, await this.loadState());
      if (this.course.schemaVersion === 7) {
        return this.persistAndView(advanceVideoQuestion(this.course, state));
      }
      const advanced = advanceBlock(this.course, state);
      const nextState = archiveAndResetClarification(advanced, {
        finalUnitIds: state.activeUnitIds,
        nextCursor: advanced.cursor,
        completedAt: this.clock().toISOString(),
      });
      return this.persistAndView(nextState);
    });
  }

  async chooseApplication(choice) {
    return this.mutate(async () => {
      const loaded = initializeActiveBlock(this.course, await this.loadState());
      return this.persistAndView(selectApplication(this.course, loaded, choice));
    });
  }

  async generateLayer(operation) {
    return this.mutate(async () => {
      if (!["detail", "rephrase"].includes(operation)) {
        throw new Error("Unsupported lesson layer");
      }
      const state = initializeActiveBlock(this.course, await this.loadState());
      if (state.activeUnitIds.length === 0) throw new Error("No active lesson block");
      const units = this.unitsFor(state);
      const result = await this.provider.generate(
        this.promptBuilder({ operation, units }),
        operation,
      );
      return this.persistAndView({ ...state, layers: [...state.layers, result] });
    });
  }

  async startPractice() {
    return this.mutate(async () => {
      const state = initializeActiveBlock(this.course, await this.loadState());
      if (state.activeUnitIds.length === 0) throw new Error("No active lesson block");
      const units = this.unitsFor(state);
      const practice = await this.provider.generate(
        this.promptBuilder({ operation: "practice", units }),
        "practice",
      );
      return this.persistAndView({ ...state, practice });
    });
  }

  async reviewPractice(userAnswer) {
    return this.mutate(async () => {
      const state = initializeActiveBlock(this.course, await this.loadState());
      if (!state.practice) throw new Error("No active practice");
      const units = this.unitsFor(state);
      const review = await this.provider.generate(
        this.promptBuilder({
          operation: "practice-review",
          units,
          userAnswer,
          practice: state.practice,
        }),
        "practice-review",
      );
      const entry = {
        practice: state.practice,
        userAnswer,
        review,
        completedAt: this.clock().toISOString(),
      };
      return this.persistAndView({
        ...state,
        practice: null,
        practiceHistory: [...state.practiceHistory, entry],
      });
    });
  }

  async askClarification(question) {
    return this.mutate(async () => {
      const cleaned = String(question ?? "").trim();
      if (!cleaned) throw new Error("Clarification question is required");
      const state = initializeActiveBlock(this.course, await this.loadState());
      if (state.activeUnitIds.length === 0) throw new Error("No active lesson block");
      const units = this.unitsFor(state);
      const result = await this.provider.generate(
        this.promptBuilder({
          operation: "clarification",
          units,
          clarificationQuestion: cleaned,
          clarificationMessages: state.clarificationThread.messages,
        }),
        "clarification",
      );
      const createdAt = this.clock().toISOString();
      return this.persistAndView({
        ...state,
        clarificationThread: appendExchange(state.clarificationThread, {
          question: cleaned,
          result,
          unitIds: state.activeUnitIds,
          createdAt,
        }),
      });
    });
  }

  unitsFor(state) {
    return state.activeUnitIds.map((id) => this.course.units.find((unit) => unit.id === id));
  }

  questionStats(state) {
    if (this.course.schemaVersion === 7) {
      let answered = 0;
      let skipped = 0;
      for (const progress of Object.values(state.questionProgress ?? {})) {
        for (const entry of progress.answers ?? []) {
          if (entry.skipped) skipped += 1;
          else answered += 1;
        }
      }
      return { answered, skipped };
    }
    const skipped = new Set(state.skippedQuestionIds ?? []);
    const asked = state.askedQuestionIds ?? [];
    return {
      answered: asked.filter((id) => !skipped.has(id)).length,
      skipped: asked.filter((id) => skipped.has(id)).length,
    };
  }

  sourceArtifactsFor(units) {
    return selectRenderableCourseArtifacts(this.course, units);
  }

  sectionGroupsFor(units) {
    return units.reduce((groups, unit) => {
      const section = this.course.sections.find((candidate) => candidate.id === unit.sectionId);
      const last = groups.at(-1);
      if (last?.id === section.id) {
        last.units.push(unit);
      } else {
        groups.push({ id: section.id, title: section.title, units: [unit] });
      }
      return groups;
    }, []);
  }

  async persistAndView(state) {
    const lifecycleStatus = this.course.schemaVersion === 7
      ? state.lifecycleStatus
      : state.status === "complete"
        ? "complete"
        : "in-progress";
    const stamped = {
      ...state,
      lifecycleStatus,
      updatedAt: this.clock().toISOString(),
    };
    await this.assertCurrentCourse();
    await this.store.save(stamped);
    if (stamped.lifecycleStatus === "complete") {
      await this.onLifecycleChange?.({
        courseId: this.course.id,
        lifecycleStatus: stamped.lifecycleStatus,
      });
    }
    return this.toView(stamped);
  }

  toView(state) {
    if (this.course.schemaVersion === 7) {
      return this.toVideoView(state);
    }
    const units = this.unitsFor(state);
    const questionUnit = this.course.units.find((unit) => unit.id === state.activeQuestionUnitId);
    const stateQueue = Array.isArray(state.activeQuestionUnitIds)
      ? state.activeQuestionUnitIds
      : null;
    const questionUnitIds = stateQueue?.length
      ? stateQueue
      : stateQueue !== null
        ? []
        : units.map((unit) => unit.id);
    const answeredQuestionIds = new Set(state.askedQuestionIds ?? []);
    const questionIndex = Math.max(0, questionUnitIds.indexOf(state.activeQuestionUnitId));
    const reading = Boolean(state.readingMode);
    const remainingQuestionCount = reading
      ? 0
      : questionUnitIds
        .filter((unitId) => !answeredQuestionIds.has(unitId)).length;
    const actualSize = units.length;
    const awaitingAnswer = state.status === "awaiting-answer";
    const canResize = awaitingAnswer || (reading && state.status === "reviewed");
    const { clarificationHistory: _privateHistory, ...publicState } = state;
    const articleEnd = state.cursor + actualSize >= this.course.units.length;
    const sizeLimitReason = !canResize
      ? "answer-locked"
      : articleEnd
        ? "article-end"
        : null;
    const canIncrease = canResize && sizeLimitReason === null;
    const canDecrease = canResize && actualSize > 1;
    const activityHistory = state.activityHistory ?? [];
    const activities = units
      .filter((unit) => unit.activity)
      .map((unit) => {
        const completed = activityHistory.find((entry) => entry.unitId === unit.id);
        return {
          unitId: unit.id,
          ...unit.activity,
          completed: Boolean(completed),
          result: completed?.result ?? null,
          completedAt: completed?.completedAt ?? null,
        };
      });
    return {
      ...publicState,
      appId: APP_ID,
      apiVersion: API_VERSION,
      title: this.course.title,
      totalUnits: this.course.units.length,
      units,
      actualSize,
      sectionGroups: this.sectionGroupsFor(units),
      sourceArtifacts: this.sourceArtifactsFor(units),
      sizeLimitReason,
      canIncrease,
      canDecrease,
      question: questionUnit?.check ?? null,
      questionPosition: questionUnit ? questionIndex + 1 : 0,
      questionCount: questionUnitIds.length,
      remainingQuestionCount,
      readingMode: reading,
      questionStats: this.questionStats(state),
      activities,
      application: state.status === "awaiting-application" ? this.course.application : null,
      canGoNext: state.status === "reviewed",
      nextAction: state.status === "reviewed" && remainingQuestionCount > 0
        ? "question"
        : "block",
      progress: state.completedUnitIds.length / this.course.units.length,
    };
  }

  toVideoView(state) {
    const { clarificationHistory: _privateHistory, ...publicState } = state;
    const unitId = state.activeQuestionUnitId;
    const unit = unitId ? this.course.units.find((u) => u.id === unitId) : null;
    const reading = Boolean(state.readingMode);
    const question = reading ? null : currentVideoQuestion(this.course, state);

    let questionReview = null;
    if (state.status === "video-question-reviewed" && unitId) {
      const progress = state.questionProgress[unitId];
      const lastAnswer = progress?.answers.at(-1);
      if (lastAnswer) {
        const questionObj = unit?.checks.find((q) => q.id === lastAnswer.questionId);
        questionReview = {
          questionId: lastAnswer.questionId,
          choice: lastAnswer.choice,
          correct: lastAnswer.correct,
          correctAnswer: questionObj?.correct,
          explanation: lastAnswer.explanation,
          explanations: questionObj?.explanations,
        };
      }
    }

    const chapter = unitId
      ? this.course.videoSource?.chapters.find(
          (c) => c.status === "ready" && c.unitId === unitId,
        )
      : null;
    const storedProgress = unitId ? state.videoProgress[unitId] : undefined;
    const videoProgress = chapter && storedProgress
      ? {
          segmentId: unitId,
          positionSeconds: storedProgress.positionSeconds,
          watched: storedProgress.watched,
          startSeconds: chapter.startSeconds,
          endSeconds: chapter.endSeconds,
        }
      : null;

    const units = unit ? [unit] : [];
    const readyChapters = this.course.videoSource?.chapters.filter((c) => c.status === "ready") ?? [];

    return {
      ...publicState,
      appId: APP_ID,
      apiVersion: API_VERSION,
      courseMode: "video",
      title: this.course.title,
      totalUnits: this.course.units.length,
      units,
      actualSize: units.length,
      sectionGroups: this.sectionGroupsFor(units),
      sourceArtifacts: this.sourceArtifactsFor(units),
      videoChapter: chapter ? {
        id: chapter.id,
        title: chapter.title,
        order: chapter.order,
        status: chapter.status,
        startSeconds: chapter.startSeconds,
        endSeconds: chapter.endSeconds,
      } : null,
      question,
      questionReview,
      videoProgress,
      transcript: unit?.transcript ?? null,
      progress: state.completedUnitIds.length / this.course.units.length,
      readingMode: reading,
      questionStats: this.questionStats(state),
      prepared: {
        completed: state.completedUnitIds.length,
        total: readyChapters.length,
      },
      chapterPreparation: {
        ready: readyChapters.length,
        total: this.course.videoSource?.chapters.length ?? 0,
      },
    };
  }
}
