import { Client } from '@xhayper/discord-rpc'
import type { RpcClient } from './presence'

/** Real Discord IPC client (talks to the local Discord desktop app, no OAuth/bot token). */
export function createDiscordClient(clientId: string): RpcClient {
  const client = new Client({ clientId })
  return {
    connect: () => client.login(),
    setActivity: (a) => {
      if (!client.user) return Promise.reject(new Error('not ready'))
      return client.user.setActivity(a)
    },
    clearActivity: () => (client.user ? client.user.clearActivity() : Promise.resolve()),
    destroy: () => client.destroy(),
    onDisconnected: (cb) => void client.on('disconnected', cb)
  }
}
