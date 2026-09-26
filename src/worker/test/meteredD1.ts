export interface D1Meter {
  /** D1에 다녀온 횟수 (batch 한 번은 1회) */
  roundTrips: number;
  /** D1이 `meta.rows_written`으로 알려 준 쓴 행 수의 합 */
  rowsWritten: number;
}

type Executor = (...args: unknown[]) => Promise<unknown>;

const EXECUTORS = new Set(["all", "run", "raw", "first"]);

function rowsWrittenOf(result: unknown): number {
  const meta = (result as { meta?: { rows_written?: number } } | null)?.meta;
  return meta?.rows_written ?? 0;
}

/**
 * D1 바인딩을 감싸 왕복 횟수와 쓴 행 수를 센다. 저장 경로의 성능 기준
 * (순차 왕복·쓰기 행 수)을 테스트에서 확인하려고 쓴다.
 */
export function meterD1(db: D1Database): { db: D1Database; meter: D1Meter } {
  const meter: D1Meter = { roundTrips: 0, rowsWritten: 0 };
  const originals = new WeakMap<object, D1PreparedStatement>();

  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (prop === "bind") {
          return (...args: unknown[]) => wrap(target.bind(...args));
        }
        if (typeof prop === "string" && EXECUTORS.has(prop)) {
          return async (...args: unknown[]) => {
            meter.roundTrips += 1;
            const result = await (value as Executor).apply(target, args);
            meter.rowsWritten += rowsWrittenOf(result);
            return result;
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };

  const metered = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => wrap(target.prepare(query));
      }
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          meter.roundTrips += 1;
          const results = await target.batch(
            statements.map(
              (statement) => originals.get(statement) ?? statement,
            ),
          );
          meter.rowsWritten += results.reduce(
            (sum, result) => sum + rowsWrittenOf(result),
            0,
          );
          return results;
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { db: metered, meter };
}
