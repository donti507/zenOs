import { describe, it, expect } from 'vitest';
import { parseActions, visibleText, stripThinking, toSpeech } from '../dante';

const reply = 'Sure, **adding** it.\n```json\n{"actions":[{"action":"create_task","data":{"title":"X"}},{"action":"switch_view","data":{"view":"kanban"}}]}\n```';

describe('parseActions', () => {
  it('reads the {"actions": [...]} format', () => {
    expect(parseActions(reply).map(a => a.action)).toEqual(['create_task', 'switch_view']);
  });
  it('reads a single action object and a bare array', () => {
    expect(parseActions('```json\n{"action":"complete_task","data":{"id":"1"}}\n```')).toHaveLength(1);
    expect(parseActions('```json\n[{"action":"a"},{"action":"b"}]\n```')).toHaveLength(2);
  });
  it('ignores malformed JSON and plain answers', () => {
    expect(parseActions('```json\n{"actions": [oops\n```')).toEqual([]);
    expect(parseActions('Just an answer.')).toEqual([]);
  });
  it('ignores actions inside <think> reasoning', () => {
    expect(parseActions('<think>```json\n{"action":"create_task"}\n```</think>No changes.')).toEqual([]);
  });
});

describe('text helpers', () => {
  it('visibleText hides the action JSON and reasoning', () => {
    expect(visibleText('<think>hmm</think>' + reply)).toBe('Sure, **adding** it.');
  });
  it('visibleText hides a half-streamed json block', () => {
    expect(visibleText('Okay\n```json\n{"act')).toBe('Okay');
  });
  it('stripThinking removes an unfinished <think> block while streaming', () => {
    expect(stripThinking('Hi<think>still thinking')).toBe('Hi');
  });
  it('toSpeech removes markdown and links', () => {
    expect(toSpeech('**Bold** and `code`, see https://x.com')).toBe('Bold and code, see link');
  });
});
