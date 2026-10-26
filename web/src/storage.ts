import type { Connection, Role } from "./api";

// Storage can throw (private mode, blocked site data); LinkDrop then simply forgets on reload.

export function loadConnection(role: Role): Connection | null {
  try {
    const saved = JSON.parse(localStorage.getItem(`linkdrop:${role}`) ?? "null");
    if (saved && typeof saved.sessionId === "string" && typeof saved.endpointKey === "string") {
      return { sessionId: saved.sessionId, endpointKey: saved.endpointKey, role };
    }
  } catch {}
  forgetConnection(role);
  return null;
}

export function saveConnection(connection: Connection) {
  try {
    localStorage.setItem(`linkdrop:${connection.role}`, JSON.stringify(connection));
  } catch {}
}

export function forgetConnection(role: Role) {
  try {
    localStorage.removeItem(`linkdrop:${role}`);
  } catch {}
}

export function saveTheme(theme: string) {
  try {
    localStorage.setItem("linkdrop:theme", theme);
  } catch {}
}
