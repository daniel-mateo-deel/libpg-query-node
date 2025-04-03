/* eslint-disable @typescript-eslint/no-explicit-any */
import { deparseSync as deparse, parseQuerySync as parse, normalizeSync } from './index';

interface BindReplacementResult {
  replacedSql: string;
  bindParams: string[];
}

/**
 * Replace bind parameters (e.g. :limit) with unique placeholders.
 *
 * @param sql - The original SQL string.
 * @returns An object with the replaced SQL and an array of original bind parameters.
 */
function replaceBindParametersWithPlaceholders(sql: string): BindReplacementResult {
  const bindParams: string[] = [];
  const replacedSql = sql.replace(/(:[a-zA-Z_][a-zA-Z0-9_]*)/g, (match: string) => {
    const placeholder = `__bind_param_${bindParams.length}__`;
    bindParams.push(match);
    return placeholder;
  });
  return { replacedSql, bindParams };
}

/**
 * Reinsert the original bind parameters back into the SQL by replacing the unique placeholders.
 *
 * @param sql - The SQL string with placeholders.
 * @param bindParams - The array of original bind parameter strings.
 * @returns The SQL string with the bind parameters reinserted.
 */
function reinsertBindParameters(sql: string, bindParams: string[]): string {
  for (let i = 0; i < bindParams.length; i++) {
    const placeholder = `__bind_param_${i}__`;
    sql = sql.replace(new RegExp(placeholder, 'g'), bindParams[i]);
  }
  return sql;
}

/**
 * Recursively traverse an AST node (or array of nodes) to collect table names from RangeVar nodes.
 *
 * @param node - The AST node or array of nodes.
 * @param tables - A Set to collect table names.
 */
function traverseForTables(node: any, tables: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => traverseForTables(child, tables));
  } else if (node && typeof node === 'object') {
    if (node.RangeVar && typeof node.RangeVar.relname === 'string') {
      let tableName = node.RangeVar.relname;
      if (node.RangeVar.schemaname && typeof node.RangeVar.schemaname === 'string') {
        tableName = `${node.RangeVar.schemaname}.${tableName}`;
      } else {
        tableName = `public.${tableName}`;
      }
      tables.add(tableName);
    }
    Object.keys(node).forEach((key) => traverseForTables(node[key], tables));
  }
}
/**
 * Extract all table names from a SQL query.
 *
 * @param sql - The SQL query string.
 * @returns A Set of table names found in the query.
 */
export function extractTableNames(sql: string): Set<string> {
  const { replacedSql } = replaceBindParametersWithPlaceholders(sql);
  const ast = parse(replacedSql);
  const tables = new Set<string>();
  ast.stmts?.forEach((stmt: any) => {
    traverseForTables(stmt, tables);
  });
  return tables;
}

/**
 * Recursively traverse an AST node (or array of nodes) and replace table names according to a map.
 *
 * @param node - The AST node or array of nodes.
 * @param tableMap - A mapping from original table names to new table names.
 */
function traverseAndReplaceTables(node: any, tableMap: Record<string, string>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => traverseAndReplaceTables(child, tableMap));
  } else if (node && typeof node === 'object') {
    if (node.RangeVar && typeof node.RangeVar.relname === 'string') {
      const original = node.RangeVar.relname;
      if (Object.prototype.hasOwnProperty.call(tableMap, original)) {
        node.RangeVar.relname = tableMap[original];
        if (node.RangeVar.schemaname) {
          delete node.RangeVar.schemaname;
        }
      }
    }
    Object.keys(node).forEach((key) => traverseAndReplaceTables(node[key], tableMap));
  }
}

/**
 * Rewrites a SQL query by replacing table names according to a given map.
 * Bind parameters are temporarily replaced with placeholders for proper parsing.
 *
 * @param originalSql - The original SQL query.
 * @param tableMap - A mapping from original table names to new table names.
 * @returns The rewritten SQL query.
 */
export function replaceTablesInQuery(originalSql: string, tableMap: Record<string, string>): string {
  const { replacedSql, bindParams } = replaceBindParametersWithPlaceholders(originalSql);

  const ast = parse(replacedSql);

  ast.stmts?.forEach((stmt: any) => {
    traverseAndReplaceTables(stmt, tableMap);
  });

  const rewrittenSql = deparse(ast);

  return reinsertBindParameters(rewrittenSql, bindParams);
}

const originalSql: string = `
SELECT * FROM contract c
where name = 'tests' AND c.id = 23 OR c.price = 2 OR c.is_active = true
UNION ALL
select * from contract c
where name = 'tests' AND c.id IN (1, 2, 3) OR c.price = 2 OR c.is_active = true
`;

console.log(normalizeSync(originalSql));

const tables = extractTableNames(originalSql);
console.log('Extracted tables:', Array.from(tables));
const tableMap: Record<string, string> = {
  contract: 'contracts_with_access',
};

const newSql = replaceTablesInQuery(originalSql, tableMap);
console.log('Rewritten SQL:\n', newSql);
