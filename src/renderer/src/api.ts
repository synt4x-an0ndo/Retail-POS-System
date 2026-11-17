import type { Channel, IpcResult } from '@shared/channels'

declare global {
  interface Window {
    pos: { invoke: (channel: Channel, payload?: unknown) => Promise<IpcResult> }
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export async function call<T = any>(channel: Channel, payload?: unknown): Promise<T> {
  const r = await window.pos.invoke(channel, payload)
  if (!r.ok) throw new ApiError(r.code, r.message)
  return r.data as T
}

export const isOverride = (e: unknown) => e instanceof ApiError && (e.code === 'OVERRIDE_REQUIRED' || e.code === 'OVERRIDE_FAILED')
