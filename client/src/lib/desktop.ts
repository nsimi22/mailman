export interface DesktopSettings {
  mode: 'local' | 'remote';
  serverUrl: string;
  password: string;
}

export interface DesktopBridge {
  version: string;
  platform: string;
  getSettings(): Promise<DesktopSettings>;
  setSettings(settings: DesktopSettings): Promise<{ ok: boolean; error?: string }>;
  testConnection(settings: DesktopSettings): Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window { mailman?: DesktopBridge }
}

/** Present only when running inside the Electron shell. */
export const desktop: DesktopBridge | undefined = typeof window !== 'undefined' ? window.mailman : undefined;
