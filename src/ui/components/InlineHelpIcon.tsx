/**
 * A small circular help glyph to drop inline next to anything in the app a
 * user might have a question about. Clicking it opens the Help screen on the
 * linked topic — and, when an anchor is set, scrolls straight to that section.
 *
 * The target is a semantic key into `HELP_TOPIC` (see `core/help-links.ts`)
 * rather than a raw topic id string, so a help-doc rename fails the unit test
 * instead of silently producing a dead link at runtime.
 */

import { CircleHelp } from "lucide-react";
import { HELP_TOPIC, type HelpLinkTarget } from "../../core/help-links";
import { findHelpTopic, HELP_TOPICS } from "../../core/help";
import { useTabs } from "../tabs-context";

export function InlineHelpIcon({
	target,
	label,
	className,
	size = 14,
}: {
	/** A semantic key from `HELP_TOPIC`. */
	target: keyof typeof HELP_TOPIC;
	/** Accessible name; also the native tooltip hovering the icon. */
	label: string;
	className?: string;
	size?: number;
}) {
	const { openHelp } = useTabs();
	const spec: HelpLinkTarget = HELP_TOPIC[target];
	const topic = findHelpTopic(HELP_TOPICS, spec.topicId);
	const title = topic ? topic.title : spec.topicId;

	return (
		<button
			type="button"
			className={`vf-inline-help${className ? ` ${className}` : ""}`}
			aria-label={`${label} — help`}
			title={`${label} — see ${title}`}
			onClick={() => openHelp(spec.topicId, spec.anchor)}
		>
			<CircleHelp size={size} aria-hidden />
		</button>
	);
}
