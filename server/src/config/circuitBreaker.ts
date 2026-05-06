import { logger } from './logger.js';

type State = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private state: State = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly failureThreshold = 5,
    private readonly recoveryTimeoutMs = 60_000,
    private readonly successThreshold = 2,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.state = 'half-open';
        logger.info('Circuit breaker half-open', { name: this.name });
      } else {
        throw new Error(`Circuit breaker [${this.name}] is OPEN — refusing call`);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'closed';
        this.successCount = 0;
        logger.info('Circuit breaker closed (recovered)', { name: this.name });
      }
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'half-open' || this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      logger.warn('Circuit breaker opened', { name: this.name, failures: this.failureCount });
    }
  }

  getState(): State {
    return this.state;
  }
}

export const s3Breaker  = new CircuitBreaker('s3',      5, 60_000);
export const dbBreaker  = new CircuitBreaker('mongodb', 5, 60_000);
export const sqsBreaker = new CircuitBreaker('sqs',     5, 60_000);
