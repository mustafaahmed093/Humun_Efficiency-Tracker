declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
      get<T = Record<string, unknown>>(...args: unknown[]): T | undefined;
      all<T = Record<string, unknown>>(...args: unknown[]): T[];
    };
  }
}
