import { useWerkbank } from "@werkbank/framework";
import { useFeedStatus } from "./market/hooks";

/** Status-bar item: the state of the data feed, and a click to pause or resume it. */
export function FeedStatus() {
  const wb = useWerkbank();
  const status = useFeedStatus();
  return (
    <button
      className={`wb-status-button ${status === "live" ? "" : "wb-status-warn"}`}
      title={status === "paused" ? "Resume the simulated feed" : "Pause the simulated feed"}
      onClick={() => void wb.run(status === "paused" ? "feed.resume" : "feed.pause")}
    >
      <span className="st-feed-dot" data-status={status} aria-hidden />
      feed: {status} (simulated)
    </button>
  );
}
