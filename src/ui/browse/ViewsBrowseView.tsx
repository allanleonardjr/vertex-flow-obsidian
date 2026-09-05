/**
 * Views hub — every user Saved View in the workspace as a card, with an
 * Edit / Duplicate / Delete row menu mirroring `ViewsSection` in the sidebar
 * exactly. The two System Views (All Tasks, Untriaged) are filtered out — they
 * have a permanent home as bare sidebar rows and none of these actions apply.
 */

import { useState } from "react";
import { newConfigId } from "../../core/ids";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
import { isSystemViewId, layoutIcon, newView } from "../../core/views";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { usePlugin } from "../context";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useTabs } from "../tabs-context";
import { ViewCardContent } from "./ViewCardContent";
import {
  BrowseCard,
  BrowseCardMenu,
  BrowseEmpty,
  BrowseHeader,
  BrowseList,
} from "./shared";

type DialogState = { mode: "edit"; view: SavedView } | null;

export function ViewsBrowseView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const { openView } = useTabs();

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);

  const views = snapshot.views.filter((v) => !isSystemViewId(v.id));

  const duplicate = (view: SavedView) => {
    const copy: SavedView = {
      ...view,
      id: newConfigId("view"),
      name: `${view.name} copy`,
    };
    void plugin.mutations.addView(snapshot, copy).then(() => openView(copy.id));
  };

  return (
    <div className="vf-browse">
      <BrowseHeader
        title="Views"
        noun="view"
        count={views.length}
        idPrefix={snapshot.workspace.idPrefix}
        actionLabel="New view"
        onAction={() => setCreating(true)}
      />

      {views.length === 0 ? (
        <BrowseEmpty label="views" actionLabel="New view" />
      ) : (
        <BrowseList>
          {views.map((view) => (
            <BrowseCard
              key={view.id}
              onClick={() => openView(view.id)}
              trailing={
                <BrowseCardMenu
                  open={menuOpenId === view.id}
                  onToggle={() =>
                    setMenuOpenId((current) =>
                      current === view.id ? null : view.id,
                    )
                  }
                  onClose={() => setMenuOpenId(null)}
                >
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuOpenId(null);
                      setDialog({ mode: "edit", view });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuOpenId(null);
                      duplicate(view);
                    }}
                  >
                    Duplicate
                  </button>
                  <div className="vf-menu-divider" aria-hidden />
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuOpenId(null);
                      setDeleting(view);
                    }}
                  >
                    Move to Trash
                  </button>
                </BrowseCardMenu>
              }
            >
              <ViewCardContent view={view} />
            </BrowseCard>
          ))}
        </BrowseList>
      )}

      {deleting && (
        <ConfirmDeleteDialog
          destructive={false}
          title={`Move view "${deleting.name}" to Trash?`}
          body="The view definition is removed. Tasks are not affected. You can restore it anytime from the Trash view."
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void plugin.mutations.deleteView(snapshot, deleting.id);
            setDeleting(null);
          }}
        />
      )}

      {creating && (
        <NamedIconDialog
          title="New view"
          initialName="New view"
          initialIcon={layoutIcon("list")}
          initialDescription=""
          descriptionSourcePath={`${snapshot.workspace.root}/Untitled`}
          iconFallback={layoutIcon("list")}
          confirmLabel="Create"
          onConfirm={(name, icon, description) => {
            const view = {
              ...newView(newConfigId("view"), "New view", "list"),
              name,
              icon,
              description: description?.trim() || undefined,
            };
            void plugin.mutations.addView(snapshot, view).then(() =>
              openView(view.id),
            );
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {dialog && (
        <NamedIconDialog
          title="Edit view"
          initialName={dialog.view.name}
          initialIcon={dialog.view.icon}
          iconFallback={layoutIcon(dialog.view.viewType)}
          confirmLabel="Save"
          onConfirm={(name, icon) =>
            void plugin.mutations.updateView(snapshot, {
              ...dialog.view,
              name,
              icon,
            })
          }
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
