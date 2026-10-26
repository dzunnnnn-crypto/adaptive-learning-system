import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createYouTubeSegmentPlayer } from "../public/youtube-player.js";

function createFakeYouTube({ currentTime = 0 } = {}) {
  let options;
  let seconds = currentTime;
  const player = {
    cueVideoById: vi.fn(),
    getCurrentTime: vi.fn(() => seconds),
    pauseVideo: vi.fn(),
    seekTo: vi.fn((value) => { seconds = value; }),
    destroy: vi.fn(),
  };
  function Player(_element, nextOptions) {
    options = nextOptions;
    return player;
  }
  return {
    youtube: {
      Player,
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    },
    player,
    ready() { options.events.onReady({ target: player }); },
    state(value) { options.events.onStateChange({ data: value, target: player }); },
    error(code) { options.events.onError({ data: code, target: player }); },
    setCurrentTime(value) { seconds = value; },
  };
}

function playerOptions({ fake, saved } = {}) {
  const element = new JSDOM("<div></div>").window.document.querySelector("div");
  return {
    element,
    videoId: "ocbtH4-FttI",
    startSeconds: 0,
    endSeconds: 353,
    saved,
    youtube: fake.youtube,
    onSave: vi.fn(),
    onError: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("YouTube segment player", () => {
  it("cues the chapter and resumes an unfinished position", async () => {
    const fake = createFakeYouTube({ currentTime: 197 });
    const options = playerOptions({ fake, saved: { positionSeconds: 197, watched: false } });
    const controller = await createYouTubeSegmentPlayer(options);

    fake.ready();

    expect(fake.player.cueVideoById).toHaveBeenCalledWith({
      videoId: "ocbtH4-FttI",
      startSeconds: 197,
      endSeconds: 353,
    });
    controller.destroy();
  });

  it("starts a watched chapter from the chapter beginning", async () => {
    const fake = createFakeYouTube({ currentTime: 197 });
    const controller = await createYouTubeSegmentPlayer(playerOptions({
      fake,
      saved: { positionSeconds: 197, watched: true },
    }));

    fake.ready();

    expect(fake.player.cueVideoById).toHaveBeenCalledWith({
      videoId: "ocbtH4-FttI",
      startSeconds: 0,
      endSeconds: 353,
    });
    controller.destroy();
  });

  it("saves at most once per ten seconds while playing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const fake = createFakeYouTube({ currentTime: 197 });
    const options = playerOptions({ fake });
    const controller = await createYouTubeSegmentPlayer(options);
    fake.ready();
    fake.state(fake.youtube.PlayerState.PLAYING);

    await vi.advanceTimersByTimeAsync(31_000);

    expect(options.onSave).toHaveBeenCalledTimes(3);
    expect(options.onSave).toHaveBeenLastCalledWith(197);
    controller.destroy();
  });

  it("stops and saves watched at the end boundary after seekTo", async () => {
    const fake = createFakeYouTube({ currentTime: 100 });
    const options = playerOptions({ fake });
    const controller = await createYouTubeSegmentPlayer(options);
    fake.ready();

    controller.seekTo(353);

    expect(fake.player.pauseVideo).toHaveBeenCalled();
    expect(options.onSave).toHaveBeenCalledWith(353);
    controller.destroy();
  });

  it("recues the end boundary after the full YouTube video ends", async () => {
    const fake = createFakeYouTube({ currentTime: 6_525 });
    const options = playerOptions({ fake });
    const controller = await createYouTubeSegmentPlayer(options);
    fake.ready();

    fake.state(fake.youtube.PlayerState.ENDED);

    expect(fake.player.cueVideoById).toHaveBeenLastCalledWith({
      videoId: "ocbtH4-FttI",
      startSeconds: 353,
      endSeconds: 353,
    });
    expect(fake.player.pauseVideo).toHaveBeenCalled();
    expect(options.onSave).toHaveBeenCalledWith(353);
    controller.destroy();
  });

  it.each([101, 150, 153])("shows fallback when IFrame API emits error %i", async (code) => {
    const fake = createFakeYouTube();
    const options = playerOptions({ fake });
    const controller = await createYouTubeSegmentPlayer(options);
    fake.ready();

    fake.error(code);

    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onSave).not.toHaveBeenCalled();
    controller.destroy();
  });
});
