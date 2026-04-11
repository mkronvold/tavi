export const densities = ['compact', 'comfortable'] as const;
export type Density = (typeof densities)[number];

export const surfaceClassNames = {
  shell: 'tavi-shell',
  panel: 'tavi-panel',
  table: 'tavi-table',
} as const;
