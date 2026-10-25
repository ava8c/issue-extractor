import {
  ArrowDownToLine,
  ArrowRight,
  Code2,
  Copy,
  FileArchive,
  Link2,
  LoaderCircle,
} from 'lucide-react'
import { issueMarkdown } from '../shared/export'
import type { IssueDetail } from '../shared/types'
import { useHandoff } from './HandoffContext'

interface ExportActions {
  issue: IssueDetail | null
  busy: string
  copy: () => void
  exportZip: () => void
  copyReference: () => void
}

export function IssueExportView({ issue, busy, copy, exportZip, copyReference }: ExportActions) {
  const handoff = useHandoff()
  if (!handoff.enabled || !issue) return null
  return (
    <div className="export-view">
      <div className="tab-intro">
        <span className="feature-icon">
          <Code2 size={23} />
        </span>
        <h3>Esporta issue</h3>
      </div>
      {handoff.error && <p role="alert">{handoff.error}</p>}
      <div className="export-options">
        {handoff.mcpUrl && (
          <button onClick={copyReference} disabled={!!busy}>
            <Link2 size={20} />
            <strong>Copia riferimento</strong>
            <span>Contesto e allegati tramite connessione locale</span>
            <ArrowRight size={15} />
          </button>
        )}
        <button onClick={copy} disabled={!!busy}>
          <Copy size={20} />
          <strong>Copia testo</strong>
          <span>Markdown, commenti e reference</span>
          <ArrowRight size={15} />
        </button>
        <button onClick={exportZip} disabled={!!busy}>
          <FileArchive size={20} />
          <strong>Scarica lo ZIP</strong>
          <span>Markdown, immagini, file e manifest</span>
          <ArrowDownToLine size={15} />
        </button>
      </div>
      <div className="preview-label">
        <span>ANTEPRIMA MARKDOWN</span>
        <span>Autori esclusi · date e ore incluse</span>
      </div>
      <pre className="export-preview">{issueMarkdown(issue)}</pre>
    </div>
  )
}

export function IssueExportBar({ issue, busy, copy, exportZip, copyReference }: ExportActions) {
  const handoff = useHandoff()
  if (!handoff.enabled) return null
  return (
    <footer className="export-bar">
      <span className="export-caption">Esporta issue</span>
      <div className="export-buttons">
        <button className="button secondary" disabled={!issue || !!busy} onClick={copy}>
          {busy === 'copy' ? <LoaderCircle size={14} className="spin" /> : <Copy size={14} />}
          Copia testo
        </button>
        <button
          className={`button ${handoff.mcpUrl ? 'secondary' : 'primary'}`}
          disabled={!issue || !!busy}
          onClick={exportZip}
        >
          {busy === 'zip' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <ArrowDownToLine size={15} />
          )}
          {busy === 'zip' ? 'Esportazione…' : 'Esporta ZIP'}
        </button>
        {handoff.mcpUrl && (
          <button className="button primary" disabled={!issue || !!busy} onClick={copyReference}>
            {busy === 'reference' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Link2 size={14} />
            )}
            Copia riferimento
          </button>
        )}
      </div>
    </footer>
  )
}
