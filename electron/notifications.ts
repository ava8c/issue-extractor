import type { NotificationConstructorOptions } from 'electron'
import { NOTIFICATION_LIMIT } from '../src/shared/activity'
import type { IssueNotification } from '../src/shared/types'

interface NativeNotification {
  readonly id: string
  on(event: 'click' | 'close' | 'failed' | 'show', listener: () => void): unknown
  show(): void
  close(): void
}

export function nativeNotificationOptions(
  item: IssueNotification,
  projectTitle: string,
): NotificationConstructorOptions {
  const change =
    item.type === 'status'
      ? `${item.fromStatus} → ${item.toStatus}`
      : item.type === 'comment'
        ? `${item.newCommentCount} ${item.newCommentCount === 1 ? 'nuovo commento' : 'nuovi commenti'}`
        : 'Nuova issue nel progetto'
  return {
    id: item.id,
    groupId: item.projectId,
    title: projectTitle,
    subtitle: `#${item.issue.number || 'bozza'} · ${item.issue.title}`,
    body: `${change} · ${item.issue.repository}`,
  }
}

// Retain native objects so notification clicks keep working while the app is in the background.
export class DesktopNotifications {
  private active = new Map<string, { native: NativeNotification; item: IssueNotification }>()
  error: string | undefined

  constructor(
    private create: (options: NotificationConstructorOptions) => NativeNotification | undefined,
    private open: (item: IssueNotification) => void,
    private changed: () => void,
    private remove: (ids: string[]) => void = () => {},
  ) {}

  private setError(value?: string) {
    if (this.error === value) return
    this.error = value
    this.changed()
  }

  private failed() {
    this.setError(
      'Notifica macOS non consegnata. Consenti le notifiche in Impostazioni di Sistema → Notifiche → Issue Atlas. Se usi una build locale, verifica che l’app sia firmata.',
    )
  }

  private attach(native: NativeNotification, item: IssueNotification) {
    this.active.set(item.id, { native, item })
    const current = () => this.active.get(item.id)?.native === native
    native.on('click', () => {
      if (!current()) return
      this.dismiss((event) => event.id === item.id)
      this.open(item)
    })
    native.on('close', () => {
      if (current()) this.active.delete(item.id)
    })
    native.on('failed', () => {
      if (!current()) return
      this.active.delete(item.id)
      this.failed()
    })
    native.on('show', () => {
      if (current()) this.setError()
      else if (!this.active.has(item.id)) this.remove([item.id])
    })
    while (this.active.size > NOTIFICATION_LIMIT) {
      const oldest = this.active.keys().next().value!
      this.dismiss((event) => event.id === oldest)
    }
  }

  show(items: IssueNotification[], projectTitle: (projectId: string) => string) {
    for (const item of items) {
      if (item.read || this.active.has(item.id)) continue
      try {
        const native = this.create(nativeNotificationOptions(item, projectTitle(item.projectId)))
        if (!native) {
          this.failed()
          continue
        }
        this.attach(native, item)
        native.show()
      } catch {
        this.dismiss((event) => event.id === item.id)
        this.failed()
      }
    }
  }

  restore(delivered: NativeNotification[], items: IssueNotification[]) {
    const known = new Map(items.filter((item) => !item.read).map((item) => [item.id, item]))
    for (const native of delivered) {
      const item = known.get(native.id)
      if (item && !this.active.has(item.id)) this.attach(native, item)
      else if (!this.active.has(native.id)) {
        native.close()
        this.remove([native.id])
      }
    }
  }

  dismiss(matches: (item: IssueNotification) => boolean) {
    for (const [id, entry] of this.active) {
      if (!matches(entry.item)) continue
      this.active.delete(id)
      try {
        entry.native.close()
        // Restored Electron notifications are observed, not owned: close()
        // detaches their handlers but only remove() clears them from macOS.
        this.remove([id])
      } catch {
        // The OS may already have removed this notification.
      }
    }
  }

  clear() {
    this.dismiss(() => true)
    this.setError()
  }
}
