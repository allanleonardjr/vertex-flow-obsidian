import { describe, expect, it } from "vitest";
import { describeAiLoadError } from "../../src/core/ai/load-error";

const GPU_MESSAGE =
	"Your GPU couldn't load this model. It may need more GPU memory or a larger buffer than this device allows.";
const NETWORK_MESSAGE = "The download was interrupted. Retrying picks up where it left off.";

describe("describeAiLoadError", () => {
	it("explains the real post-device-loss message as a GPU failure", () => {
		expect(describeAiLoadError("Object has already been disposed")).toBe(GPU_MESSAGE);
	});

	it.each([
		"GPU device was lost: Device was destroyed",
		"Device lost during init",
		"Buffer size (1174405120) exceeds the max buffer size limit (1073741824).",
		"GPUValidationError: Invalid Buffer",
	])("treats %j as a GPU failure", (message) => {
		expect(describeAiLoadError(message)).toBe(GPU_MESSAGE);
	});

	it.each([
		"TypeError: Failed to fetch",
		"NetworkError when attempting to fetch resource.",
		"network connection was lost",
	])("treats %j as an interrupted download", (message) => {
		expect(describeAiLoadError(message)).toBe(NETWORK_MESSAGE);
	});

	it("passes any other message through with a prefix", () => {
		expect(describeAiLoadError("  Unknown model id  ")).toBe(
			"The model failed to load: Unknown model id",
		);
	});

	it("trims an overlong raw message", () => {
		const result = describeAiLoadError("x".repeat(1000));
		expect(result.startsWith("The model failed to load: ")).toBe(true);
		expect(result.endsWith("…")).toBe(true);
		expect(result.length).toBeLessThan(260);
	});
});
