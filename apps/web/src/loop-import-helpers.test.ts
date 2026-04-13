import {
  buildLoopImportPreview,
  expandLoopImportRows,
  hasPreparedLoopImportTask,
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

  it("captures missing task assignees instead of silently hiding them", () => {
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
    expect(row.missingTaskAssignee).toEqual({
      canCreate: false,
      email: null,
      label: "Unknown Person",
      name: "Unknown Person",
    });
    expect(row.project.title).toBe("Loop migration");
    expect(row.task.assigneeUserId).toBe("user-1");
    expect(row.task.notes).toBe(
      "Confirm API dependency\n\nBlocked: Waiting on API",
    );
    expect(row.task.priority).toBe("high");
    expect(row.task.status).toBe("blocked");
    expect(row.warnings).toEqual([
      'Task assignee "Unknown Person" did not match a known user and does not include an email address.',
    ]);
  });

  it("allows project-only rows when no task fields are populated", () => {
    const row = prepareLoopImportRow({
      defaultUserId: "user-1",
      mapping: {
        projectTitle: "Project Title",
        taskTitle: "Checklist Item",
      },
      rawRow: {
        "Checklist Item": "",
        "Project Title": "Loop migration",
      },
      rowNumber: 1,
      users,
    });

    expect(row.errors).toEqual([]);
    expect(row.project.title).toBe("Loop migration");
    expect(row.task.title).toBeNull();
  });

  it("treats rows without a checklist item as project-only even when shared task mappings are present", () => {
    const row = prepareLoopImportRow({
      defaultUserId: "user-1",
      mapping: {
        projectTitle: "Project Title",
        taskPriority: "Priority",
        taskStatus: "Task Status",
        taskTitle: "Checklist Item",
      },
      rawRow: {
        "Checklist Item": "",
        Priority: "Medium",
        "Project Title": "Loop migration",
        "Task Status": "Done",
      },
      rowNumber: 1,
      users,
    });

    expect(row.errors).toEqual([]);
    expect(row.task.title).toBeNull();
    expect(hasPreparedLoopImportTask(row.task)).toBe(false);
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

  it("matches assignees by embedded email address", () => {
    const row = prepareLoopImportRow({
      defaultUserId: "user-1",
      mapping: {
        projectTitle: "Project Title",
        taskAssignee: "Task Assignee",
        taskTitle: "Task Title",
      },
      rawRow: {
        "Project Title": "Loop migration",
        "Task Assignee": "Tavi Editor <editor@tavi.local>",
        "Task Title": "Confirm mapping",
      },
      rowNumber: 1,
      users,
    });

    expect(row.errors).toEqual([]);
    expect(row.missingTaskAssignee).toBeNull();
    expect(row.task.assigneeUserId).toBe("user-2");
    expect(row.warnings).toEqual([]);
  });

  it("splits newline-delimited checklist entries into separate task rows", () => {
    const rows = expandLoopImportRows({
      mapping: {
        projectTitle: "Project Title",
        taskExternalId: "Task Id",
        taskTitle: "Checklist Item",
      },
      rawRows: [
        {
          "Checklist Item": "Confirm mapping\nShip docs",
          "Project Title": "Loop migration",
          "Task Id": "task-1",
        },
      ],
    });

    expect(rows).toEqual([
      {
        "Checklist Item": "Confirm mapping",
        "Project Title": "Loop migration",
        "Task Id": null,
      },
      {
        "Checklist Item": "Ship docs",
        "Project Title": "Loop migration",
        "Task Id": null,
      },
    ]);
  });

  it("uses the first project owner and surfaces additional missing owners", () => {
    const row = prepareLoopImportRow({
      defaultUserId: "user-1",
      mapping: {
        projectOwner: "Primary Assignee",
        projectTitle: "Project Title",
        taskTitle: "Task Title",
      },
      rawRow: {
        "Primary Assignee":
          "Jeyson Remigivse <jeyson@example.com> King Cheung <king@example.com>",
        "Project Title": "Stackrox POC",
        "Task Title": "poc in lab, add dev clusters",
      },
      rowNumber: 1,
      users: [
        ...users,
        {
          email: "jeyson@example.com",
          id: "user-3",
          name: "Jeyson Remigivse",
        },
      ],
    });

    expect(row.project.ownerUserId).toBe("user-3");
    expect(row.missingImportUsers).toEqual([
      {
        blocksCommit: false,
        canCreate: true,
        email: "king@example.com",
        label: "King Cheung <king@example.com>",
        name: "King Cheung",
        sourceLabels: ["Additional project owner"],
      },
    ]);
    expect(row.warnings).toEqual([
      'Project owner lists multiple people. Tavi will use "Jeyson Remigivse <jeyson@example.com>" as the project owner and leave the others for manual task assignment.',
      'Additional project owner "King Cheung <king@example.com>" did not match a known user. Create the account if this person should be assigned to tasks after import.',
    ]);
  });

  it("splits KPE-style checklist blocks into separate tasks", () => {
    const rows = expandLoopImportRows({
      mapping: {
        projectTitle: "Project track",
        taskTitle: "Checklist",
      },
      rawRows: [
        {
          Checklist:
            "Create Initiative\nCommunicate Initiative\nUpdate GC packages\nCreate & test new Policies\nUpdate KPE Apps in GC\nCreate & Send Release Notes inc Policy\nRollout Policy\nRollout to Pilot (in7)\nAssist with dev-prod rollout",
          "Project track": "GC263",
        },
      ],
    });

    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({
      Checklist: "Create Initiative",
      "Project track": "GC263",
    });
    expect(rows[8]).toEqual({
      Checklist: "Assist with dev-prod rollout",
      "Project track": "GC263",
    });
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
    expect(preview.rows[0]?.errors).toEqual(["Map a column to Project title"]);
  });

  it("aggregates missing task assignees in previews", () => {
    const preview = buildLoopImportPreview({
      defaultUserId: "user-1",
      mapping: {
        projectTitle: "Project Title",
        taskAssignee: "Task Assignee",
        taskTitle: "Task Title",
      },
      rawRows: [
        {
          "Project Title": "Loop migration",
          "Task Assignee": "Jane Doe <jane@example.com>",
          "Task Title": "Confirm mapping",
        },
        {
          "Project Title": "Loop migration",
          "Task Assignee": "Jane Doe <jane@example.com>",
          "Task Title": "Ship docs",
        },
      ],
      sampleSize: 25,
      users,
    });

    expect(preview.missingTaskAssigneeRowCount).toBe(2);
    expect(preview.missingTaskAssignees).toEqual([
      {
        canCreate: true,
        email: "jane@example.com",
        label: "Jane Doe <jane@example.com>",
        name: "Jane Doe",
        rowCount: 2,
        rowNumbers: [1, 2],
      },
    ]);
  });
});
