import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";

// Define a common interface for both Redis clients
interface RedisClient {
  ping(): Promise<string>;
  get<T = string>(key: string): Promise<T | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: any): Promise<string | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setex(key: string, seconds: number, value: any): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
}

// Wrapper for IORedis to match the interface
class IORedisWrapper implements RedisClient {
  private client: IORedis;

  constructor(url: string) {
    this.client = new IORedis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.client.on('connect', () => {
      console.log('✅ Connected to Redis (ioredis)');
    });
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async set(key: string, value: any): Promise<string | null> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.client.set(key, serialized);
    return 'OK';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setex(key: string, seconds: number, value: any): Promise<string | null> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.client.setex(key, seconds, serialized);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async exists(...keys: string[]): Promise<number> {
    return this.client.exists(...keys);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, members);
  }

  async smembers(key: string): Promise<string[]> {
    const result = await this.client.smembers(key);
    return result || [];
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, members);
  }
}

// Wrapper for Upstash Redis to match the interface
class UpstashRedisWrapper implements RedisClient {
  private client: UpstashRedis;

  constructor(url: string, token: string) {
    this.client = new UpstashRedis({ url, token });
    console.log('✅ Using Upstash Redis (REST API)');
  }

  async ping(): Promise<string> {
    await this.client.ping();
    return 'PONG';
  }

  async get<T = string>(key: string): Promise<T | null> {
    return this.client.get<T>(key);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async set(key: string, value: any): Promise<string | null> {
    await this.client.set(key, value);
    return 'OK';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setex(key: string, seconds: number, value: any): Promise<string | null> {
    await this.client.setex(key, seconds, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async exists(...keys: string[]): Promise<number> {
    return this.client.exists(...keys);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, members);
  }

  async smembers(key: string): Promise<string[]> {
    const result = await this.client.smembers(key);
    return result || [];
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, members);
  }
}

// Lazy initialization of Redis client
let redisClient: RedisClient | null = null;

function getRedisClient(): RedisClient {
  if (!redisClient) {
    // Check for local Redis URL first
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      console.log('🔧 Using local Redis with REDIS_URL');
      redisClient = new IORedisWrapper(redisUrl);
    } else {
      // Fall back to Upstash Redis
      const url = process.env.KV_REST_API_URL;
      const token = process.env.KV_REST_API_TOKEN;

      if (!url || url === "your_kv_rest_api_url") {
        throw new Error(
          "Neither REDIS_URL nor KV_REST_API_URL is properly configured. " +
          "Please set REDIS_URL for local Redis or KV_REST_API_URL/KV_REST_API_TOKEN for Upstash Redis."
        );
      }

      if (!token || token === "your_kv_rest_api_token") {
        throw new Error(
          "KV_REST_API_TOKEN is not properly configured. " +
          "Please set it to your actual Upstash Redis REST token."
        );
      }

      console.log('🔧 Using Upstash Redis with KV_REST_API_URL');
      redisClient = new UpstashRedisWrapper(url, token);
    }
  }

  return redisClient;
}

// Export a proxy object that lazily initializes the Redis client
export const redis = new Proxy({} as RedisClient, {
  get(target, prop) {
    const client = getRedisClient();
    const value = client[prop as keyof RedisClient];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

// Key prefixes for organization
export const REDIS_KEYS = {
  AGENT: (agentId: string) => `agent:${agentId}`,
  AGENT_LIST: "agents:list",
  ADMIN_NONCE: (address: string) => `admin:nonce:${address}`,
} as const;
