import sql, { migrationRunner, type UpdateQueryResponse } from "@forge/sql";

export type WorkspaceRow<T> = {
  id: string;
  group_id: string;
  seq: number;
  data: T;
};
type SqlRow = Omit<WorkspaceRow<unknown>, "data"> & { payload: string };

// The installation owns the SQL database. Every record is further isolated by Jira project.
const table = `CREATE TABLE IF NOT EXISTS kinlet_workspace (
  project_id VARCHAR(20) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  id VARCHAR(100) NOT NULL,
  group_id VARCHAR(100) NOT NULL,
  seq INT NOT NULL,
  ordered_at VARCHAR(30) NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  PRIMARY KEY (project_id, kind, id),
  INDEX kinlet_workspace_group (project_id, kind, group_id, seq),
  INDEX kinlet_workspace_recent (project_id, kind, ordered_at, id)
)`;

export function migrateWorkspace() {
  return migrationRunner.enqueue("kinlet_workspace_v1", table).run();
}

function decode<T>(row: SqlRow): WorkspaceRow<T> {
  return {
    id: row.id,
    group_id: row.group_id,
    seq: row.seq,
    data: JSON.parse(row.payload) as T,
  };
}

function rowLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error("Request between 1 and 50 workspace records.");
  // Forge SQL rejects a bound parameter in LIMIT.
  return limit;
}

export function projectStore(project: string) {
  return {
    async get<T>(kind: string, id: string) {
      const { rows } = await sql
        .prepare<SqlRow>(
          "SELECT id, group_id, seq, payload FROM kinlet_workspace WHERE project_id = ? AND kind = ? AND id = ?",
        )
        .bindParams(project, kind, id)
        .execute();
      return rows[0] ? decode<T>(rows[0]) : undefined;
    },
    async recent<T>(kind: string, before = "9999", limit = 25) {
      const { rows } = await sql
        .prepare<SqlRow>(
          `SELECT id, group_id, seq, payload FROM kinlet_workspace WHERE project_id = ? AND kind = ? AND ordered_at < ? ORDER BY ordered_at DESC, id DESC LIMIT ${rowLimit(limit)}`,
        )
        .bindParams(project, kind, before)
        .execute();
      return rows.map(decode<T>);
    },
    async revisions<T>(kind: string, group: string, limit = 1) {
      const { rows } = await sql
        .prepare<SqlRow>(
          `SELECT id, group_id, seq, payload FROM kinlet_workspace WHERE project_id = ? AND kind = ? AND group_id = ? ORDER BY seq DESC LIMIT ${rowLimit(limit)}`,
        )
        .bindParams(project, kind, group)
        .execute();
      return rows.map(decode<T>);
    },
    async revisionList(kind: string, group: string) {
      const { rows } = await sql
        .prepare<{ seq: number; ordered_at: string }>(
          "SELECT seq, ordered_at FROM kinlet_workspace WHERE project_id = ? AND kind = ? AND group_id = ? ORDER BY seq DESC LIMIT 50",
        )
        .bindParams(project, kind, group)
        .execute();
      return rows;
    },
    async insert<T>(kind: string, id: string, data: T, group = "", seq = 1) {
      try {
        await sql
          .prepare<UpdateQueryResponse>(
            "INSERT INTO kinlet_workspace (project_id, kind, id, group_id, seq, ordered_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bindParams(
            project,
            kind,
            id,
            group,
            seq,
            new Date().toISOString(),
            JSON.stringify(data),
          )
          .execute();
        return true;
      } catch (error) {
        if (await this.get(kind, id)) return false;
        throw error;
      }
    },
    async remove<T>(kind: string, id: string, contents: T) {
      await sql
        .prepare<UpdateQueryResponse>(
          "DELETE FROM kinlet_workspace WHERE project_id = ? AND kind = ? AND id = ? AND payload = ?",
        )
        .bindParams(project, kind, id, JSON.stringify(contents))
        .execute();
    },
    async replace<T>(kind: string, id: string, seq: number, data: T) {
      const { rows } = await sql
        .prepare<UpdateQueryResponse>(
          "UPDATE kinlet_workspace SET payload = ?, seq = seq + 1 WHERE project_id = ? AND kind = ? AND id = ? AND seq = ?",
        )
        .bindParams(JSON.stringify(data), project, kind, id, seq)
        .execute();
      return rows.affectedRows === 1;
    },
  };
}

export type WorkspaceStore = ReturnType<typeof projectStore>;
