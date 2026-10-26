import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompt';
import { loadLLMConfig, describeConfigProblem } from '../llm';

describe('buildSystemPrompt', () => {
  it('includes the user’s tasks and date', () => {
    const p = buildSystemPrompt({ userName: 'Anna', now: { date: '2026-10-26' }, tasks: [{ id: '1', title: 'Write report', status: 'todo', date: '2026-10-27', cat: 'r' }] });
    expect(p).toContain('Anna');
    expect(p).toContain('2026-10-26');
    expect(p).toContain('"Write report"');
  });
  it('adds voice rules only in voice mode', () => {
    expect(buildSystemPrompt({ mode: 'voice' })).toContain('VOICE MODE');
    expect(buildSystemPrompt({})).not.toContain('VOICE MODE');
  });
  it('caps huge or hostile context', () => {
    const tasks = Array.from({ length: 500 }, (_, i) => ({ id: String(i), title: 'x'.repeat(5000), status: 'todo' }));
    expect(buildSystemPrompt({ tasks }).length).toBeLessThan(40000);
  });
});

describe('LLM config', () => {
  it('detects an OpenAI-compatible provider from LLM_BASE_URL', () => {
    const cfg = loadLLMConfig({ LLM_BASE_URL: 'https://llm.example/v1/', LLM_MODEL: 'm', LLM_API_KEY: 'k' } as any);
    expect(cfg.provider).toBe('openai');
    expect(cfg.baseUrl).toBe('https://llm.example/v1');
    expect(describeConfigProblem(cfg)).toBeNull();
  });
  it('explains what is missing', () => {
    expect(describeConfigProblem(loadLLMConfig({} as any))).toMatch(/No AI provider/);
    expect(describeConfigProblem(loadLLMConfig({ LLM_BASE_URL: 'https://x/v1' } as any))).toMatch(/LLM_MODEL/);
  });
});
