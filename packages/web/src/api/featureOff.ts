/**
 * AD2: a switched-off feature answers writes with 403 `feature_off`. The API client reports it here, and a
 * component near the root (FeatureOffNotice) shows a friendly toast and refreshes the app settings.
 */
type Handler = () => void;
let handler: Handler | null = null;

export const FEATURE_OFF_TEXT = "Dan has switched that off for now.";

export function setFeatureOffHandler(h: Handler | null): void {
  handler = h;
}

export function reportFeatureOff(): void {
  handler?.();
}
