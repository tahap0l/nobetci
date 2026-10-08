// Preferences, mirroring src-tauri/src/settings.rs (camelCase). Rust sanitises
// whatever it is sent and hands back what it kept.

export type RuleMode = "contains" | "prefix" | "exact" | "glob" | "regex";
export type RuleAction = "allow" | "deny" | "ask" | "low" | "medium" | "high" | "critical";

export interface UserRule {
  id: string;
  enabled: boolean;
  name: string;
  /** "*", a tool name, a comma list, or a prefix ending in "*" (mcp__github__*). */
  tool: string;
  pattern: string;
  mode: RuleMode;
  /** Empty for every project, otherwise a folder the session must be inside. */
  project: string;
  action: RuleAction;
  /** What Claude is told when this rule denies. */
  message: string;
}

export interface ProjectPolicy {
  path: string;
  mode: "trusted" | "normal" | "strict";
  note: string;
}

export interface Hotkeys {
  toggle: string;
  deny: string;
  /** LOW risk only (keystrokes can be synthesised), off by default. */
  allow: string;
  dnd: string;
}

export interface Settings {
  // General
  /** "auto" follows the Windows display language (Turkish → tr, anything else → en). */
  language: "auto" | "tr" | "en";
  /** The first-run welcome has been completed or skipped. */
  onboarded: boolean;
  autostart: boolean;
  screen: "primary" | "cursor";
  position: "center" | "left" | "right";
  autoCloseInterval: number;
  staleMinutes: number;
  expandOnFinish: boolean;
  // Claude Code
  hooksInstalled: boolean;
  hookEvents: string[];
  // Safety
  holdMs: number;
  holdCriticalMs: number;
  /**
   * Approvals must come from a physical mouse click: clicks synthesised by another
   * program (SendInput, UI Automation) are refused. Off only for accessibility tools.
   */
  inputGuard: boolean;
  autoAllowMax: "none" | "low" | "medium";
  disabledCategories: string[];
  rules: UserRule[];
  projects: ProjectPolicy[];
  denyReasons: string[];
  // Notifications
  soundEnabled: boolean;
  soundVolume: number;
  mutedSounds: string[];
  toastEnabled: boolean;
  /** approval | finished | error | waiting */
  toastEvents: string[];
  toastOnlyWhenHidden: boolean;
  dnd: boolean;
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  quietFullscreen: boolean;
  hotkeys: Hotkeys;
  // History
  auditEnabled: boolean;
  auditMaxMb: number;
}

export const ALL_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
] as const;

export const DEFAULT_SETTINGS: Settings = {
  language: "auto",
  onboarded: false,
  autostart: false,
  screen: "primary",
  position: "center",
  autoCloseInterval: 15,
  staleMinutes: 45,
  expandOnFinish: false,
  hooksInstalled: false,
  hookEvents: [...ALL_EVENTS],
  holdMs: 1200,
  holdCriticalMs: 2400,
  inputGuard: true,
  autoAllowMax: "low",
  disabledCategories: [],
  rules: [],
  projects: [],
  denyReasons: [
    "Bunu yapma.",
    "Önce ne yapacağını açıkla, sonra tekrar sor.",
    "Başka, daha güvenli bir yol dene.",
    "Bu dosyaya/klasöre dokunma.",
  ],
  soundEnabled: true,
  soundVolume: 0.35,
  mutedSounds: [],
  toastEnabled: true,
  toastEvents: ["approval", "error", "waiting"],
  toastOnlyWhenHidden: true,
  dnd: false,
  quietEnabled: false,
  quietFrom: "23:00",
  quietTo: "08:00",
  quietFullscreen: true,
  hotkeys: { toggle: "Ctrl+Alt+N", deny: "Ctrl+Alt+D", allow: "", dnd: "" },
  auditEnabled: true,
  auditMaxMb: 10,
};

export function newRule(): UserRule {
  return {
    id: `r${Date.now().toString(16)}`,
    enabled: true,
    name: "",
    tool: "*",
    pattern: "",
    mode: "contains",
    project: "",
    action: "ask",
    message: "",
  };
}
