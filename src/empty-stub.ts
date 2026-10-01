export default {};

declare global {
  interface Window {
    ViteWS?: unknown;
  }
}

export const WebSocket =
  typeof window !== 'undefined' ? (window.ViteWS as any) || globalThis.WebSocket : undefined;
