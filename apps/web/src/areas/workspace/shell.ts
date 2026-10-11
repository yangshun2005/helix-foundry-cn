import type { AreaShell } from "../../shell/types";

// Workspace owns the Home and Settings sections; neither adds sidebar
// children or palette groups.
export const workspaceShell: AreaShell = {};
