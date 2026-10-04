import { expect, it } from "vitest";
import { jobReasons, stateLabel } from "../src/client/util.js";

it("names job and printer states as a person would say them", () => {
  expect(stateLabel("idle")).toBe("Ready");
  expect(stateLabel("pending-held")).toBe("On hold");
  expect(stateLabel("aborted")).toBe("Failed");
  expect(stateLabel("canceled")).toBe("Cancelled");
  // A stop the printer gives no reason for is just how some printers take a job in.
  expect(stateLabel("processing-stopped", ["job-printing"])).toBe("Printing");
  expect(stateLabel("processing-stopped", ["media-jam-error"])).toBe("Paused");
  expect(stateLabel("some-new-state")).toBe("Some new state");
});

it("keeps only the job reasons that say something went wrong", () => {
  expect(jobReasons(["job-printing", "none"])).toEqual([]);
  expect(jobReasons(["job-queued", "document-format-error"])).toEqual(["The printer can't read this kind of file"]);
  expect(jobReasons(["job-canceled-at-device"])).toEqual(["Cancelled at the printer"]);
  expect(jobReasons(["some-new-reason"])).toEqual(["Some new reason"]);
});
