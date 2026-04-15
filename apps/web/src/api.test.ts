import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, updateProject, updateTask } from "./api";

describe("api error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces field validation errors from flattened API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            fieldErrors: {
              ownerUserId: ["Invalid input: expected string, received null"],
            },
            formErrors: [],
          }),
          {
            status: 400,
            statusText: "Bad Request",
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      updateProject("project-1", { ownerUserId: null }),
    ).rejects.toEqual(
      new ApiError(
        400,
        "ownerUserId: Invalid input: expected string, received null",
      ),
    );
  });

  it("combines flattened form and field errors into a readable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            fieldErrors: {
              assigneeUserId: ["Invalid input: expected string, received null"],
            },
            formErrors: ["Task update could not be applied"],
          }),
          {
            status: 400,
            statusText: "Bad Request",
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      updateTask("task-1", { assigneeUserId: null }),
    ).rejects.toEqual(
      new ApiError(
        400,
        "Task update could not be applied, assigneeUserId: Invalid input: expected string, received null",
      ),
    );
  });

  it("shows a friendly message when the API returns a 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Bad Gateway", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    await expect(updateProject("project-1", { title: "Retry me" })).rejects.toEqual(
      new ApiError(
        502,
        "The Tavi API is unavailable and may be restarting. Please wait a moment and try again.",
      ),
    );
  });

  it("shows the same friendly message when fetch fails before a response exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(updateProject("project-1", { title: "Retry me" })).rejects.toEqual(
      new ApiError(
        503,
        "The Tavi API is unavailable and may be restarting. Please wait a moment and try again.",
      ),
    );
  });
});
