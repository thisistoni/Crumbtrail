export async function whenNativeWindowReady<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!String(error).toLowerCase().includes("underlying handle")) throw error
      await new Promise(resolve => window.setTimeout(resolve, 40))
    }
  }
  throw lastError
}
