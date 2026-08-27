export interface KnowledgeEntity {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  source_event_ids: string[];
}

export interface KnowledgeConcept {
  id: string;
  name: string;
  description?: string;
  source_event_ids: string[];
  related_entity_ids: string[];
}

export interface KnowledgeClaim {
  id: string;
  text: string;
  normalized_text?: string;
  source_event_ids: string[];
  source_article_ids: string[];
  support_count: number;
  contradiction_count: number;
  confidence: number;
}

export interface KnowledgeRelation {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  source_event_ids: string[];
}

export interface KnowledgeStore {
  schema: string;
  schema_version: string;
  updated_at: string;
  entities: KnowledgeEntity[];
  concepts: KnowledgeConcept[];
  claims: KnowledgeClaim[];
  relations: KnowledgeRelation[];
}
