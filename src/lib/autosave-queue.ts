export class AutosaveQueue<T> {
  private latest: { revision: number; value: T } | null = null
  private savedRevision = 0
  private nextRevision = 0
  private inFlight: Promise<void> | null = null
  private readonly save: (value: T) => Promise<T>
  private readonly onLatestSaved: (value: T) => void

  constructor(
    save: (value: T) => Promise<T>,
    onLatestSaved: (value: T) => void,
  ) {
    this.save = save
    this.onLatestSaved = onLatestSaved
  }

  get pending() {
    return this.latest !== null && this.savedRevision < this.latest.revision
  }

  enqueue(value: T) {
    this.nextRevision += 1
    this.latest = { revision: this.nextRevision, value }
  }

  async flush(): Promise<void> {
    while (this.pending) {
      if (!this.inFlight) {
        const queued = this.latest
        if (!queued) return
        this.inFlight = this.persist(queued).finally(() => { this.inFlight = null })
      }
      await this.inFlight
    }
  }

  private async persist(queued: { revision: number; value: T }) {
    const saved = await this.save(queued.value)
    this.savedRevision = Math.max(this.savedRevision, queued.revision)
    if (this.latest?.revision === queued.revision) this.onLatestSaved(saved)
  }
}
