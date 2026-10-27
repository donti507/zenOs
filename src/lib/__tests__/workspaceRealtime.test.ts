import { expect, it } from 'vitest';
import { mapTask, mergeWorkspaceChange, insertWorkspaceRow, readWorkspaceChange, type WorkspaceTable } from '../workspaceRealtime';
import type { ZenosState } from '../../types';
const owner='owner-a';
const empty = (): ZenosState => ({view:'calendar',calYear:2026,calMonth:9,theme:'dark',tasks:[],categories:[],meetings:[],vault:[],specialTasks:[],danteHistory:[],completionLog:[],filterCat:null});
const change = (table: WorkspaceTable, operation: string, row: any) => readWorkspaceChange({payload:{schema:'public',table,operation,record:operation==='DELETE'?null:row,old_record:operation==='DELETE'?row:null}},owner)!;
it.each(['tasks','categories','meetings','vault_items'] as const)('merges %s events by primary key without duplicates and removes deletes', table => {
  const row={id:'row-1',user_id:owner,title:'Task',label:'Work',subject:'Meeting',name:'Link',person_name:'Anna',elapsed_seconds:5,added_at:'2026-10-27',created_at:'2026-10-27'};
  const key=table==='vault_items'?'vault':table;
  let state=empty();
  state=mergeWorkspaceChange(state,change(table,'INSERT',row));
  state=mergeWorkspaceChange(state,change(table,'INSERT',row));
  state=mergeWorkspaceChange(state,change(table,'UPDATE',{...row,title:'New task',label:'New category',subject:'New meeting',name:'New link'}));
  expect(state[key]).toHaveLength(1);
  expect(state[key][0]).toMatchObject({id:'row-1'});
  expect(state.theme).toBe('dark'); expect(state.view).toBe('calendar');
  state=mergeWorkspaceChange(state,change(table,'DELETE',row)); expect(state[key]).toHaveLength(0);
});
it('maps all persisted task/meeting fields and derives completion history from remote tasks',()=>{
  const row={id:'task',user_id:owner,title:'Review',status:'done',completed_at:'2026-10-27T12:00:00Z',postponed_count:4,recurrence:'weekly',recurrence_day:27,recurrence_source_id:'parent',exam_plan:{id:'plan'},steps:[{label:'Read',done:true}]};
  const state=mergeWorkspaceChange(empty(),change('tasks','UPDATE',row));
  expect(state.tasks[0]).toMatchObject({postponedCount:4,completedAt:row.completed_at,recurrenceSourceId:'parent',recurrenceDay:27,examPlan:{id:'plan'},steps:row.steps});
  expect(state.completionLog).toHaveLength(1);
  const reopened=mergeWorkspaceChange(state,change('tasks','UPDATE',{...row,status:'todo',completed_at:null})); expect(reopened.completionLog).toHaveLength(0);
  const meeting=mergeWorkspaceChange(empty(),change('meetings','INSERT',{id:'meet',user_id:owner,person_name:'Anna',elapsed_seconds:23,google_event_id:'g1',created_at:'2026-10-27'}));
  expect(meeting.meetings?.[0]).toMatchObject({personName:'Anna',elapsedSeconds:23,googleEventId:'g1',createdAt:'2026-10-27'});
});
it('rejects foreign, unowned, malformed, or unrelated payloads including unfiltered deletes',()=>{
  for(const row of [{id:'x',user_id:'someone-else'},{id:'x'},{user_id:owner}]) expect(change('tasks','DELETE',row)).toBeNull();
  expect(readWorkspaceChange({payload:{schema:'public',table:'google_tokens',operation:'INSERT',record:{id:'x',user_id:owner}}},owner)).toBeNull();
  expect(readWorkspaceChange({},owner)).toBeNull();
});
it('merges UPDATE before INSERT and preserves a newer event when a local insert response arrives later',()=>{
  const row={id:'x',user_id:owner,title:'newest'};
  let state=mergeWorkspaceChange(empty(),change('tasks','UPDATE',row));
  state=insertWorkspaceRow(state,'tasks',{...row,title:'older API response'});
  expect(state.tasks).toHaveLength(1); expect(state.tasks[0].title).toBe('newest');
  state=insertWorkspaceRow(empty(),'tasks',row);
  state=mergeWorkspaceChange(state,change('tasks','INSERT',row)); expect(state.tasks).toHaveLength(1);
});
it('heals pre-existing duplicate rows when a full update is merged',()=>{
  const task=mapTask({id:'x',title:'old'});const state={...empty(),tasks:[task,task]};
  expect(mergeWorkspaceChange(state,change('tasks','UPDATE',{id:'x',user_id:owner,title:'new'})).tasks).toHaveLength(1);
});
