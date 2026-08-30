/**
 * The People register — no auth, just names for `assignee` and
 * `@mentions`. At most one entry carries `isSelf`, which is what `self`
 * filters (Assigned to Me / Mentions Me) resolve against.
 */

import { useState } from "react";
import { slugify } from "../../core/ids";
import type { Person, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

export function PeopleSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const people = snapshot.workspace.people;

	const commit = (next: Person[]) => {
		void plugin.mutations.saveWorkspaceConfig({ ...snapshot.workspace, people: next });
	};

	const parseAliases = (raw: string): string[] =>
		raw
			.split(",")
			.map((alias) => alias.trim())
			.filter(Boolean);

	return (
		<section className="vf-settings-section">
			<h3>People</h3>
			<p className="vf-settings-description">
				Used for <code>assignee</code> and <code>@mentions</code> — no
				accounts, just names. Mark yourself so "Assigned to Me" and
				"Mentions Me" know who "me" is.
			</p>

			<div className="vf-people-table">
				{people.map((person, index) => (
					<div key={person.id} className="vf-people-row">
						<input
							type="radio"
							className="vf-person-self"
							name="vf-self"
							checked={person.isSelf ?? false}
							title="This is me"
							onChange={() =>
								commit(
									people.map((p, i) => ({ ...p, isSelf: i === index })),
								)
							}
						/>
						<input
							type="text"
							className="vf-input vf-person-name"
							value={person.name}
							onChange={(event) => {
								const name = event.target.value;
								commit(people.map((p, i) => (i === index ? { ...p, name } : p)));
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
							onClick={() => commit(people.filter((_, i) => i !== index))}
						>
							✕
						</button>
					</div>
				))}
			</div>

			<AddPersonRow
				onAdd={(name, aliases) => {
					const id = slugify(name, people.map((p) => p.id));
					commit([...people, { id, name, aliases, isSelf: people.length === 0 }]);
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
