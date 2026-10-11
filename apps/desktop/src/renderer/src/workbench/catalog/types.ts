// What the UI Workbench knows about the components and stories (docs/47): extracted
// from the sources by extract.ts, served by plugin.ts as virtual:workbench-catalog.
// Nothing here is written by hand.

/** How a prop can be set: union (its literal values), boolean, string, number, node (JSX), function, other. */
export type PropKind = "union" | "boolean" | "string" | "number" | "node" | "function" | "other";

export interface PropInfo {
  name: string;
  kind: PropKind;
  /** A union's values, in declaration order. */
  values?: (string | number | boolean)[];
  /** The declared type, as written. */
  type: string;
  required: boolean;
  /** From the component's destructuring (`variant = "default"`), as written. */
  default?: string;
  doc?: string;
}

export interface ComponentInfo {
  /** "ui/Button" for the kit's, "<folder>/<Name>" for the renderer's ("shell/Feedback"). */
  id: string;
  name: string;
  /** Repo-relative. */
  file: string;
  kit: boolean;
  /** Its JSDoc, else its file's header comment. */
  doc?: string;
  props: PropInfo[];
}

export interface VariantInfo {
  name: string;
  /** The doc comment above its export. */
  doc?: string;
}

export interface StoryInfo {
  /** From the path: "ui/button", "shell/feedback", "windows/pdf/pdfview". */
  id: string;
  /** The file's name ("Feedback"). */
  title: string;
  /** The folder ("shell", "windows/pdf", "ui"). */
  group: string;
  /** Repo-relative. */
  file: string;
  /** The file's header comment. */
  doc?: string;
  /** Exported names, in file order (the page keeps those that are components). */
  variants: VariantInfo[];
  /** The ids of the components it shows: those of the file beside it, else the one it is named after. */
  components: string[];
}

export interface Catalog {
  components: ComponentInfo[];
  stories: StoryInfo[];
  /** How long the extraction took. */
  ms: number;
}
