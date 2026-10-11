// Content pieces as sheets and settings use them: a setup's Checklist, what something
// offers (SheetHeader and FeatureList), facts in KeyValue, and running text in Prose.
import { Badge } from "./status.tsx";
import { Button } from "./button.tsx";
import { Card, Checklist, FeatureList, KeyValue, Prose, SheetHeader } from "./layout.tsx";

/** A setup's steps, titled as things to do: done ones are a line with their value, the first that isn't shows what to do and a way to check again, the rest wait. */
export const Setup = () => (
  <div style={{ width: 480 }}>
    <Checklist
      steps={[
        { title: "Install Tailscale", state: "done" },
        { title: "Connect to your tailnet", state: "done", detail: "lukas@github" },
        {
          title: "Turn on HTTPS certificates",
          state: "todo",
          detail: "In Tailscale's admin console, under DNS.",
          action: (
            <>
              <Button>Open Admin Console</Button>
              <Button variant="ghost">Check Again</Button>
            </>
          ),
        },
        { title: "Publish on your tailnet", state: "todo" },
      ]}
    />
  </div>
);

/** A step that failed: what went wrong, and its fix. */
export const Failed = () => (
  <div style={{ width: 480 }}>
    <Checklist
      steps={[
        { title: "Install Tailscale", state: "done" },
        { title: "Connect to your tailnet", state: "failed", detail: "tailscale status: not logged in", action: <Button>Log In</Button> },
        { title: "Publish on your tailnet", state: "todo" },
      ]}
    />
  </div>
);

/** A sheet's greeting, then what it offers, one feature a line. */
export const Offer = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 460 }}>
    <Card>
      <SheetHeader icon="sparkles" title="Connect an AI provider" subtitle="Magic widgets and notification summaries use it." />
    </Card>
    <Card>
      <FeatureList
        items={[
          { icon: "rectangle.3.group", title: "A workspace per project", description: "Terminals, agents, a browser and an editor as windows." },
          { icon: "terminal", title: "Agents in your terminals", description: "The one that needs you is on top." },
        ]}
      />
    </Card>
  </div>
);

/** Facts as label and value; mono for data (a widget's permissions). */
export const Facts = () => (
  <div style={{ display: "flex", gap: 24, width: 560 }}>
    <KeyValue
      mono
      items={[
        ["Network", "api.open-meteo.com"],
        ["Files", "none"],
        ["Env", "OPENWEATHER_KEY"],
      ]}
    />
    <KeyValue
      items={[
        ["Build", "4f670fc"],
        ["Uptime", "3h 12m"],
        ["Terminals", "7"],
      ]}
    />
  </div>
);

/** Release notes: running text styled by its elements (h3 with a date, lists, code, links). */
export const Notes = () => (
  <div style={{ width: 460 }}>
    <Card>
      <Prose>
        <h3>
          0.14.0 <small>5 October 2026</small>
        </h3>
        <p>Read PDFs in cmd, and four new built-in widgets.</p>
        <Badge size="sm" tone="success">
          Improved
        </Badge>
        <ul>
          <li>
            <strong>Built-in widgets.</strong> Commands lists what your terminals ran; <code>cmd open</code> opens files.
          </li>
          <li>
            Window outlines no longer spill into the gap. <a href="#">Read more</a>
          </li>
        </ul>
      </Prose>
    </Card>
  </div>
);
