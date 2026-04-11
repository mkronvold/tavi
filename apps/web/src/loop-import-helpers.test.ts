import {
  buildLoopImportPreview,
  prepareLoopImportRow,
  suggestLoopImportMapping,
} from "@tavi/schemas";
import { describe, expect, it } from "vitest";

describe("Loop import helpers", () => {
  const users = [
    {
      email: "admin@tavi.local",
      id: "user-1",
      name: "Tavi Admin",
    },
    {
      email: "editor@tavi.local",
      id: "user-2",
      name: "Tavi Editor",
    },
  ];

  it("suggests conservative mapping matches from common headers", () => {
    const mapping = suggestLoopImportMapping([
      "Project Title",
      "Checklist Item",
      "Task Status",
      "Task Assignee",
    ]);

    expect(mapping).toEqual({
      projectTitle: "Project Title",
      taskAssignee: "Task Assignee",
      taskStatus: "Task Status",
      taskTitle: "Checklist Item",
    });
  });

  it("normalizes a staged row and defaults unknown users to the import creator", () => {
    const row = prepareLoopImportRow({
      defaultUserId: "user-1",
      mapping: {
        projectTitle: "Project Title",
        taskAssignee: "Task Assignee",
        taskBlockedReason: "Blocked Reason",
        taskNotes: "Task Notes",
        taskPriority: "Task Priority",
        taskStatus: "Task Status",
        taskTitle: "Task Title",
      },
      rawRow: {
        "Blocked Reason": "Waiting on API",
        "Project Title": "Loop migration",
        "Task Assignee": "Unknown Person",
        "Task Notes": "Confirm API dependency",
        "Task Priority": "Urgent",
        "Task Status": "Blocked",
        "Task Title": "Confirm mapping",
      },
      rowNumber: 1,
      users,
    });

    expect(row.errors).toEqual([]);
    expect(row.project.title).toBe("Loop migration");
    expect(row.task.assigneeUserId).toBe("user-1");
    expect(row.task.notes).toBe(
      "Confirm API dependency\n\nBlocked: Waiting on API",
    );
    expect(row.task.priority).toBe("high");
    expect(row.task.status).toBe("blocked");
    expect(row.warnings).toEqual([
      'Task assignee "Unknown Person" did not match a known user. Defaulted to the import creator.',
    ]);
  });

  it("allows blocked tasks without a dedicated blocker column", () => {
    const row = prepareLoopImportRow({
      defaultUserId: "user-1",
      mapping: {
        projectTitle: "Project Title",
        taskStatus: "Task Status",
        taskTitle: "Task Title",
      },
      rawRow: {
        "Project Title": "Loop migration",
        "Task Status": "Blocked",
        "Task Title": "Confirm mapping",
      },
      rowNumber: 1,
      users,
    });

    expect(row.errors).toEqual([]);
    expect(row.task.notes).toBeNull();
    expect(row.task.status).toBe("blocked");
  });

  it("reports missing required mappings and invalid row data in previews", () => {
    const preview = buildLoopImportPreview({
      defaultUserId: "user-1",
      mapping: {
        taskTitle: "Task Title",
      },
      rawRows: [
        {
          "Task Title": "",
        },
      ],
      sampleSize: 25,
      users,
    });

    expect(preview.missingRequiredMappings).toEqual(["projectTitle"]);
    expect(preview.invalidRowCount).toBe(1);
    expect(preview.rows[0]?.errors).toEqual([
      "Map a column to Project title",
      "Task title is required",
    ]);
  });
});
