/**
 * Native folder picker for "where should this workspace live?"
 *
 * Obsidian's own fuzzy suggester rather than a plain `<datalist>` — it's the
 * exact picker experience users already know from "Move file to…", with real
 * fuzzy matching instead of a raw browser dropdown that renders inconsistently
 * inside an Electron app.
 */

import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly onChoose: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a parent folder for this workspace…");
	}

	getItems(): TFolder[] {
		const folders: TFolder[] = [];
		const walk = (folder: TFolder) => {
			folders.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) walk(child);
			}
		};
		walk(this.app.vault.getRoot());
		// Deepest first isn't necessary; alphabetical reads better in the list.
		return folders.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? "/ (vault root)" : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}
