/**
 * The AI engine's in-flight download and per-session load failures, as React
 * state. Both live in `AiEngineService`, not in any component, so the
 * Settings rows and the chat view always show the same download — including
 * after either one unmounts (Settings does, on every tab switch) and comes
 * back mid-download.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { AiInstallStatus } from "../../ai/AiEngineService";
import { usePlugin } from "../context";

export function useAiEngineStatus(): {
	inFlight: AiInstallStatus | null;
	getLoadError: (modelId: string) => string | null;
} {
	const engine = usePlugin().aiEngine;
	const status = useSyncExternalStore(engine.subscribe, engine.getStatus);
	const getLoadError = useCallback(
		(modelId: string) => status.loadErrors.get(modelId) ?? null,
		[status],
	);
	return { inFlight: status.inFlight, getLoadError };
}
