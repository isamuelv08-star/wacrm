import { describe, expect, it, vi } from "vitest";
import { ensureDefaultPipeline, defaultStageRows } from "./default-stages";

// ensureDefaultPipeline is the fix for the onboarding audit's #1
// critical finding: onboarding used to claim a pipeline already
// existed when none did, so WhatsApp leads silently never became
// deals. These tests guard the idempotency this whole fix depends on
// — call it twice (once from the wizard's pipeline step, once again
// from /api/onboarding/complete as a fallback) and it must never
// create a second pipeline.

interface Row {
  [key: string]: unknown;
}

function makeClient(existingPipelines: Row[]) {
  const inserted: { table: string; rows: unknown }[] = [];
  const pipelines = [...existingPipelines];

  const from = (table: string) => {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: pipelines, error: null }),
            }),
          }),
        }),
        insert: (row: Row) => ({
          select: () => ({
            single: () => {
              const created = { id: "new-pipeline-id", created_at: new Date().toISOString(), ...row };
              inserted.push({ table: "pipelines", rows: created });
              pipelines.push(created);
              return Promise.resolve({ data: created, error: null });
            },
          }),
        }),
      };
    }
    if (table === "pipeline_stages") {
      return {
        insert: (rows: Row[]) => {
          inserted.push({ table: "pipeline_stages", rows });
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, inserted };
}

describe("ensureDefaultPipeline", () => {
  it("creates a pipeline with 6 default stages when the account has none", async () => {
    const { client, inserted } = makeClient([]);

    const pipeline = await ensureDefaultPipeline(client, "account-1", "user-1");

    expect(pipeline).not.toBeNull();
    expect(pipeline?.name).toBe("Sales Pipeline");
    const pipelineInsert = inserted.find((i) => i.table === "pipelines");
    expect(pipelineInsert?.rows).toMatchObject({ account_id: "account-1", user_id: "user-1" });
    const stagesInsert = inserted.find((i) => i.table === "pipeline_stages");
    expect(stagesInsert?.rows).toHaveLength(6);
  });

  it("is idempotent — does nothing when the account already has a pipeline", async () => {
    const { client, inserted } = makeClient([
      { id: "existing-pipeline", account_id: "account-1", name: "Sales Pipeline" },
    ]);

    const pipeline = await ensureDefaultPipeline(client, "account-1", "user-1");

    expect(pipeline?.id).toBe("existing-pipeline");
    expect(inserted).toHaveLength(0);
  });

  it("never crashes on a DB error — returns null instead", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: null, error: { message: "boom" } }),
            }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const pipeline = await ensureDefaultPipeline(client, "account-1", "user-1");

    expect(pipeline).toBeNull();
    spy.mockRestore();
  });
});

describe("defaultStageRows", () => {
  it("carries the won/lost/qualified flags and a 10-90 win-probability ramp", () => {
    const rows = defaultStageRows("pipeline-1");

    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.pipeline_id === "pipeline-1")).toBe(true);
    expect(rows.find((r) => r.name === "Won")?.is_won_stage).toBe(true);
    expect(rows.find((r) => r.name === "Lost")?.is_lost_stage).toBe(true);
    expect(rows.find((r) => r.name === "Qualified")?.is_qualified_stage).toBe(true);
    expect(rows.find((r) => r.name === "New Lead")?.win_probability).toBe(10);
  });
});
