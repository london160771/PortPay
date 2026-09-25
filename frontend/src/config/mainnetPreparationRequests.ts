export interface MainnetPreparationRequestTicket<T> {
  key: string;
  id: number;
  promise: Promise<T>;
}

export function createMainnetPreparationRequestCoordinator<T>() {
  let sequence = 0;
  let latestKey: string | null = null;
  let inFlight: MainnetPreparationRequestTicket<T> | null = null;

  return {
    run(key: string, request: () => Promise<T>): { ticket: MainnetPreparationRequestTicket<T>; isNew: boolean } {
      if (inFlight?.key === key) return { ticket: inFlight, isNew: false };

      const ticket: MainnetPreparationRequestTicket<T> = {
        key,
        id: ++sequence,
        promise: Promise.resolve().then(request),
      };
      latestKey = key;
      inFlight = ticket;
      const clearIfCurrent = () => {
        if (inFlight === ticket) inFlight = null;
      };
      void ticket.promise.then(clearIfCurrent, clearIfCurrent);
      return { ticket, isNew: true };
    },

    isLatest(ticket: MainnetPreparationRequestTicket<T>): boolean {
      return ticket.id === sequence && ticket.key === latestKey;
    },

    invalidate(): void {
      sequence += 1;
      latestKey = null;
      inFlight = null;
    },
  };
}
