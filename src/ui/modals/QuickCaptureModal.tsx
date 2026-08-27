/**
 * Quick capture (§9.4).
 *
 * A plain Obsidian `Modal` rather than a React tree: it has to open from
 * anywhere in Obsidian — including when the plugin's own view isn't mounted —
 * so it can't depend on the React root existing.
 */

import { App, Modal, Notice, Setting } from "obsidian";
import { listValues } from "../../core/taxonomy";
import { workspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import type VertexFlowPlugin from "../../main";

export class QuickCaptureModal extends Modal {
	private title = "";
	private status: string;
	private priority: string | null = null;
	private assignee: string | null = null;
	private project: string | null = null;

	constructor(
		app: App,
		private readonly plugin: VertexFlowPlugin,
		private readonly snapshot: WorkspaceSnapshot,
	) {
		super(app);
		this.status = snapshot.workspace.defaultNewTaskStatus;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("vf-modal");
		contentEl.createEl("h3", { text: "New task" });

		const taxonomies = workspaceTaxonomies(this.snapshot.workspace);

		new Setting(contentEl).setName("Title").addText((text) => {
			text.setPlaceholder("What needs doing?").onChange((value) => {
				this.title = value;
			});
			// Enter submits, so capture stays a two-keystroke operation.
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void this.submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(contentEl).setName("Status").addDropdown((dropdown) => {
			for (const status of listValues(taxonomies.status)) {
				dropdown.addOption(status.id, status.name);
			}
			dropdown.setValue(this.status).onChange((value) => {
				this.status = value;
			});
		});

		new Setting(contentEl).setName("Priority").addDropdown((dropdown) => {
			dropdown.addOption("", "None");
			for (const priority of listValues(taxonomies.priority)) {
				dropdown.addOption(priority.id, priority.name);
			}
			dropdown.onChange((value) => {
				this.priority = value || null;
			});
		});

		if (this.snapshot.projects.length > 0) {
			new Setting(contentEl).setName("Project").addDropdown((dropdown) => {
				dropdown.addOption("", "No project");
				for (const project of this.snapshot.projects) {
					dropdown.addOption(project.path, project.title);
				}
				dropdown.onChange((value) => {
					this.project = value || null;
				});
			});
		}

		if (this.snapshot.workspace.people.length > 0) {
			new Setting(contentEl).setName("Assignee").addDropdown((dropdown) => {
				dropdown.addOption("", "Unassigned");
				for (const person of this.snapshot.workspace.people) {
					dropdown.addOption(person.id, person.name);
				}
				dropdown.onChange((value) => {
					this.assignee = value || null;
				});
			});
		}

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText("Create task")
				.setCta()
				.onClick(() => void this.submit()),
		);
	}

	private async submit(): Promise<void> {
		if (!this.title.trim()) {
			new Notice("A task needs a title");
			return;
		}

		try {
			const file = await this.plugin.mutations.createTask(this.snapshot, {
				title: this.title,
				status: this.status,
				priority: this.priority,
				assignee: this.assignee,
				project: this.project,
			});
			new Notice(`Created ${file.basename}`);
			this.close();
		} catch (cause) {
			new Notice(
				`Could not create task: ${cause instanceof Error ? cause.message : String(cause)}`,
			);
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
