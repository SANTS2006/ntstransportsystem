import { Redis } from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Store } from 'express-rate-limit';

export type RedisClient = Redis;

export function createRedis(url: string): RedisClient {
  return new Redis(url, {
    maxRetriesPerRequest: 2, // fail fast instead of queueing requests behind a dead connection
    enableReadyCheck: true,
    connectTimeout: 10_000,
    lazyConnect: false,
  });
}

/** Builds one counter store per limiter so each route keeps independent, shared-across-instances counts. */
export type RateLimitStoreFactory = (name: string) => Store;

export function redisRateLimitStores(redis: RedisClient): RateLimitStoreFactory {
  return (name) =>
    new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (...args: string[]) =>
        redis.call(args[0] as string, ...args.slice(1)) as Promise<RedisReply>,
    });
}
