import type { Server } from "socket.io";

let ioInstance: Server | null = null;

/**
 * Called once from src/index.ts right after the Socket.io server is created.
 * Lets deep service functions (e.g. stockMovementService, called from many
 * controllers that never pass req down) emit events without req.app.get("io").
 */
export const setIo = (io: Server): void => {
  ioInstance = io;
};

export const getIo = (): Server | null => {
  return ioInstance;
};
