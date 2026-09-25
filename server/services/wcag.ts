import { FixKind, Impact, RuleCategory, RuleMetaDto, WcagLevel } from "../../shared/types";

interface Criterion {
  name: string;
  level: WcagLevel;
  slug: string;
}

/** WCAG 2.2 success criteria referenced by the rule engine. */
export const CRITERIA: Record<string, Criterion> = {
  "1.1.1": { name: "Non-text Content", level: "A", slug: "non-text-content" },
  "1.3.1": { name: "Info and Relationships", level: "A", slug: "info-and-relationships" },
  "1.4.3": { name: "Contrast (Minimum)", level: "AA", slug: "contrast-minimum" },
  "1.4.6": { name: "Contrast (Enhanced)", level: "AAA", slug: "contrast-enhanced" },
  "2.4.1": { name: "Bypass Blocks", level: "A", slug: "bypass-blocks" },
  "2.4.4": { name: "Link Purpose (In Context)", level: "A", slug: "link-purpose-in-context" },
  "2.4.6": { name: "Headings and Labels", level: "AA", slug: "headings-and-labels" },
  "2.4.7": { name: "Focus Visible", level: "AA", slug: "focus-visible" },
  "2.5.8": { name: "Target Size (Minimum)", level: "AA", slug: "target-size-minimum" },
  "3.1.1": { name: "Language of Page", level: "A", slug: "language-of-page" },
  "3.3.2": { name: "Labels or Instructions", level: "A", slug: "labels-or-instructions" },
  "4.1.2": { name: "Name, Role, Value", level: "A", slug: "name-role-value" },
};

function meta(
  id: string,
  category: RuleCategory,
  criterion: string,
  impact: Impact,
  title: string,
  remediation: string,
  fixKind: FixKind | null = null
): RuleMetaDto {
  const c = CRITERIA[criterion];
  return {
    id,
    category,
    criterion,
    criterionName: c.name,
    level: c.level,
    impact,
    title,
    remediation,
    helpUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${c.slug}.html`,
    fixKind,
  };
}

const LIST: RuleMetaDto[] = [
  meta("missing-alt", "alt-text", "1.1.1", "critical", "Image is missing alternative text",
    "Select the image in the Designer, open Element Settings and fill in Alt text describing its purpose. Use an empty alt only for purely decorative images.", "alt-text"),
  meta("alt-quality", "alt-text", "1.1.1", "moderate", "Alternative text looks like a file name or placeholder",
    "Replace the alt text with a short description of what the image conveys, not its file name or a generic word such as \"image\".", "alt-text"),
  meta("empty-link", "empty-controls", "2.4.4", "critical", "Link has no accessible name",
    "Give the link visible text, or add an aria-label custom attribute that describes where it goes. Icon-only links need an aria-label.", "aria-label"),
  meta("empty-button", "empty-controls", "4.1.2", "critical", "Button has no accessible name",
    "Give the button visible text, or add an aria-label custom attribute that describes its action.", "aria-label"),
  meta("heading-skip", "heading-order", "1.3.1", "moderate", "Heading level is skipped",
    "Change the heading tag so levels only ever go down one step at a time (h2 followed by h3, not h4). Style headings with classes rather than by picking a tag for its size."),
  meta("heading-no-h1", "heading-order", "1.3.1", "moderate", "Page has no h1 heading",
    "Add exactly one H1 heading that names the page, ideally the first heading in the main content."),
  meta("heading-multiple-h1", "heading-order", "1.3.1", "minor", "Page has more than one h1 heading",
    "Keep one H1 for the page title and change the others to H2 or lower."),
  meta("heading-empty", "heading-order", "2.4.6", "serious", "Heading is empty",
    "Add text to the heading or remove it. Empty headings are announced by screen readers and break navigation by headings."),
  meta("form-label", "form-labels", "3.3.2", "critical", "Form field has no label",
    "Add a Label element connected to the field (Webflow form labels wrap or reference the input), or add an aria-label custom attribute. A placeholder is not a label.", "aria-label"),
  meta("color-contrast", "color-contrast", "1.4.3", "serious", "Text does not meet the minimum contrast ratio",
    "Darken the text or lighten the background until the ratio reaches 4.5:1 (3:1 for text of 24px or larger, or 18.66px bold or larger). Update the color style, not just the instance."),
  meta("color-contrast-enhanced", "color-contrast", "1.4.6", "minor", "Text does not meet the enhanced contrast ratio",
    "For AAA conformance raise the ratio to 7:1 (4.5:1 for large text)."),
  meta("landmark-main", "landmarks", "2.4.1", "serious", "Page has no main landmark",
    "Wrap the primary content of the page in a Main element (or add role=\"main\") so keyboard and screen reader users can skip repeated navigation."),
  meta("landmark-main-multiple", "landmarks", "1.3.1", "moderate", "Page has more than one main landmark",
    "Keep a single Main element per page and change the others to Section or Div."),
  meta("landmark-banner", "landmarks", "1.3.1", "minor", "Page has no banner (header) landmark",
    "Use a Header element (or role=\"banner\") for the site header that appears at the top of the page."),
  meta("landmark-contentinfo", "landmarks", "1.3.1", "minor", "Page has no contentinfo (footer) landmark",
    "Use a Footer element (or role=\"contentinfo\") for the site footer."),
  meta("landmark-nav-label", "landmarks", "1.3.1", "minor", "Multiple navigation landmarks are not distinguishable",
    "Add an aria-label custom attribute (for example \"Primary\" and \"Footer\") to each Nav element when a page has more than one."),
  meta("html-lang-missing", "document-language", "3.1.1", "serious", "Document has no language attribute",
    "Set the language in Site settings, or add lang=\"en\" (your language code) to the html element so assistive technology uses the right pronunciation."),
  meta("html-lang-invalid", "document-language", "3.1.1", "serious", "Document language code is not valid",
    "Use a valid BCP 47 language tag such as en, en-GB or fr-CA."),
  meta("duplicate-id", "duplicate-ids", "1.3.1", "minor", "Duplicate id attribute",
    "Make every id unique on the page. Duplicate ids break label associations and ARIA references (WCAG 2.2 no longer lists 4.1.1 Parsing, but the failure still surfaces through 1.3.1 and 4.1.2)."),
  meta("tap-target-size", "tap-targets", "2.5.8", "moderate", "Tap target is smaller than 24 by 24 CSS pixels",
    "Increase the element's width, height or padding to at least 24 by 24 CSS pixels, or space undersized targets so a 24px circle around each does not overlap another target."),
  meta("focus-visible-removed", "focus-visible", "2.4.7", "serious", "Keyboard focus indicator is removed",
    "Do not set outline to none without replacing it. Add a visible focus style on the :focus-visible state (an outline, box-shadow or border change with sufficient contrast)."),
];

export const RULE_META: Record<string, RuleMetaDto> = Object.fromEntries(LIST.map((m) => [m.id, m]));

export function ruleMeta(ruleId: string): RuleMetaDto {
  const m = RULE_META[ruleId];
  if (!m) throw new Error(`Unknown rule ${ruleId}`);
  return m;
}

export function allRuleMeta(): RuleMetaDto[] {
  return LIST;
}
