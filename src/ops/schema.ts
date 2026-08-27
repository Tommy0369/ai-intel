export const SCHEMA_VERSIONS = {
  catalog: "2026.08-step01",
  events: "2026.08-step02",
  intelligence: "2026.08-step03",
  trends: "2026.08-step04",
  knowledge: "2026.08-step05",
  cross: "2026.08-step06",
  personal: "2026.08-step07",
  ideas: "2026.08-step08",
  content: "2026.08-step09",
  feedback: "2026.08-step10",
  ops: "2026.08-step11",
} as const;

export function withSchemaMeta<T extends Record<string, unknown>>(
  schema: string,
  schema_version: string,
  body: T,
): T & { schema: string; schema_version: string; generated_at: string } {
  return {
    ...body,
    schema,
    schema_version,
    generated_at: new Date().toISOString(),
  };
}
