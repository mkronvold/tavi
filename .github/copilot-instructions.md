Help create docs/DESIGN.md and docs/ARCHITECTURE.md to use in copilot-cli to develop Tavi, a web application.

Tavi is our lightweight system for tracking work and projects clearly, without slowing teams down.

It should run in a docker container through development, but ultimately run in kubernetes for resiliency.

Refine and add requirements and features.
suggest additional docs if necessary.
ask clarifying questions.
The goal is a complete design spec before beginning creation.

The app will track project work and tasks associated with each project will exist within a project task.

- Reference the TrackForge app created in the frontier app builder if possible or request screenshots.
- Currently projects are tracked in Loop like the screenshot attached.

The loop tracker lacks the ability to track each task's status and instead uses checklists.  The intent would be for each checklist item to be a task within the same project track.  The overall status of the project track would then depend on the status of the tasks within it.

Visualization of this is vital.  The ability to sort, filter and regroup with easy to use controls are required.  Requires project rollup/collapse/expand to focus the screen frame on content being discussed.  Minimal sized UI elements to keep the screen clear of large control elements again help maintain focus.
