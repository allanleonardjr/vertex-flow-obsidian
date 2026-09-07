/**
 * Human-readable descriptions of a recurrence.
 *
 * These strings are the Repeat-row summary, the Series/Overview dialogs' copy
 * and the Stop-repeating confirmation lead — one phrasing, one place.
 */

import type { RecurrenceConfig, StatusValue } from "../types";
import { weekdayName } from "./engine";

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

/** English ordinal: "1st", "2nd", "11th", "23rd", "112th". */
function ordinal(n: number): string {
	const mod100 = n % 100;
	if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
}

function joinList(items: string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The cadence half of the description — "Every week on Monday, Wednesday". */
export function describeFrequency(rule: RecurrenceConfig): string {
	const interval = Math.max(1, rule.interval);
	switch (rule.freq) {
		case "daily":
			return interval === 1 ? "Every day" : `Every ${interval} days`;
		case "weekly":
			if (interval === 1 && rule.weekdays.length > 0) {
				return `Every week on ${joinList(
					rule.weekdays.map((day) => weekdayName(day)),
				)}`;
			}
			return interval === 1 ? "Every week" : `Every ${interval} weeks`;
		case "monthly":
			if (rule.dayOfMonth != null) {
				return interval === 1
					? `Monthly on the ${ordinal(rule.dayOfMonth)}`
					: `Every ${interval} months on the ${ordinal(rule.dayOfMonth)}`;
			}
			if (rule.weekdayOfMonth != null) {
				return interval === 1
					? `Monthly on the ${ordinal(rule.weekdayOfMonth)} occurrence`
					: `Every ${interval} months on the ${ordinal(rule.weekdayOfMonth)} occurrence`;
			}
			return interval === 1 ? "Monthly" : `Every ${interval} months`;
		case "yearly":
			if (rule.monthOfYear != null) {
				const month = MONTHS[Math.min(12, rule.monthOfYear) - 1];
				if (rule.dayOfMonth != null) {
					return interval === 1
						? `Every year on ${month} ${ordinal(rule.dayOfMonth)}`
						: `Every ${interval} years on ${month} ${ordinal(rule.dayOfMonth)}`;
				}
				return interval === 1
					? `Every year in ${month}`
					: `Every ${interval} years in ${month}`;
			}
			return interval === 1 ? "Every year" : `Every ${interval} years`;
	}
}

/** The trigger half — "when completed", "when status is In Review" or "on the
 *  due date / start date". */
export function describeTrigger(
	rule: RecurrenceConfig,
	statuses: readonly StatusValue[],
): string {
	if (rule.trigger === "on-date") {
		return rule.anchor === "startDate"
			? "on the start date"
			: "on the due date";
	}
	if (rule.triggerStatus == null) return "when completed";
	const status = statuses.find((value) => value.id === rule.triggerStatus);
	return `when status is ${status ? status.name : rule.triggerStatus}`;
}

/** The full one-line summary — cadence, trigger, and any end conditions. */
export function describeRecurrence(
	rule: RecurrenceConfig,
	statuses: readonly StatusValue[],
): string {
	const parts = [describeFrequency(rule), describeTrigger(rule, statuses)];
	if (rule.endsAfter != null) parts.push(`${rule.endsAfter} occurrences total`);
	if (rule.endsOn) parts.push(`until ${rule.endsOn}`);
	return parts.join(", ");
}