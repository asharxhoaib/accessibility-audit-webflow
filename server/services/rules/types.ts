import { Impact } from "../../../shared/types";
import { PageModel } from "../dom/model";
import { StyleResolver } from "../dom/style-resolver";

export interface RuleInput {
  page: PageModel;
  resolver: StyleResolver;
  includeAAA: boolean;
}

export interface RawFinding {
  ruleId: string;
  message: string;
  selector: string;
  snippet: string;
  nodeId?: string;
  htmlId?: string;
  impact?: Impact;
  details?: Record<string, unknown>;
}

export interface Rule {
  /** Category file name, for diagnostics. */
  category: string;
  run(input: RuleInput): RawFinding[];
}
