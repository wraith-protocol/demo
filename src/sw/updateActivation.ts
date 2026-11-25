interface UpdateClient {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

async function clientReady(client: UpdateClient): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 2000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.ready === true);
    };
    client.postMessage({ type: 'PREPARE_APP_UPDATE' }, [channel.port2]);
  });
}

/** Freeze every client before activation, including other open tabs. Fail closed. */
export async function approveUpdate(clients: readonly UpdateClient[]): Promise<boolean> {
  const ready = await Promise.all(clients.map(clientReady));
  if (ready.every(Boolean)) return true;
  clients.forEach((client) => client.postMessage({ type: 'CANCEL_APP_UPDATE' }));
  return false;
}
