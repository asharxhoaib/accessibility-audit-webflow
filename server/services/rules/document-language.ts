import { documentFinding } from "./util";
import { RawFinding, Rule } from "./types";

const BCP47 = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?(-[a-z0-9]{5,8}|-\d[a-z0-9]{3})*$/i;

/** 3.1.1: <html lang> must be present and valid. */
export const documentLanguageRule: Rule = {
  category: "document-language",
  run({ page }) {
    const out: RawFinding[] = [];
    if (!page.hasDocument) return out;
    const html = page.elements.find((e) => e.tag === "html");
    if (!html) return out;
    const lang = (html.attrs.lang ?? html.attrs["xml:lang"] ?? "").trim();
    if (!lang) out.push(documentFinding(page, "html-lang-missing", "The <html> element has no lang attribute."));
    else if (!BCP47.test(lang)) out.push(documentFinding(page, "html-lang-invalid", `lang="${lang}" is not a valid language tag.`));
    return out;
  },
};
