import { describe, it, expect, vi } from 'vitest';
import { runDanteActions, ActionDeps } from '../danteActions';
import { ZenosState, Task } from '../../types';

const task = (over: Partial<Task>): Task => ({ id: 't1', title: 'Write report', cat: 'research', status: 'todo', date: '', reminder: '', note: '', progress: 0, steps: [], ...over });

function setup(tasks: Task[] = [task({})]) {
  const state = {
    tasks,
    categories: [{ id: 'research', label: 'Research', color: '' }, { id: 'other', label: 'Other', color: '' }],
  } as unknown as ZenosState;
  const deps: ActionDeps = {
    stateRef: { current: state },
    addTask: vi.fn(async t => ({ ...t, id: 'new' } as Task)),
    editTask: vi.fn(async () => {}),
    toggleTaskDone: vi.fn(async () => {}),
    addMeeting: vi.fn(async m => ({ ...m, id: 'm1', createdAt: '' })),
    updateState: vi.fn(),
  };
  return deps;
}

describe('runDanteActions', () => {
  it('creates a task with a valid category and date', async () => {
    const deps = setup();
    const [r] = await runDanteActions([{ action: 'create_task', data: { title: 'Call bank', cat: 'Research', date: '2026-10-27' } }], deps);
    expect(r.ok).toBe(true);
    expect(deps.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call bank', cat: 'research', date: '2026-10-27' }));
  });

  it('falls back to "Other" for an unknown category and ignores invalid dates', async () => {
    const deps = setup();
    await runDanteActions([{ action: 'create_task', data: { title: 'X', cat: 'nope', date: 'next friday' } }], deps);
    const arg = (deps.addTask as any).mock.calls[0][0];
    expect(arg.cat).toBe('other');
    expect(arg.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses to create a task without a title', async () => {
    const deps = setup();
    const [r] = await runDanteActions([{ action: 'create_task', data: {} }], deps);
    expect(r.ok).toBe(false);
    expect(deps.addTask).not.toHaveBeenCalled();
  });

  it('completes a task found by id', async () => {
    const deps = setup();
    const [r] = await runDanteActions([{ action: 'complete_task', data: { id: 't1' } }], deps);
    expect(r.ok).toBe(true);
    expect(deps.toggleTaskDone).toHaveBeenCalledWith('t1');
  });

  it('does not toggle a task that is already done', async () => {
    const deps = setup([task({ status: 'done' })]);
    await runDanteActions([{ action: 'complete_task', data: { id: 't1' } }], deps);
    expect(deps.toggleTaskDone).not.toHaveBeenCalled();
  });

  it('never matches a task with an empty title (old bug)', async () => {
    const deps = setup();
    const [r] = await runDanteActions([{ action: 'complete_task', data: { title: '' } }], deps);
    expect(r.ok).toBe(false);
    expect(deps.toggleTaskDone).not.toHaveBeenCalled();
  });

  it('refuses ambiguous title matches', async () => {
    const deps = setup([task({ id: 'a', title: 'Report draft' }), task({ id: 'b', title: 'Report final' })]);
    const [r] = await runDanteActions([{ action: 'complete_task', data: { title: 'report' } }], deps);
    expect(r.ok).toBe(false);
  });

  it('validates views and rejects unknown actions', async () => {
    const deps = setup();
    const res = await runDanteActions([
      { action: 'switch_view', data: { view: 'calendar' } },
      { action: 'switch_view', data: { view: 'hacker' } },
      { action: 'delete_everything' },
    ], deps);
    expect(res.map(r => r.ok)).toEqual([true, false, false]);
    expect(deps.updateState).toHaveBeenCalledWith({ view: 'calendar' });
  });

  it('schedules a meeting with a normalised time', async () => {
    const deps = setup();
    await runDanteActions([{ action: 'create_meeting', data: { personName: 'Anna', date: '2026-10-30', time: '9:30', subject: 'Sync' } }], deps);
    expect(deps.addMeeting).toHaveBeenCalledWith(expect.objectContaining({ time: '09:30', date: '2026-10-30' }));
  });

  it('runs at most 10 actions', async () => {
    const deps = setup();
    const many = Array.from({ length: 15 }, () => ({ action: 'switch_view', data: { view: 'vault' } }));
    expect(await runDanteActions(many, deps)).toHaveLength(10);
  });
});

describe('Dante repeat actions', () => {
  it.each(['none','daily','weekdays','weekly','monthly'])('creates and updates tasks with repeat=%s', async repeat => {
    const deps=setup();
    const results=await runDanteActions([{action:'create_task',data:{title:'Routine',repeat}},{action:'update_task',data:{id:'t1',repeat}}],deps);
    expect(results.every(r=>r.ok)).toBe(true);
    expect(deps.addTask).toHaveBeenCalledWith(expect.objectContaining({recurrence:repeat}));
    expect(deps.editTask).toHaveBeenCalledWith('t1',expect.objectContaining({recurrence:repeat}));
  });
  it('rejects invalid repeat values before writing',async()=>{
    const deps=setup();
    const results=await runDanteActions([{action:'create_task',data:{title:'Routine',repeat:'yearly'}},{action:'update_task',data:{id:'t1',repeat:{daily:true}}}],deps);
    expect(results.every(r=>!r.ok)).toBe(true);expect(deps.addTask).not.toHaveBeenCalled();expect(deps.editTask).not.toHaveBeenCalled();
  });
});

describe('task breakdown steps',()=>{
 it('appends steps without replacing existing checklist state or moving the date',async()=>{
  const deps=setup([task({steps:[{label:'Existing',done:true}]})]);
  const [result]=await runDanteActions([{action:'add_task_steps',data:{id:'t1',steps:['Open the document','Write one sentence','Read it once']}}],deps);
  expect(result.ok).toBe(true);
  expect(deps.editTask).toHaveBeenCalledWith('t1',{steps:[{label:'Existing',done:true},{label:'Open the document',done:false},{label:'Write one sentence',done:false},{label:'Read it once',done:false}],progress:25});
 });
 it('validates labels and avoids duplicate steps on a replay',async()=>{
  const deps=setup([task({steps:[{label:'Open it',done:false}]})]);
  const results=await runDanteActions([{action:'add_task_steps',data:{id:'t1',steps:['  OPEN IT  ']}},{action:'add_task_steps',data:{id:'t1',steps:[{label:'bad'}]}}],deps);
  expect(results.map(r=>r.ok)).toEqual([true,false]);expect(deps.editTask).not.toHaveBeenCalled();
 });
});

describe('durable memory actions',()=>{
  const memory={id:'fact-1',fact:'I prefer mornings',createdAt:'2026-10-27T10:00:00Z'};
  it('validates facts and delegates quota enforcement to the persistence layer',async()=>{
    const deps={...setup(),rememberFact:vi.fn().mockResolvedValue(memory)};
    expect((await runDanteActions([{action:'remember',data:{fact:'  I prefer mornings  '}}],deps))[0].ok).toBe(true);
    expect(deps.rememberFact).toHaveBeenCalledWith('I prefer mornings');
    for(const fact of ['', 'x'.repeat(201), {}, 123])expect((await runDanteActions([{action:'remember',data:{fact}}],deps))[0].ok).toBe(false);
    deps.rememberFact.mockRejectedValue(new Error('100 facts maximum'));
    expect((await runDanteActions([{action:'remember',data:{fact:'one more'}}],deps))[0]).toMatchObject({ok:false,detail:'100 facts maximum'});
  });
  it('never forgets unknown IDs or deletes without an explicit confirmation',async()=>{
    const deps={...setup(),forgetFact:vi.fn().mockResolvedValue(undefined),confirmForgetFact:vi.fn().mockResolvedValue(false)};
    deps.stateRef.current.danteMemory=[memory];
    expect((await runDanteActions([{action:'forget',data:{id:'unknown'}}],deps))[0].ok).toBe(false);expect(deps.confirmForgetFact).not.toHaveBeenCalled();
    expect((await runDanteActions([{action:'forget',data:{id:memory.id}}],deps))[0].detail).toBe('Canceled');expect(deps.forgetFact).not.toHaveBeenCalled();
    deps.confirmForgetFact.mockResolvedValue(true);
    expect((await runDanteActions([{action:'forget',data:{id:memory.id}}],deps))[0].ok).toBe(true);expect(deps.forgetFact).toHaveBeenCalledWith(memory.id);
    deps.confirmForgetFact=undefined as any;deps.forgetFact.mockClear();
    expect((await runDanteActions([{action:'forget',data:{id:memory.id}}],deps))[0].ok).toBe(false);expect(deps.forgetFact).not.toHaveBeenCalled();
  });
});

describe('voice page editing',()=>{
 it('requires an explicit host-scoped handler and ignores model-supplied page/model targets',async()=>{
  const action={action:'edit_space_page',data:{instruction:' add a timer ',pageId:'foreign',model:'foreign'}};
  expect((await runDanteActions([action],setup()))[0].ok).toBe(false);
  const editSpacePageFromVoice=vi.fn().mockResolvedValue(undefined);
  const deps={...setup(),editSpacePageFromVoice};
  expect((await runDanteActions([action],deps))[0].ok).toBe(true);
  expect(editSpacePageFromVoice).toHaveBeenCalledWith('add a timer');
  for(const instruction of ['', 'x'.repeat(2001),{}]) expect((await runDanteActions([{action:'edit_space_page',data:{instruction}}],deps))[0].ok).toBe(false);
  expect(editSpacePageFromVoice).toHaveBeenCalledTimes(1);
  editSpacePageFromVoice.mockRejectedValueOnce(new Error('Save was not confirmed'));
  expect((await runDanteActions([action],deps))[0]).toMatchObject({ok:false,detail:'Save was not confirmed'});
 });
});

it('stops a Dante action batch if the workspace changes while an earlier edit is saving',async()=>{
 const deps=setup();deps.stateRef.current.workspaceId='team';deps.stateRef.current.workspaceEpoch=1;
 deps.addTask=vi.fn(async task=>{deps.stateRef.current={...deps.stateRef.current,workspaceId:null,workspaceEpoch:2};return {...task,id:'first'};});
 const result=await runDanteActions([{action:'create_task',data:{title:'First'}},{action:'create_task',data:{title:'Second'}}],deps);
 expect(result).toHaveLength(1);expect(deps.addTask).toHaveBeenCalledTimes(1);
});
it('does not let shared Dante change personal facts or My Space pages',async()=>{
 const deps=setup();deps.stateRef.current.workspaceId='team';deps.rememberFact=vi.fn();deps.forgetFact=vi.fn();deps.editSpacePageFromVoice=vi.fn();
 const result=await runDanteActions([{action:'remember',data:{fact:'Secret'}},{action:'forget',data:{id:'fact'}},{action:'edit_space_page',data:{instruction:'change it'}}],deps);
 expect(result.every(row=>!row.ok)).toBe(true);expect(deps.rememberFact).not.toHaveBeenCalled();expect(deps.forgetFact).not.toHaveBeenCalled();expect(deps.editSpacePageFromVoice).not.toHaveBeenCalled();
});
