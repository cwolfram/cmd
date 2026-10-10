// What a text window's CodeMirror is made of (basicSetup, spelled out so its parts can be
// configured: fold markers drawn as the app's chevrons, no lint keymap), and what the
// editor reads from a file before showing it: its indentation and its line endings, so
// editing keeps both (a CRLF file is saved with CRLF, a tab-indented one indents with tabs).

import { EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars,
  keymap, lineNumbers, rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";

const marker = (open: boolean) => {
  const el = document.createElement("span");
  el.className = "cm-fold-marker";
  el.textContent = open ? "⌄" : "›";
  el.title = open ? "Fold" : "Unfold";
  return el;
};

/** The editor's behaviour: gutters, history, brackets, completion, selections and the keys for them. */
export const editorSetup: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter({ markerDOM: marker }),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
];

export interface Indent {
  /** What one level of indentation inserts: "\t" or some spaces. */
  unit: string;
  /** How wide a tab is drawn. */
  tabSize: number;
}

/** A file's indentation, from its indented lines: tabs if most start with one, else the commonest step between levels of spaces (2 if nothing is indented). */
export function detectIndent(text: string): Indent {
  let tabs = 0;
  let spaced = 0;
  const steps = new Map<number, number>();
  let prev = 0;
  // A sample is enough: the first few thousand lines.
  const lines = text.split(/\r?\n/, 5000);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line[0] === "\t") {
      tabs++;
      continue;
    }
    const n = line.length - line.trimStart().length;
    if (n > 0 && line[n - 1] === " ") spaced++;
    const step = Math.abs(n - prev);
    // A block comment's " * " continues by one: not a level.
    if (step > 1 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    prev = n;
  }
  if (tabs > spaced) return { unit: "\t", tabSize: 4 };
  let best = 2;
  let count = 0;
  for (const [step, c] of steps) if (c > count || (c === count && step < best)) (best = step), (count = c);
  return { unit: " ".repeat(best), tabSize: 4 };
}

/** "\r\n" when every line break in the text is one (the file is saved that way again), else null: CodeMirror's default (any break, written as "\n"). */
export function lineBreakOf(text: string): "\r\n" | null {
  const crlf = text.split("\r\n").length - 1;
  if (!crlf) return null;
  const lf = text.split("\n").length - 1;
  return crlf === lf ? "\r\n" : null;
}

/** The facets for a file's indentation and line endings. */
export const fileFormat = (text: string): Extension => {
  const indent = detectIndent(text);
  const lineBreak = lineBreakOf(text);
  return [indentUnit.of(indent.unit), EditorState.tabSize.of(indent.tabSize), lineBreak ? EditorState.lineSeparator.of(lineBreak) : []];
};
