const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const API_URL = "https://www.youtube.com/iframe_api";
let apiPromise = null;

function clamp(value, startSeconds, endSeconds) {
  return Math.max(startSeconds, Math.min(endSeconds, Math.floor(Number(value) || 0)));
}

function assertSegment({ element, videoId, startSeconds, endSeconds }) {
  if (!element || typeof element !== "object") throw new TypeError("YouTube player element is required");
  if (!VIDEO_ID.test(videoId)) throw new TypeError("Invalid YouTube video ID");
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
    || startSeconds < 0 || endSeconds <= startSeconds) {
    throw new TypeError("Invalid YouTube segment bounds");
  }
}

export function loadYouTubeApi(windowRef = globalThis.window) {
  if (windowRef?.YT?.Player) return Promise.resolve(windowRef.YT);
  if (apiPromise) return apiPromise;
  const documentRef = windowRef?.document;
  if (!documentRef) return Promise.reject(new Error("YouTube IFrame API requires a browser window"));

  apiPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = windowRef.setTimeout(() => finish(new Error("YouTube IFrame API timed out")), 15_000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      windowRef.clearTimeout(timeout);
      if (error) {
        apiPromise = null;
        reject(error);
      } else {
        resolve(windowRef.YT);
      }
    };
    const previousReady = windowRef.onYouTubeIframeAPIReady;
    windowRef.onYouTubeIframeAPIReady = (...args) => {
      previousReady?.apply(windowRef, args);
      if (windowRef.YT?.Player) finish();
      else finish(new Error("YouTube IFrame API did not expose Player"));
    };
    const existing = documentRef.querySelector(`script[src="${API_URL}"]`);
    if (!existing) {
      const script = documentRef.createElement("script");
      script.src = API_URL;
      script.async = true;
      script.onerror = () => finish(new Error("YouTube IFrame API failed to load"));
      documentRef.head.append(script);
    }
  });
  return apiPromise;
}

export async function createYouTubeSegmentPlayer({
  element,
  videoId,
  startSeconds,
  endSeconds,
  saved,
  onSave = () => {},
  onError = () => {},
  youtube,
  clock = () => Date.now(),
}) {
  assertSegment({ element, videoId, startSeconds, endSeconds });
  const yt = youtube ?? await loadYouTubeApi(element.ownerDocument?.defaultView);
  if (typeof yt?.Player !== "function") throw new TypeError("YouTube IFrame API is unavailable");

  const savedPosition = saved && !saved.watched
    ? clamp(saved.positionSeconds, startSeconds, endSeconds)
    : startSeconds;
  const initialPosition = savedPosition >= endSeconds ? startSeconds : savedPosition;
  const documentRef = element.ownerDocument;
  const playerStates = yt.PlayerState ?? {};
  let player;
  let pollingId = null;
  let lastSavedAt = clock();
  let destroyed = false;

  const currentPosition = () => clamp(player?.getCurrentTime?.(), startSeconds, endSeconds);
  const notifySave = (positionSeconds) => {
    if (destroyed) return;
    try {
      const result = onSave(positionSeconds);
      result?.catch?.(() => {});
    } catch {
      // Saving progress must not make the lesson unavailable.
    }
  };
  const stopPolling = () => {
    if (pollingId !== null) {
      clearInterval(pollingId);
      pollingId = null;
    }
  };
  const stopAtEnd = () => {
    player?.cueVideoById?.({
      videoId,
      startSeconds: endSeconds,
      endSeconds,
    });
    player?.pauseVideo?.();
    notifySave(endSeconds);
    stopPolling();
  };
  const enforceBounds = () => {
    const position = currentPosition();
    if (position >= endSeconds) {
      stopAtEnd();
      return true;
    }
    if (position < startSeconds) player?.seekTo?.(startSeconds, true);
    return false;
  };
  const startPolling = () => {
    if (pollingId !== null) return;
    lastSavedAt = clock();
    pollingId = setInterval(() => {
      if (destroyed || enforceBounds()) return;
      if (clock() - lastSavedAt >= 10_000) {
        lastSavedAt = clock();
        notifySave(currentPosition());
      }
    }, 1_000);
  };
  const saveCurrent = () => {
    if (enforceBounds()) return;
    notifySave(currentPosition());
  };
  const onVisibilityChange = () => {
    if (documentRef?.visibilityState === "hidden") saveCurrent();
  };

  player = new yt.Player(element, {
    events: {
      onReady: ({ target }) => {
        target.cueVideoById({
          videoId,
          startSeconds: initialPosition,
          endSeconds,
        });
      },
      onStateChange: ({ data }) => {
        if (data === playerStates.PLAYING) startPolling();
        else if (data === playerStates.PAUSED) {
          stopPolling();
          saveCurrent();
        } else if (data === playerStates.ENDED) stopAtEnd();
        else if (data !== playerStates.BUFFERING) stopPolling();
      },
      onError: () => {
        stopPolling();
        onError();
      },
    },
  });
  documentRef?.addEventListener?.("visibilitychange", onVisibilityChange);

  return {
    seekTo(seconds) {
      const target = clamp(seconds, startSeconds, endSeconds);
      player.seekTo(target, true);
      if (target >= endSeconds) stopAtEnd();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPolling();
      documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange);
      player?.destroy?.();
    },
  };
}
