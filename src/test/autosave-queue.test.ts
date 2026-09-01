import { describe, expect, it, vi } from "vitest"
import { AutosaveQueue } from "@/lib/autosave-queue"

describe("AutosaveQueue", () => {
  it("serializes writes and never publishes a stale completion", async () => {
    type Draft = { title: string }
    const pending: { value: Draft; resolve(value: Draft): void }[] = []
    let active = 0
    let maximumActive = 0
    const save = vi.fn(async (value: Draft) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      try {
        return await new Promise<Draft>(resolve => pending.push({ value, resolve }))
      } finally {
        active -= 1
      }
    })
    const published: Draft[] = []
    const queue = new AutosaveQueue(save, value => published.push(value))

    queue.enqueue({ title: "first" })
    const firstFlush = queue.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    queue.enqueue({ title: "latest" })
    const secondFlush = queue.flush()

    expect(save).toHaveBeenCalledTimes(1)
    pending[0].resolve(pending[0].value)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(published).toEqual([])
    pending[1].resolve(pending[1].value)
    await Promise.all([firstFlush, secondFlush])

    expect(maximumActive).toBe(1)
    expect(published).toEqual([{ title: "latest" }])
    expect(queue.pending).toBe(false)
  })

  it("keeps failed work pending so a later flush retries it", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("disk busy"))
      .mockImplementationOnce(async value => value)
    const published = vi.fn()
    const queue = new AutosaveQueue<{ title: string }>(save, published)
    queue.enqueue({ title: "retry me" })

    await expect(queue.flush()).rejects.toThrow("disk busy")
    expect(queue.pending).toBe(true)
    await queue.flush()

    expect(save).toHaveBeenCalledTimes(2)
    expect(published).toHaveBeenCalledWith({ title: "retry me" })
    expect(queue.pending).toBe(false)
  })
})
