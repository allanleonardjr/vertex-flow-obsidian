/**
 * The People register — no auth, just names for `assignee` and
 * `@mentions`. "Me" is a global app setting that affects all workspaces.
 */

import { useState, useEffect, useRef } from "react";
import { slugify } from "../../core/ids";
import type { Person, WorkspaceSnapshot, MeBinding } from "../../core/types";
import { usePlugin } from "../context";

export function PeopleSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const people = snapshot.workspace.people;
	const mePerson = plugin.settings.mePerson as MeBinding | null;

	// ---------- debounced save ----------
	let pendingName: string | null = null;
	const setPendingName = (value: string | null) => {
		pendingName = value;
	};
	const debounceTimer = useRef<number | null>(null);

	const flushPending = () => {
		if (pendingName) {
			const binding: MeBinding = {
				personId: pendingName,
				name: pendingName,
			};
			plugin.settings.mePerson = binding;
			void plugin.saveSettings();
		}
		pendingName = null;
	};

	useEffect(() => {
		const timer = setTimeout(flushPending, 300);
		return () => clearTimeout(timer);
	}, []);

	const commit = (next: Person[]) => {
		void plugin.mutations.saveWorkspaceConfig({ ...snapshot.workspace, people: next });
	};

	const parseAliases = (raw: string): string[] =>
		raw
			.split(",")
			.map((alias) => alias.trim())
			.filter(Boolean);

	const isMe = (person: Person) => mePerson?.personId === person.id;

	return (
		<section className="vf-settings-section">
			<h3>People</h3>
			<p className="vf-settings-description">
				Used for <code>assignee</code> and <code>@mentions</code> — no
				accounts, just names.
			</p>
			<div className="vf-settings-callout vf-callout-info">
				<strong>"Me" is a global setting</strong> — it applies to all
				workspaces. Changing it here updates it everywhere.
			</div>

			<div className="vf-people-table">
				{people.map((person, index) => (
					<div key={person.id} className="vf-people-row">
						<input
							type="radio"
							className="vf-person-self"
							name="vf-self"
							checked={isMe(person)}
							title="This is me"
							onChange={() => {
								// Set the pending name; debounced save will fire shortly
								setPendingName(person.name);
							}}
						/>
						<input
							type="text"
							className="vf-input vf-person-name"
							value={person.name}
							onChange={(event) => {
								const name = event.target.value;
								commit(people.map((p, i) => (i === index ? { ...p, name } : p)));
								if (isMe(person)) {
									setPendingName(name);
									void plugin.saveSettings();
								}
							}}
						/>
						<input
							type="text"
							className="vf-input vf-person-aliases"
							placeholder="Aliases, comma-separated"
							value={(person.aliases ?? []).join(", ")}
							onChange={(event) => {
								const aliases = parseAliases(event.target.value);
								commit(
									people.map((p, i) => (i === index ? { ...p, aliases } : p)),
								);
							}}
						/>
						<button
							className="vf-icon-button"
							title="Remove"
							onClick={() => {
								if (isMe(person)) {
									setPendingName(null);
									plugin.settings.mePerson = null;
									void plugin.saveSettings();
								}
								commit(people.filter((_, i) => i !== index));
							}}
						>
							✕
						</button>
					</div>
				))}
			</div>

			<AddPersonRow
				onAdd={(name, aliases) => {
					const id = slugify(name, people.map((p) => p.id));
					commit([...people, { id, name, aliases }]);
					// New person becomes "me" by default
					setPendingName(name);
				}}
			/>
		</section>
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