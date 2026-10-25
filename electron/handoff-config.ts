import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'

export const DEFAULT_MCP_PORT = 47321

export function handoffConfig(env: Record<string, string | undefined>) {
  const enabled = env.ISSUE_ATLAS_HANDOFF_ENABLED?.trim().toLowerCase() === 'true'
  const value = env.ISSUE_ATLAS_MCP_PORT?.trim() || String(DEFAULT_MCP_PORT)
  const port = Number(value)
  if (enabled && (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535))
    throw new Error('ISSUE_ATLAS_MCP_PORT deve essere una porta tra 1024 e 65535.')
  return { enabled, port: enabled ? port : DEFAULT_MCP_PORT }
}

export async function loadHandoffConfig(path: string, env = process.env) {
  let values: Record<string, string | undefined> = {}
  try {
    values = parseEnv(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return handoffConfig({ ...values, ...env })
}
