export type PersonalSourceType =
  | "markdown"
  | "text"
  | "pdf"
  | "epub"
  | "kindle_highlights"
  | "notes"
  | "html";

export interface DocumentSection {
  id: string;
  heading?: string;
  text: string;
  order: number;
  chapter?: string;
  page?: number;
  location?: string;
}

export interface NormalizedDocument {
  id: string;
  source_type: PersonalSourceType;
  title: string;
  author?: string;
  source_path?: string;
  source_url?: string;
  imported_at: string;
  content_hash: string;
  sections: DocumentSection[];
  metadata: Record<string, unknown>;
}

export interface KnowledgeQuote {
  id: string;
  text: string;
  document_id: string;
  section_id: string;
  location?: string;
}

export type IngestStatus =
  | "success"
  | "duplicate"
  | "empty"
  | "unsupported"
  | "parse_failed"
  | "encrypted";

export interface IngestResult {
  status: IngestStatus;
  path: string;
  document?: NormalizedDocument;
  error?: string;
}

export interface PersonalSourceAdapter {
  canHandle(input: string): boolean;
  ingest(input: string): Promise<NormalizedDocument>;
}
