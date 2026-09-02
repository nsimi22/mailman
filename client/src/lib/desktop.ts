export interface DesktopSettings {
  mode: 'local' | 'remote';
  serverUrl: string;
  password: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

export interface DesktopBridge {
  version: string;
  platform: string;
  getSettings(): Promise<DesktopSettings>;
  setSettings(settings: DesktopSettings): Promise<{ ok: boolean; error?: string }>;
  testConnection(settings: DesktopSettings): Promise<{ ok: boolean; error?: string }>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(cb: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window { mailman?: DesktopBridge }
}

const bridge: DesktopBridge | undefined = typeof window !== 'undefined' ? window.mailman : undefined;

/**
 * Electron's context bridge serialises arguments with the structured clone algorithm, which
 * throws "An object could not be cloned." on a Proxy. Vue's reactive state (a `ref` holding an
 * object) *is* a Proxy, so settings have to be copied into a plain object before they cross.
 */
const snapshot = (s: DesktopSettings): DesktopSettings => ({
  mode: s.mode === 'remote' ? 'remote' : 'local',
  serverUrl: String(s.serverUrl ?? ''),
  password: String(s.password ?? ''),
});

/** Present only when running inside the Electron shell. */
export const desktop: DesktopBridge | undefined = bridge && {
  version: bridge.version,
  platform: bridge.platform,
  getSettings: () => bridge.getSettings(),
  setSettings: (settings) => bridge.setSettings(snapshot(settings)),
  testConnection: (settings) => bridge.testConnection(snapshot(settings)),
  getUpdateState: () => bridge.getUpdateState(),
  checkForUpdates: () => bridge.checkForUpdates(),
  installUpdate: () => bridge.installUpdate(),
  onUpdateState: (cb) => bridge.onUpdateState(cb),
};
