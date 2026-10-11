// What a view shows instead of its content (ViewState, also View's `state`): loading,
// empty (nothing yet, and how to start), no results (after a filter), and an error
// (what went wrong, and a way on). Each fills its view's body.
import { Button } from "./button.tsx";
import { ViewState, type ViewStateSpec } from "./frame.tsx";

const STATES: ViewStateSpec[] = [
  { kind: "loading", title: "Reading the database…" },
  { kind: "empty", icon: "tray", title: "No runs yet", text: "Runs show up here once a workflow starts.", action: <Button>Run Workflow</Button> },
  { kind: "noResults", title: "No runs match “deploy”", action: <Button variant="ghost">Clear Filter</Button> },
  { kind: "error", title: "The runs didn't load", text: "gh: authentication required (run gh auth login in a terminal)", action: <Button>Try Again</Button> },
];

/** Every state side by side, each in a body of a window's size. */
export const States = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, width: 760 }}>
    {STATES.map((s) => (
      <div key={s.kind} style={{ width: 360, height: 220, display: "flex", borderRadius: "var(--radius-md)", background: "var(--bg)" }}>
        <ViewState state={s} />
      </div>
    ))}
  </div>
);
