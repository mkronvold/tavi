import { describe, expect, it } from "vitest";
import type { WorkspaceProject } from "./types";
import {
  buildLoopExportRows,
  buildWorkspaceExportRows,
  createCsvContent,
} from "./export-utils";

const sampleProjects: WorkspaceProject[] = [
  {
    id: "project-1",
    title: "Roadmap refresh",
    summary: "Summarize the quarter",
    notes: "Discuss sequencing",
    trackerLink: null,
    ownerUserId: "user-1",
    ownerName: "Taylor",
    dueDate: "2026-04-30T00:00:00.000Z",
    priority: "high",
    derivedStatus: "in_progress",
    displayStatus: "blocked",
    manualStatus: "blocked",
    taskTotalCount: 1,
    taskTodoCount: 0,
    taskInProgressCount: 1,
    taskBlockedCount: 0,
    taskDoneCount: 0,
    taskCanceledCount: 0,
    taskOverdueCount: 0,
    tasks: [
      {
        id: "task-1",
        projectId: "project-1",
        title: "Validate milestones",
        notes: "Blocked: waiting on approvals",
        assigneeUserId: "user-2",
        assigneeName: "Jordan",
        dueDate: "2026-04-28T00:00:00.000Z",
        priority: "medium",
        status: "blocked",
        sortOrder: 0,
        completedAt: null,
      },
    ],
  },
];

describe("export-utils", () => {
  it("builds workspace export rows with project and task notes", () => {
    expect(
      buildWorkspaceExportRows({ groupBy: "owner", projects: sampleProjects }),
    ).toEqual([
      expect.objectContaining({
        Group: "Taylor",
        "Project Notes": "Discuss sequencing",
        "Task Notes": "Blocked: waiting on approvals",
        "Task Status": "blocked",
      }),
    ]);
  });

  it("builds loop export rows with notes fields", () => {
    expect(buildLoopExportRows(sampleProjects)).toEqual([
      expect.objectContaining({
        "Project Notes": "Discuss sequencing",
        "Task Notes": "Blocked: waiting on approvals",
        "Task Status": "blocked",
      }),
    ]);
  });

  it("creates CSV output with escaped values", () => {
    const content = createCsvContent(
      [
        {
          Notes: 'Needs "quotes"',
          Title: "Roadmap refresh",
        },
      ],
      ["Title", "Notes"],
    );

    expect(content).toContain("Title,Notes");
    expect(content).toContain('"Needs ""quotes"""');
  });
});
