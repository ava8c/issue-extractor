export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export const GITHUB_UNAVAILABLE =
  'GitHub non è raggiungibile. Controlla indirizzo, VPN e certificato aziendale, poi riprova.'

export function isGitHubUnavailable(error: unknown): boolean {
  return errorMessage(error).includes(GITHUB_UNAVAILABLE)
}
