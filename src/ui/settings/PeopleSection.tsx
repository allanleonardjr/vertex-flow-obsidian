/**
 * The People register — no auth, just names for `assignee` and `@mentions`.
 *
 * "Me" is per device and per workspace: it's held in `localStorage` (see
 * `src/obsidian/me-storage.ts`), never written to the vault, so two
 * collaborators sharing a synced vault each keep their own identity.
 */

import { useState } from "react";
import { slugify } from "../../core/ids";
import type { Person, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";
import { setMePersonId } from "../../obsidian/me-storage";
import { useMePersonId } from "../useMe";
import { useDebouncedSave } from "../components/fields";
import { MeIdentityBanner } from "../components/MeIdentityBanner";

export function PeopleSection({
	snapshot,
	id,
}: {
	snapshot: WorkspaceSnapshot;
	/** DOM id on the section, for settings-screen deep links. */
	id?: string;
}) {
	const plugin = usePlugin();
	const people = snapshot.workspace.people;
	const root = snapshot.workspace.root;

	// Reactive read — repaints the radio, the callout and the banner the instant
	// "me" changes, here or in any other pane.
	const mePersonId = useMePersonId(root);

	const pickMe = (id: string) => setMePersonId(root, id);
	const clearMe = () => setMePersonId(root, null);

	const commit = (next: Person[]) => {
		void plugin.mutations.saveWorkspaceConfig({
			...snapshot.workspace,
			people: next,
		});
	};

	const parseAliases = (raw: string): string[] =>
		raw
			.split(",")
			.map((alias) => alias.trim())
			.filter(Boolean);

	const isMe = (person: Person) => mePersonId === person.id;
	const mePerson = mePersonId
		? people.find((person) => person.id === mePersonId) ?? null
		: null;

	return (
		<section className="vf-settings-section" id={id}>
			<h3>People</h3>
			<p className="vf-settings-description">
				Used for <code>assignee</code> and <code>@mentions</code> — no
				accounts, just names.
			</p>

			<div className="vf-settings-callout vf-callout-info">
				{mePerson ? (
					<>
						You're set as <strong>{mePerson.name}</strong> in this workspace.
						This is stored on this device only — separate for every workspace,
						and never synced to collaborators.{" "}
						<button
							type="button"
							className="vf-link-button"
							onClick={clearMe}
						>
							Unset
						</button>
					</>
				) : (
					<>
						You haven't set who you are in this workspace yet — pick yourself
						below, or add a new person.
					</>
				)}
			</div>

			<MeIdentityBanner workspace={snapshot.workspace} />

			<div className="vf-people-table">
				<div className="vf-people-row vf-people-header" aria-hidden>
					<span className="vf-person-self">Me</span>
					<span className="vf-person-name">Name</span>
					<span className="vf-person-aliases">Aliases</span>
				</div>

				{people.map((person, index) => (
					<PersonRow
						key={person.id}
						person={person}
						checked={isMe(person)}
						onPickMe={() => pickMe(person.id)}
						onRename={(name) =>
							commit(
								people.map((p, i) => (i === index ? { ...p, name } : p)),
							)
						}
						onAliases={(raw) =>
							commit(
								people.map((p, i) =>
									i === index ? { ...p, aliases: parseAliases(raw) } : p,
								),
							)
						}
						onRemove={() => {
							if (isMe(person)) clearMe();
							commit(people.filter((_, i) => i !== index));
						}}
					/>
				))}
			</div>

			<AddPersonRow
				onAdd={(name, aliases) => {
					const id = slugify(name, people.map((p) => p.id));
					commit([...people, { id, name, aliases }]);
					// A freshly added person is a reasonable "me" default when none
					// is set yet — but never steal it from an existing pick.
					if (!mePersonId) pickMe(id);
				}}
			/>
		</section>
	);
}

function PersonRow({
	person,
	checked,
	onPickMe,
	onRename,
	onAliases,
	onRemove,
}: {
	person: Person;
	checked: boolean;
	onPickMe: () => void;
	onRename: (name: string) => void;
	onAliases: (raw: string) => void;
	onRemove: () => void;
}) {
	// Debounced so a file write (and index rebuild) doesn't fire per keystroke.
	const [name, setName] = useDebouncedSave(person.name, onRename);
	const [aliases, setAliases] = useDebouncedSave(
		(person.aliases ?? []).join(", "),
		onAliases,
	);

	return (
		<div className="vf-people-row">
			<input
				type="radio"
				className="vf-person-self"
				name="vf-self"
				checked={checked}
				title="This is me"
				aria-label={`Set ${person.name || "this person"} as me`}
				onChange={onPickMe}
			/>
			<input
				type="text"
				className="vf-input vf-person-name"
				value={name}
				onChange={(event) => setName(event.target.value)}
			/>
			<input
				type="text"
				className="vf-input vf-person-aliases"
				placeholder="Aliases, comma-separated"
				value={aliases}
				onChange={(event) => setAliases(event.target.value)}
			/>
			<button className="vf-icon-button" title="Remove" onClick={onRemove}>
				✕
			</button>
		</div>
	);
}

function AddPersonRow({
	onAdd,
}: {
	onAdd: (name: string, aliases: string[]) => void;
}) {
	const [name, setName] = useState("");
	const [aliases, setAliases] = useState("");
	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		onAdd(
			trimmed,
			aliases
				.split(",")
				.map((alias) => alias.trim())
				.filter(Boolean),
		);
		setName("");
		setAliases("");
	};

	return (
		<div className="vf-people-row vf-people-add">
			<span className="vf-person-self" aria-hidden="true" />
			<input
				type="text"
				className="vf-input vf-person-name"
				placeholder="Add a person…"
				value={name}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") submit();
				}}
			/>
			<input
				type="text"
				className="vf-input vf-person-aliases"
				placeholder="Aliases, comma-separated"
				value={aliases}
				onChange={(event) => setAliases(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") submit();
				}}
			/>
			<button className="mod-cta" disabled={!name.trim()} onClick={submit}>
				Add
			</button>
		</div>
	);
}
