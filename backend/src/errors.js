import { ERROR_STATUS } from './contract.js';

/** An error that maps 1:1 onto a contract ErrorResponse (§8). */
export class ApiError extends Error {
  constructor(code, message, status = ERROR_STATUS[code] ?? 504) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class StageTimeoutError extends Error {
  constructor(stage, ms) {
    super(`${stage} exceeded its ${ms} ms budget`);
    this.code = 'STAGE_TIMEOUT';
  }
}

export const errorBody = (code, message) => ({ error: { code, message } });

export function sendError(res, err) {
  res.locals.errorCode = err.code;
  res.status(err.status).json(errorBody(err.code, err.message));
}

/** Resolve `promise` or reject with StageTimeoutError after `ms`. Never leaves a timer running. */
export function withTimeout(promise, ms, stage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StageTimeoutError(stage, ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());
