/**
 * Turns a raw WebLLM/WebGPU load failure into something a user can act on.
 * The errors that actually reach the UI are runtime internals — after a GPU
 * device loss the message is literally `Object has already been disposed` —
 * so the Settings row and the chat view show this instead. Pure over a
 * string: no WebLLM import and no Obsidian API (Golden Rule), so it's unit
 * tested directly.
 */

const GPU_FAILURE = /disposed|device (was )?lost|exceeds the max buffer size|GPUValidationError/i;
const NETWORK_FAILURE = /fetch|network|Failed to fetch|NetworkError/i;

/** Long enough for a real runtime message, short enough to sit under a settings row without wrapping into a wall of text. */
const MAX_RAW_MESSAGE_LENGTH = 200;

export function describeAiLoadError(message: string): string {
	if (GPU_FAILURE.test(message)) {
		return "Your GPU couldn't load this model. It may need more GPU memory or a larger buffer than this device allows.";
	}
	if (NETWORK_FAILURE.test(message)) {
		return "The download was interrupted. Retrying picks up where it left off.";
	}
	const trimmed = message.trim();
	const detail =
		trimmed.length > MAX_RAW_MESSAGE_LENGTH
			? `${trimmed.slice(0, MAX_RAW_MESSAGE_LENGTH - 1).trimEnd()}…`
			: trimmed;
	return `The model failed to load: ${detail}`;
}
