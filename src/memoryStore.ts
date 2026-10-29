import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
});

export interface AgentMemory {
  id: number;
  agent_id: string;
  session_id: string;
  memory_type: 'episodic' | 'semantic' | 'procedural';
  key: string;
  value: any;
  created_at: string;
  last_accessed_at: string;
  access_count: number;
}

export interface AgentSession {
  agent_id: string;
  session_id: string;
  created_at: string;
  last_active: string;
}

export async function saveMemory(
  agentId: string,
  sessionId: string,
  key: string,
  value: any,
  memoryType: string = 'episodic'
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO agent_memory (agent_id, session_id, memory_type, key, value, role, content, created_at, last_accessed_at, access_count)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'assistant', $5::text, NOW(), NOW(), 0)
       ON CONFLICT (agent_id, key)
       DO UPDATE SET value = $5::jsonb, session_id = $2, last_accessed_at = NOW(), access_count = agent_memory.access_count + 1`,
      [agentId, sessionId, memoryType, key, JSON.stringify(value)]
    );
    return true;
  } catch (err) {
    console.error('[MEMORY] saveMemory error:', (err as Error).message);
    return false;
  }
}

export async function getMemory(agentId: string, sessionId: string, key: string): Promise<AgentMemory | null> {
  try {
    const res = await pool.query(
      `UPDATE agent_memory SET last_accessed_at = NOW(), access_count = access_count + 1
       WHERE agent_id = $1 AND session_id = $2 AND key = $3
       RETURNING *`,
      [agentId, sessionId, key]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[MEMORY] getMemory error:', (err as Error).message);
    return null;
  }
}

export async function searchMemory(
  agentId: string,
  query: string,
  limit: number = 10
): Promise<AgentMemory[]> {
  try {
    const res = await pool.query(
      `SELECT * FROM agent_memory
       WHERE agent_id = $1
         AND (key ILIKE $2 OR value::text ILIKE $2)
       ORDER BY last_accessed_at DESC
       LIMIT $3`,
      [agentId, `%${query}%`, limit]
    );
    return res.rows;
  } catch (err) {
    console.error('[MEMORY] searchMemory error:', (err as Error).message);
    return [];
  }
}

export async function deleteMemory(agentId: string, sessionId: string, key: string): Promise<boolean> {
  try {
    await pool.query(
      'DELETE FROM agent_memory WHERE agent_id = $1 AND session_id = $2 AND key = $3',
      [agentId, sessionId, key]
    );
    return true;
  } catch (err) {
    console.error('[MEMORY] deleteMemory error:', (err as Error).message);
    return false;
  }
}

export async function saveSession(agentId: string, sessionId: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO agent_memory (agent_id, session_id, memory_type, key, value, role, content, created_at, last_accessed_at, access_count)
       VALUES ($1, $2, 'semantic', '_session_meta', $3::jsonb, 'assistant', $3::text, NOW(), NOW(), 1)
       ON CONFLICT (agent_id, key)
       DO UPDATE SET last_accessed_at = NOW(), access_count = agent_memory.access_count + 1`,
      [agentId, sessionId, JSON.stringify({ created_at: new Date().toISOString(), agent_id: agentId, session_id: sessionId })]
    );
  } catch (err) {
    console.error('[MEMORY] saveSession error:', (err as Error).message);
  }
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE agent_memory SET last_accessed_at = NOW(), access_count = access_count + 1
       WHERE session_id = $1 AND key = '_session_meta'`,
      [sessionId]
    );
  } catch (err) {
    console.error('[MEMORY] updateSessionActivity error:', (err as Error).message);
  }
}

export async function listSessions(agentId: string): Promise<AgentSession[]> {
  try {
    const res = await pool.query(
      `SELECT agent_id, session_id, created_at,
              last_accessed_at AS last_active
       FROM agent_memory
       WHERE agent_id = $1 AND key = '_session_meta'
       ORDER BY last_accessed_at DESC`,
      [agentId]
    );
    return res.rows;
  } catch (err) {
    console.error('[MEMORY] listSessions error:', (err as Error).message);
    return [];
  }
}

export async function cleanupStaleSessions(maxAgeMinutes: number = 60): Promise<number> {
  try {
    const res = await pool.query(
      `DELETE FROM agent_memory
       WHERE key = '_session_meta'
         AND last_accessed_at < NOW() - ($1 || ' minutes')::interval
       RETURNING id`,
      [maxAgeMinutes]
    );
    return res.rowCount || 0;
  } catch (err) {
    console.error('[MEMORY] cleanupStaleSessions error:', (err as Error).message);
    return 0;
  }
}
