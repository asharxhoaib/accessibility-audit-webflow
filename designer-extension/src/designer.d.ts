// Minimal typings for the parts of the Webflow Designer API the App Panel uses.

interface DesignerElementId {
  component: string;
  element: string;
}

interface DesignerElement {
  id: DesignerElementId;
  type: string;
  setAltText?(altText: string): Promise<null>;
  getAltText?(): Promise<string | null>;
  setCustomAttribute?(name: string, value: string): Promise<null>;
  getDomId?(): Promise<string | null>;
  customAttributes?: boolean;
}

interface DesignerPage {
  id: string;
  getSlug?(): Promise<string>;
}

interface WebflowDesignerApi {
  getCurrentPage(): Promise<DesignerPage>;
  getAllPagesAndFolders(): Promise<DesignerPage[]>;
  switchPage(page: DesignerPage): Promise<null>;
  getAllElements(): Promise<DesignerElement[]>;
  getSelectedElement(): Promise<DesignerElement | null>;
  setSelectedElement(element: DesignerElement): Promise<null>;
}

declare const webflow: WebflowDesignerApi;
